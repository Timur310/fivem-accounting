import { and, inArray, isNotNull } from 'drizzle-orm';
import { db, type TransactionLike } from '../db/index.js';
import { entries } from '../db/schema.js';
import { fromCents, toCents } from './treasury.js';

/**
 * Wages from takings: a member keeps a percentage of what they brought in.
 *
 * "Whatever dirty money you bring in this week, you keep 30% of it and the
 * rest goes to the faction." The percentage is set per rank and per item, with
 * a row without a rank covering everyone else, and whoever pays may change
 * any single line before paying it.
 *
 * Pure arithmetic here; the route reads the entries and writes the payouts.
 */

/** A rate as the calculator reads it. */
export interface CommissionRate {
  rank: string | null;
  itemTypeId: string;
  /** "30" or "12.5": a percentage, 0 to 100. */
  percent: string;
}

/** One unpaid entry, as the calculator reads it. */
export interface TakingsEntry {
  id: string;
  userId: string;
  itemTypeId: string;
  amount: string;
}

/** What one member brought in of one item, and their cut of it. */
export interface CommissionLine {
  userId: string;
  itemTypeId: string;
  /** Everything they brought in, exact. */
  brought: string;
  /** The rate that applies, or null when none does. */
  ratePercent: string | null;
  entryIds: string[];
}

const normalise = (rank: string | null | undefined) => (rank ?? '').trim().toLowerCase();

/**
 * The percentage a member of this rank keeps of this item.
 *
 * Their own rank's rate for the item first, then the item's rate for everyone
 * else, then nothing — a member nobody set a rate for keeps none of it, and
 * the screen shows 0% rather than a number somebody would have to trust.
 */
export function percentFor(
  rank: string | null | undefined,
  itemTypeId: string,
  rates: CommissionRate[],
): string | null {
  const forItem = rates.filter((r) => r.itemTypeId === itemTypeId);
  const wanted = normalise(rank);
  if (wanted) {
    const own = forItem.find((r) => r.rank !== null && normalise(r.rank) === wanted);
    if (own) return own.percent;
  }
  return forItem.find((r) => r.rank === null || normalise(r.rank) === '')?.percent ?? null;
}

/** A percentage in hundredths of a percent: "12.5" is 1250. */
export function basisPoints(percent: string): bigint {
  const [whole = '0', fraction = ''] = percent.trim().split('.');
  return BigInt(whole) * 100n + BigInt((fraction + '00').slice(0, 2));
}

/**
 * A member's share of an amount, in cents.
 *
 * Money rounds to the nearest cent, half a cent up. Goods that are counted
 * rather than spent round **down** to a whole one — nobody is paid half a
 * pistol — and the faction keeps the remainder. Integer arithmetic, like the
 * rest of the ledger.
 */
export function shareOf(brought: string, percent: string, isCurrency: boolean): bigint {
  const cents = toCents(brought);
  const bp = basisPoints(percent);
  if (!isCurrency) return ((cents * bp) / 1_000_000n) * 100n;
  return (cents * bp * 2n + 10_000n) / 20_000n;
}

/**
 * Add up what each member brought in, per item.
 *
 * `rankOf` is each current member's rank. Entries of anybody not in it — the
 * anonymous placeholder, somebody who has left — are left out: there is
 * nobody here to pay.
 */
export function computeTakings(
  rows: TakingsEntry[],
  rankOf: Map<string, string | null>,
  rates: CommissionRate[],
): CommissionLine[] {
  const lines = new Map<string, { userId: string; itemTypeId: string; cents: bigint; entryIds: string[] }>();
  for (const row of rows) {
    if (!rankOf.has(row.userId)) continue;
    const key = `${row.userId}:${row.itemTypeId}`;
    const line = lines.get(key) ?? { userId: row.userId, itemTypeId: row.itemTypeId, cents: 0n, entryIds: [] };
    line.cents += toCents(row.amount);
    line.entryIds.push(row.id);
    lines.set(key, line);
  }
  return [...lines.values()].map((l) => ({
    userId: l.userId,
    itemTypeId: l.itemTypeId,
    brought: fromCents(l.cents),
    ratePercent: percentFor(rankOf.get(l.userId), l.itemTypeId, rates),
    entryIds: l.entryIds,
  }));
}

/**
 * Is one of these entries already paid for as wages?
 *
 * A paid entry is what a payout was worked out from. Changing its amount, or
 * deleting it, would leave a payout nobody can account for — so, like an
 * operation's shares, it refuses until the payout is rejected or deleted,
 * which frees it again.
 */
export async function commissionHolding(
  rows: { entryIds?: string[] },
  handle: TransactionLike | typeof db = db,
): Promise<boolean> {
  const entryIds = rows.entryIds?.filter(Boolean) ?? [];
  if (entryIds.length === 0) return false;
  const [held] = await handle
    .select({ id: entries.id })
    .from(entries)
    .where(and(inArray(entries.id, entryIds), isNotNull(entries.commissionPayoutId)))
    .limit(1);
  return !!held;
}

export const COMMISSION_HOLDING_MESSAGE =
  'A share of this entry has already been paid out as wages. Reject or delete that wage payout first, and the entry can be changed again.';

/** An exchange value in ten-thousandths: "0.7" is 7000. */
export function rateUnits(rate: string): bigint {
  const [whole = '0', fraction = ''] = rate.trim().split('.');
  return BigInt(whole) * 10_000n + BigInt((fraction + '0000').slice(0, 4));
}

/**
 * A share, in cents of the brought item, as cents of the item it is paid in.
 *
 * "30% of the dirty money, paid in cash at 0.7 each." The share is worked out
 * in the brought item first — that is what the faction gives up — and then
 * converted, rounded the way the paying item rounds: money to the cent (half
 * up), counted goods down to a whole one.
 */
export function convertShare(shareCents: bigint, rate: string, payIsCurrency: boolean): bigint {
  const r = rateUnits(rate);
  if (!payIsCurrency) return ((shareCents * r) / 1_000_000n) * 100n;
  return (shareCents * r * 2n + 10_000n) / 20_000n;
}
