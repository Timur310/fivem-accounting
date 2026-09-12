import { db } from '../db/index.js';
import { entries, payouts, expenses, itemTypes } from '../db/schema.js';
import { eq, and, sql } from 'drizzle-orm';

/**
 * Treasury balance for a single item type.
 * `balance` is `inflow - outflow` and may legitimately be negative when a
 * faction has paid out more than it took in.
 */
export interface TreasuryBalance {
  itemTypeId: string;
  itemTypeName: string;
  unit: string;
  isCurrency: boolean;
  inflow: number;
  outflow: number;
  balance: number;
}

/**
 * Compute treasury balances per item type for a faction.
 *
 * The balance is always derived, never stored, so it cannot drift out of sync
 * with the underlying entries and payouts:
 *
 *   balance = SUM(entries WHERE NOT deleted)
 *           - SUM(payouts WHERE NOT deleted AND status = 'completed')
 *           - SUM(expenses WHERE NOT deleted)
 *
 * Only 'completed' payouts count: pending and approved ones are not out of the
 * vault yet, and rejected ones never will be. Expenses have no lifecycle —
 * money spent on rent is gone the moment the row exists.
 *
 * Item types with no activity on either side are included with zeroes by
 * default, so the caller sees the faction's full set of item types. That is
 * what the laundering screen needs — you wash *into* a currency the vault has
 * never held, and a type missing from the list is a type you cannot pick.
 *
 * `onlyWithActivity` drops them instead, for callers reporting on what the
 * vault has actually done rather than what it could hold.
 */
export async function computeTreasuryBalances(
  factionId: string,
  options: { onlyWithActivity?: boolean } = {},
): Promise<TreasuryBalance[]> {
  const [inflows, outflows, expenseSums, types] = await Promise.all([
    db
      .select({
        itemTypeId: entries.itemTypeId,
        total: sql<string>`COALESCE(SUM(CAST(${entries.amount} AS NUMERIC)), 0)`,
      })
      .from(entries)
      .where(and(eq(entries.factionId, factionId), eq(entries.isDeleted, false)))
      .groupBy(entries.itemTypeId),
    db
      .select({
        itemTypeId: payouts.itemTypeId,
        total: sql<string>`COALESCE(SUM(CAST(${payouts.amount} AS NUMERIC)), 0)`,
      })
      .from(payouts)
      .where(
        and(
          eq(payouts.factionId, factionId),
          eq(payouts.isDeleted, false),
          eq(payouts.status, 'completed'),
        ),
      )
      .groupBy(payouts.itemTypeId),
    db
      .select({
        itemTypeId: expenses.itemTypeId,
        total: sql<string>`COALESCE(SUM(CAST(${expenses.amount} AS NUMERIC)), 0)`,
      })
      .from(expenses)
      .where(and(eq(expenses.factionId, factionId), eq(expenses.isDeleted, false)))
      .groupBy(expenses.itemTypeId),
    db
      .select({ id: itemTypes.id, name: itemTypes.name, unit: itemTypes.unit, isCurrency: itemTypes.isCurrency, imageUrl: itemTypes.imageUrl, icon: itemTypes.icon, category: itemTypes.category })
      .from(itemTypes)
      .where(eq(itemTypes.factionId, factionId)),
  ]);

  const inflowMap = new Map(inflows.map((r) => [r.itemTypeId, Number(r.total)]));
  const outflowMap = new Map(outflows.map((r) => [r.itemTypeId, Number(r.total)]));
  for (const r of expenseSums) {
    // Expenses land in the same column as payouts: both are value that left
    // the vault, and the balance only cares about the net.
    outflowMap.set(r.itemTypeId, (outflowMap.get(r.itemTypeId) ?? 0) + Number(r.total));
  }

  // Presence in a map, not a non-zero sum: the question is whether any record
  // exists, and reading that off the GROUP BY answers it exactly. Amounts are
  // validated above zero today, so the two happen to agree — but a balance that
  // nets to zero is still activity, and should still be listed.
  const listed = options.onlyWithActivity
    ? types.filter((t) => inflowMap.has(t.id) || outflowMap.has(t.id))
    : types;

  return listed.map((t) => {
    const inflow = inflowMap.get(t.id) ?? 0;
    const outflow = outflowMap.get(t.id) ?? 0;
    return {
      itemTypeId: t.id,
      itemTypeName: t.name,
      unit: t.unit,
      isCurrency: t.isCurrency,
      imageUrl: t.imageUrl,
      icon: t.icon,
      category: t.category,
      inflow,
      outflow,
      balance: inflow - outflow,
    };
  });
}
