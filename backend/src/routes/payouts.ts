import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { db, type TransactionLike } from '../db/index.js';
import { payouts, itemTypes, users, factionMembers } from '../db/schema.js';
import { eq, and, sql, desc, gte, lte } from 'drizzle-orm';
import { success, error } from '../lib/response.js';
import { parsePagination } from '../lib/types.js';
import { requireAuth } from '../middleware/auth.js';
import { requireFactionMember, requirePermission } from '../middleware/factionAccess.js';
import { createAuditLog } from '../lib/audit.js';
import { notify } from '../lib/notify.js';
import { buildWhere } from '../lib/query.js';
import { todayDateString } from '../lib/date.js';
import { PAYOUT_STATUSES } from '../db/schema.js';

const router = Router({ mergeParams: true });

// Settling a payout is admin material: PATCH and DELETE, and creating one for
// somebody else, all need `manage_payouts`. Asking for one is not — any member
// may request a withdrawal for themselves, and read the ones they asked for.
// What the permission buys is reach: over other people's names, and over the
// status of anything already in the queue.
router.use(requireAuth, requireFactionMember);

/** Whether the caller may act on other people's payouts, not just their own. */
const canManagePayouts = (req: Request) =>
  (req.factionPermissions ?? []).includes('manage_payouts');

// ── Validation schemas ────────────────────────────────

const amountField = z.string().refine(
  (v) => !isNaN(Number(v)) && Number(v) > 0,
  'Amount must be a positive number',
);

const createPayoutSchema = z.object({
  recipientUserId: z.string().uuid(),
  itemTypeId: z.string().uuid(),
  amount: amountField,
  description: z.string().max(500).optional(),
  payoutDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
});

const updatePayoutSchema = z.object({
  amount: amountField.optional(),
  description: z.string().max(500).nullable().optional(),
  payoutDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  status: z.enum(PAYOUT_STATUSES).optional(),
});

const listPayoutsQuerySchema = z.object({
  item_type_id: z.string().uuid().optional(),
  recipient_user_id: z.string().uuid().optional(),
  status: z.enum(PAYOUT_STATUSES).optional(),
  date_from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  date_to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  page: z.string().optional(),
  page_size: z.string().optional(),
});

const evenSplitSchema = z.object({
  itemTypeId: z.string().uuid(),
  totalAmount: amountField,
  description: z.string().max(500).optional(),
  payoutDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  // When given, only these members receive a share (an even split across a
  // picked crew rather than the whole roster). Every id must be a member.
  memberUserIds: z.array(z.string().uuid()).min(1).max(500).optional(),
});

/**
 * Allowed payout status transitions.
 *
 * 'completed' and 'rejected' are terminal: a completed payout has already left
 * the vault and a rejected one never will, so reopening either would silently
 * rewrite treasury history.
 */
const STATUS_TRANSITIONS: Record<string, readonly string[]> = {
  pending: ['approved', 'rejected', 'completed'],
  approved: ['completed', 'rejected'],
  rejected: [],
  completed: [],
};

// ── Helpers ───────────────────────────────────────────

/** Validate that an item type exists in this faction and is usable. */
async function findFactionItemType(factionId: string, itemTypeId: string) {
  const [itemType] = await db
    .select()
    .from(itemTypes)
    .where(and(eq(itemTypes.id, itemTypeId), eq(itemTypes.factionId, factionId)))
    .limit(1);
  return itemType;
}

/** Validate that a user is a member of this faction. */
async function isFactionMember(factionId: string, userId: string): Promise<boolean> {
  const [membership] = await db
    .select({ id: factionMembers.id })
    .from(factionMembers)
    .where(and(eq(factionMembers.factionId, factionId), eq(factionMembers.userId, userId)))
    .limit(1);
  return !!membership;
}

/** Reject dates in the future. */
function isFutureDate(dateStr: string): boolean {
  return dateStr > todayDateString();
}

// ── POST / — create a payout ─────────────────────────
router.post('/', async (req: Request, res: Response) => {
  const factionId = req.params.id as string;
  const canManage = canManagePayouts(req);

  const parsed = createPayoutSchema.safeParse(req.body);
  if (!parsed.success) {
    error(res, 'VALIDATION_ERROR', parsed.error.issues[0]!.message);
    return;
  }

  const { recipientUserId, itemTypeId, amount, description, payoutDate } = parsed.data;

  // Without the permission this is a request, not a payout: you may put your
  // own name on it and nobody else's.
  if (!canManage && recipientUserId !== req.user!.id) {
    error(
      res,
      'FORBIDDEN',
      'You need the "manage_payouts" permission to request a withdrawal for someone else',
      403,
    );
    return;
  }

  const itemType = await findFactionItemType(factionId, itemTypeId);
  if (!itemType) {
    error(res, 'NOT_FOUND', 'Item type not found in this faction', 404);
    return;
  }

  if (!(await isFactionMember(factionId, recipientUserId))) {
    error(res, 'VALIDATION_ERROR', 'Recipient is not a member of this faction');
    return;
  }

  const date = payoutDate ?? todayDateString();
  if (isFutureDate(date)) {
    error(res, 'VALIDATION_ERROR', 'Payout date cannot be in the future');
    return;
  }

  // The permission decides, and it is the only thing that does. Someone who may
  // settle payouts is settling one; someone who may not is asking for one, and
  // it waits for a person who can grant it. Auto-completing a request would let
  // any member pay themselves out of the treasury and call it done.
  const status = canManage ? 'completed' : 'pending';

  let payout;
  try {
    payout = await db.transaction(async (tx) => {
      const [row] = await tx
        .insert(payouts)
        .values({
          factionId,
          recipientUserId,
          createdBy: req.user!.id,
          itemTypeId,
          amount,
          description: description ?? null,
          payoutDate: date,
          status,
        })
        .returning();

      if (!row) throw new Error('Failed to create payout');

      // Keep amount as a string — the column is decimal, so JS strings round-trip
      // exactly where Number would lose precision past 2^53.
      await createAuditLog({
        userId: req.user!.id,
        factionId,
        action: 'create',
        entityType: 'payout',
        entityId: row.id,
        details: { recipientUserId, itemTypeId, amount, payoutDate: date, status },
        req,
        tx,
      });

      return row;
    });
  } catch (err) {
    console.error('[CREATE PAYOUT ERROR]', err);
    error(res, 'INTERNAL_ERROR', 'Failed to create payout', 500);
    return;
  }

  success(res, payout, 201);
});

// ── GET / — list payouts with filters ────────────────
// The full list names every recipient and every amount in the faction, so it
// stays behind the permission. Without it you still see the requests you made
// yourself — otherwise asking for one would send it somewhere you cannot look.
router.get('/', async (req: Request, res: Response) => {
  const factionId = req.params.id as string;
  const canManage = canManagePayouts(req);

  const query = listPayoutsQuerySchema.safeParse(req.query);
  if (!query.success) {
    error(res, 'VALIDATION_ERROR', query.error.issues[0]!.message);
    return;
  }

  const {
    item_type_id,
    recipient_user_id,
    status,
    date_from,
    date_to,
    page: pageStr,
    page_size: pageSizeStr,
  } = query.data;
  const { page, pageSize, offset } = parsePagination({ page: pageStr, page_size: pageSizeStr });

  const where = buildWhere([
    eq(payouts.factionId, factionId),
    eq(payouts.isDeleted, false),
    canManage ? undefined : eq(payouts.recipientUserId, req.user!.id),
    item_type_id ? eq(payouts.itemTypeId, item_type_id) : undefined,
    recipient_user_id ? eq(payouts.recipientUserId, recipient_user_id) : undefined,
    status ? eq(payouts.status, status) : undefined,
    date_from ? gte(payouts.payoutDate, date_from) : undefined,
    date_to ? lte(payouts.payoutDate, date_to) : undefined,
  ]);

  const [items, countResult] = await Promise.all([
    db
      .select({
        id: payouts.id,
        amount: payouts.amount,
        description: payouts.description,
        payoutDate: payouts.payoutDate,
        status: payouts.status,
        createdAt: payouts.createdAt,
        updatedAt: payouts.updatedAt,
        approvedAt: payouts.approvedAt,
        recipientUserId: payouts.recipientUserId,
        recipientUsername: users.username,
        recipientInGameName: users.inGameName,
        recipientAvatarUrl: users.avatarUrl,
        itemTypeId: payouts.itemTypeId,
        itemTypeName: itemTypes.name,
        itemUnit: itemTypes.unit,
        itemIsCurrency: itemTypes.isCurrency,
        itemImageUrl: itemTypes.imageUrl,
      itemIcon: itemTypes.icon,
      itemCategory: itemTypes.category,
        createdBy: payouts.createdBy,
        approvedBy: payouts.approvedBy,
      })
      .from(payouts)
      .innerJoin(users, eq(payouts.recipientUserId, users.id))
      .innerJoin(itemTypes, eq(payouts.itemTypeId, itemTypes.id))
      .where(where)
      .orderBy(desc(payouts.createdAt))
      .limit(pageSize)
      .offset(offset),
    db
      .select({ count: sql<number>`COUNT(*)::int` })
      .from(payouts)
      .where(where),
  ]);

  const totalCount = countResult[0]?.count ?? 0;
  success(res, items, 200, { page, page_size: pageSize, total_count: totalCount });
});

// ── POST /even-split — distribute an amount evenly ───
// Declared before /:payoutId so the literal path is not captured as an id.
router.post('/even-split', requirePermission('manage_payouts'), async (req: Request, res: Response) => {
  const factionId = req.params.id as string;

  const parsed = evenSplitSchema.safeParse(req.body);
  if (!parsed.success) {
    error(res, 'VALIDATION_ERROR', parsed.error.issues[0]!.message);
    return;
  }

  const { itemTypeId, totalAmount, description, payoutDate, memberUserIds } = parsed.data;

  const itemType = await findFactionItemType(factionId, itemTypeId);
  if (!itemType) {
    error(res, 'NOT_FOUND', 'Item type not found in this faction', 404);
    return;
  }

  const date = payoutDate ?? todayDateString();
  if (isFutureDate(date)) {
    error(res, 'VALIDATION_ERROR', 'Payout date cannot be in the future');
    return;
  }

  // A named subset splits across exactly those members; no names means the
  // whole roster, as before.
  let memberList = await db
    .select({ userId: factionMembers.userId })
    .from(factionMembers)
    .where(eq(factionMembers.factionId, factionId));
  if (memberUserIds) {
    const memberIds = new Set(memberList.map((m) => m.userId));
    const unknown = memberUserIds.filter((id) => !memberIds.has(id));
    if (unknown.length > 0) {
      error(res, 'VALIDATION_ERROR', 'Some recipients are not members of this faction');
      return;
    }
    memberList = memberList.filter((m) => memberUserIds.includes(m.userId));
  }
  const members = memberList;

  if (members.length === 0) {
    error(res, 'VALIDATION_ERROR', 'Faction has no members to distribute to');
    return;
  }

  // Split in whole cents and keep the remainder in the vault rather than
  // handing someone a fraction more than everyone else.
  const totalCents = Math.round(Number(totalAmount) * 100);
  const perMemberCents = Math.floor(totalCents / members.length);
  if (perMemberCents <= 0) {
    error(res, 'VALIDATION_ERROR', 'Amount is too small to split across all members');
    return;
  }
  const perMember = (perMemberCents / 100).toFixed(2);
  const distributedCents = perMemberCents * members.length;

  // The route already requires `manage_payouts`, so this is a settlement, not
  // a request: the rows land completed like any other payout that permission
  // creates.
  const status = 'completed' as const;

  let created: { id: string }[] = [];
  try {
    created = await db.transaction(async (tx: TransactionLike) => {
      const rows = await tx
        .insert(payouts)
        .values(
          members.map((m) => ({
            factionId,
            recipientUserId: m.userId,
            createdBy: req.user!.id,
            itemTypeId,
            amount: perMember,
            description: description ?? 'Even split distribution',
            payoutDate: date,
            status,
          })),
        )
        .returning({ id: payouts.id });

      // One audit entry for the whole batch, not one per member.
      await createAuditLog({
        userId: req.user!.id,
        factionId,
        action: 'create',
        entityType: 'payout_batch',
        entityId: null,
        details: {
          itemTypeId,
          requestedTotal: Number(totalAmount),
          distributedTotal: distributedCents / 100,
          remainder: (totalCents - distributedCents) / 100,
          perMember: Number(perMember),
          memberCount: members.length,
          payoutDate: date,
          status,
          payoutIds: rows.map((c) => c.id),
        },
        req,
        tx,
      });

      return rows;
    });
  } catch (err) {
    console.error('[EVEN-SPLIT ERROR]', err);
    error(res, 'INTERNAL_ERROR', 'Failed to create even-split payouts', 500);
    return;
  }

  success(
    res,
    {
      created: created.length,
      perMember: Number(perMember),
      distributedTotal: distributedCents / 100,
      remainder: (totalCents - distributedCents) / 100,
      status,
      payoutIds: created.map((c) => c.id),
    },
    201,
  );
});

// ── PATCH /:payoutId — edit or advance a payout ──────
router.patch('/:payoutId', requirePermission('manage_payouts'), async (req: Request, res: Response) => {
  const factionId = req.params.id as string;
  const payoutId = req.params.payoutId as string;

  const parsed = updatePayoutSchema.safeParse(req.body);
  if (!parsed.success) {
    error(res, 'VALIDATION_ERROR', parsed.error.issues[0]!.message);
    return;
  }

  const [existing] = await db
    .select()
    .from(payouts)
    .where(
      and(
        eq(payouts.id, payoutId),
        eq(payouts.factionId, factionId),
        eq(payouts.isDeleted, false),
      ),
    )
    .limit(1);
  if (!existing) {
    error(res, 'NOT_FOUND', 'Payout not found', 404);
    return;
  }

  const updates: Record<string, unknown> = { updatedAt: new Date() };

  // Amount, description and date can only change while the payout is still
  // open — once completed or rejected the record is part of the ledger.
  const editsFinancials =
    parsed.data.amount !== undefined ||
    parsed.data.description !== undefined ||
    parsed.data.payoutDate !== undefined;

  if (editsFinancials && (existing.status === 'completed' || existing.status === 'rejected')) {
    error(res, 'BAD_REQUEST', `Cannot edit a ${existing.status} payout`);
    return;
  }

  if (parsed.data.amount !== undefined) updates.amount = parsed.data.amount;
  if (parsed.data.description !== undefined) updates.description = parsed.data.description;
  if (parsed.data.payoutDate !== undefined) {
    if (isFutureDate(parsed.data.payoutDate)) {
      error(res, 'VALIDATION_ERROR', 'Payout date cannot be in the future');
      return;
    }
    updates.payoutDate = parsed.data.payoutDate;
  }

  if (parsed.data.status !== undefined && parsed.data.status !== existing.status) {
    const allowed = STATUS_TRANSITIONS[existing.status] ?? [];
    if (!allowed.includes(parsed.data.status)) {
      error(
        res,
        'BAD_REQUEST',
        `Cannot change payout status from '${existing.status}' to '${parsed.data.status}'`,
      );
      return;
    }

    // Whoever holds `manage_payouts` may settle a payout, including one they
    // raised themselves before they held it. There is no second-person
    // requirement: the permission is the whole qualification.

    updates.status = parsed.data.status;
    if (parsed.data.status === 'approved') {
      updates.approvedBy = req.user!.id;
      updates.approvedAt = new Date();
    }
  }

  let updated;
  try {
    updated = await db.transaction(async (tx: TransactionLike) => {
      const [row] = await tx
        .update(payouts)
        .set(updates)
        .where(eq(payouts.id, payoutId))
        .returning();

      await createAuditLog({
        userId: req.user!.id,
        factionId,
        action: 'update',
        entityType: 'payout',
        entityId: payoutId,
        details: {
          before: {
            amount: existing.amount,
            description: existing.description,
            payoutDate: existing.payoutDate,
            status: existing.status,
          },
          after: updates,
        },
        req,
        tx,
      });

      return row;
    });
  } catch (err) {
    console.error('[UPDATE PAYOUT ERROR]', err);
    error(res, 'INTERNAL_ERROR', 'Failed to update payout', 500);
    return;
  }

  // Tell the recipient what happened to their request.
  //
  // Raised after the transaction rather than inside it: the status change is
  // the real outcome, and a notification is a courtesy on top of it. A failed
  // insert must never roll back a payout that was genuinely approved.
  //
  // Skipped when the person settling it is the recipient — someone who just
  // approved their own request does not need telling.
  if (parsed.data.status && parsed.data.status !== existing.status) {
    const type =
      parsed.data.status === 'approved' ? 'payout_approved' :
      parsed.data.status === 'rejected' ? 'payout_rejected' :
      parsed.data.status === 'completed' ? 'payout_completed' : null;

    if (type && existing.recipientUserId !== req.user!.id) {
      const [item] = await db
        .select({ name: itemTypes.name, unit: itemTypes.unit, isCurrency: itemTypes.isCurrency })
        .from(itemTypes)
        .where(eq(itemTypes.id, existing.itemTypeId))
        .limit(1);

      await notify({
        userId: existing.recipientUserId,
        type,
        factionId,
        linkView: 'payouts',
        data: {
          amount: existing.amount,
          itemTypeName: item?.name ?? '',
          itemUnit: item?.unit ?? '',
          itemIsCurrency: item?.isCurrency ? 1 : 0,
        },
      });
    }
  }

  success(res, updated);
});

// ── DELETE /:payoutId — soft-delete a payout ─────────
//
// `manage_payouts` deletes any row at any status. A requester may additionally
// withdraw their OWN request while it is still pending: a member who typed the
// wrong amount otherwise has to find someone with the permission to undo a row
// nobody has acted on yet, and a pending payout has not left the vault, so
// taking it back moves no money. Once it is approved, rejected or completed it
// is someone else's decision and part of the ledger, so self-cancel stops.
router.delete('/:payoutId', async (req: Request, res: Response) => {
  const factionId = req.params.id as string;
  const payoutId = req.params.payoutId as string;

  const [existing] = await db
    .select()
    .from(payouts)
    .where(
      and(
        eq(payouts.id, payoutId),
        eq(payouts.factionId, factionId),
        eq(payouts.isDeleted, false),
      ),
    )
    .limit(1);
  if (!existing) {
    error(res, 'NOT_FOUND', 'Payout not found', 404);
    return;
  }

  const canManage = canManagePayouts(req);
  const isMine = existing.recipientUserId === req.user!.id;
  const selfCancel = !canManage && isMine && existing.status === 'pending';
  if (!canManage && !selfCancel) {
    error(res, 'FORBIDDEN', isMine
      ? 'A withdrawal can only be withdrawn by you while it is still pending'
      : 'You need the "manage_payouts" permission to do this', 403);
    return;
  }

  try {
    await db.transaction(async (tx: TransactionLike) => {
      await tx
        .update(payouts)
        .set({ isDeleted: true, updatedAt: new Date() })
        .where(eq(payouts.id, payoutId));

      await createAuditLog({
        userId: req.user!.id,
        factionId,
        action: 'delete',
        entityType: 'payout',
        entityId: payoutId,
        details: {
          amount: existing.amount,
          itemTypeId: existing.itemTypeId,
          recipientUserId: existing.recipientUserId,
          payoutDate: existing.payoutDate,
          status: existing.status,
          ...(selfCancel ? { selfCancelled: true } : {}),
        },
        req,
        tx,
      });
    });
  } catch (err) {
    console.error('[DELETE PAYOUT ERROR]', err);
    error(res, 'INTERNAL_ERROR', 'Failed to delete payout', 500);
    return;
  }

  success(res, { id: payoutId, deleted: true });
});

export default router;
