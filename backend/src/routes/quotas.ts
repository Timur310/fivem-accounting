import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { db } from '../db/index.js';
import { quotas, entries, itemTypes, users, factionMembers } from '../db/schema.js';
import { eq, and, sql, desc, gte, lte, isNull } from 'drizzle-orm';
import { success, error } from '../lib/response.js';
import { requireAuth } from '../middleware/auth.js';
import { requireFactionMember, requirePermission } from '../middleware/factionAccess.js';
import { createAuditLog } from '../lib/audit.js';
import { toDateString } from '../lib/date.js';
import { getPeriodRange } from '../lib/period.js';

const router = Router({ mergeParams: true });

router.use(requireAuth, requireFactionMember);

// ── Helpers ──────────────────────────────────────────

/**
 * Check if a quota's current period has started (period_start <= today)
 * and compute the actual sum of entries for that period.
 *
 * If the quota has a `targetUserId`, only that member's entries count;
 * otherwise (null) it's a faction-wide quota and every member's entries count.
 */
async function computeQuotaProgress(
  quota: { itemTypeId: string; targetAmount: string; periodType: string; periodStart: string; isActive: boolean; targetUserId: string | null },
  factionId: string,
) {
  const today = new Date();
  const startDate = new Date(quota.periodStart);

  // Quota hasn't started yet
  if (startDate > today) {
    return {
      currentAmount: 0,
      targetAmount: Number(quota.targetAmount),
      percentage: 0,
      periodActive: false,
    };
  }

  const range = getPeriodRange(quota.periodType, today);

  // Per-member quotas only count that member's entries; faction-wide quotas
  // (targetUserId === null) count every member's entries.
  const userCondition = quota.targetUserId
    ? eq(entries.userId, quota.targetUserId)
    : undefined;

  const [result] = await db
    .select({
      total: sql<string>`COALESCE(SUM(CAST(amount AS NUMERIC)), 0)`,
    })
    .from(entries)
    .where(
      and(
        eq(entries.factionId, factionId),
        eq(entries.itemTypeId, quota.itemTypeId),
        gte(entries.entryDate, range.start),
        lte(entries.entryDate, range.end),
        eq(entries.isDeleted, false),
        ...(userCondition ? [userCondition] : []),
      ),
    );

  const currentAmount = Number(result?.total ?? 0);
  const targetAmount = Number(quota.targetAmount);
  const percentage = targetAmount > 0 ? Math.min((currentAmount / targetAmount) * 100, 100) : 0;

  return {
    currentAmount,
    targetAmount,
    percentage: Math.round(percentage * 100) / 100,
    periodActive: true,
    periodStart: range.start,
    periodEnd: range.end,
  };
}

// ── Validation schemas ────────────────────────────────

const createQuotaSchema = z.object({
  itemTypeId: z.string().uuid(),
  targetAmount: z.string().refine(
    (v) => !isNaN(Number(v)) && Number(v) > 0,
    'Target amount must be a positive number',
  ),
  periodType: z.enum(['weekly', 'monthly']),
  periodStart: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Must be YYYY-MM-DD format'),
  // Optional: if set, this is a per-member quota (only that member's entries
  // count). If null/omitted, it's a faction-wide quota.
  targetUserId: z.string().uuid().nullable().optional(),
});

const updateQuotaSchema = z.object({
  targetAmount: z.string().refine(
    (v) => !isNaN(Number(v)) && Number(v) > 0,
    'Target amount must be a positive number',
  ).optional(),
  periodType: z.enum(['weekly', 'monthly']).optional(),
  periodStart: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Must be YYYY-MM-DD format').optional(),
  isActive: z.boolean().optional(),
  targetUserId: z.string().uuid().nullable().optional(),
});

// ── POST / — create quota ───────────────────────────
router.post('/', requirePermission('manage_quotas'), async (req: Request, res: Response) => {
  const factionId = req.params.id as string;
  const parsed = createQuotaSchema.safeParse(req.body);
  if (!parsed.success) {
    error(res, 'VALIDATION_ERROR', parsed.error.issues[0]!.message);
    return;
  }

  const { itemTypeId, targetAmount, periodType, periodStart, targetUserId } = parsed.data;

  // Validate item type belongs to this faction
  const [itemType] = await db
    .select()
    .from(itemTypes)
    .where(and(eq(itemTypes.id, itemTypeId), eq(itemTypes.factionId, factionId)))
    .limit(1);
  if (!itemType) {
    error(res, 'NOT_FOUND', 'Item type not found in this faction', 404);
    return;
  }

  // If targetUserId is set, validate the user is a member of this faction.
  if (targetUserId) {
    const [membership] = await db
      .select({ id: factionMembers.id })
      .from(factionMembers)
      .where(and(eq(factionMembers.factionId, factionId), eq(factionMembers.userId, targetUserId)))
      .limit(1);
    if (!membership) {
      error(res, 'VALIDATION_ERROR', 'Target user is not a member of this faction');
      return;
    }
  }

  // Check for duplicate active quota on same item type + period type + target.
  // A faction-wide quota and a per-member quota for the same item type are
  // allowed to coexist — they're different scopes.
  const duplicateConditions = [
    eq(quotas.factionId, factionId),
    eq(quotas.itemTypeId, itemTypeId),
    eq(quotas.periodType, periodType),
    eq(quotas.isActive, true),
    // Match the same scope: both null (faction-wide) or both the same userId.
    targetUserId ? eq(quotas.targetUserId, targetUserId) : isNull(quotas.targetUserId),
  ];
  const [duplicate] = await db
    .select()
    .from(quotas)
    .where(and(...duplicateConditions))
    .limit(1);
  if (duplicate) {
    error(res, 'BAD_REQUEST', `An active ${targetUserId ? 'per-member' : 'faction-wide'} quota already exists for this item type and period type. Deactivate it first.`, 400);
    return;
  }

  const [created] = await db
    .insert(quotas)
    .values({ factionId, itemTypeId, targetAmount, periodType, periodStart, targetUserId: targetUserId ?? null })
    .returning();

  if (!created) {
    error(res, 'INTERNAL_ERROR', 'Failed to create quota', 500);
    return;
  }

  await createAuditLog({
    userId: req.user!.id,
    factionId,
    action: 'create',
    entityType: 'quota',
    entityId: created.id,
    details: { itemTypeId, targetAmount: Number(targetAmount), periodType, periodStart, targetUserId: targetUserId ?? null, scope: targetUserId ? 'member' : 'faction' },
    req,
  });

  success(res, created, 201);
});

// ── GET / — list quotas with progress ───────────────
router.get('/', async (req: Request, res: Response) => {
  const factionId = req.params.id as string;

  const allQuotas = await db
    .select({
      id: quotas.id,
      itemTypeId: quotas.itemTypeId,
      itemTypeName: itemTypes.name,
      itemUnit: itemTypes.unit,
      itemIsCurrency: itemTypes.isCurrency,
      targetUserId: quotas.targetUserId,
      targetUsername: users.username,
      targetAvatarUrl: users.avatarUrl,
      targetAmount: quotas.targetAmount,
      periodType: quotas.periodType,
      periodStart: quotas.periodStart,
      isActive: quotas.isActive,
      createdAt: quotas.createdAt,
    })
    .from(quotas)
    .innerJoin(itemTypes, eq(quotas.itemTypeId, itemTypes.id))
    .leftJoin(users, eq(quotas.targetUserId, users.id))
    .where(eq(quotas.factionId, factionId))
    .orderBy(desc(quotas.createdAt));

  // Compute progress for active quotas in parallel
  const withProgress = await Promise.all(
    allQuotas.map(async (q) => {
      if (!q.isActive) {
        return {
          ...q,
          currentAmount: 0,
          targetAmount: Number(q.targetAmount),
          percentage: 0,
          periodActive: false,
        };
      }
      const progress = await computeQuotaProgress(
        {
          itemTypeId: q.itemTypeId,
          targetAmount: q.targetAmount,
          periodType: q.periodType,
          periodStart: q.periodStart,
          isActive: q.isActive,
          targetUserId: q.targetUserId,
        },
        factionId,
      );
      return {
        ...q,
        ...progress,
      };
    }),
  );

  success(res, withProgress);
});

// ── PATCH /:quotaId — update quota ──────────────────
router.patch('/:quotaId', requirePermission('manage_quotas'), async (req: Request, res: Response) => {
  const factionId = req.params.id as string;
  const quotaId = req.params.quotaId as string;

  const parsed = updateQuotaSchema.safeParse(req.body);
  if (!parsed.success) {
    error(res, 'VALIDATION_ERROR', parsed.error.issues[0]!.message);
    return;
  }

  const [existing] = await db
    .select()
    .from(quotas)
    .where(and(eq(quotas.id, quotaId), eq(quotas.factionId, factionId)))
    .limit(1);
  if (!existing) {
    error(res, 'NOT_FOUND', 'Quota not found', 404);
    return;
  }

  const updates: Record<string, unknown> = {};
  if (parsed.data.targetAmount !== undefined) updates.targetAmount = parsed.data.targetAmount;
  if (parsed.data.periodType !== undefined) updates.periodType = parsed.data.periodType;
  if (parsed.data.periodStart !== undefined) updates.periodStart = parsed.data.periodStart;
  if (parsed.data.isActive !== undefined) updates.isActive = parsed.data.isActive;

  const [updated] = await db
    .update(quotas)
    .set(updates)
    .where(eq(quotas.id, quotaId))
    .returning();

  await createAuditLog({
    userId: req.user!.id,
    factionId,
    action: 'update',
    entityType: 'quota',
    entityId: quotaId,
    details: {
      before: {
        targetAmount: existing.targetAmount,
        periodType: existing.periodType,
        periodStart: existing.periodStart,
        isActive: existing.isActive,
      },
      after: updates,
    },
    req,
  });

  success(res, updated);
});

// ── DELETE /:quotaId — delete quota ──────────────────
router.delete('/:quotaId', requirePermission('manage_quotas'), async (req: Request, res: Response) => {
  const factionId = req.params.id as string;
  const quotaId = req.params.quotaId as string;

  const [existing] = await db
    .select()
    .from(quotas)
    .where(and(eq(quotas.id, quotaId), eq(quotas.factionId, factionId)))
    .limit(1);
  if (!existing) {
    error(res, 'NOT_FOUND', 'Quota not found', 404);
    return;
  }

  await db.delete(quotas).where(eq(quotas.id, quotaId));

  await createAuditLog({
    userId: req.user!.id,
    factionId,
    action: 'delete',
    entityType: 'quota',
    entityId: quotaId,
    details: {
      targetAmount: existing.targetAmount,
      periodType: existing.periodType,
      periodStart: existing.periodStart,
    },
    req,
  });

  success(res, { id: quotaId, deleted: true });
});

export default router;
