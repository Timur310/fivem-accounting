import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { db } from '../db/index.js';
import { entries, itemTypes, users, factionMembers, factions } from '../db/schema.js';
import { eq, and, sql, gte, lte, desc } from 'drizzle-orm';
import { success, error } from '../lib/response.js';
import { requireAuth } from '../middleware/auth.js';
import { requireFactionMember, requireFactionAdminOrSuperadmin } from '../middleware/factionAccess.js';
import { toDateString, todayDateString } from '../lib/date.js';
import { getPeriodRange } from '../lib/period.js';

const router = Router({ mergeParams: true });

router.use(requireAuth, requireFactionMember);

const summaryQuerySchema = z.object({
  period: z.enum(['this_week', 'last_week', 'this_month', 'last_month', 'last_30d', 'last_90d', 'all']).default('this_month'),
});

const growthQuerySchema = z.object({
  periods: z.string().optional(),
  granularity: z.enum(['week', 'month']).optional(),
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
        // Split by kind: adding money to kilograms gives a figure with no unit.
        currencyTotal: sql<string>`COALESCE(SUM(CAST(${entries.amount} AS NUMERIC)) FILTER (WHERE ${itemTypes.isCurrency}), 0)`,
        itemTotal: sql<string>`COALESCE(SUM(CAST(${entries.amount} AS NUMERIC)) FILTER (WHERE NOT ${itemTypes.isCurrency}), 0)`,
        currencyEntryCount: sql<number>`COUNT(*) FILTER (WHERE ${itemTypes.isCurrency})::int`,
        itemEntryCount: sql<number>`COUNT(*) FILTER (WHERE NOT ${itemTypes.isCurrency})::int`,
        entryCount: sql<number>`COUNT(*)::int`,
        uniqueMembers: sql<number>`COUNT(DISTINCT ${entries.userId})::int`,
        avgPerCurrencyEntry: sql<string>`COALESCE(AVG(CAST(${entries.amount} AS NUMERIC)) FILTER (WHERE ${itemTypes.isCurrency}), 0)`,
        avgPerItemEntry: sql<string>`COALESCE(AVG(CAST(${entries.amount} AS NUMERIC)) FILTER (WHERE NOT ${itemTypes.isCurrency}), 0)`,
      })
      .from(entries)
      .innerJoin(itemTypes, eq(entries.itemTypeId, itemTypes.id))
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
        inGameName: users.inGameName,
        avatarUrl: users.avatarUrl,
        currencyTotal: sql<string>`COALESCE(SUM(CAST(${entries.amount} AS NUMERIC)) FILTER (WHERE ${itemTypes.isCurrency}), 0)`,
        itemTotal: sql<string>`COALESCE(SUM(CAST(${entries.amount} AS NUMERIC)) FILTER (WHERE NOT ${itemTypes.isCurrency}), 0)`,
        count: sql<number>`COUNT(*)::int`,
      })
      .from(entries)
      .innerJoin(users, eq(entries.userId, users.id))
      .innerJoin(itemTypes, eq(entries.itemTypeId, itemTypes.id))
      .where(where)
      .groupBy(users.id, users.username, users.inGameName, users.avatarUrl)
      // Ranked on money, with goods reported alongside rather than mixed in.
      .orderBy(sql`SUM(CAST(${entries.amount} AS NUMERIC)) FILTER (WHERE ${itemTypes.isCurrency}) DESC NULLS LAST`),

    // Daily breakdown
    db
      .select({
        date: entries.entryDate,
        currencyTotal: sql<string>`COALESCE(SUM(CAST(${entries.amount} AS NUMERIC)) FILTER (WHERE ${itemTypes.isCurrency}), 0)`,
        itemTotal: sql<string>`COALESCE(SUM(CAST(${entries.amount} AS NUMERIC)) FILTER (WHERE NOT ${itemTypes.isCurrency}), 0)`,
        count: sql<number>`COUNT(*)::int`,
      })
      .from(entries)
      .innerJoin(itemTypes, eq(entries.itemTypeId, itemTypes.id))
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
      // Money and goods are reported separately: they have no shared unit, so
      // one combined figure would be meaningless.
      currencyTotal: Number(s?.currencyTotal ?? 0),
      itemTotal: Number(s?.itemTotal ?? 0),
      currencyEntryCount: s?.currencyEntryCount ?? 0,
      itemEntryCount: s?.itemEntryCount ?? 0,
      entryCount: s?.entryCount ?? 0,
      uniqueMembers: s?.uniqueMembers ?? 0,
      avgPerCurrencyEntry: Number(s?.avgPerCurrencyEntry ?? 0),
      avgPerItemEntry: Number(s?.avgPerItemEntry ?? 0),
    },
    byType: byType.map((t) => ({
      ...t,
      total: Number(t.total),
      avg: Number(t.avg),
      max: Number(t.max),
    })),
    memberRanking: byMember.map((m) => ({
      ...m,
      currencyTotal: Number(m.currencyTotal),
      itemTotal: Number(m.itemTotal),
    })),
    dailyBreakdown: dailyBreakdown.map((d) => ({
      ...d,
      currencyTotal: Number(d.currencyTotal),
      itemTotal: Number(d.itemTotal),
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
        currencyTotal: sql<string>`COALESCE(SUM(CAST(${entries.amount} AS NUMERIC)) FILTER (WHERE ${itemTypes.isCurrency}), 0)`,
        itemTotal: sql<string>`COALESCE(SUM(CAST(${entries.amount} AS NUMERIC)) FILTER (WHERE NOT ${itemTypes.isCurrency}), 0)`,
        count: sql<number>`COUNT(*)::int`,
        members: sql<number>`COUNT(DISTINCT ${entries.userId})::int`,
      })
      .from(entries)
      .innerJoin(itemTypes, eq(entries.itemTypeId, itemTypes.id))
      .where(where);
    const byType = await db
      .select({
        itemTypeName: itemTypes.name,
        unit: itemTypes.unit,
        isCurrency: itemTypes.isCurrency,
        total: sql<string>`COALESCE(SUM(CAST(${entries.amount} AS NUMERIC)), 0)`,
        count: sql<number>`COUNT(*)::int`,
      })
      .from(entries)
      .innerJoin(itemTypes, eq(entries.itemTypeId, itemTypes.id))
      .where(where)
      .groupBy(itemTypes.name, itemTypes.unit, itemTypes.isCurrency)
      .orderBy(sql`SUM(CAST(${entries.amount} AS NUMERIC)) DESC`);
    return {
      currencyTotal: Number(stats?.currencyTotal ?? 0),
      itemTotal: Number(stats?.itemTotal ?? 0),
      count: stats?.count ?? 0,
      members: stats?.members ?? 0,
      byType: byType.map((t) => ({ ...t, total: Number(t.total) })),
    };
  }

  const [periodA, periodB] = await Promise.all([
    getPeriodStats(boundsA),
    getPeriodStats(boundsB),
  ]);

  // Deltas are computed per kind for the same reason the totals are split.
  // null means the earlier period was zero, so there is no baseline — that is
  // not the same as 0% and should not be rendered as one.
  const pct = (before: number, after: number): number | null => {
    if (before === 0) return after === 0 ? 0 : null;
    return Math.round(((after - before) / before) * 10000) / 100;
  };

  success(res, {
    periodA: { label: period_a, ...boundsA, ...periodA },
    periodB: { label: period_b, ...boundsB, ...periodB },
    deltas: {
      currencyTotal: periodB.currencyTotal - periodA.currencyTotal,
      currencyTotalPercent: pct(periodA.currencyTotal, periodB.currencyTotal),
      itemTotal: periodB.itemTotal - periodA.itemTotal,
      itemTotalPercent: pct(periodA.itemTotal, periodB.itemTotal),
      entryCount: periodB.count - periodA.count,
      memberActivity: periodB.members - periodA.members,
    },
  });
});

// ── GET /growth — period-over-period metrics ─────────
router.get('/growth', requireFactionAdminOrSuperadmin, async (req: Request, res: Response) => {
  const factionId = req.params.id as string;

  const parsed = growthQuerySchema.safeParse(req.query);
  if (!parsed.success) {
    error(res, 'VALIDATION_ERROR', parsed.error.issues[0]!.message);
    return;
  }

  const periodCount = Math.min(24, Math.max(2, Number(parsed.data.periods) || 6));
  const granularity = parsed.data.granularity ?? 'month';

  // Build the window list newest-last, so the response reads left to right on
  // a chart without the frontend having to reverse it.
  const windows: { label: string; from: string; to: string }[] = [];
  const now = new Date();
  for (let i = periodCount - 1; i >= 0; i--) {
    if (granularity === 'month') {
      const start = new Date(now.getFullYear(), now.getMonth() - i, 1);
      const end = new Date(now.getFullYear(), now.getMonth() - i + 1, 0);
      windows.push({
        label: start.toLocaleString('en-US', { month: 'short', year: 'numeric' }),
        from: toDateString(start),
        to: toDateString(end),
      });
    } else {
      const ref = new Date(now);
      ref.setDate(ref.getDate() - i * 7);
      const range = getPeriodRange('weekly', ref);
      windows.push({ label: `Week of ${range.start}`, from: range.start, to: range.end });
    }
  }

  const periods = await Promise.all(
    windows.map(async (w) => {
      const [row] = await db
        .select({
          totalEntries: sql<number>`COUNT(*)::int`,
          totalAmount: sql<string>`COALESCE(SUM(CAST(${entries.amount} AS NUMERIC)), 0)`,
          activeMembers: sql<number>`COUNT(DISTINCT ${entries.userId})::int`,
        })
        .from(entries)
        .where(
          and(
            eq(entries.factionId, factionId),
            eq(entries.isDeleted, false),
            gte(entries.entryDate, w.from),
            lte(entries.entryDate, w.to),
          ),
        );

      const totalAmount = Number(row?.totalAmount ?? 0);
      const activeMembers = row?.activeMembers ?? 0;
      return {
        label: w.label,
        from: w.from,
        to: w.to,
        totalEntries: row?.totalEntries ?? 0,
        totalAmount,
        activeMembers,
        // Averaged over members who were actually active, not the whole roster:
        // otherwise adding a dormant member looks like a performance drop.
        avgPerMember: activeMembers > 0 ? Math.round((totalAmount / activeMembers) * 100) / 100 : 0,
      };
    }),
  );

  // Growth compares the two most recent windows. The latest one is usually
  // still in progress, which the `partial` flag makes explicit rather than
  // letting it read as a sudden decline.
  const latest = periods[periods.length - 1];
  const previous = periods[periods.length - 2];

  const pct = (now: number, before: number): number | null => {
    if (before === 0) return now === 0 ? 0 : null; // null = no baseline to compare against
    return Math.round(((now - before) / before) * 10000) / 100;
  };

  const growth =
    latest && previous
      ? {
          entriesChangePct: pct(latest.totalEntries, previous.totalEntries),
          amountChangePct: pct(latest.totalAmount, previous.totalAmount),
          memberChange: latest.activeMembers - previous.activeMembers,
          avgChangePct: pct(latest.avgPerMember, previous.avgPerMember),
        }
      : null;

  success(res, {
    granularity,
    periods,
    growth,
    // The final window has not finished yet unless its end date is in the past.
    partial: latest ? latest.to >= todayDateString() : false,
  });
});

export default router;
