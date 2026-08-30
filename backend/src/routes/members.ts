import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { db, type TransactionLike } from '../db/index.js';
import { factionMembers, users, entries, factions, itemTypes, payouts, quotas, auditLogs } from '../db/schema.js';
import { eq, and, sql, desc, gte, lte, ilike, notInArray } from 'drizzle-orm';
import { success, error } from '../lib/response.js';
import { parsePagination } from '../lib/types.js';
import { requireAuth } from '../middleware/auth.js';
import { requireFactionMember, requirePermission } from '../middleware/factionAccess.js';
import { createAuditLog } from '../lib/audit.js';
import { getPeriodRange } from '../lib/period.js';
import { daysSince } from '../lib/date.js';
import { countActiveStrikes } from '../lib/strikes.js';
import { computeHeatmap, computeStreak, computePerformanceScore } from '../lib/analytics.js';

const router = Router({ mergeParams: true });

// All routes require faction membership
router.use(requireAuth, requireFactionMember);

/** Escape a user-supplied search string for safe use inside an ilike('%...%')
 *  pattern. Backslash, %, and _ are escaped so they match literally. */
function escapeLike(input: string): string {
  return input.replace(/[%_\\]/g, (m) => '\\' + m);
}

// ── Validation schemas ────────────────────────────────

const addMemberSchema = z.object({
  // Accept either the Discord ID (existing flow) or a known user id (e.g.
  // from the /search endpoint). Exactly one must be provided.
  discordId: z.string().min(1, 'Discord ID is required').optional(),
  userId: z.string().uuid().optional(),
}).refine(
  (d) => (d.discordId ? !d.userId : !!d.userId),
  'Provide exactly one of: discordId, userId',
);

const updateMemberSchema = z.object({
  role: z.enum(['admin', 'member']).optional(),
  // null clears the rank; a string must match one of the faction's ranks
  rank: z.string().min(1).max(100).nullable().optional(),
}).refine(
  (d) => d.role !== undefined || d.rank !== undefined,
  'Provide at least one of: role, rank',
);

// ── POST / — add member to faction ───────────────────
router.post('/', requirePermission('manage_members'), async (req: Request, res: Response) => {
  const factionId = req.params.id as string;
  const parsed = addMemberSchema.safeParse(req.body);
  if (!parsed.success) {
    error(res, 'VALIDATION_ERROR', parsed.error.issues[0]!.message);
    return;
  }

  // Look up the target either by Discord ID or by primary key.
  const where = parsed.data.userId
    ? eq(users.id, parsed.data.userId)
    : eq(users.discordId, parsed.data.discordId!);

  const [targetUser] = await db
    .select()
    .from(users)
    .where(where)
    .limit(1);

  if (!targetUser) {
    if (parsed.data.discordId) {
      error(res, 'NOT_FOUND', `No user found with Discord ID: ${parsed.data.discordId}. They must log in first.`);
    } else {
      error(res, 'NOT_FOUND', 'User not found');
    }
    return;
  }

  // Check already a member
  const [existing] = await db
    .select()
    .from(factionMembers)
    .where(
      and(
        eq(factionMembers.factionId, factionId),
        eq(factionMembers.userId, targetUser.id),
      ),
    )
    .limit(1);
  if (existing) {
    error(res, 'CONFLICT', 'User is already a member of this faction', 409);
    return;
  }

  let member;
  try {
    member = await db.transaction(async (tx: TransactionLike) => {
      const [row] = await tx
        .insert(factionMembers)
        .values({ factionId, userId: targetUser.id, role: 'member' })
        .returning();
      if (!row) throw new Error('Failed to add member');

      await createAuditLog({
        userId: req.user!.id,
        factionId,
        action: 'create',
        entityType: 'member',
        entityId: row.id,
        details: {
          userId: targetUser.id,
          addedUserId: targetUser.id,
          discordId: targetUser.discordId,
          username: targetUser.username,
        },
        req,
        tx,
      });

      return row;
    });
  } catch (err) {
    console.error('[ADD MEMBER ERROR]', err);
    error(res, 'INTERNAL_ERROR', 'Failed to add member', 500);
    return;
  }

  success(res, {
    ...member,
    username: targetUser.username,
    inGameName: targetUser.inGameName,
    avatarUrl: targetUser.avatarUrl,
    discordId: targetUser.discordId,
  }, 201);
});

// ── GET /search — find users not yet in this faction ──
// Powers the "add member" picker. Limited to faction admins so the roster is
// not exposed to arbitrary searches by plain members.
router.get('/search', requirePermission('manage_members'), async (req: Request, res: Response) => {
  const factionId = req.params.id as string;
  const q = (req.query.q as string | undefined)?.trim() ?? '';
  if (q.length < 2) {
    success(res, []);
    return;
  }

  // Existing member ids — we exclude these so the picker never offers someone
  // who is already in the faction.
  const existing = await db
    .select({ userId: factionMembers.userId })
    .from(factionMembers)
    .where(eq(factionMembers.factionId, factionId));
  const existingIds = existing.map((m) => m.userId);

  const escaped = escapeLike(q);
  const query = db
    .select({
      id: users.id,
      username: users.username,
      inGameName: users.inGameName,
      avatarUrl: users.avatarUrl,
      discordId: users.discordId,
      lastLogin: users.lastLogin,
    })
    .from(users)
    .where(
      and(
        ilike(users.username, `%${escaped}%`),
        existingIds.length > 0 ? notInArray(users.id, existingIds) : undefined,
      ),
    )
    .orderBy(desc(users.lastLogin))
    .limit(20);

  const matches = await query;
  success(res, matches);
});

// ── GET / — list faction members ─────────────────────
router.get('/', async (req: Request, res: Response) => {
  const factionId = req.params.id as string;

  // Parameterised bindings, not sql.raw — the faction id is a UUID pulled from
  // the path, but treating it as text in the SQL is the safer default and
  // keeps the query plan stable.
  const memberList = await db
    .select({
      id: factionMembers.id,
      userId: factionMembers.userId,
      role: factionMembers.role,
      rank: factionMembers.rank,
      joinedAt: factionMembers.joinedAt,
      username: users.username,
      inGameName: users.inGameName,
      avatarUrl: users.avatarUrl,
      discordId: users.discordId,
      entryCount: sql<number>`(SELECT COUNT(*) FROM entries WHERE user_id = users.id AND faction_id = ${factionId} AND is_deleted = false)::int`,
      lastEntryDate: sql<string | null>`(SELECT MAX(entry_date) FROM entries WHERE user_id = users.id AND faction_id = ${factionId} AND is_deleted = false)`,
    })
    .from(factionMembers)
    .innerJoin(users, eq(factionMembers.userId, users.id))
    .where(eq(factionMembers.factionId, factionId))
    .orderBy(factionMembers.joinedAt);

  // Strike counts are admin-visible only; members see the roster without them.
  const isAdmin = req.factionRole === 'admin' || req.factionRole === 'superadmin';
  const strikeCounts = isAdmin ? await countActiveStrikes(factionId) : null;

  success(
    res,
    memberList.map((m) => ({
      ...m,
      daysInactive: daysSince(m.lastEntryDate),
      ...(strikeCounts ? { activeStrikeCount: strikeCounts.get(m.userId) ?? 0 } : {}),
    })),
  );
});

// ── PATCH /:userId — update member role ──────────────
router.patch('/:userId', requirePermission('manage_members'), async (req: Request, res: Response) => {
  const factionId = req.params.id as string;
  const targetUserId = req.params.userId as string;

  const parsed = updateMemberSchema.safeParse(req.body);
  if (!parsed.success) {
    error(res, 'VALIDATION_ERROR', parsed.error.issues[0]!.message);
    return;
  }

  const [membership] = await db
    .select()
    .from(factionMembers)
    .where(
      and(
        eq(factionMembers.factionId, factionId),
        eq(factionMembers.userId, targetUserId),
      ),
    )
    .limit(1);
  if (!membership) {
    error(res, 'NOT_FOUND', 'Member not found in this faction', 404);
    return;
  }

  // Capture before-state outside the transaction so the audit details are
  // correct even if the write itself fails.
  const oldRole = membership.role;
  const oldRank = membership.rank;

  const updates: Record<string, unknown> = {};
  if (parsed.data.role !== undefined) updates.role = parsed.data.role;

  if (parsed.data.rank !== undefined) {
    // A rank is display-only, but it still has to be one the faction defined —
    // otherwise the roster fills up with typos that no longer match any rank.
    if (parsed.data.rank !== null) {
      const [faction] = await db
        .select({ ranks: factions.ranks })
        .from(factions)
        .where(eq(factions.id, factionId))
        .limit(1);
      const defined = (faction?.ranks ?? []).map((r) => r.name);
      if (!defined.includes(parsed.data.rank)) {
        error(
          res,
          'VALIDATION_ERROR',
          defined.length
            ? `Unknown rank '${parsed.data.rank}'. Defined ranks: ${defined.join(', ')}`
            : 'This faction has no ranks defined yet',
        );
        return;
      }
    }
    updates.rank = parsed.data.rank;
  }

  let updated;
  try {
    updated = await db.transaction(async (tx: TransactionLike) => {
      const [row] = await tx
        .update(factionMembers)
        .set(updates)
        .where(eq(factionMembers.id, membership.id))
        .returning();

      // If promoting to admin, update user's global role inside the same
      // transaction so the user table never lags the membership table.
      if (parsed.data.role === 'admin') {
        const [targetUser] = await tx
          .select({ role: users.role })
          .from(users)
          .where(eq(users.id, targetUserId))
          .limit(1);
        if (targetUser && targetUser.role === 'member') {
          await tx
            .update(users)
            .set({ role: 'faction_admin' })
            .where(eq(users.id, targetUserId));
        }
      }

      await createAuditLog({
        userId: req.user!.id,
        factionId,
        action: 'update',
        entityType: 'member',
        entityId: membership.id,
        details: {
          userId: targetUserId,
          before: { role: oldRole, rank: oldRank },
          after: { role: updates.role ?? oldRole, rank: 'rank' in updates ? updates.rank : oldRank },
        },
        req,
        tx,
      });

      return row;
    });
  } catch (err) {
    console.error('[UPDATE MEMBER ERROR]', err);
    error(res, 'INTERNAL_ERROR', 'Failed to update member', 500);
    return;
  }

  success(res, updated);
});

// ── DELETE /:userId — remove member ───────────────────
router.delete('/:userId', requirePermission('manage_members'), async (req: Request, res: Response) => {
  const factionId = req.params.id as string;
  const targetUserId = req.params.userId as string;

  const [membership] = await db
    .select()
    .from(factionMembers)
    .where(
      and(
        eq(factionMembers.factionId, factionId),
        eq(factionMembers.userId, targetUserId),
      ),
    )
    .limit(1);
  if (!membership) {
    error(res, 'NOT_FOUND', 'Member not found in this faction', 404);
    return;
  }

  // Prevent removing the last admin
  if (membership.role === 'admin') {
    const [adminCount] = await db
      .select({ count: sql<number>`COUNT(*)::int` })
      .from(factionMembers)
      .where(
        and(
          eq(factionMembers.factionId, factionId),
          eq(factionMembers.role, 'admin'),
        ),
      );
    if (adminCount!.count <= 1) {
      error(res, 'BAD_REQUEST', 'Cannot remove the last admin of a faction. Promote another member first.');
      return;
    }
  }

  try {
    await db.transaction(async (tx: TransactionLike) => {
      await tx.delete(factionMembers).where(eq(factionMembers.id, membership.id));

      await createAuditLog({
        userId: req.user!.id,
        factionId,
        action: 'delete',
        entityType: 'member',
        entityId: membership.id,
        details: {
          userId: targetUserId,
          removedUserId: targetUserId,
          role: membership.role,
        },
        req,
        tx,
      });
    });
  } catch (err) {
    console.error('[REMOVE MEMBER ERROR]', err);
    error(res, 'INTERNAL_ERROR', 'Failed to remove member', 500);
    return;
  }

  success(res, { removed: true });
});

// ── GET /:userId/history — join / leave / role changes ──
// Reads the existing audit log rather than keeping a second table: member
// lifecycle events are already recorded there with entity_type='member'.
router.get('/:userId/history', requirePermission('manage_members'), async (req: Request, res: Response) => {
  const factionId = req.params.id as string;
  const targetUserId = req.params.userId as string;

  const { page, pageSize, offset } = parsePagination({
    page: req.query.page as string | undefined,
    page_size: req.query.page_size as string | undefined,
  });

  // Member lifecycle events record the target as either `userId`, `addedUserId`
  // (POST /) or `removedUserId` (DELETE /) inside the JSONB details — match any
  // of them so the history stays complete across all three event kinds.
  const where = and(
    eq(auditLogs.factionId, factionId),
    eq(auditLogs.entityType, 'member'),
    sql`(${auditLogs.details}->>'userId' = ${targetUserId}
         OR ${auditLogs.details}->>'addedUserId' = ${targetUserId}
         OR ${auditLogs.details}->>'removedUserId' = ${targetUserId})`,
  );

  const [items, countResult] = await Promise.all([
    db
      .select({
        id: auditLogs.id,
        action: auditLogs.action,
        details: auditLogs.details,
        createdAt: auditLogs.createdAt,
        actorId: auditLogs.userId,
        actorUsername: users.username,
        actorInGameName: users.inGameName,
        actorAvatarUrl: users.avatarUrl,
      })
      .from(auditLogs)
      .innerJoin(users, eq(auditLogs.userId, users.id))
      .where(where)
      .orderBy(desc(auditLogs.createdAt))
      .limit(pageSize)
      .offset(offset),
    db.select({ count: sql<number>`COUNT(*)::int` }).from(auditLogs).where(where),
  ]);

  success(res, items, 200, {
    page,
    page_size: pageSize,
    total_count: countResult[0]?.count ?? 0,
  });
});

// ── GET /:userId/heatmap — daily activity grid ───────
router.get('/:userId/heatmap', async (req: Request, res: Response) => {
  const factionId = req.params.id as string;
  const targetUserId = req.params.userId as string;

  const year = Number(req.query.year) || new Date().getFullYear();
  if (year < 2000 || year > 2100) {
    error(res, 'VALIDATION_ERROR', 'year must be between 2000 and 2100');
    return;
  }

  const [membership] = await db
    .select({ id: factionMembers.id })
    .from(factionMembers)
    .where(and(eq(factionMembers.factionId, factionId), eq(factionMembers.userId, targetUserId)))
    .limit(1);
  if (!membership) {
    error(res, 'NOT_FOUND', 'Member not found in this faction', 404);
    return;
  }

  success(res, await computeHeatmap(factionId, targetUserId, year));
});

// ── GET /:userId — member profile ─────────────────────
// Aggregate view for one member. Notes and strikes stay on their own
// endpoints, which enforce their own visibility rules.
router.get('/:userId', async (req: Request, res: Response) => {
  const factionId = req.params.id as string;
  const targetUserId = req.params.userId as string;

  const [membership] = await db
    .select({
      id: factionMembers.id,
      role: factionMembers.role,
      rank: factionMembers.rank,
      joinedAt: factionMembers.joinedAt,
      userId: users.id,
      username: users.username,
      inGameName: users.inGameName,
      avatarUrl: users.avatarUrl,
      discordId: users.discordId,
      lastLogin: users.lastLogin,
    })
    .from(factionMembers)
    .innerJoin(users, eq(factionMembers.userId, users.id))
    .where(
      and(eq(factionMembers.factionId, factionId), eq(factionMembers.userId, targetUserId)),
    )
    .limit(1);

  if (!membership) {
    error(res, 'NOT_FOUND', 'Member not found in this faction', 404);
    return;
  }

  const isAdmin = req.factionRole === 'admin' || req.factionRole === 'superadmin';

  // Payouts are admin-only material — members cannot see what others earned.
  // Use Promise.resolve([]) to keep the Promise.all shape uniform.
  const recentPayoutsPromise: Promise<RecentPayoutsRow[]> = isAdmin
    ? db
      .select({
        id: payouts.id,
        amount: payouts.amount,
        description: payouts.description,
        payoutDate: payouts.payoutDate,
        status: payouts.status,
        itemTypeName: itemTypes.name,
        itemUnit: itemTypes.unit,
        itemIsCurrency: itemTypes.isCurrency,
        itemImageUrl: itemTypes.imageUrl,
      })
      .from(payouts)
      .innerJoin(itemTypes, eq(payouts.itemTypeId, itemTypes.id))
      .where(
        and(
          eq(payouts.factionId, factionId),
          eq(payouts.recipientUserId, targetUserId),
          eq(payouts.isDeleted, false),
        ),
      )
      .orderBy(desc(payouts.createdAt))
      .limit(20)
    : Promise.resolve([]);

  const [contribution, byItemType, payoutStats, recentEntries, recentPayouts, activeQuotas] =
    await Promise.all([
      db
        .select({
          // Split by kind: money and goods share no unit, so one combined
          // figure would be meaningless (see routes/reports.ts).
          currencyTotal: sql<string>`COALESCE(SUM(CAST(${entries.amount} AS NUMERIC)) FILTER (WHERE ${itemTypes.isCurrency}), 0)`,
          itemTotal: sql<string>`COALESCE(SUM(CAST(${entries.amount} AS NUMERIC)) FILTER (WHERE NOT ${itemTypes.isCurrency}), 0)`,
          currencyCount: sql<number>`COUNT(*) FILTER (WHERE ${itemTypes.isCurrency})::int`,
          itemCount: sql<number>`COUNT(*) FILTER (WHERE NOT ${itemTypes.isCurrency})::int`,
          count: sql<number>`COUNT(*)::int`,
          lastEntryDate: sql<string | null>`MAX(${entries.entryDate})`,
        })
        .from(entries)
        .innerJoin(itemTypes, eq(entries.itemTypeId, itemTypes.id))
        .where(
          and(
            eq(entries.factionId, factionId),
            eq(entries.userId, targetUserId),
            eq(entries.isDeleted, false),
          ),
        ),
      db
        .select({
          itemTypeId: entries.itemTypeId,
          itemTypeName: itemTypes.name,
          unit: itemTypes.unit,
          isCurrency: itemTypes.isCurrency,
          imageUrl: itemTypes.imageUrl,
          total: sql<string>`COALESCE(SUM(CAST(${entries.amount} AS NUMERIC)), 0)`,
          count: sql<number>`COUNT(*)::int`,
        })
        .from(entries)
        .innerJoin(itemTypes, eq(entries.itemTypeId, itemTypes.id))
        .where(
          and(
            eq(entries.factionId, factionId),
            eq(entries.userId, targetUserId),
            eq(entries.isDeleted, false),
          ),
        )
        .groupBy(entries.itemTypeId, itemTypes.name, itemTypes.unit, itemTypes.isCurrency, itemTypes.imageUrl),
      db
        .select({
          currencyTotal: sql<string>`COALESCE(SUM(CAST(${payouts.amount} AS NUMERIC)) FILTER (WHERE ${itemTypes.isCurrency}), 0)`,
          itemTotal: sql<string>`COALESCE(SUM(CAST(${payouts.amount} AS NUMERIC)) FILTER (WHERE NOT ${itemTypes.isCurrency}), 0)`,
          count: sql<number>`COUNT(*)::int`,
        })
        .from(payouts)
        .innerJoin(itemTypes, eq(payouts.itemTypeId, itemTypes.id))
        .where(
          and(
            eq(payouts.factionId, factionId),
            eq(payouts.recipientUserId, targetUserId),
            eq(payouts.isDeleted, false),
            eq(payouts.status, 'completed'),
          ),
        ),
      db
        .select({
          id: entries.id,
          amount: entries.amount,
          description: entries.description,
          entryDate: entries.entryDate,
          createdAt: entries.createdAt,
          itemTypeName: itemTypes.name,
          itemUnit: itemTypes.unit,
          itemIsCurrency: itemTypes.isCurrency,
          itemImageUrl: itemTypes.imageUrl,
        })
        .from(entries)
        .innerJoin(itemTypes, eq(entries.itemTypeId, itemTypes.id))
        .where(
          and(
            eq(entries.factionId, factionId),
            eq(entries.userId, targetUserId),
            eq(entries.isDeleted, false),
          ),
        )
        .orderBy(desc(entries.createdAt))
        .limit(20),
      recentPayoutsPromise,
      db
        .select({
          id: quotas.id,
          itemTypeId: quotas.itemTypeId,
          itemTypeName: itemTypes.name,
          unit: itemTypes.unit,
          isCurrency: itemTypes.isCurrency,
          imageUrl: itemTypes.imageUrl,
          targetAmount: quotas.targetAmount,
          periodType: quotas.periodType,
          periodStart: quotas.periodStart,
        })
        .from(quotas)
        .innerJoin(itemTypes, eq(quotas.itemTypeId, itemTypes.id))
        .where(and(eq(quotas.factionId, factionId), eq(quotas.isActive, true))),
    ]);

  // This member's share of each active quota in its current period.
  const today = new Date();
  const quotaProgress = await Promise.all(
    activeQuotas
      .filter((q) => new Date(q.periodStart) <= today)
      .map(async (q) => {
        const range = getPeriodRange(q.periodType, today);
        const [row] = await db
          .select({ total: sql<string>`COALESCE(SUM(CAST(${entries.amount} AS NUMERIC)), 0)` })
          .from(entries)
          .where(
            and(
              eq(entries.factionId, factionId),
              eq(entries.userId, targetUserId),
              eq(entries.itemTypeId, q.itemTypeId),
              eq(entries.isDeleted, false),
              gte(entries.entryDate, range.start),
              lte(entries.entryDate, range.end),
            ),
          );
        const contributed = Number(row?.total ?? 0);
        const target = Number(q.targetAmount);
        return {
          quotaId: q.id,
          itemTypeName: q.itemTypeName,
          unit: q.unit,
          isCurrency: q.isCurrency,
          imageUrl: q.imageUrl,
          periodType: q.periodType,
          periodStart: range.start,
          periodEnd: range.end,
          // Faction-wide target; this is the member's contribution towards it.
          targetAmount: target,
          contributed,
          percentage: target > 0 ? Math.round((contributed / target) * 10000) / 100 : 0,
        };
      }),
  );

  const currencyContributed = Number(contribution[0]?.currencyTotal ?? 0);
  const itemContributed = Number(contribution[0]?.itemTotal ?? 0);
  const currencyEntryCount = contribution[0]?.currencyCount ?? 0;
  const itemEntryCount = contribution[0]?.itemCount ?? 0;
  const entryCount = contribution[0]?.count ?? 0;
  const lastEntryDate = contribution[0]?.lastEntryDate ?? null;

  const mostActiveItemType =
    byItemType.length > 0
      ? byItemType.reduce((a, b) => (Number(b.total) > Number(a.total) ? b : a))
      : null;

  const strikeCounts = await countActiveStrikes(factionId);
  const streak = await computeStreak(factionId, targetUserId);
  const performance = await computePerformanceScore(factionId, targetUserId, streak);

  success(res, {
    member: {
      ...membership,
      daysInactive: daysSince(lastEntryDate),
    },
    contribution: {
      currencyContributed,
      itemContributed,
      currencyEntryCount,
      itemEntryCount,
      entryCount,
      // Averaged within each kind — an average across money and kilograms
      // would be as meaningless as their sum.
      avgPerCurrencyEntry:
        currencyEntryCount > 0 ? Math.round((currencyContributed / currencyEntryCount) * 100) / 100 : 0,
      avgPerItemEntry:
        itemEntryCount > 0 ? Math.round((itemContributed / itemEntryCount) * 100) / 100 : 0,
      lastEntryDate,
      byItemType: byItemType.map((t) => ({ ...t, total: Number(t.total) })),
      mostActiveItemType: mostActiveItemType
        ? { itemTypeName: mostActiveItemType.itemTypeName, total: Number(mostActiveItemType.total) }
        : null,
    },
    payouts: {
      currencyReceived: Number(payoutStats[0]?.currencyTotal ?? 0),
      itemReceived: Number(payoutStats[0]?.itemTotal ?? 0),
      payoutCount: payoutStats[0]?.count ?? 0,
    },
    quotaProgress,
    // Detail lives on /strikes; this is just the badge count.
    activeStrikeCount: strikeCounts.get(targetUserId) ?? 0,
    recentEntries,
    recentPayouts,
    // Heatmap has its own endpoint (/heatmap?year=) because a full year of
    // days is far larger than the rest of this response.
    streak,
    performance,
    // Notes are admin-only and paginated separately; this flag tells the UI
    // whether to show the tab at all.
    canViewNotes: isAdmin,
  });
});

// Hoisted type for the recent payouts promise so the Promise.all binding can
// be typed uniformly for both admin and member callers (members get an
// empty array of the same shape).
type RecentPayoutsRow = {
  id: string;
  amount: string;
  description: string | null;
  payoutDate: string;
  status: string;
  itemTypeName: string;
  itemUnit: string;
  itemIsCurrency: boolean;
  itemImageUrl: string | null;
};

export default router;
