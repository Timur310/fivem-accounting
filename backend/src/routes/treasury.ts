import { Request, Response } from 'express';
import { asyncRouter } from '../lib/asyncRouter.js';
import { z } from 'zod';
import { db } from '../db/index.js';
import { payouts, expenses, itemTypes, users, entries, treasuryChecks } from '../db/schema.js';
import { eq, and, sql, gte, lte, desc } from 'drizzle-orm';
import { success, error } from '../lib/response.js';
import { requireAuth } from '../middleware/auth.js';
import { requireFactionMember } from '../middleware/factionAccess.js';
import { computeTreasuryBalances } from '../lib/treasury.js';
import { requirePermission } from '../middleware/factionAccess.js';
import { createAuditLog } from '../lib/audit.js';
import { toDateString } from '../lib/date.js';

const router = asyncRouter({ mergeParams: true });

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
      itemIcon: itemTypes.icon,
      itemCategory: itemTypes.category,
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

  const [balances, payoutOutflow, expenseOutflow, pendingStats, recentPayouts] = await Promise.all([
    // Only item types the vault has actually moved. A faction that defined a
    // dozen types and used two should see two cards, not ten rows of zeroes —
    // and the totals note below counts the same set, so it cannot claim to
    // cover types that are not on screen.
    computeTreasuryBalances(factionId, { onlyWithActivity: true }),
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
    // Expenses leave the vault just as completed payouts do, so they ride the
    // same trend — a balance that dropped because of rent should not read as
    // an unexplained gap between the chart and the number.
    db
      .select({
        date: expenses.expenseDate,
        itemTypeId: expenses.itemTypeId,
        total: sql<string>`COALESCE(SUM(CAST(${expenses.amount} AS NUMERIC)), 0)`,
      })
      .from(expenses)
      .where(
        and(
          eq(expenses.factionId, factionId),
          eq(expenses.isDeleted, false),
          gte(expenses.expenseDate, sinceStr),
        ),
      )
      .groupBy(expenses.expenseDate, expenses.itemTypeId),
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

  for (const row of [...payoutOutflow, ...expenseOutflow]) {
    const total = Number(row.total);
    overallByDate.set(row.date, (overallByDate.get(row.date) ?? 0) + total);
    const series = trendByItemType.get(row.itemTypeId) ?? [];
    series.push({ date: row.date, total });
    trendByItemType.set(row.itemTypeId, series);
  }

  // The trend series are merged per date, but a date only exists if some
  // payout or expense landed on it — sort so the merged series stays ordered.
  for (const series of trendByItemType.values()) {
    series.sort((a, b) => a.date.localeCompare(b.date));
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

// ── Recorded balance at a date ───────────────────────
// The same derivation the live balance uses, cut off at a date: every movement
// on or before the day the vault was counted.
async function recordedBalanceAt(factionId: string, itemTypeId: string, dateStr: string): Promise<number> {
  const [entrySum, payoutSum, expenseSum] = await Promise.all([
    db
      .select({ total: sql<string>`COALESCE(SUM(CAST(${entries.amount} AS NUMERIC)), 0)` })
      .from(entries)
      .where(and(eq(entries.factionId, factionId), eq(entries.itemTypeId, itemTypeId), eq(entries.isDeleted, false), lte(entries.entryDate, dateStr))),
    db
      .select({ total: sql<string>`COALESCE(SUM(CAST(${payouts.amount} AS NUMERIC)), 0)` })
      .from(payouts)
      .where(and(eq(payouts.factionId, factionId), eq(payouts.itemTypeId, itemTypeId), eq(payouts.isDeleted, false), eq(payouts.status, 'completed'), lte(payouts.payoutDate, dateStr))),
    db
      .select({ total: sql<string>`COALESCE(SUM(CAST(${expenses.amount} AS NUMERIC)), 0)` })
      .from(expenses)
      .where(and(eq(expenses.factionId, factionId), eq(expenses.itemTypeId, itemTypeId), eq(expenses.isDeleted, false), lte(expenses.expenseDate, dateStr))),
  ]);
  return Number(entrySum[0]?.total ?? 0) - Number(payoutSum[0]?.total ?? 0) - Number(expenseSum[0]?.total ?? 0);
}

// ── GET /checks — recent vault counts (manage_payouts) ────────
// Same gate as POST below: whoever may record a count has to be able to read
// the counts back, otherwise the permission grants a write into a list its
// holder cannot see. Admins and superadmins pass implicitly.
router.get('/checks', requirePermission('manage_payouts'), async (req: Request, res: Response) => {
  const factionId = req.params.id as string;

  const rows = await db
    .select({
      id: treasuryChecks.id,
      countedAmount: treasuryChecks.countedAmount,
      checkDate: treasuryChecks.checkDate,
      note: treasuryChecks.note,
      createdAt: treasuryChecks.createdAt,
      createdBy: treasuryChecks.createdBy,
      creatorUsername: users.username,
      creatorInGameName: users.inGameName,
      itemTypeId: treasuryChecks.itemTypeId,
      itemTypeName: itemTypes.name,
      itemUnit: itemTypes.unit,
      itemIsCurrency: itemTypes.isCurrency,
    })
    .from(treasuryChecks)
    .innerJoin(users, eq(treasuryChecks.createdBy, users.id))
    .innerJoin(itemTypes, eq(treasuryChecks.itemTypeId, itemTypes.id))
    .where(eq(treasuryChecks.factionId, factionId))
    .orderBy(desc(treasuryChecks.checkDate), desc(treasuryChecks.createdAt))
    .limit(20);

  // The recorded balance for each check's day, derived fresh: the number a
  // dispute argues about must come from the same source as the live balance.
  const checks = await Promise.all(rows.map(async (r) => {
    const recordedBalance = await recordedBalanceAt(factionId, r.itemTypeId, r.checkDate);
    return { ...r, recordedBalance, variance: Number(r.countedAmount) - recordedBalance };
  }));

  success(res, { checks });
});

// ── POST /checks — record a vault count (manage_payouts) ──
const createCheckSchema = z.object({
  itemTypeId: z.string().uuid(),
  countedAmount: z.string().refine(
    (v) => !isNaN(Number(v)) && Number(v) >= 0,
    'Counted amount must be zero or more',
  ),
  checkDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Must be YYYY-MM-DD format').optional(),
  note: z.string().max(500).optional(),
});

router.post('/checks', requirePermission('manage_payouts'), async (req: Request, res: Response) => {
  const factionId = req.params.id as string;
  const parsed = createCheckSchema.safeParse(req.body);
  if (!parsed.success) {
    error(res, 'VALIDATION_ERROR', parsed.error.issues[0]!.message);
    return;
  }

  const { itemTypeId, countedAmount, checkDate, note } = parsed.data;

  const [itemType] = await db
    .select()
    .from(itemTypes)
    .where(and(eq(itemTypes.id, itemTypeId), eq(itemTypes.factionId, factionId)))
    .limit(1);
  if (!itemType) {
    error(res, 'NOT_FOUND', 'Item type not found in this faction', 404);
    return;
  }

  const date = checkDate ?? toDateString(new Date());
  if (date > toDateString(new Date())) {
    error(res, 'VALIDATION_ERROR', 'Check date cannot be in the future');
    return;
  }

  const [created] = await db
    .insert(treasuryChecks)
    .values({
      factionId,
      createdBy: req.user!.id,
      itemTypeId,
      countedAmount,
      checkDate: date,
      note: note ?? null,
    })
    .returning();

  if (!created) {
    error(res, 'INTERNAL_ERROR', 'Failed to record check', 500);
    return;
  }

  await createAuditLog({
    userId: req.user!.id,
    factionId,
    action: 'create',
    entityType: 'treasury_check',
    entityId: created.id,
    details: { itemTypeId, countedAmount: Number(countedAmount), checkDate: date, recordedBalance: await recordedBalanceAt(factionId, itemTypeId, date) },
    req,
  });

  success(res, created, 201);
});

export default router;
