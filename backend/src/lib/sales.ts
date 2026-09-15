import { and, eq, inArray, isNull, or } from 'drizzle-orm';
import { db, type TransactionLike } from '../db/index.js';
import { saleMovements, sales } from '../db/schema.js';

/**
 * The reading side of booked sales, and the guard that keeps one intact.
 *
 * The writing side — the transaction that moves the treasury — lives in
 * `routes/pricing.ts` next to the request that triggers it, the same way
 * crafting is arranged.
 */

/** How a sale is named in a message: who it was to, and when. */
export function saleLabel(row: { counterpartyName: string | null; saleDate: string }): string {
  return row.counterpartyName
    ? `the sale to ${row.counterpartyName} on ${row.saleDate}`
    : `the walk-in sale on ${row.saleDate}`;
}

/**
 * Is one of these ledger rows part of a sale that still stands?
 *
 * A sale is one act: the payment in and every item out. Editing the payment on
 * its own leaves the books describing a trade that never happened — money
 * received for goods that were never handed over, or the reverse. So the rows
 * a sale created refuse to be touched individually, and the way to undo one is
 * to revert the sale, which moves both sides back together.
 *
 * Reverted sales do not hold anything: their rows are already soft-deleted,
 * and a deleted row nobody can edit needs no protecting.
 */
export async function saleHolding(
  rows: { entryIds?: string[]; payoutIds?: string[] },
  handle: TransactionLike | typeof db = db,
): Promise<string | null> {
  const entryIds = rows.entryIds?.filter(Boolean) ?? [];
  const payoutIds = rows.payoutIds?.filter(Boolean) ?? [];
  if (entryIds.length === 0 && payoutIds.length === 0) return null;

  const matches = [
    ...(entryIds.length ? [inArray(saleMovements.entryId, entryIds)] : []),
    ...(payoutIds.length ? [inArray(saleMovements.payoutId, payoutIds)] : []),
  ];

  const [held] = await handle
    .select({ counterpartyName: sales.counterpartyName, saleDate: sales.saleDate })
    .from(saleMovements)
    .innerJoin(sales, eq(saleMovements.saleId, sales.id))
    .where(and(isNull(sales.revertedAt), matches.length === 1 ? matches[0] : or(...matches)))
    .limit(1);

  return held ? saleLabel(held) : null;
}

export function saleHoldingMessage(label: string): string {
  return `This is part of ${label}. Revert that sale instead — it takes the payment back out and returns the goods together.`;
}
