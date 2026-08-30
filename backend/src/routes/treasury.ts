import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { db } from '../db/index.js';
import { payouts, itemTypes, users } from '../db/schema.js';
import { eq, and, sql, gte, desc } from 'drizzle-orm';
import { success, error } from '../lib/response.js';
import { requireAuth } from '../middleware/auth.js';
import { requireFactionMember } from '../middleware/factionAccess.js';
import { computeTreasuryBalances } from '../lib/treasury.js';
import { toDateString } from '../lib/date.js';

const router = Router({ mergeParams: true });

// Readable by any faction member: the treasury view is aggregate only and
// exposes no individual payout records.
router.use(requireAuth, requireFactionMember);

const treasuryQuerySchema = z.object({
  trend_days: z.string().optional(),
});

// ── GET / — treasury balances and recent outflow ─────
router.get('/', async (req: Request, res: Response) => {
  const factionId = req.params.id as string;

  const query = treasuryQuerySchema.safeParse(req.query);
  if (!query.success) {
    error(res, 'VALIDATION_ERROR', query.error.issues[0]!.message);
    return;
  }

  const trendDays = Math.min(90, Math.max(1, Number(query.data.trend_days) || 30));
  const since = new Date();
  since.setDate(since.getDate() - trendDays);
  const sinceStr = toDateString(since);

  const isAdmin = req.factionRole === 'admin' || req.factionRole === 'superadmin';

  // Treasury balances are aggregate and safe for any member; recent payouts
  // reveal individual transfers, so they stay admin-only.
  const recentPayoutsPromise = isAdmin
    ? db
      .select({
        id: payouts.id,
        amount: payouts.amount,
        description: payouts.description,
        payoutDate: payouts.payoutDate,
        status: payouts.status,
        recipientUsername: users.username,
        recipientInGameName: users.inGameName,
        recipientAvatarUrl: users.avatarUrl,
        itemTypeName: itemTypes.name,
        itemUnit: itemTypes.unit,
        itemIsCurrency: itemTypes.isCurrency,
        itemImageUrl: itemTypes.imageUrl,
      })
      .from(payouts)
      .innerJoin(users, eq(payouts.recipientUserId, users.id))
      .innerJoin(itemTypes, eq(payouts.itemTypeId, itemTypes.id))
      .where(
        and(
          eq(payouts.factionId, factionId),
          eq(payouts.isDeleted, false),
          eq(payouts.status, 'completed'),
        ),
      )
      .orderBy(desc(payouts.createdAt))
      .limit(10)
    : Promise.resolve([]);

  const [balances, recentOutflow, pendingStats, recentPayouts] = await Promise.all([
    computeTreasuryBalances(factionId),
    // Completed outflow per day AND per item type over the trend window.
    // One query serves both the overall trend and the per-card sparklines.
    db
      .select({
        date: payouts.payoutDate,
        itemTypeId: payouts.itemTypeId,
        total: sql<string>`COALESCE(SUM(CAST(${payouts.amount} AS NUMERIC)), 0)`,
      })
      .from(payouts)
      .where(
        and(
          eq(payouts.factionId, factionId),
          eq(payouts.isDeleted, false),
          eq(payouts.status, 'completed'),
          gte(payouts.payoutDate, sinceStr),
        ),
      )
      .groupBy(payouts.payoutDate, payouts.itemTypeId)
      .orderBy(payouts.payoutDate),
    // How much is waiting in the approval queue.
    db
      .select({
        count: sql<number>`COUNT(*)::int`,
        total: sql<string>`COALESCE(SUM(CAST(${payouts.amount} AS NUMERIC)), 0)`,
      })
      .from(payouts)
      .where(
        and(
          eq(payouts.factionId, factionId),
          eq(payouts.isDeleted, false),
          sql`${payouts.status} IN ('pending', 'approved')`,
        ),
      ),
    recentPayoutsPromise,
  ]);

  // Cross-type totals only sum currency item types. Adding money to kilograms
  // and piece counts produces a number with no meaningful unit, so goods are
  // reported per item type in `balances` and left out of the roll-up.
  const currencyBalances = balances.filter((b) => b.isCurrency);
  const netBalance = currencyBalances.reduce((acc, b) => acc + b.balance, 0);
  const totalInflow = currencyBalances.reduce((acc, b) => acc + b.inflow, 0);
  const totalOutflow = currencyBalances.reduce((acc, b) => acc + b.outflow, 0);

  // Roll the per-item-type rows up into one overall series...
  const overallByDate = new Map<string, number>();
  // ...and index them per item type for the balance-card sparklines.
  const trendByItemType = new Map<string, { date: string; total: number }[]>();

  for (const row of recentOutflow) {
    const total = Number(row.total);
    overallByDate.set(row.date, (overallByDate.get(row.date) ?? 0) + total);
    const series = trendByItemType.get(row.itemTypeId) ?? [];
    series.push({ date: row.date, total });
    trendByItemType.set(row.itemTypeId, series);
  }

  success(res, {
    balances: balances.map((b) => ({
      ...b,
      outflowTrend: trendByItemType.get(b.itemTypeId) ?? [],
    })),
    netBalance,
    totalInflow,
    totalOutflow,
    // What the totals above cover, so the UI never implies they include goods.
    totals: {
      currencyTypeCount: currencyBalances.length,
      nonCurrencyTypeCount: balances.length - currencyBalances.length,
    },
    pending: {
      count: pendingStats[0]?.count ?? 0,
      total: Number(pendingStats[0]?.total ?? 0),
    },
    outflowTrend: [...overallByDate.entries()]
      .map(([date, total]) => ({ date, total }))
      .sort((a, b) => a.date.localeCompare(b.date)),
    trendDays,
    recentPayouts,
  });
});

export default router;
