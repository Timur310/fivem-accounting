import { db, type TransactionLike } from '../db/index.js';
import { entries, payouts, expenses, itemTypes } from '../db/schema.js';
import { eq, and, inArray, sql } from 'drizzle-orm';

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

// ── What can actually be spent ─────────────────────────

/**
 * A decimal string as an exact integer number of hundredths.
 *
 * Exported because anything comparing two treasury figures needs the same
 * arithmetic. `Number('9007199254740993')` already lies, and FiveM money runs
 * long enough to reach that.
 */
export function toCents(v: string): bigint {
  const [whole = '0', fraction = ''] = v.split('.');
  const negative = whole.startsWith('-');
  const digits = (negative ? whole.slice(1) : whole) || '0';
  const cents = BigInt(digits + `${fraction}00`.slice(0, 2));
  return negative ? -cents : cents;
}

/** And back again, in the `0.00` shape the columns use. */
export function fromCents(cents: bigint): string {
  const negative = cents < 0n;
  const str = (negative ? -cents : cents).toString().padStart(3, '0');
  return `${negative ? '-' : ''}${str.slice(0, -2)}.${str.slice(-2)}`;
}

/**
 * What the vault holds of each of these item types, right now.
 *
 * The one query anything guarding a spend should use, and the reason it lives
 * here rather than next to its first caller: the laundering desk hand-rolled
 * its own version that left **expenses** out, so it would green-light a
 * conversion the treasury screen said the faction could not afford. Two
 * definitions of "available" is one too many.
 *
 *   balance = entries − completed payouts − expenses
 *
 * Same definition as `computeTreasuryBalances`; this one is narrowed to named
 * item types and can run inside a caller's transaction, which that one cannot.
 *
 * Three grouped aggregates rather than one row of correlated subqueries. The
 * subquery version silently returned zero for everything: Drizzle renders a
 * column embedded in a `sql` template unqualified, so the inner
 * `item_type_id = id` matched the *subquery's own* id column and never found a
 * row. This shape cannot express that mistake.
 *
 * Run in sequence, not Promise.all: a transaction is one connection, and
 * firing three queries at it concurrently is how you get a driver error
 * instead of an answer.
 */
export async function balancesFor(
  factionId: string,
  itemTypeIds: string[],
  handle: TransactionLike | typeof db = db,
): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  if (itemTypeIds.length === 0) return out;

  const ids = [...new Set(itemTypeIds)];

  const inflow = await handle
    .select({
      itemTypeId: entries.itemTypeId,
      total: sql<string>`COALESCE(SUM(CAST(${entries.amount} AS NUMERIC)), 0)`,
    })
    .from(entries)
    .where(and(
      eq(entries.factionId, factionId),
      eq(entries.isDeleted, false),
      inArray(entries.itemTypeId, ids),
    ))
    .groupBy(entries.itemTypeId);

  const paid = await handle
    .select({
      itemTypeId: payouts.itemTypeId,
      total: sql<string>`COALESCE(SUM(CAST(${payouts.amount} AS NUMERIC)), 0)`,
    })
    .from(payouts)
    .where(and(
      eq(payouts.factionId, factionId),
      eq(payouts.isDeleted, false),
      eq(payouts.status, 'completed'),
      inArray(payouts.itemTypeId, ids),
    ))
    .groupBy(payouts.itemTypeId);

  const spent = await handle
    .select({
      itemTypeId: expenses.itemTypeId,
      total: sql<string>`COALESCE(SUM(CAST(${expenses.amount} AS NUMERIC)), 0)`,
    })
    .from(expenses)
    .where(and(
      eq(expenses.factionId, factionId),
      eq(expenses.isDeleted, false),
      inArray(expenses.itemTypeId, ids),
    ))
    .groupBy(expenses.itemTypeId);

  const cents = new Map<string, bigint>(ids.map((id) => [id, 0n]));
  for (const row of inflow) cents.set(row.itemTypeId, (cents.get(row.itemTypeId) ?? 0n) + toCents(row.total));
  for (const row of paid) cents.set(row.itemTypeId, (cents.get(row.itemTypeId) ?? 0n) - toCents(row.total));
  for (const row of spent) cents.set(row.itemTypeId, (cents.get(row.itemTypeId) ?? 0n) - toCents(row.total));

  for (const [id, value] of cents) out.set(id, fromCents(value));
  return out;
}

/**
 * Lock the item types a spend is about to touch.
 *
 * `item_types` rows stand in for the balances themselves, which are derived
 * and so have no row to lock. Two members spending the same materials at the
 * same moment queue up here instead of both reading a balance only one of them
 * can spend.
 *
 * Ordered by id so two operations sharing some but not all of their item types
 * cannot take the locks in opposite orders and deadlock.
 */
export async function lockItemTypes(tx: TransactionLike, itemTypeIds: string[]): Promise<void> {
  if (itemTypeIds.length === 0) return;
  const ordered = [...new Set(itemTypeIds)].sort();
  await tx
    .select({ id: itemTypes.id })
    .from(itemTypes)
    .where(inArray(itemTypes.id, ordered))
    .orderBy(itemTypes.id)
    .for('update');
}
