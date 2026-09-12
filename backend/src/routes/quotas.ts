import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { db } from '../db/index.js';
import { quotas, entries, itemTypes, users, factionMembers } from '../db/schema.js';
import { eq, and, sql, desc, gte, lte, isNull } from 'drizzle-orm';
import { success, error } from '../lib/response.js';
import { requireAuth } from '../middleware/auth.js';
import { requireFactionMember, requirePermission } from '../middleware/factionAccess.js';
import { createAuditLog } from '../lib/audit.js';
import { getPeriodRange, getPreviousPeriodRange, type PeriodRange } from '../lib/period.js';
import { toDateString, periodHasStarted, parseLocalDate } from '../lib/date.js';
import { QUOTA_SCOPES, type QuotaScope } from '../db/schema.js';

const router = Router({ mergeParams: true });

router.use(requireAuth, requireFactionMember);

// ── Helpers ──────────────────────────────────────────

/**
 * Sum of this faction's (or one subject's) non-deleted entries of an item type
 * within an inclusive date range.
 */
async function sumEntriesInRange(
  factionId: string,
  itemTypeId: string,
  targetUserId: string | null,
  range: PeriodRange,
): Promise<number> {
  const [result] = await db
    .select({
      total: sql<string>`COALESCE(SUM(CAST(amount AS NUMERIC)), 0)`,
    })
    .from(entries)
    .where(
      and(
        eq(entries.factionId, factionId),
        eq(entries.itemTypeId, itemTypeId),
        targetUserId ? eq(entries.userId, targetUserId) : undefined,
        gte(entries.entryDate, range.start),
        lte(entries.entryDate, range.end),
        eq(entries.isDeleted, false),
      ),
    );
  return Number(result?.total ?? 0);
}

/**
 * Check if a quota's current period has started (period_start <= today)
 * and compute the actual sum of entries for that period.
 *
 * Whose entries count depends on the quota's scope:
 *   'faction'  — the whole faction's contributions sum into one target
 *   'everyone' — the same target measured against the *viewer's* entries,
 *                so every member sees their own progress against it
 *   'member'   — only the target member's entries count
 */
async function computeQuotaProgress(
  quota: {
    scope: QuotaScope;
    itemTypeId: string;
    targetUserId: string | null;
    targetAmount: string;
    periodType: string;
    periodStart: string;
    isActive: boolean;
  },
  factionId: string,
  viewerUserId: string,
) {
  const today = new Date();

  // Whose entries this quota reads for the person looking at it.
  const subjectUserId = quota.scope === 'everyone'
    ? viewerUserId
    : quota.targetUserId;

  // Quota hasn't started yet
  if (!periodHasStarted(quota.periodStart, today)) {
    return {
      currentAmount: 0,
      targetAmount: Number(quota.targetAmount),
      percentage: 0,
      periodActive: false,
    };
  }

  const range = getPeriodRange(quota.periodType, today);

  const currentAmount = await sumEntriesInRange(factionId, quota.itemTypeId, subjectUserId, range);
  const targetAmount = Number(quota.targetAmount);
  const percentage = targetAmount > 0 ? Math.min((currentAmount / targetAmount) * 100, 100) : 0;

  // The period that just closed keeps its outcome here: once the current one
  // rolls over, this is the only place that still says whether it was met.
  // Reported only when the quota already existed back then — the week before
  // a quota was created says nothing about it.
  const prevRange = getPreviousPeriodRange(quota.periodType, today);
  let previousPeriod: {
    periodStart: string;
    periodEnd: string;
    currentAmount: number;
    targetAmount: number;
    met: boolean;
  } | null = null;
  if (prevRange.end >= quota.periodStart) {
    const prevAmount = await sumEntriesInRange(factionId, quota.itemTypeId, subjectUserId, prevRange);
    previousPeriod = {
      periodStart: prevRange.start,
      periodEnd: prevRange.end,
      currentAmount: prevAmount,
      targetAmount,
      met: prevAmount >= targetAmount,
    };
  }

  return {
    currentAmount,
    targetAmount,
    percentage: Math.round(percentage * 100) / 100,
    periodActive: true,
    periodStart: range.start,
    periodEnd: range.end,
    previousPeriod,
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
  // 'faction' — all contributions sum into one target
  // 'everyone' — the same target measured per member individually
  // 'member'   — one named member's personal target
  scope: z.enum(QUOTA_SCOPES).default('faction'),
  // Required for scope 'member'; must reference a current faction member.
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
  scope: z.enum(QUOTA_SCOPES).optional(),
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

  const { itemTypeId, targetAmount, periodType, periodStart, scope, targetUserId } = parsed.data;

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

  // Scope/target have to agree: a named target only makes sense for the
  // 'member' scope, and that target must actually be in the faction —
  // otherwise the quota would silently apply faction-wide.
  const effectiveScope = scope ?? 'faction';
  if (effectiveScope === 'member' && !targetUserId) {
    error(res, 'VALIDATION_ERROR', 'A per-member quota requires targetUserId');
    return;
  }
  if (effectiveScope !== 'member' && targetUserId) {
    error(res, 'VALIDATION_ERROR', 'targetUserId is only valid with scope "member"');
    return;
  }
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

  // Duplicate check: only one active quota per (itemType + periodType + scope).
  // 'faction' and 'everyone' both have a null target but are distinct scopes;
  // the same userId counts as the same 'member' scope.
  const [duplicate] = await db
    .select()
    .from(quotas)
    .where(
      and(
        eq(quotas.factionId, factionId),
        eq(quotas.itemTypeId, itemTypeId),
        eq(quotas.periodType, periodType),
        eq(quotas.isActive, true),
        eq(quotas.scope, effectiveScope),
        targetUserId ? eq(quotas.targetUserId, targetUserId) : isNull(quotas.targetUserId),
      ),
    )
    .limit(1);
  if (duplicate) {
    error(res, 'BAD_REQUEST', 'An active quota already exists for this item type and period type. Deactivate it first.', 400);
    return;
  }

  const [created] = await db
    .insert(quotas)
    .values({ factionId, itemTypeId, targetAmount, periodType, periodStart, scope: effectiveScope, targetUserId: targetUserId ?? null })
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
    details: { itemTypeId, targetAmount: Number(targetAmount), periodType, periodStart, scope: effectiveScope, targetUserId: targetUserId ?? null },
    req,
  });

  success(res, created, 201);
});

// ── GET / — list quotas with progress ───────────────
router.get('/', async (req: Request, res: Response) => {
  const factionId = req.params.id as string;

  // leftJoin on users so a per-member quota can resolve its target user even
  // if the user has since left the faction (the row is kept by the cascade
  // rule, but the user record still exists).
  const allQuotas = await db
    .select({
      id: quotas.id,
      itemTypeId: quotas.itemTypeId,
      itemTypeName: itemTypes.name,
      itemUnit: itemTypes.unit,
      itemIsCurrency: itemTypes.isCurrency,
      itemImageUrl: itemTypes.imageUrl,
      itemIcon: itemTypes.icon,
      itemCategory: itemTypes.category,
      targetAmount: quotas.targetAmount,
      scope: quotas.scope,
      periodType: quotas.periodType,
      periodStart: quotas.periodStart,
      isActive: quotas.isActive,
      createdAt: quotas.createdAt,
      targetUserId: quotas.targetUserId,
      targetUsername: users.username,
      targetAvatarUrl: users.avatarUrl,
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
          previousPeriod: null,
        };
      }
      const progress = await computeQuotaProgress(
        {
          scope: q.scope as QuotaScope,
          itemTypeId: q.itemTypeId,
          targetUserId: q.targetUserId,
          targetAmount: q.targetAmount,
          periodType: q.periodType,
          periodStart: q.periodStart,
          isActive: q.isActive,
        },
        factionId,
        // 'everyone' quotas read the viewer's own ledger, so each member sees
        // their personal progress against the shared target.
        req.user!.id,
      );
      return {
        ...q,
        ...progress,
      };
    }),
  );

  success(res, withProgress);
});

// ── GET /:quotaId/history — per-period outcomes ──────
// Computed on read rather than persisted: one grouped query covers every
// completed period since the quota began, so there is no rollover scheduler
// to keep honest and no second source of truth to drift.
router.get('/:quotaId/history', async (req: Request, res: Response) => {
  const factionId = req.params.id as string;
  const quotaId = req.params.quotaId as string;

  const [quota] = await db
    .select()
    .from(quotas)
    .where(and(eq(quotas.id, quotaId), eq(quotas.factionId, factionId)))
    .limit(1);
  if (!quota) {
    error(res, 'NOT_FOUND', 'Quota not found', 404);
    return;
  }

  const today = new Date();
  if (!periodHasStarted(quota.periodStart, today)) {
    success(res, { periods: [], summary: { met: 0, total: 0 } });
    return;
  }

  // 'everyone' quotas measure each member against the same target — the
  // history answers for the caller unless a member is named explicitly.
  const userParam = typeof req.query.user_id === 'string' ? req.query.user_id : undefined;
  if (userParam && !/^[0-9a-f-]{36}$/i.test(userParam)) {
    error(res, 'VALIDATION_ERROR', 'user_id must be a UUID');
    return;
  }
  const subjectUserId = quota.scope === 'everyone'
    ? (userParam ?? req.user!.id)
    : quota.targetUserId;

  const currentRange = getPeriodRange(quota.periodType, today);

  // Walk the completed periods: from the period containing periodStart up to
  // the one before the current. The cursor re-anchors on each period's first
  // day, so month lengths cannot make it skip a period.
  const completed: PeriodRange[] = [];
  let cursor = parseLocalDate(quota.periodStart);
  while (completed.length < 260) {
    const range = getPeriodRange(quota.periodType, cursor);
    if (range.end >= currentRange.start || range.end >= toDateString(today)) break;
    completed.push(range);
    if (quota.periodType === 'weekly') {
      const [y, m, d] = range.start.split('-').map(Number);
      cursor = new Date(y!, m! - 1, d! + 7);
    } else {
      const [y, m] = range.start.split('-').map(Number);
      cursor = new Date(y!, m!, 1); // month is 0-based: m is the next month
    }
  }

  if (completed.length === 0) {
    success(res, { periods: [], summary: { met: 0, total: 0 } });
    return;
  }

  const first = completed[0]!;
  const last = completed[completed.length - 1]!;
  const daily = await db
    .select({
      day: entries.entryDate,
      total: sql<string>`COALESCE(SUM(CAST(${entries.amount} AS NUMERIC)), 0)`,
    })
    .from(entries)
    .where(
      and(
        eq(entries.factionId, factionId),
        eq(entries.itemTypeId, quota.itemTypeId),
        subjectUserId ? eq(entries.userId, subjectUserId) : undefined,
        gte(entries.entryDate, first.start),
        lte(entries.entryDate, last.end),
        eq(entries.isDeleted, false),
      ),
    )
    .groupBy(entries.entryDate);
  const byDay = new Map(daily.map((r) => [r.day, Number(r.total)]));

  const targetAmount = Number(quota.targetAmount);
  const periods = completed.map((range) => {
    let currentAmount = 0;
    for (const [day, total] of byDay) {
      if (day >= range.start && day <= range.end) currentAmount += total;
    }
    return { periodStart: range.start, periodEnd: range.end, currentAmount, targetAmount, met: currentAmount >= targetAmount };
  });

  success(res, {
    periods,
    summary: {
      met: periods.filter((p) => p.met).length,
      total: periods.length,
    },
  });
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
  if (parsed.data.scope !== undefined) updates.scope = parsed.data.scope;
  if (parsed.data.targetUserId !== undefined) updates.targetUserId = parsed.data.targetUserId;

  // Scope/target have to agree after the update, not just in isolation —
  // patching one without the other must not leave a faction-wide quota
  // pointing at a member or a member quota with no target.
  const nextScope = (updates.scope ?? existing.scope) as QuotaScope;
  const nextTarget = 'targetUserId' in updates ? (updates.targetUserId as string | null) : existing.targetUserId;
  if (nextScope === 'member' && !nextTarget) {
    error(res, 'VALIDATION_ERROR', 'A per-member quota requires targetUserId');
    return;
  }
  if (nextScope !== 'member' && nextTarget) {
    error(res, 'VALIDATION_ERROR', 'targetUserId is only valid with scope "member"');
    return;
  }
  if (nextTarget) {
    const [membership] = await db
      .select({ id: factionMembers.id })
      .from(factionMembers)
      .where(and(eq(factionMembers.factionId, factionId), eq(factionMembers.userId, nextTarget)))
      .limit(1);
    if (!membership) {
      error(res, 'VALIDATION_ERROR', 'Target user is not a member of this faction');
      return;
    }
  }

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
        scope: existing.scope,
        targetUserId: existing.targetUserId,
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
      targetUserId: existing.targetUserId,
    },
    req,
  });

  success(res, { id: quotaId, deleted: true });
});

export default router;
