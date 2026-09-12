import { db } from '../db/index.js';
import { entries, quotas, factionMembers, itemTypes } from '../db/schema.js';
import { eq, and, sql, gte, lte } from 'drizzle-orm';
import { toDateString, periodHasStarted } from './date.js';
import { getPeriodRange } from './period.js';

// ── Streaks ────────────────────────────────────────────

export interface StreakInfo {
  current: number;
  best: number;
  lastEntryDate: string | null;
  /** True while today itself still counts toward the current streak. */
  activeToday: boolean;
}

/**
 * Consecutive days on which a member logged at least one entry.
 *
 * The current streak survives until a day is *missed*, so logging yesterday
 * but not yet today keeps it alive — otherwise every streak would appear
 * broken every morning until the member got round to logging.
 */
export async function computeStreak(factionId: string, userId: string): Promise<StreakInfo> {
  const rows = await db
    .selectDistinct({ date: entries.entryDate })
    .from(entries)
    .where(
      and(
        eq(entries.factionId, factionId),
        eq(entries.userId, userId),
        eq(entries.isDeleted, false),
      ),
    )
    .orderBy(entries.entryDate);

  const dates = rows.map((r) => r.date);
  if (dates.length === 0) {
    return { current: 0, best: 0, lastEntryDate: null, activeToday: false };
  }

  const DAY = 86_400_000;
  const asTime = (d: string) => new Date(`${d}T00:00:00Z`).getTime();

  // Longest run of consecutive days anywhere in the history.
  let best = 1;
  let run = 1;
  for (let i = 1; i < dates.length; i++) {
    run = asTime(dates[i]!) - asTime(dates[i - 1]!) === DAY ? run + 1 : 1;
    if (run > best) best = run;
  }

  const today = asTime(toDateString(new Date()));
  const last = asTime(dates[dates.length - 1]!);
  const gapFromToday = Math.round((today - last) / DAY);

  // A gap of 0 (logged today) or 1 (logged yesterday) keeps the streak alive.
  let current = 0;
  if (gapFromToday <= 1) {
    current = 1;
    for (let i = dates.length - 1; i > 0; i--) {
      if (asTime(dates[i]!) - asTime(dates[i - 1]!) === DAY) current++;
      else break;
    }
  }

  return {
    current,
    best,
    lastEntryDate: dates[dates.length - 1] ?? null,
    activeToday: gapFromToday === 0,
  };
}

// ── Heatmap ────────────────────────────────────────────

export interface HeatmapDay {
  date: string;
  count: number;
  /** Split by kind: money and goods share no unit, so no combined total. */
  currencyTotal: number;
  itemTotal: number;
}

export interface HeatmapResult {
  year: number;
  data: HeatmapDay[];
  maxCount: number;
  maxCurrencyTotal: number;
}

/**
 * Per-day activity for one calendar year, gap-filled so the frontend can render
 * a fixed grid without reasoning about missing days.
 *
 * Gaps are filled in JS rather than with a SQL `generate_series`: a year is 365
 * rows either way, and this keeps the query trivial.
 */
export async function computeHeatmap(
  factionId: string,
  userId: string,
  year: number,
): Promise<HeatmapResult> {
  const from = `${year}-01-01`;
  const to = `${year}-12-31`;

  const rows = await db
    .select({
      date: entries.entryDate,
      count: sql<number>`COUNT(*)::int`,
      currencyTotal: sql<string>`COALESCE(SUM(CAST(${entries.amount} AS NUMERIC)) FILTER (WHERE ${itemTypes.isCurrency}), 0)`,
      itemTotal: sql<string>`COALESCE(SUM(CAST(${entries.amount} AS NUMERIC)) FILTER (WHERE NOT ${itemTypes.isCurrency}), 0)`,
    })
    .from(entries)
    .innerJoin(itemTypes, eq(entries.itemTypeId, itemTypes.id))
    .where(
      and(
        eq(entries.factionId, factionId),
        eq(entries.userId, userId),
        eq(entries.isDeleted, false),
        gte(entries.entryDate, from),
        lte(entries.entryDate, to),
      ),
    )
    .groupBy(entries.entryDate);

  const byDate = new Map(
    rows.map((r) => [
      r.date,
      { count: r.count, currencyTotal: Number(r.currencyTotal), itemTotal: Number(r.itemTotal) },
    ]),
  );

  const data: HeatmapDay[] = [];
  const cursor = new Date(Date.UTC(year, 0, 1));
  const end = new Date(Date.UTC(year, 11, 31));
  while (cursor <= end) {
    const date = cursor.toISOString().slice(0, 10);
    const hit = byDate.get(date);
    data.push({
      date,
      count: hit?.count ?? 0,
      currencyTotal: hit?.currencyTotal ?? 0,
      itemTotal: hit?.itemTotal ?? 0,
    });
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }

  return {
    year,
    data,
    maxCount: data.reduce((m, d) => Math.max(m, d.count), 0),
    maxCurrencyTotal: data.reduce((m, d) => Math.max(m, d.currencyTotal), 0),
  };
}

// ── Performance score ──────────────────────────────────

export interface PerformanceScore {
  score: number;
  breakdown: {
    quotaHitRate: number;
    consistency: number;
    totalVolume: number;
    streakBonus: number;
    seniorityBonus: number;
  };
}

/** Window used for the consistency sub-score. */
const CONSISTENCY_WINDOW_DAYS = 30;
/** Seniority is capped at a year — beyond that it stops differentiating. */
const SENIORITY_CAP_MONTHS = 12;

const WEIGHTS = {
  quotaHitRate: 30,
  consistency: 25,
  totalVolume: 20,
  streakBonus: 15,
  seniorityBonus: 10,
} as const;

/**
 * Composite 0-100 score for one member, computed on demand and never stored.
 *
 * Each component is normalised to 0-1 before weighting. `totalVolume` is
 * rank-scaled against the faction's top contributor rather than an absolute
 * figure, so the score means the same thing in a small faction and a rich one.
 */
export async function computePerformanceScore(
  factionId: string,
  userId: string,
  streak?: StreakInfo,
): Promise<PerformanceScore> {
  const streakInfo = streak ?? (await computeStreak(factionId, userId));

  const since = new Date();
  since.setDate(since.getDate() - CONSISTENCY_WINDOW_DAYS);
  const sinceStr = toDateString(since);

  const [activeQuotas, activeDays, memberTotal, factionTop, membership] = await Promise.all([
    db
      .select({
        itemTypeId: quotas.itemTypeId,
        periodType: quotas.periodType,
        periodStart: quotas.periodStart,
      })
      .from(quotas)
      .where(and(eq(quotas.factionId, factionId), eq(quotas.isActive, true))),
    db
      .select({ days: sql<number>`COUNT(DISTINCT ${entries.entryDate})::int` })
      .from(entries)
      .where(
        and(
          eq(entries.factionId, factionId),
          eq(entries.userId, userId),
          eq(entries.isDeleted, false),
          gte(entries.entryDate, sinceStr),
        ),
      ),
    db
      .select({ total: sql<string>`COALESCE(SUM(CAST(${entries.amount} AS NUMERIC)), 0)` })
      .from(entries)
      .where(
        and(
          eq(entries.factionId, factionId),
          eq(entries.userId, userId),
          eq(entries.isDeleted, false),
        ),
      ),
    db
      .select({ total: sql<string>`COALESCE(SUM(CAST(${entries.amount} AS NUMERIC)), 0)` })
      .from(entries)
      .where(and(eq(entries.factionId, factionId), eq(entries.isDeleted, false)))
      .groupBy(entries.userId)
      .orderBy(sql`SUM(CAST(${entries.amount} AS NUMERIC)) DESC`)
      .limit(1),
    db
      .select({ joinedAt: factionMembers.joinedAt })
      .from(factionMembers)
      .where(
        and(eq(factionMembers.factionId, factionId), eq(factionMembers.userId, userId)),
      )
      .limit(1),
  ]);

  // Quota hit rate: of the quotas running right now, how many has this member
  // contributed to in the current period. No active quotas means the component
  // cannot be measured, so it is treated as neutral (1) rather than punishing.
  const today = new Date();
  const started = activeQuotas.filter((q) => periodHasStarted(q.periodStart, today));
  let quotaHitRate = 1;
  if (started.length > 0) {
    const hits = await Promise.all(
      started.map(async (q) => {
        const range = getPeriodRange(q.periodType, today);
        const [row] = await db
          .select({ count: sql<number>`COUNT(*)::int` })
          .from(entries)
          .where(
            and(
              eq(entries.factionId, factionId),
              eq(entries.userId, userId),
              eq(entries.itemTypeId, q.itemTypeId),
              eq(entries.isDeleted, false),
              gte(entries.entryDate, range.start),
              lte(entries.entryDate, range.end),
            ),
          );
        return (row?.count ?? 0) > 0 ? 1 : 0;
      }),
    );
    quotaHitRate = hits.reduce<number>((a, b) => a + b, 0) / started.length;
  }

  const consistency = Math.min(1, (activeDays[0]?.days ?? 0) / CONSISTENCY_WINDOW_DAYS);

  const mine = Number(memberTotal[0]?.total ?? 0);
  const top = Number(factionTop[0]?.total ?? 0);
  const totalVolume = top > 0 ? Math.min(1, mine / top) : 0;

  const streakBonus = streakInfo.best > 0 ? Math.min(1, streakInfo.current / streakInfo.best) : 0;

  const joinedAt = membership[0]?.joinedAt;
  const months = joinedAt
    ? (Date.now() - new Date(joinedAt).getTime()) / (30 * 86_400_000)
    : 0;
  const seniorityBonus = Math.min(1, months / SENIORITY_CAP_MONTHS);

  const round2 = (n: number) => Math.round(n * 100) / 100;
  const score =
    quotaHitRate * WEIGHTS.quotaHitRate +
    consistency * WEIGHTS.consistency +
    totalVolume * WEIGHTS.totalVolume +
    streakBonus * WEIGHTS.streakBonus +
    seniorityBonus * WEIGHTS.seniorityBonus;

  return {
    score: round2(score),
    breakdown: {
      quotaHitRate: round2(quotaHitRate),
      consistency: round2(consistency),
      totalVolume: round2(totalVolume),
      streakBonus: round2(streakBonus),
      seniorityBonus: round2(seniorityBonus),
    },
  };
}
