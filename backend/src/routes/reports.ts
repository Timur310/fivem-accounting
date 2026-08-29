import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { db } from '../db/index.js';
import { entries, itemTypes, users, factionMembers, factions } from '../db/schema.js';
import { eq, and, sql, gte, lte, desc } from 'drizzle-orm';
import { success, error } from '../lib/response.js';
import { requireAuth } from '../middleware/auth.js';
import { requireFactionMember, requireFactionAdminOrSuperadmin } from '../middleware/factionAccess.js';
import { toDateString } from '../lib/date.js';

const router = Router({ mergeParams: true });

router.use(requireAuth, requireFactionMember);

const summaryQuerySchema = z.object({
  period: z.enum(['this_week', 'last_week', 'this_month', 'last_month', 'last_30d', 'last_90d', 'all']).default('this_month'),
});

const comparisonQuerySchema = z.object({
  period_a: z.enum(['this_week', 'last_week', 'this_month', 'last_month']).default('this_month'),
  period_b: z.enum(['this_week', 'last_week', 'this_month', 'last_month']).default('last_month'),
});

// ── Helpers ──────────────────────────────────────────

function getPeriodBounds(period: string): { from: string; to: string } {
  const today = new Date();
  const todayStr = toDateString(today);

  if (period === 'all') {
    return { from: '2000-01-01', to: '2099-12-31' };
  }

  if (period === 'last_30d') {
    const from = new Date(today);
    from.setDate(from.getDate() - 30);
    return { from: toDateString(from), to: todayStr };
  }

  if (period === 'last_90d') {
    const from = new Date(today);
    from.setDate(from.getDate() - 90);
    return { from: toDateString(from), to: todayStr };
  }

  // Weekly: Monday-based
  if (period === 'this_week') {
    const day = today.getDay();
    const diff = day === 0 ? 6 : day - 1;
    const monday = new Date(today);
    monday.setDate(today.getDate() - diff);
    const sunday = new Date(monday);
    sunday.setDate(monday.getDate() + 6);
    return { from: toDateString(monday), to: toDateString(sunday) };
  }

  if (period === 'last_week') {
    const day = today.getDay();
    const diff = day === 0 ? 6 : day - 1;
    const thisMonday = new Date(today);
    thisMonday.setDate(today.getDate() - diff);
    const lastMonday = new Date(thisMonday);
    lastMonday.setDate(thisMonday.getDate() - 7);
    const lastSunday = new Date(thisMonday);
    lastSunday.setDate(thisMonday.getDate() - 1);
    return { from: toDateString(lastMonday), to: toDateString(lastSunday) };
  }

  // Monthly
  if (period === 'this_month') {
    const firstDay = new Date(today.getFullYear(), today.getMonth(), 1);
    const lastDay = new Date(today.getFullYear(), today.getMonth() + 1, 0);
    return { from: toDateString(firstDay), to: toDateString(lastDay) };
  }

  // last_month
  const firstDay = new Date(today.getFullYear(), today.getMonth() - 1, 1);
  const lastDay = new Date(today.getFullYear(), today.getMonth(), 0);
  return { from: toDateString(firstDay), to: toDateString(lastDay) };
}

// ── GET /summary — periodic summary ─────────────────
router.get('/summary', async (req: Request, res: Response) => {
  const factionId = req.params.id as string;
  const query = summaryQuerySchema.safeParse(req.query);
  if (!query.success) {
    error(res, 'VALIDATION_ERROR', query.error.issues[0]!.message);
    return;
  }

  const { from, to } = getPeriodBounds(query.data.period);
  const where = and(
    eq(entries.factionId, factionId),
    eq(entries.isDeleted, false),
    gte(entries.entryDate, from),
    lte(entries.entryDate, to),
  );

  const [stats, byType, byMember, dailyBreakdown] = await Promise.all([
    // Overall stats
    db
      .select({
        totalAmount: sql<string>`COALESCE(SUM(CAST(amount AS NUMERIC)), 0)`,
        entryCount: sql<number>`COUNT(*)::int`,
        uniqueMembers: sql<number>`COUNT(DISTINCT user_id)::int`,
        avgPerEntry: sql<string>`COALESCE(AVG(CAST(amount AS NUMERIC)), 0)`,
      })
      .from(entries)
      .where(where),

    // Per item type
    db
      .select({
        itemTypeName: itemTypes.name,
        unit: itemTypes.unit,
        isCurrency: itemTypes.isCurrency,
        total: sql<string>`COALESCE(SUM(CAST(amount AS NUMERIC)), 0)`,
        count: sql<number>`COUNT(*)::int`,
        avg: sql<string>`COALESCE(AVG(CAST(amount AS NUMERIC)), 0)`,
        max: sql<string>`COALESCE(MAX(CAST(amount AS NUMERIC)), 0)`,
      })
      .from(entries)
      .innerJoin(itemTypes, eq(entries.itemTypeId, itemTypes.id))
      .where(where)
      .groupBy(itemTypes.name, itemTypes.unit, itemTypes.isCurrency)
      .orderBy(sql`SUM(CAST(amount AS NUMERIC)) DESC`),

    // Per member ranking
    db
      .select({
        username: users.username,
        avatarUrl: users.avatarUrl,
        total: sql<string>`COALESCE(SUM(CAST(amount AS NUMERIC)), 0)`,
        count: sql<number>`COUNT(*)::int`,
        avg: sql<string>`COALESCE(AVG(CAST(amount AS NUMERIC)), 0)`,
      })
      .from(entries)
      .innerJoin(users, eq(entries.userId, users.id))
      .where(where)
      .groupBy(users.id, users.username, users.avatarUrl)
      .orderBy(sql`SUM(CAST(amount AS NUMERIC)) DESC`),

    // Daily breakdown
    db
      .select({
        date: entries.entryDate,
        total: sql<string>`COALESCE(SUM(CAST(amount AS NUMERIC)), 0)`,
        count: sql<number>`COUNT(*)::int`,
      })
      .from(entries)
      .where(where)
      .groupBy(entries.entryDate)
      .orderBy(entries.entryDate),
  ]);

  const s = stats[0];
  success(res, {
    period: query.data.period,
    from,
    to,
    overview: {
      totalAmount: Number(s?.totalAmount ?? 0),
      entryCount: s?.entryCount ?? 0,
      uniqueMembers: s?.uniqueMembers ?? 0,
      avgPerEntry: Number(s?.avgPerEntry ?? 0),
    },
    byType: byType.map((t) => ({
      ...t,
      total: Number(t.total),
      avg: Number(t.avg),
      max: Number(t.max),
    })),
    memberRanking: byMember.map((m) => ({
      ...m,
      total: Number(m.total),
      avg: Number(m.avg),
    })),
    dailyBreakdown: dailyBreakdown.map((d) => ({
      ...d,
      total: Number(d.total),
    })),
  });
});

// ── GET /comparison — compare two periods ───────────
router.get('/comparison', async (req: Request, res: Response) => {
  const factionId = req.params.id as string;
  const query = comparisonQuerySchema.safeParse(req.query);
  if (!query.success) {
    error(res, 'VALIDATION_ERROR', query.error.issues[0]!.message);
    return;
  }

  const { period_a, period_b } = query.data;
  const boundsA = getPeriodBounds(period_a);
  const boundsB = getPeriodBounds(period_b);

  async function getPeriodStats(bounds: { from: string; to: string }) {
    const where = and(
      eq(entries.factionId, factionId),
      eq(entries.isDeleted, false),
      gte(entries.entryDate, bounds.from),
      lte(entries.entryDate, bounds.to),
    );
    const [stats] = await db
      .select({
        total: sql<string>`COALESCE(SUM(CAST(amount AS NUMERIC)), 0)`,
        count: sql<number>`COUNT(*)::int`,
        members: sql<number>`COUNT(DISTINCT user_id)::int`,
      })
      .from(entries)
      .where(where);
    const byType = await db
      .select({
        itemTypeName: itemTypes.name,
        total: sql<string>`COALESCE(SUM(CAST(amount AS NUMERIC)), 0)`,
        count: sql<number>`COUNT(*)::int`,
      })
      .from(entries)
      .innerJoin(itemTypes, eq(entries.itemTypeId, itemTypes.id))
      .where(where)
      .groupBy(itemTypes.name)
      .orderBy(sql`SUM(CAST(amount AS NUMERIC)) DESC`);
    return {
      total: Number(stats?.total ?? 0),
      count: stats?.count ?? 0,
      members: stats?.members ?? 0,
      byType: byType.map((t) => ({ ...t, total: Number(t.total) })),
    };
  }

  const [periodA, periodB] = await Promise.all([
    getPeriodStats(boundsA),
    getPeriodStats(boundsB),
  ]);

  // Compute deltas
  const pctChange = periodA.total > 0
    ? ((periodB.total - periodA.total) / periodA.total) * 100
    : periodB.total > 0 ? 100 : 0;

  success(res, {
    periodA: { label: period_a, ...boundsA, ...periodA },
    periodB: { label: period_b, ...boundsB, ...periodB },
    deltas: {
      totalAmount: periodB.total - periodA.total,
      totalAmountPercent: Math.round(pctChange * 100) / 100,
      entryCount: periodB.count - periodA.count,
      memberActivity: periodB.members - periodA.members,
    },
  });
});

export default router;
