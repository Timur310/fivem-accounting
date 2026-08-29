import { db } from '../db/index.js';
import { entries, payouts, itemTypes } from '../db/schema.js';
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
 *
 * Only 'completed' payouts count: pending and approved ones are not out of the
 * vault yet, and rejected ones never will be.
 *
 * Item types with no activity on either side are included with zeroes, so the
 * caller always sees the faction's full set of active item types.
 */
export async function computeTreasuryBalances(factionId: string): Promise<TreasuryBalance[]> {
  const [inflows, outflows, types] = await Promise.all([
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
      .select({ id: itemTypes.id, name: itemTypes.name, unit: itemTypes.unit })
      .from(itemTypes)
      .where(eq(itemTypes.factionId, factionId)),
  ]);

  const inflowMap = new Map(inflows.map((r) => [r.itemTypeId, Number(r.total)]));
  const outflowMap = new Map(outflows.map((r) => [r.itemTypeId, Number(r.total)]));

  return types.map((t) => {
    const inflow = inflowMap.get(t.id) ?? 0;
    const outflow = outflowMap.get(t.id) ?? 0;
    return {
      itemTypeId: t.id,
      itemTypeName: t.name,
      unit: t.unit,
      inflow,
      outflow,
      balance: inflow - outflow,
    };
  });
}
