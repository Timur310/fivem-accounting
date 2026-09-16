import { Request, Response } from 'express';
import { asyncRouter } from '../lib/asyncRouter.js';
import { db } from '../db/index.js';
import { entries, itemTypes, users, quotas } from '../db/schema.js';
import { eq, and, sql, gte, lte, desc } from 'drizzle-orm';
import { requireAuth } from '../middleware/auth.js';
import { requireFactionMember } from '../middleware/factionAccess.js';
import { buildWhere } from '../lib/query.js';
import { todayDateString, formatDateValue, periodHasStarted } from '../lib/date.js';
import { getPeriodRange } from '../lib/period.js';

const router = asyncRouter({ mergeParams: true });

router.use(requireAuth, requireFactionMember);

// ── Helpers ──────────────────────────────────────────

function csvEscape(val: string | null | undefined): string {
  if (val === null || val === undefined) return '';
  const str = String(val);
  if (str.includes(',') || str.includes('"') || str.includes('\n')) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

function setCsvHeaders(res: Response, filename: string) {
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
}

// ── GET /entries — CSV export of faction entries ─────
router.get('/entries', async (req: Request, res: Response) => {
  const factionId = req.params.id as string;

  const dateFrom = req.query.date_from as string | undefined;
  const dateTo = req.query.date_to as string | undefined;
  const itemTypeId = req.query.item_type_id as string | undefined;
  // Optional personal export: a member pulls their own rows for their own bookkeeping.
  const userId = req.query.user_id as string | undefined;

  // Validate date formats if provided
  const dateRegex = /^\d{4}-\d{2}-\d{2}$/;
  if (dateFrom && !dateRegex.test(dateFrom)) {
    res.status(400).json({ error: { code: 'VALIDATION_ERROR', message: 'Invalid date_from format, use YYYY-MM-DD' } });
    return;
  }
  if (dateTo && !dateRegex.test(dateTo)) {
    res.status(400).json({ error: { code: 'VALIDATION_ERROR', message: 'Invalid date_to format, use YYYY-MM-DD' } });
    return;
  }

  const where = buildWhere([
    eq(entries.factionId, factionId),
    eq(entries.isDeleted, false),
    itemTypeId ? eq(entries.itemTypeId, itemTypeId) : undefined,
    userId ? eq(entries.userId, userId) : undefined,
    dateFrom ? gte(entries.entryDate, dateFrom) : undefined,
    dateTo ? lte(entries.entryDate, dateTo) : undefined,
  ]);

  const rows = await db
    .select({
      username: users.username,
      inGameName: users.inGameName,
      itemTypeName: itemTypes.name,
      itemUnit: itemTypes.unit,
      amount: entries.amount,
      description: entries.description,
      entryDate: entries.entryDate,
      createdAt: entries.createdAt,
    })
    .from(entries)
    .innerJoin(users, eq(entries.userId, users.id))
    .innerJoin(itemTypes, eq(entries.itemTypeId, itemTypes.id))
    .where(where)
    .orderBy(desc(entries.entryDate));

  setCsvHeaders(res, `entries-${factionId.slice(0, 8)}-${todayDateString()}.csv`);

  // Header — the In-Game Name column is appended at the END so the column
  // indices of every existing column stay stable for any downstream parser.
  res.write('Member,Item Type,Amount,Description,Entry Date,Created At,In-Game Name\n');

  // Write rows
  for (const row of rows) {
    res.write(
      `${csvEscape(row.username)},${csvEscape(row.itemTypeName)},${csvEscape(row.itemUnit + Number(row.amount).toFixed(2))},${csvEscape(row.description)},${csvEscape(row.entryDate)},${csvEscape(formatDateValue(row.createdAt))},${csvEscape(row.inGameName)}\n`,
    );
  }

  res.end();
});

// ── GET /quota-report — CSV export of quota progress ─
router.get('/quota-report', async (req: Request, res: Response) => {
  const factionId = req.params.id as string;

  // Fetch active quotas with item type info
  const allQuotas = await db
    .select({
      id: quotas.id,
      itemTypeName: itemTypes.name,
      itemUnit: itemTypes.unit,
      targetAmount: quotas.targetAmount,
      periodType: quotas.periodType,
      periodStart: quotas.periodStart,
      isActive: quotas.isActive,
      itemTypeId: quotas.itemTypeId,
    })
    .from(quotas)
    .innerJoin(itemTypes, eq(quotas.itemTypeId, itemTypes.id))
    .where(eq(quotas.factionId, factionId))
    .orderBy(desc(quotas.createdAt));

  // Compute progress for each quota
  const reportRows: {
    itemTypeName: string;
    itemUnit: string;
    targetAmount: string;
    periodType: string;
    periodStart: string;
    isActive: boolean;
    currentAmount: number;
    percentage: number;
    periodRangeStart: string;
    periodRangeEnd: string;
  }[] = [];

  for (const q of allQuotas) {
    const today = new Date();

    if (!q.isActive || !periodHasStarted(q.periodStart, today)) {
      reportRows.push({
        itemTypeName: q.itemTypeName,
        itemUnit: q.itemUnit,
        targetAmount: q.targetAmount,
        periodType: q.periodType,
        periodStart: q.periodStart,
        isActive: q.isActive,
        currentAmount: 0,
        percentage: 0,
        periodRangeStart: '',
        periodRangeEnd: '',
      });
      continue;
    }

    const range = getPeriodRange(q.periodType, today);

    const [result] = await db
      .select({
        total: sql<string>`COALESCE(SUM(CAST(amount AS NUMERIC)), 0)`,
      })
      .from(entries)
      .where(
        and(
          eq(entries.factionId, factionId),
          eq(entries.itemTypeId, q.itemTypeId),
          gte(entries.entryDate, range.start),
          lte(entries.entryDate, range.end),
          eq(entries.isDeleted, false),
        ),
      );

    const currentAmount = Number(result?.total ?? 0);
    const targetAmount = Number(q.targetAmount);
    const percentage = targetAmount > 0 ? Math.min((currentAmount / targetAmount) * 100, 100) : 0;

    reportRows.push({
      itemTypeName: q.itemTypeName,
      itemUnit: q.itemUnit,
      targetAmount: q.targetAmount,
      periodType: q.periodType,
      periodStart: q.periodStart,
      isActive: q.isActive,
      currentAmount,
      percentage: Math.round(percentage * 100) / 100,
      periodRangeStart: range.start,
      periodRangeEnd: range.end,
    });
  }

  setCsvHeaders(res, `quota-report-${factionId.slice(0, 8)}-${todayDateString()}.csv`);

  res.write('Item Type,Target,Current,Percentage,Period Type,Period Start,Current Period Start,Current Period End,Status\n');

  for (const row of reportRows) {
    const status = !row.isActive ? 'Inactive' : row.percentage >= 100 ? 'Met' : 'In Progress';
    res.write(
      `${csvEscape(row.itemTypeName)},${csvEscape(row.itemUnit + Number(row.targetAmount).toFixed(2))},${csvEscape(row.itemUnit + row.currentAmount.toFixed(2))},${row.percentage.toFixed(1)}%,${row.periodType},${csvEscape(formatDateValue(row.periodStart))},${csvEscape(row.periodRangeStart)},${csvEscape(row.periodRangeEnd)},${status}\n`,
    );
  }

  res.end();
});

// ── Period helpers ────────────────────────────────────

export default router;
