import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { db } from '../db/index.js';
import { payouts, itemTypes, users, factions, factionMembers } from '../db/schema.js';
import { eq, and, sql, desc, gte, lte } from 'drizzle-orm';
import { success, error } from '../lib/response.js';
import { parsePagination } from '../lib/types.js';
import { requireAuth } from '../middleware/auth.js';
import { requireFactionMember, requirePermission } from '../middleware/factionAccess.js';
import { createAuditLog } from '../lib/audit.js';
import { buildWhere } from '../lib/query.js';
import { todayDateString } from '../lib/date.js';
import { PAYOUT_STATUSES } from '../db/schema.js';

const router = Router({ mergeParams: true });

// All routes require faction membership. The list endpoint (GET /) is
// readable by any member so they can see who got paid; mutations (POST/PATCH/
// DELETE) are admin-only and apply `requirePermission('manage_payouts')` per-route.
router.use(requireAuth, requireFactionMember);

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

/**
 * Decide which status a new payout starts in.
 *
 * Approval is only meaningful when somebody else can actually give it. With a
 * single admin the four-eyes rule in PATCH would leave the payout stuck in
 * 'pending' forever, so it auto-completes instead — the faction still has the
 * setting on, it just has nobody to ask.
 */
async function resolveInitialStatus(factionId: string): Promise<'pending' | 'completed'> {
  const [faction] = await db
    .select({ payoutApprovalRequired: factions.payoutApprovalRequired })
    .from(factions)
    .where(eq(factions.id, factionId))
    .limit(1);

  if (!faction?.payoutApprovalRequired) return 'completed';

  const [admins] = await db
    .select({ count: sql<number>`COUNT(*)::int` })
    .from(factionMembers)
    .where(
      and(eq(factionMembers.factionId, factionId), eq(factionMembers.role, 'admin')),
    );

  return (admins?.count ?? 0) >= 2 ? 'pending' : 'completed';
}

// ── POST / — create a payout ─────────────────────────
router.post('/', requirePermission('manage_payouts'), async (req: Request, res: Response) => {
  const factionId = req.params.id as string;

  const parsed = createPayoutSchema.safeParse(req.body);
  if (!parsed.success) {
    error(res, 'VALIDATION_ERROR', parsed.error.issues[0]!.message);
    return;
  }

  const { recipientUserId, itemTypeId, amount, description, payoutDate } = parsed.data;

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

  // When approval is off (or there is nobody to approve), the payout is
  // immediately final; otherwise it waits in the queue for a second admin.
  const status = await resolveInitialStatus(factionId);

  const [payout] = await db
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

  if (!payout) {
    error(res, 'INTERNAL_ERROR', 'Failed to create payout', 500);
    return;
  }

  await createAuditLog({
    userId: req.user!.id,
    factionId,
    action: 'create',
    entityType: 'payout',
    entityId: payout.id,
    details: { recipientUserId, itemTypeId, amount: Number(amount), payoutDate: date, status },
    req,
  });

  success(res, payout, 201);
});

// ── GET / — list payouts with filters ────────────────
router.get('/', async (req: Request, res: Response) => {
  const factionId = req.params.id as string;

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
        recipientAvatarUrl: users.avatarUrl,
        itemTypeId: payouts.itemTypeId,
        itemTypeName: itemTypes.name,
        itemUnit: itemTypes.unit,
        itemIsCurrency: itemTypes.isCurrency,
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

  const { itemTypeId, totalAmount, description, payoutDate } = parsed.data;

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

  const members = await db
    .select({ userId: factionMembers.userId })
    .from(factionMembers)
    .where(eq(factionMembers.factionId, factionId));

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

  const status = await resolveInitialStatus(factionId);

  const created = await db
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
      payoutIds: created.map((c) => c.id),
    },
    req,
  });

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

    // Four-eyes rule: the admin who created a payout cannot approve their own.
    if (parsed.data.status === 'approved' && existing.createdBy === req.user!.id) {
      error(res, 'FORBIDDEN', 'A payout must be approved by a different admin', 403);
      return;
    }

    updates.status = parsed.data.status;
    if (parsed.data.status === 'approved') {
      updates.approvedBy = req.user!.id;
      updates.approvedAt = new Date();
    }
  }

  const [updated] = await db
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
  });

  success(res, updated);
});

// ── DELETE /:payoutId — soft-delete a payout ─────────
router.delete('/:payoutId', requirePermission('manage_payouts'), async (req: Request, res: Response) => {
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

  await db
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
    },
    req,
  });

  success(res, { id: payoutId, deleted: true });
});

export default router;
