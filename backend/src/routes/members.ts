import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { db } from '../db/index.js';
import { factionMembers, users, entries, factions, itemTypes, payouts, quotas, auditLogs } from '../db/schema.js';
import { eq, and, sql, desc, gte, lte, count as countFn } from 'drizzle-orm';
import { success, error } from '../lib/response.js';
import { parsePagination } from '../lib/types.js';
import { requireAuth } from '../middleware/auth.js';
import { requireFactionMember, requireFactionAdminOrSuperadmin } from '../middleware/factionAccess.js';
import { createAuditLog } from '../lib/audit.js';
import { getPeriodRange } from '../lib/period.js';
import { daysSince } from '../lib/date.js';
import { countActiveStrikes } from '../lib/strikes.js';

const router = Router({ mergeParams: true });

// All routes require faction membership
router.use(requireAuth, requireFactionMember);

// ── Validation schemas ────────────────────────────────

const addMemberSchema = z.object({
  discordId: z.string().min(1, 'Discord ID is required'),
});

const updateMemberSchema = z.object({
  role: z.enum(['admin', 'member']).optional(),
  // null clears the rank; a string must match one of the faction's ranks
  rank: z.string().min(1).max(100).nullable().optional(),
}).refine(
  (d) => d.role !== undefined || d.rank !== undefined,
  'Provide at least one of: role, rank',
);

// ── POST / — add member to faction ───────────────────
router.post('/', requireFactionAdminOrSuperadmin, async (req: Request, res: Response) => {
  const factionId = req.params.id as string;
  const parsed = addMemberSchema.safeParse(req.body);
  if (!parsed.success) {
    error(res, 'VALIDATION_ERROR', parsed.error.issues[0]!.message);
    return;
  }

  const { discordId } = parsed.data;

  // Find user by Discord ID
  const [targetUser] = await db
    .select()
    .from(users)
    .where(eq(users.discordId, discordId))
    .limit(1);
  if (!targetUser) {
    error(res, 'NOT_FOUND', `No user found with Discord ID: ${discordId}. They must log in first.`);
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

  const [member] = await db
    .insert(factionMembers)
    .values({ factionId, userId: targetUser.id, role: 'member' })
    .returning();

  if (!member) {
    error(res, 'INTERNAL_ERROR', 'Failed to add member', 500);
    return;
  }

  await createAuditLog({
    userId: req.user!.id,
    factionId,
    action: 'create',
    entityType: 'member',
    entityId: member.id,
    details: { addedUserId: targetUser.id, discordId: targetUser.discordId, username: targetUser.username },
    req,
  });

  success(res, { ...member, username: targetUser.username, avatarUrl: targetUser.avatarUrl, discordId: targetUser.discordId }, 201);
});

// ── GET / — list faction members ─────────────────────
router.get('/', async (req: Request, res: Response) => {
  const factionId = req.params.id as string;

  const memberList = await db
    .select({
      id: factionMembers.id,
      userId: factionMembers.userId,
      role: factionMembers.role,
      rank: factionMembers.rank,
      joinedAt: factionMembers.joinedAt,
      username: users.username,
      avatarUrl: users.avatarUrl,
      discordId: users.discordId,
      entryCount: sql<number>`(SELECT COUNT(*) FROM entries WHERE user_id = users.id AND faction_id = ${sql.raw(`'${factionId}'::uuid`)} AND is_deleted = false)::int`,
      lastEntryDate: sql<string | null>`(SELECT MAX(entry_date) FROM entries WHERE user_id = users.id AND faction_id = ${sql.raw(`'${factionId}'::uuid`)} AND is_deleted = false)`,
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
router.patch('/:userId', requireFactionAdminOrSuperadmin, async (req: Request, res: Response) => {
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

  const oldRole = membership.role;
  const oldRank = membership.rank;
  const [updated] = await db
    .update(factionMembers)
    .set(updates)
    .where(eq(factionMembers.id, membership.id))
    .returning();

  // If promoting to admin, update user's global role
  if (parsed.data.role === 'admin') {
    const [targetUser] = await db.select().from(users).where(eq(users.id, targetUserId)).limit(1);
    if (targetUser && targetUser.role === 'member') {
      await db.update(users).set({ role: 'faction_admin' }).where(eq(users.id, targetUserId));
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
  });

  success(res, updated);
});

// ── DELETE /:userId — remove member ───────────────────
router.delete('/:userId', requireFactionAdminOrSuperadmin, async (req: Request, res: Response) => {
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

  await db.delete(factionMembers).where(eq(factionMembers.id, membership.id));

  await createAuditLog({
    userId: req.user!.id,
    factionId,
    action: 'delete',
    entityType: 'member',
    entityId: membership.id,
    details: { removedUserId: targetUserId, role: membership.role },
    req,
  });

  success(res, { removed: true });
});

// ── GET /:userId/history — join / leave / role changes ──
// Reads the existing audit log rather than keeping a second table: member
// lifecycle events are already recorded there with entity_type='member'.
router.get('/:userId/history', requireFactionAdminOrSuperadmin, async (req: Request, res: Response) => {
  const factionId = req.params.id as string;
  const targetUserId = req.params.userId as string;

  const { page, pageSize, offset } = parsePagination({
    page: req.query.page as string | undefined,
    page_size: req.query.page_size as string | undefined,
  });

  const where = and(
    eq(auditLogs.factionId, factionId),
    eq(auditLogs.entityType, 'member'),
    sql`${auditLogs.details}->>'userId' = ${targetUserId}`,
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

  const [contribution, byItemType, payoutStats, recentEntries, recentPayouts, activeQuotas] =
    await Promise.all([
      db
        .select({
          total: sql<string>`COALESCE(SUM(CAST(${entries.amount} AS NUMERIC)), 0)`,
          count: sql<number>`COUNT(*)::int`,
          lastEntryDate: sql<string | null>`MAX(${entries.entryDate})`,
        })
        .from(entries)
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
        .groupBy(entries.itemTypeId, itemTypes.name, itemTypes.unit, itemTypes.isCurrency),
      db
        .select({
          total: sql<string>`COALESCE(SUM(CAST(${payouts.amount} AS NUMERIC)), 0)`,
          count: sql<number>`COUNT(*)::int`,
        })
        .from(payouts)
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
      db
        .select({
          id: payouts.id,
          amount: payouts.amount,
          description: payouts.description,
          payoutDate: payouts.payoutDate,
          status: payouts.status,
          itemTypeName: itemTypes.name,
          itemUnit: itemTypes.unit,
          itemIsCurrency: itemTypes.isCurrency,
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
        .limit(20),
      db
        .select({
          id: quotas.id,
          itemTypeId: quotas.itemTypeId,
          itemTypeName: itemTypes.name,
          unit: itemTypes.unit,
          isCurrency: itemTypes.isCurrency,
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

  const totalContributed = Number(contribution[0]?.total ?? 0);
  const entryCount = contribution[0]?.count ?? 0;
  const lastEntryDate = contribution[0]?.lastEntryDate ?? null;

  const mostActiveItemType =
    byItemType.length > 0
      ? byItemType.reduce((a, b) => (Number(b.total) > Number(a.total) ? b : a))
      : null;

  const strikeCounts = await countActiveStrikes(factionId);

  success(res, {
    member: {
      ...membership,
      daysInactive: daysSince(lastEntryDate),
    },
    contribution: {
      totalContributed,
      entryCount,
      averagePerEntry: entryCount > 0 ? Math.round((totalContributed / entryCount) * 100) / 100 : 0,
      lastEntryDate,
      byItemType: byItemType.map((t) => ({ ...t, total: Number(t.total) })),
      mostActiveItemType: mostActiveItemType
        ? { itemTypeName: mostActiveItemType.itemTypeName, total: Number(mostActiveItemType.total) }
        : null,
    },
    payouts: {
      totalReceived: Number(payoutStats[0]?.total ?? 0),
      payoutCount: payoutStats[0]?.count ?? 0,
    },
    quotaProgress,
    // Detail lives on /strikes; this is just the badge count.
    activeStrikeCount: strikeCounts.get(targetUserId) ?? 0,
    recentEntries,
    recentPayouts,
    // Phase 7 features — declared so the UI can render an empty state today
    // without guessing at the eventual shape.
    heatmap: null,
    streak: null,
    // Notes are admin-only and paginated separately; this flag tells the UI
    // whether to show the tab at all.
    canViewNotes: isAdmin,
  });
});

export default router;
