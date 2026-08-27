import { Router, Request, Response } from 'express';
import { db } from '../db/index.js';
import { entries, itemTypes, users } from '../db/schema.js';
import { eq, and, sql, gte, lte, desc, extract } from 'drizzle-orm';
import { success, error } from '../lib/response.js';
import { requireAuth } from '../middleware/auth.js';
import { requireFactionMember } from '../middleware/factionAccess.js';

const router = Router({ mergeParams: true });

router.use(requireAuth, requireFactionMember);

// GET / — chart data for faction dashboard
// Query params:
//   range=7d|14d|30d|90d  (default 30d)
router.get('/', async (req: Request, res: Response) => {
  const factionId = req.params.id as string;

  // Parse range — default 30 days
  const rangeStr = (req.query.range as string) || '30d';
  const daysMatch = rangeStr.match(/^(\d+)d$/);
  const days = daysMatch ? Math.min(Number(daysMatch[1]), 365) : 30;

  const dateFrom = new Date();
  dateFrom.setDate(dateFrom.getDate() - days);
  dateFrom.setHours(0, 0, 0, 0);
  const dateFromStr = dateFrom.toISOString().split('T')[0];
  const todayStr = new Date().toISOString().split('T')[0];

  const baseWhere = and(
    eq(entries.factionId, factionId),
    eq(entries.isDeleted, false),
    gte(entries.entryDate, dateFromStr),
    lte(entries.entryDate, todayStr),
  );

  // ── 1. Per-member contributions (bar chart) ───────
  const memberContributions = await db
    .select({
      userId: users.id,
      username: users.username,
      avatarUrl: users.avatarUrl,
      total: sql<string>`COALESCE(SUM(CAST(amount AS NUMERIC)), 0)`,
      entryCount: sql<number>`COUNT(*)::int`,
    })
    .from(entries)
    .innerJoin(users, eq(entries.userId, users.id))
    .where(baseWhere)
    .groupBy(users.id, users.username, users.avatarUrl)
    .orderBy(sql`SUM(CAST(amount AS NUMERIC)) DESC`);

  // ── 2. Item type distribution (pie chart) ──────────
  const itemDistribution = await db
    .select({
      itemTypeId: itemTypes.id,
      itemTypeName: itemTypes.name,
      unit: itemTypes.unit,
      total: sql<string>`COALESCE(SUM(CAST(amount AS NUMERIC)), 0)`,
      entryCount: sql<number>`COUNT(*)::int`,
    })
    .from(entries)
    .innerJoin(itemTypes, eq(entries.itemTypeId, itemTypes.id))
    .where(baseWhere)
    .groupBy(itemTypes.id, itemTypes.name, itemTypes.unit)
    .orderBy(sql`SUM(CAST(amount AS NUMERIC)) DESC`);

  // ── 3. Daily trend (line chart) ────────────────────
  // Generate a series of dates and left-join entries onto them
  // to ensure every day appears even with zero activity.
  const dailyTrend = await db
    .select({
      date: entries.entryDate,
      total: sql<string>`COALESCE(SUM(CAST(amount AS NUMERIC)), 0)`,
      entryCount: sql<number>`COUNT(*)::int`,
    })
    .from(entries)
    .where(baseWhere)
    .groupBy(entries.entryDate)
    .orderBy(entries.entryDate);

  // Fill in missing days with zero values
  const filledTrend: { date: string; total: number; entryCount: number }[] = [];
  const trendMap = new Map(dailyTrend.map((d) => [d.date, d]));

  const cursor = new Date(dateFromStr + 'T00:00:00');
  const end = new Date(todayStr + 'T00:00:00');
  while (cursor <= end) {
    const dateStr = cursor.toISOString().split('T')[0];
    const existing = trendMap.get(dateStr);
    filledTrend.push({
      date: dateStr,
      total: existing ? Number(existing.total) : 0,
      entryCount: existing ? existing.entryCount : 0,
    });
    cursor.setDate(cursor.getDate() + 1);
  }

  // ── 4. Top item type per-member breakdown (stacked bar data) ──
  const memberItemBreakdown = await db
    .select({
      userId: users.id,
      username: users.username,
      itemTypeId: itemTypes.id,
      itemTypeName: itemTypes.name,
      unit: itemTypes.unit,
      total: sql<string>`COALESCE(SUM(CAST(amount AS NUMERIC)), 0)`,
    })
    .from(entries)
    .innerJoin(users, eq(entries.userId, users.id))
    .innerJoin(itemTypes, eq(entries.itemTypeId, itemTypes.id))
    .where(baseWhere)
    .groupBy(users.id, users.username, itemTypes.id, itemTypes.name, itemTypes.unit)
    .orderBy(sql`SUM(CAST(amount AS NUMERIC)) DESC`);

  success(res, {
    range: { days, from: dateFromStr, to: todayStr },
    memberContributions: memberContributions.map((m) => ({
      ...m,
      total: Number(m.total),
    })),
    itemDistribution: itemDistribution.map((i) => ({
      ...i,
      total: Number(i.total),
    })),
    dailyTrend: filledTrend,
    memberItemBreakdown: memberItemBreakdown.map((b) => ({
      ...b,
      total: Number(b.total),
    })),
  });
});

export default router;
