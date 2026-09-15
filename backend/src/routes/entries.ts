import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { db, type TransactionLike } from '../db/index.js';
import {
  entries,
  itemTypes,
  users,
  factions,
  factionMembers,
} from '../db/schema.js';
import { eq, and, sql, desc, gte, lte, ilike } from 'drizzle-orm';
import { success, error } from '../lib/response.js';
import { parsePagination } from '../lib/types.js';
import { resolveSort } from '../lib/sort.js';
import { requireAuth } from '../middleware/auth.js';
import { requireFactionMember, requirePermission } from '../middleware/factionAccess.js';
import { createAuditLog } from '../lib/audit.js';
import { ledgerHoldMessage } from '../lib/ledgerHold.js';
import { dispatchDiscord } from '../lib/discordDispatch.js';
import { resolveAnonymousUserId } from '../lib/anonymous.js';
import { buildWhere } from '../lib/query.js';
import { todayDateString } from '../lib/date.js';

const router = Router({ mergeParams: true });

router.use(requireAuth, requireFactionMember);

/** Escape a user-supplied search string for safe use inside an ilike('%...%')
 *  pattern. Backslash, %, and _ are escaped so they match literally. */
function escapeLike(input: string): string {
  return input.replace(/[%_\\]/g, (m) => '\\' + m);
}

// ── Validation schemas ────────────────────────────────

// 1-13 integer digits, optional .DD — keeps the column's numeric(15,2) range
// intact and rejects anything that Number() would silently coerce (e.g. "1e3").
const amountField = z
  .string()
  .regex(/^\d{1,13}(\.\d{1,2})?$/, 'Amount must be a positive number with up to 2 decimal places')
  .refine((v) => Number(v) > 0, 'Amount must be greater than zero');

const createEntrySchema = z.object({
  itemTypeId: z.string().uuid(),
  amount: amountField,
  description: z.string().max(500).optional(),
  // z.string().date() validates a real calendar date (YYYY-MM-DD), which the
  // old regex did not — 2026-02-31 used to pass.
  entryDate: z.string().date().optional(),
  customValues: z.record(z.string(), z.string().max(500)).optional(),
  /** Log against the anonymous placeholder instead of the caller. */
  anonymous: z.boolean().optional(),
  /**
   * Credit the entry to another member instead of the caller. Someone has to
   * be able to book what a member handed in — most of all a member registered
   * by Discord ID who has never signed in and so cannot log anything.
   */
  userId: z.string().uuid().optional(),
}).refine(
  (d) => !(d.anonymous && d.userId),
  'An entry is either anonymous or credited to a member, not both',
);

const updateEntrySchema = z.object({
  amount: amountField.optional(),
  description: z.string().max(500).nullable().optional(),
  entryDate: z.string().date().optional(),
  customValues: z.record(z.string(), z.string().max(500)).optional(),
});

const listEntriesQuerySchema = z.object({
  sort: z.string().max(40).optional(),
  dir: z.enum(['asc', 'desc']).optional(),
  item_type_id: z.string().uuid().optional(),
  user_id: z.string().uuid().optional(),
  date_from: z.string().date().optional(),
  date_to: z.string().date().optional(),
  search: z.string().max(200).optional(),
  page: z.string().optional(),
  page_size: z.string().optional(),
});

// ── POST / — log new entry ───────────────────────────
router.post('/', async (req: Request, res: Response) => {
  if (!req.factionRole) {
    error(res, 'FORBIDDEN', 'You must be a member of this faction to log entries', 403);
    return;
  }

  const parsed = createEntrySchema.safeParse(req.body);
  if (!parsed.success) {
    error(res, 'VALIDATION_ERROR', parsed.error.issues[0]!.message);
    return;
  }

  const factionId = req.params.id as string;
  const { itemTypeId, amount, description, entryDate, customValues, anonymous } = parsed.data;
  // Logging for yourself is the ordinary case, and naming yourself explicitly
  // is the same thing.
  const onBehalfOf = parsed.data.userId && parsed.data.userId !== req.user!.id
    ? parsed.data.userId
    : undefined;

  // A superadmin browsing a faction they do not belong to may still book an
  // entry, but never onto themselves. `ownerId` below falls back to the caller,
  // and they are not on this roster — the credit would land on a contributor
  // the leaderboard, the member totals and the quota progress have no row for.
  // So they have to say whose it is: a member's, or, anonymously, the faction's
  // own. A superadmin who actually joined the faction takes their membership
  // role instead and logs for themselves like anyone else.
  if (req.factionRole === 'superadmin' && !anonymous && !onBehalfOf) {
    error(
      res,
      'FORBIDDEN',
      'You are not a member of this faction — log the entry for a member, or anonymously',
      403,
    );
    return;
  }

  // Anonymising an entry, or hanging it on someone else, decides who gets
  // credit for faction income — the same authority as editing entries after
  // the fact.
  if (anonymous && !(req.factionPermissions ?? []).includes('manage_entries')) {
    error(res, 'FORBIDDEN', 'You need the "manage_entries" permission to log anonymously', 403);
    return;
  }
  if (onBehalfOf && !(req.factionPermissions ?? []).includes('manage_entries')) {
    error(
      res,
      'FORBIDDEN',
      'You need the "manage_entries" permission to log an entry for another member',
      403,
    );
    return;
  }

  // The credit has to land on someone who is actually in this faction.
  if (onBehalfOf) {
    const [target] = await db
      .select({ id: factionMembers.id })
      .from(factionMembers)
      .where(
        and(eq(factionMembers.factionId, factionId), eq(factionMembers.userId, onBehalfOf)),
      )
      .limit(1);
    if (!target) {
      error(res, 'NOT_FOUND', 'Member not found in this faction', 404);
      return;
    }
  }

  // Validate custom fields against faction definition
  let validatedCustomValues: Record<string, string> | null = null;
  if (customValues && Object.keys(customValues).length > 0) {
    const [faction] = await db
      .select({ customFields: factions.customFields })
      .from(factions)
      .where(eq(factions.id, factionId))
      .limit(1);
    const fields = faction?.customFields ?? [];
    const fieldNames = new Set(fields.map((f: { name: string }) => f.name));
    // Only keep values that match defined custom fields
    const filtered: Record<string, string> = {};
    for (const [key, val] of Object.entries(customValues)) {
      if (fieldNames.has(key) && val.trim()) {
        filtered[key] = val.trim();
      }
    }
    // Check required fields are present
    for (const f of fields) {
      if (f.required && !filtered[f.name]) {
        error(res, 'VALIDATION_ERROR', `Required custom field "${f.name}" is missing`);
        return;
      }
    }
    validatedCustomValues = Object.keys(filtered).length > 0 ? filtered : null;
  } else {
    // Check if there are required custom fields with no values provided
    const [faction] = await db
      .select({ customFields: factions.customFields })
      .from(factions)
      .where(eq(factions.id, factionId))
      .limit(1);
    const requiredFields = (faction?.customFields ?? []).filter((f: { required: boolean }) => f.required);
    if (requiredFields.length > 0) {
      const missing = requiredFields.map((f: { name: string }) => f.name).join(', ');
      error(res, 'VALIDATION_ERROR', `Required custom fields: ${missing}`);
      return;
    }
  }

  // Validate item type belongs to this faction and is active
  const [itemType] = await db
    .select()
    .from(itemTypes)
    .where(and(eq(itemTypes.id, itemTypeId), eq(itemTypes.factionId, factionId)))
    .limit(1);
  if (!itemType) {
    error(res, 'NOT_FOUND', 'Item type not found in this faction', 404);
    return;
  }
  if (!itemType.isActive) {
    error(res, 'BAD_REQUEST', 'This item type is currently disabled');
    return;
  }

  // Future-dated entries have nothing to back-date against; the entry_date
  // column drives dashboards and leaderboards and would mislead them.
  const dateStr = entryDate ?? todayDateString();
  if (dateStr > todayDateString()) {
    error(res, 'VALIDATION_ERROR', 'Entry date cannot be in the future');
    return;
  }

  let entry;
  try {
    entry = await db.transaction(async (tx: TransactionLike) => {
      const ownerId = anonymous
        ? await resolveAnonymousUserId(tx)
        : (onBehalfOf ?? req.user!.id);

      const [row] = await tx
        .insert(entries)
        .values({
          factionId,
          userId: ownerId,
          itemTypeId,
          amount,
          description: description ?? null,
          entryDate: dateStr,
          customValues: validatedCustomValues,
        })
        .returning();

      if (!row) throw new Error('Failed to create entry');

      // Keep amount as a string — the column is decimal, so JS strings round-trip
      // exactly where Number would lose precision past 2^53.
      // The audit log records who actually did it. Anonymous hides the name
      // from the leaderboard, not from the faction's own history.
      await createAuditLog({
        userId: req.user!.id,
        factionId,
        action: 'create',
        entityType: 'entry',
        entityId: row.id,
        details: {
          itemTypeId,
          amount,
          description,
          entryDate: dateStr,
          customValues: validatedCustomValues,
          ...(anonymous ? { anonymous: true } : {}),
          ...(onBehalfOf ? { onBehalfOf } : {}),
        },
        req,
        tx,
      });

      return row;
    });
  } catch (err) {
    console.error('[CREATE ENTRY ERROR]', err);
    error(res, 'INTERNAL_ERROR', 'Failed to create entry', 500);
    return;
  }

  // Not awaited: a Discord round trip is a couple of hundred milliseconds and
  // nobody logging an entry should wait for one. dispatchDiscord never
  // rejects, so there is no unhandled rejection to leak.
  void dispatchDiscord(factionId, {
    type: 'entry_logged',
    actorUserId: entry.userId,
    itemTypeId: entry.itemTypeId,
    amount: entry.amount,
    description: entry.description,
    anonymous,
  });

  success(res, entry, 201);
});

// ── GET / — list entries with filters ───────────────
router.get('/', async (req: Request, res: Response) => {
  const factionId = req.params.id as string;

  const query = listEntriesQuerySchema.safeParse(req.query);
  if (!query.success) {
    error(res, 'VALIDATION_ERROR', query.error.issues[0]!.message);
    return;
  }

  const { item_type_id, user_id, date_from, date_to, search, page: pageStr, page_size: pageSizeStr } = query.data;
  const { page, pageSize, offset } = parsePagination({ page: pageStr, page_size: pageSizeStr });

  const where = buildWhere([
    eq(entries.factionId, factionId),
    eq(entries.isDeleted, false),
    item_type_id ? eq(entries.itemTypeId, item_type_id) : undefined,
    user_id ? eq(entries.userId, user_id) : undefined,
    date_from ? gte(entries.entryDate, date_from) : undefined,
    date_to ? lte(entries.entryDate, date_to) : undefined,
    search ? ilike(entries.description, `%${escapeLike(search)}%`) : undefined,
  ]);

  const [items, countResult] = await Promise.all([
    db
      .select({
        id: entries.id,
        amount: entries.amount,
        description: entries.description,
        entryDate: entries.entryDate,
        createdAt: entries.createdAt,
        updatedAt: entries.updatedAt,
        customValues: entries.customValues,
        userId: entries.userId,
        username: users.username,
        inGameName: users.inGameName,
        avatarUrl: users.avatarUrl,
        itemTypeName: itemTypes.name,
        itemUnit: itemTypes.unit,
        itemIsCurrency: itemTypes.isCurrency,
        itemImageUrl: itemTypes.imageUrl,
      itemIcon: itemTypes.icon,
      itemCategory: itemTypes.category,
      })
      .from(entries)
      .innerJoin(users, eq(entries.userId, users.id))
      .innerJoin(itemTypes, eq(entries.itemTypeId, itemTypes.id))
      .where(where)
      .orderBy(...resolveSort(
        query.data,
        {
          date: entries.entryDate,
          amount: entries.amount,
          member: users.username,
          type: itemTypes.name,
        },
        { key: 'date', dir: 'desc' },
        entries.createdAt,
      ))
      .limit(pageSize)
      .offset(offset),
    db
      .select({ count: sql<number>`COUNT(*)::int` })
      .from(entries)
      .where(where),
  ]);

  const totalCount = countResult[0]?.count ?? 0;
  success(res, items, 200, { page, page_size: pageSize, total_count: totalCount });
});

// ── PATCH /:entryId — edit entry (admin only) ───────
router.patch('/:entryId', requirePermission('manage_entries'), async (req: Request, res: Response) => {
  const factionId = req.params.id as string;
  const entryId = req.params.entryId as string;

  const parsed = updateEntrySchema.safeParse(req.body);
  if (!parsed.success) {
    error(res, 'VALIDATION_ERROR', parsed.error.issues[0]!.message);
    return;
  }

  const [existing] = await db
    .select()
    .from(entries)
    .where(and(eq(entries.id, entryId), eq(entries.factionId, factionId), eq(entries.isDeleted, false)))
    .limit(1);
  if (!existing) {
    error(res, 'NOT_FOUND', 'Entry not found', 404);
    return;
  }

  // A craft's or a sale's movements are not independently editable;
  // see ledgerHoldMessage.
  const heldBy = await ledgerHoldMessage({ entryIds: [entryId] });
  if (heldBy) {
    error(res, 'VALIDATION_ERROR', heldBy);
    return;
  }

  const updates: Record<string, unknown> = { updatedAt: new Date() };
  if (parsed.data.amount !== undefined) updates.amount = parsed.data.amount;
  if (parsed.data.description !== undefined) updates.description = parsed.data.description;
  if (parsed.data.entryDate !== undefined) {
    if (parsed.data.entryDate > todayDateString()) {
      error(res, 'VALIDATION_ERROR', 'Entry date cannot be in the future');
      return;
    }
    updates.entryDate = parsed.data.entryDate;
  }
  if (parsed.data.customValues !== undefined) {
    // Validate custom values against faction definition
    const [faction] = await db
      .select({ customFields: factions.customFields })
      .from(factions)
      .where(eq(factions.id, factionId))
      .limit(1);
    const fields = faction?.customFields ?? [];
    const fieldNames = new Set(fields.map((f: { name: string }) => f.name));
    const filtered: Record<string, string> = {};
    for (const [key, val] of Object.entries(parsed.data.customValues)) {
      if (fieldNames.has(key) && val.trim()) {
        filtered[key] = val.trim();
      }
    }
    for (const f of fields) {
      if (f.required && !filtered[f.name]) {
        error(res, 'VALIDATION_ERROR', `Required custom field "${f.name}" is missing`);
        return;
      }
    }
    updates.customValues = Object.keys(filtered).length > 0 ? filtered : null;
  }

  let updated;
  try {
    updated = await db.transaction(async (tx: TransactionLike) => {
      const [row] = await tx
        .update(entries)
        .set(updates)
        .where(eq(entries.id, entryId))
        .returning();

      await createAuditLog({
        userId: req.user!.id,
        factionId,
        action: 'update',
        entityType: 'entry',
        entityId: entryId,
        details: {
          before: { amount: existing.amount, description: existing.description, entryDate: existing.entryDate, customValues: existing.customValues },
          after: updates,
        },
        req,
        tx,
      });

      return row;
    });
  } catch (err) {
    console.error('[UPDATE ENTRY ERROR]', err);
    error(res, 'INTERNAL_ERROR', 'Failed to update entry', 500);
    return;
  }

  success(res, updated);
});

// ── DELETE /:entryId — soft-delete entry (admin) ────
// A member may undo their OWN entry for a few minutes after logging it —
// a typo'd amount should not require an admin. Past the window, `manage_entries`
// is the only key.
const UNDO_WINDOW_MS = 5 * 60 * 1000;

router.delete('/:entryId', async (req: Request, res: Response) => {
  const factionId = req.params.id as string;
  const entryId = req.params.entryId as string;

  const [existing] = await db
    .select()
    .from(entries)
    .where(and(eq(entries.id, entryId), eq(entries.factionId, factionId), eq(entries.isDeleted, false)))
    .limit(1);
  if (!existing) {
    error(res, 'NOT_FOUND', 'Entry not found', 404);
    return;
  }

  // A craft's or a sale's movements are not independently editable;
  // see ledgerHoldMessage.
  const heldBy = await ledgerHoldMessage({ entryIds: [entryId] });
  if (heldBy) {
    error(res, 'VALIDATION_ERROR', heldBy);
    return;
  }

  const canManage = (req.factionPermissions ?? []).includes('manage_entries');
  const isMine = existing.userId === req.user!.id;
  const withinUndo = isMine && Date.now() - new Date(existing.createdAt).getTime() <= UNDO_WINDOW_MS;
  if (!canManage && !withinUndo) {
    error(res, 'FORBIDDEN', isMine
      ? 'Entries can only be undone within 5 minutes of logging them'
      : 'You can only remove your own entries', 403);
    return;
  }

  try {
    await db.transaction(async (tx: TransactionLike) => {
      await tx
        .update(entries)
        .set({ isDeleted: true, updatedAt: new Date() })
        .where(eq(entries.id, entryId));

      await createAuditLog({
        userId: req.user!.id,
        factionId,
        action: 'delete',
        entityType: 'entry',
        entityId: entryId,
        details: { amount: existing.amount, itemTypeId: existing.itemTypeId, entryDate: existing.entryDate, ...(withinUndo && !canManage ? { selfUndone: true } : {}) },
        req,
        tx,
      });
    });
  } catch (err) {
    console.error('[DELETE ENTRY ERROR]', err);
    error(res, 'INTERNAL_ERROR', 'Failed to delete entry', 500);
    return;
  }

  void dispatchDiscord(factionId, {
    type: 'entry_deleted',
    actorUserId: req.user!.id,
    ownerUserId: existing.userId,
    itemTypeId: existing.itemTypeId,
    amount: existing.amount,
    selfUndone: withinUndo && !canManage,
  });

  success(res, { id: entryId, deleted: true });
});

export default router;
