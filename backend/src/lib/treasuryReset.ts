import { and, eq, isNotNull } from 'drizzle-orm';
import { type TransactionLike } from '../db/index.js';
import { crafts, entries, expenses, operations, payouts, sales, storageContents, treasuryChecks } from '../db/schema.js';

/** How many rows of each kind a reset removed. */
export interface TreasuryResetCounts {
  entries: number;
  payouts: number;
  expenses: number;
  treasuryChecks: number;
  crafts: number;
  sales: number;
  operations: number;
  /** Storage lines of the faction's own items, which stood for treasury stock. */
  storageLines: number;
}

/**
 * Empty a faction's treasury, and every record that ever moved it.
 *
 * A treasury balance is entries in, less payouts and expenses out. Crafting,
 * sales and operations write ordinary entries and payouts of their own, and
 * laundering is nothing but an entry and a payout, so deleting the money rows
 * alone would leave those screens listing jobs with nothing behind them. They
 * go too. Their child rows (movements, lines, participants, loot) follow by
 * cascade; shifts and entries that pointed at a deleted wage payout are freed
 * by their `set null` foreign keys, exactly as a deleted payout frees them.
 *
 * Storage counts of the faction's own items go as well: storage is held to
 * the treasury, and a chest claiming forty pistols from an empty treasury
 * would be the first thing to break. The rooms, the containers and lines of
 * typed-in things nobody counts in the treasury all stay.
 *
 * **What stays:** item types, crafting recipes, the price list, members,
 * ranks, settings, quotas (their progress is counted from entries, so it
 * starts again from zero), strikes, the map, vehicles, storage rooms, shifts,
 * mentoring, and the audit log — which is where the reset itself is recorded.
 *
 * **Hard delete, no backup**, by the operator's choice: this cannot be undone.
 * Called inside the caller's transaction so it is all or nothing.
 */
export async function resetTreasury(tx: TransactionLike, factionId: string): Promise<TreasuryResetCounts> {
  const count = async (rows: Promise<{ id: string }[]>) => (await rows).length;

  // The jobs first, while their movements still point at the money rows.
  const removedCrafts = await count(tx.delete(crafts).where(eq(crafts.factionId, factionId)).returning({ id: crafts.id }));
  const removedSales = await count(tx.delete(sales).where(eq(sales.factionId, factionId)).returning({ id: sales.id }));
  const removedOperations = await count(tx.delete(operations).where(eq(operations.factionId, factionId)).returning({ id: operations.id }));

  // Entries before payouts: an entry may point at the wage payout that paid it.
  const removedEntries = await count(tx.delete(entries).where(eq(entries.factionId, factionId)).returning({ id: entries.id }));
  const removedPayouts = await count(tx.delete(payouts).where(eq(payouts.factionId, factionId)).returning({ id: payouts.id }));
  const removedExpenses = await count(tx.delete(expenses).where(eq(expenses.factionId, factionId)).returning({ id: expenses.id }));
  const removedChecks = await count(tx.delete(treasuryChecks).where(eq(treasuryChecks.factionId, factionId)).returning({ id: treasuryChecks.id }));

  const removedStorage = await count(tx.delete(storageContents)
    .where(and(eq(storageContents.factionId, factionId), isNotNull(storageContents.itemTypeId)))
    .returning({ id: storageContents.id }));

  return {
    storageLines: removedStorage,
    entries: removedEntries,
    payouts: removedPayouts,
    expenses: removedExpenses,
    treasuryChecks: removedChecks,
    crafts: removedCrafts,
    sales: removedSales,
    operations: removedOperations,
  };
}
