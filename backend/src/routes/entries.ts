import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { db } from '../db/index.js';
import { entries, itemTypes, users, factions } from '../db/schema.js';
import { eq, and, sql, desc, gte, lte, ilike } from 'drizzle-orm';
import { success, error } from '../lib/response.js';
import { parsePagination } from '../lib/types.js';
import { requireAuth } from '../middleware/auth.js';
import { requireFactionMember, requireFactionAdminOrSuperadmin } from '../middleware/factionAccess.js';
import { createAuditLog } from '../lib/audit.js';
import { buildWhere } from '../lib/query.js';
import { todayDateString } from '../lib/date.js';

const router = Router({ mergeParams: true });

router.use(requireAuth, requireFactionMember);

// ── Validation schemas ────────────────────────────────

const createEntrySchema = z.object({
  itemTypeId: z.string().uuid(),
  amount: z.string().refine(
    (v) => !isNaN(Number(v)) && Number(v) > 0,
    'Amount must be a positive number',
  ),
  description: z.string().max(500).optional(),
  entryDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  customValues: z.record(z.string(), z.string().max(500)).optional(),
});

const updateEntrySchema = z.object({
  amount: z.string().refine(
    (v) => !isNaN(Number(v)) && Number(v) > 0,
    'Amount must be a positive number',
  ).optional(),
  description: z.string().max(500).nullable().optional(),
  entryDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  customValues: z.record(z.string(), z.string().max(500)).optional(),
});

const listEntriesQuerySchema = z.object({
  item_type_id: z.string().uuid().optional(),
  user_id: z.string().uuid().optional(),
  date_from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  date_to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  search: z.string().max(200).optional(),
  page: z.string().optional(),
  page_size: z.string().optional(),
});

// ── POST / — log new entry ───────────────────────────
router.post('/', async (req: Request, res: Response) => {
  // If user has no faction membership role (e.g. superadmin browsing
  // a faction they don't belong to), they cannot log entries.
  // Superadmins who are also faction members/admins CAN log entries.
  if (!req.factionRole || req.factionRole === 'superadmin') {
    error(res, 'FORBIDDEN', 'You must be a member of this faction to log entries', 403);
    return;
  }

  const parsed = createEntrySchema.safeParse(req.body);
  if (!parsed.success) {
    error(res, 'VALIDATION_ERROR', parsed.error.issues[0]!.message);
    return;
  }

  const factionId = req.params.id as string;
  const { itemTypeId, amount, description, entryDate, customValues } = parsed.data;

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

  // Validate date is not in the future
  const date = entryDate ? new Date(entryDate + 'T00:00:00') : new Date();
  const today = new Date();
  today.setHours(23, 59, 59, 999);
  if (date > today) {
    error(res, 'VALIDATION_ERROR', 'Entry date cannot be in the future');
    return;
  }

  const [entry] = await db
    .insert(entries)
    .values({
      factionId,
      userId: req.user!.id,
      itemTypeId,
      amount: amount,
      description: description ?? null,
      entryDate: entryDate ?? todayDateString(),
      customValues: validatedCustomValues,
    })
    .returning();

  if (!entry) {
    error(res, 'INTERNAL_ERROR', 'Failed to create entry', 500);
    return;
  }

  await createAuditLog({
    userId: req.user!.id,
    factionId,
    action: 'create',
    entityType: 'entry',
    entityId: entry.id,
    details: { itemTypeId, amount: Number(amount), description, entryDate, customValues: validatedCustomValues },
    req,
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
    search ? ilike(entries.description, `%${search}%`) : undefined,
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
        avatarUrl: users.avatarUrl,
        itemTypeName: itemTypes.name,
        itemUnit: itemTypes.unit,
      })
      .from(entries)
      .innerJoin(users, eq(entries.userId, users.id))
      .innerJoin(itemTypes, eq(entries.itemTypeId, itemTypes.id))
      .where(where)
      .orderBy(desc(entries.createdAt))
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
router.patch('/:entryId', requireFactionAdminOrSuperadmin, async (req: Request, res: Response) => {
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

  const updates: Record<string, unknown> = { updatedAt: new Date() };
  if (parsed.data.amount !== undefined) updates.amount = parsed.data.amount;
  if (parsed.data.description !== undefined) updates.description = parsed.data.description;
  if (parsed.data.entryDate !== undefined) updates.entryDate = parsed.data.entryDate;
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

  const [updated] = await db
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
  });

  success(res, updated);
});

// ── DELETE /:entryId — soft-delete entry (admin) ────
router.delete('/:entryId', requireFactionAdminOrSuperadmin, async (req: Request, res: Response) => {
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

  await db
    .update(entries)
    .set({ isDeleted: true, updatedAt: new Date() })
    .where(eq(entries.id, entryId));

  await createAuditLog({
    userId: req.user!.id,
    factionId,
    action: 'delete',
    entityType: 'entry',
    entityId: entryId,
    details: { amount: existing.amount, itemTypeId: existing.itemTypeId, entryDate: existing.entryDate },
    req,
  });

  success(res, { id: entryId, deleted: true });
});

export default router;
