import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { db } from '../db/index.js';
import { entries, users, itemTypes } from '../db/schema.js';
import { eq, and, sql, gte, lte } from 'drizzle-orm';
import { success, error } from '../lib/response.js';
import { requireAuth } from '../middleware/auth.js';
import { requireFactionMember } from '../middleware/factionAccess.js';
import { buildWhere } from '../lib/query.js';
import { todayDateString } from '../lib/date.js';
import { getPeriodRange } from '../lib/period.js';

const router = Router({ mergeParams: true });

// Leaderboards are a social feature: every member sees where they stand.
router.use(requireAuth, requireFactionMember);

const querySchema = z.object({
  period: z.enum(['week', 'month', 'all']).default('month'),
  item_type_id: z.string().uuid().optional(),
  limit: z.string().optional(),
});

/** Resolve a period keyword to an inclusive date range plus a display label. */
export function resolvePeriod(period: 'week' | 'month' | 'all'): {
  from: string | null;
  to: string | null;
  label: string;
} {
  if (period === 'all') return { from: null, to: null, label: 'All Time' };
  const today = new Date();
  const range = getPeriodRange(period === 'week' ? 'weekly' : 'monthly', today);
  return {
    from: range.start,
    // Never advertise a range that reaches into the future.
    to: range.end > todayDateString() ? todayDateString() : range.end,
    label: period === 'week' ? 'This Week' : 'This Month',
  };
}

// ── GET / — ranked members for a period ──────────────
router.get('/', async (req: Request, res: Response) => {
  const factionId = req.params.id as string;

  const query = querySchema.safeParse(req.query);
  if (!query.success) {
    error(res, 'VALIDATION_ERROR', query.error.issues[0]!.message);
    return;
  }

  const { period, item_type_id } = query.data;
  const limit = Math.min(100, Math.max(1, Number(query.data.limit) || 25));
  const range = resolvePeriod(period);

  const where = buildWhere([
    eq(entries.factionId, factionId),
    eq(entries.isDeleted, false),
    item_type_id ? eq(entries.itemTypeId, item_type_id) : undefined,
    range.from ? gte(entries.entryDate, range.from) : undefined,
    range.to ? lte(entries.entryDate, range.to) : undefined,
  ]);

  const [totals, breakdown] = await Promise.all([
    db
      .select({
        userId: users.id,
        username: users.username,
        inGameName: users.inGameName,
        avatarUrl: users.avatarUrl,
        total: sql<string>`COALESCE(SUM(CAST(${entries.amount} AS NUMERIC)), 0)`,
        entryCount: sql<number>`COUNT(*)::int`,
      })
      .from(entries)
      .innerJoin(users, eq(entries.userId, users.id))
      // Anonymous entries belong to the faction, not to a person, so they are
      // left out of anything that ranks people.
      .where(and(where, eq(users.isSystem, false)))
      .groupBy(users.id, users.username, users.inGameName, users.avatarUrl)
      .orderBy(sql`SUM(CAST(${entries.amount} AS NUMERIC)) DESC`)
      .limit(limit),
    // Per-item-type split for the same window, joined in memory below.
    db
      .select({
        userId: entries.userId,
        itemTypeName: itemTypes.name,
        total: sql<string>`COALESCE(SUM(CAST(${entries.amount} AS NUMERIC)), 0)`,
      })
      .from(entries)
      .innerJoin(itemTypes, eq(entries.itemTypeId, itemTypes.id))
      .where(where)
      .groupBy(entries.userId, itemTypes.name),
  ]);

  const breakdownByUser = new Map<string, Record<string, number>>();
  for (const row of breakdown) {
    const bucket = breakdownByUser.get(row.userId) ?? {};
    bucket[row.itemTypeName] = Number(row.total);
    breakdownByUser.set(row.userId, bucket);
  }

  // Equal totals share a rank ("standard competition" ranking), so two members
  // on the same amount are not ordered arbitrarily against each other.
  let lastTotal: number | null = null;
  let lastRank = 0;
  const rankings = totals.map((row, index) => {
    const total = Number(row.total);
    const rank = total === lastTotal ? lastRank : index + 1;
    lastTotal = total;
    lastRank = rank;
    return {
      rank,
      userId: row.userId,
      username: row.username,
      inGameName: row.inGameName,
      avatarUrl: row.avatarUrl,
      total,
      entryCount: row.entryCount,
      itemBreakdown: breakdownByUser.get(row.userId) ?? {},
      isMe: row.userId === req.user!.id,
    };
  });

  success(res, {
    period: { from: range.from, to: range.to, label: range.label },
    rankings,
    // Where the caller sits, even if they fell outside the returned slice.
    myRank: rankings.find((r) => r.isMe)?.rank ?? null,
  });
});

export default router;
