import { Router, Request, Response } from 'express';
import { db } from '../db/index.js';
import { factions, users, entries, factionMembers, itemTypes, quotas, auditLogs } from '../db/schema.js';
import { eq, sql, and, gte } from 'drizzle-orm';
import { success, error } from '../lib/response.js';
import { requireAuth, requireSuperadmin } from '../middleware/auth.js';

const router = Router();

router.use(requireAuth, requireSuperadmin);

// GET / — system-wide analytics for superadmin
router.get('/', async (_req: Request, res: Response) => {
  const now = new Date();
  const thirtyDaysAgo = new Date(now);
  thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
  const thirtyDaysAgoStr = thirtyDaysAgo.toISOString().split('T')[0];

  const sevenDaysAgo = new Date(now);
  sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
  const sevenDaysAgoStr = sevenDaysAgo.toISOString().split('T')[0];

  const [
    totalFactions,
    activeFactions,
    totalUsers,
    totalEntries,
    entriesLast7d,
    entriesLast30d,
    totalMemberships,
    activeQuotas,
    recentSignups,
    factionStats,
    topFactions,
  ] = await Promise.all([
    // Total factions
    db.select({ count: sql<number>`COUNT(*)::int` }).from(factions),

    // Active factions
    db.select({ count: sql<number>`COUNT(*)::int` }).from(factions).where(eq(factions.isActive, true)),

    // Total users
    db.select({ count: sql<number>`COUNT(*)::int` }).from(users),

    // Total entries
    db.select({ count: sql<number>`COUNT(*)::int` }).from(entries).where(eq(entries.isDeleted, false)),

    // Entries last 7 days
    db.select({ count: sql<number>`COUNT(*)::int` }).from(entries).where(
      and(eq(entries.isDeleted, false), gte(entries.entryDate, sevenDaysAgoStr)),
    ),

    // Entries last 30 days
    db.select({ count: sql<number>`COUNT(*)::int` }).from(entries).where(
      and(eq(entries.isDeleted, false), gte(entries.entryDate, thirtyDaysAgoStr)),
    ),

    // Total memberships
    db.select({ count: sql<number>`COUNT(*)::int` }).from(factionMembers),

    // Active quotas
    db.select({ count: sql<number>`COUNT(*)::int` }).from(quotas).where(eq(quotas.isActive, true)),

    // Recent signups (last 30 days)
    db
      .select({
        id: users.id,
        username: users.username,
        avatarUrl: users.avatarUrl,
        role: users.role,
        createdAt: users.createdAt,
      })
      .from(users)
      .where(gte(users.createdAt, thirtyDaysAgo))
      .orderBy(sql`users.created_at DESC`)
      .limit(10),

    // Per-faction stats (top 10 by entries)
    db
      .select({
        factionId: factions.id,
        name: factions.name,
        isActive: factions.isActive,
        memberCount: sql<number>`(SELECT COUNT(*) FROM faction_members WHERE faction_id = factions.id)::int`,
        entryCount: sql<number>`(SELECT COUNT(*) FROM entries WHERE faction_id = factions.id AND is_deleted = false)::int`,
        totalAmount: sql<string>`(SELECT COALESCE(SUM(CAST(amount AS NUMERIC)), 0) FROM entries WHERE faction_id = factions.id AND is_deleted = false)`,
        itemTypeCount: sql<number>`(SELECT COUNT(*) FROM item_types WHERE faction_id = factions.id)::int`,
      })
      .from(factions)
      .orderBy(sql`(SELECT COUNT(*) FROM entries WHERE faction_id = factions.id AND is_deleted = false) DESC`)
      .limit(10),

    // Top factions by total amount
    db
      .select({
        factionId: factions.id,
        name: factions.name,
        totalAmount: sql<string>`(SELECT COALESCE(SUM(CAST(amount AS NUMERIC)), 0) FROM entries WHERE faction_id = factions.id AND is_deleted = false)`,
      })
      .from(factions)
      .where(eq(factions.isActive, true))
      .orderBy(sql`(SELECT COALESCE(SUM(CAST(amount AS NUMERIC)), 0) FROM entries WHERE faction_id = factions.id AND is_deleted = false) DESC`)
      .limit(5),
  ]);

  // Daily signup trend (last 30 days)
  const dailySignups = await db
    .select({
      date: sql<string>`DATE(created_at)::text`,
      count: sql<number>`COUNT(*)::int`,
    })
    .from(users)
    .where(gte(users.createdAt, thirtyDaysAgo))
    .groupBy(sql`DATE(created_at)`)
    .orderBy(sql`DATE(created_at)`);

  // Daily entries trend (last 30 days)
  const dailyEntries = await db
    .select({
      date: sql<string>`entry_date`,
      count: sql<number>`COUNT(*)::int`,
      total: sql<string>`COALESCE(SUM(CAST(amount AS NUMERIC)), 0)`,
    })
    .from(entries)
    .where(and(eq(entries.isDeleted, false), gte(entries.entryDate, thirtyDaysAgoStr)))
    .groupBy(sql`entry_date`)
    .orderBy(sql`entry_date`);

  // Fill missing days for both trends
  const fillTrend = (data: { date: string; count: number; total?: string }[]) => {
    const map = new Map(data.map((d) => [d.date, d]));
    const filled: { date: string; count: number; total: number }[] = [];
    const cursor = new Date(thirtyDaysAgoStr + 'T00:00:00');
    const end = new Date(now.toISOString().split('T')[0] + 'T00:00:00');
    while (cursor <= end) {
      const ds = cursor.toISOString().split('T')[0];
      const existing = map.get(ds);
      filled.push({
        date: ds,
        count: existing?.count ?? 0,
        total: existing?.total ? Number(existing.total) : 0,
      });
      cursor.setDate(cursor.getDate() + 1);
    }
    return filled;
  };

  success(res, {
    overview: {
      totalFactions: totalFactions[0]?.count ?? 0,
      activeFactions: activeFactions[0]?.count ?? 0,
      totalUsers: totalUsers[0]?.count ?? 0,
      totalEntries: totalEntries[0]?.count ?? 0,
      entriesLast7d: entriesLast7d[0]?.count ?? 0,
      entriesLast30d: entriesLast30d[0]?.count ?? 0,
      totalMemberships: totalMemberships[0]?.count ?? 0,
      activeQuotas: activeQuotas[0]?.count ?? 0,
    },
    recentSignups,
    factionStats: factionStats.map((f) => ({ ...f, totalAmount: Number(f.totalAmount) })),
    topFactionsByAmount: topFactions.map((f) => ({ ...f, totalAmount: Number(f.totalAmount) })),
    dailySignupsTrend: fillTrend(dailySignups),
    dailyEntriesTrend: fillTrend(dailyEntries),
  });
});

export default router;
