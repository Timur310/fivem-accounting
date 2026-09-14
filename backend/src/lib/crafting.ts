import { and, eq, inArray, sql } from 'drizzle-orm';
import { db, type TransactionLike } from '../db/index.js';
import {
  craftingRecipes,
  craftingRecipeItems,
  entries,
  expenses,
  itemTypes,
  payouts,
  type CreditOutputTo,
} from '../db/schema.js';

/**
 * The arithmetic and the reading side of crafting. The writing side — the
 * transaction that actually moves the treasury — lives in `routes/crafting.ts`
 * next to the request that triggers it.
 */

/** A recipe line, with enough of the item type to render it. */
export interface RecipeLine {
  itemTypeId: string;
  itemTypeName: string;
  unit: string;
  isCurrency: boolean;
  icon: string | null;
  isActive: boolean;
  /** Per single craft, as stored. */
  quantity: string;
}

export interface LoadedRecipe {
  id: string;
  name: string;
  description: string | null;
  creditOutputTo: CreditOutputTo;
  isActive: boolean;
  inputs: RecipeLine[];
  outputs: RecipeLine[];
}

/**
 * Multiply a stored decimal by a whole batch count without touching a float.
 *
 * Quantities are `decimal(15,2)` and arrive as strings. `Number('0.1') * 3`
 * is 0.30000000000000004, and the same class of error on a treasury figure is
 * how a faction ends up short by a cent that nobody can account for. Scaling
 * two decimal places into an integer and multiplying there is exact.
 */
export function scaleQuantity(perCraft: string, batch: number): string {
  const [whole = '0', fraction = ''] = perCraft.split('.');
  const negative = whole.startsWith('-');
  const digits = negative ? whole.slice(1) : whole;
  const cents = BigInt(digits + `${fraction}00`.slice(0, 2));
  const total = cents * BigInt(batch);
  const str = total.toString().padStart(3, '0');
  return `${negative ? '-' : ''}${str.slice(0, -2)}.${str.slice(-2)}`;
}

/** A decimal string as an exact integer number of hundredths. */
function toCents(v: string): bigint {
  const [whole = '0', fraction = ''] = v.split('.');
  const negative = whole.startsWith('-');
  const digits = (negative ? whole.slice(1) : whole) || '0';
  const cents = BigInt(digits + `${fraction}00`.slice(0, 2));
  return negative ? -cents : cents;
}

/** And back again, in the `0.00` shape the columns use. */
function fromCents(cents: bigint): string {
  const negative = cents < 0n;
  const str = (negative ? -cents : cents).toString().padStart(3, '0');
  return `${negative ? '-' : ''}${str.slice(0, -2)}.${str.slice(-2)}`;
}

/** Compare two decimal strings without going through a float. */
export function compareQuantity(a: string, b: string): number {
  const x = toCents(a);
  const y = toCents(b);
  return x < y ? -1 : x > y ? 1 : 0;
}

/**
 * What the vault holds of each of these item types, right now.
 *
 * The definition is the one `computeTreasuryBalances` uses and not the one the
 * laundering desk wrote for itself — entries, minus completed payouts, **minus
 * expenses**. Laundering's inline copy leaves expenses out, which means it can
 * green-light a conversion the treasury screen says the faction cannot afford.
 * Crafting is not going to inherit that.
 *
 * Runs against whatever handle it is given, so the craft transaction can ask
 * the question inside its own lock.
 */
export async function balancesFor(
  factionId: string,
  itemTypeIds: string[],
  handle: TransactionLike | typeof db = db,
): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  if (itemTypeIds.length === 0) return out;

  const ids = [...new Set(itemTypeIds)];

  // Three grouped aggregates rather than one row of correlated subqueries.
  // The subquery version silently returned zero for everything: Drizzle
  // renders a column embedded in a `sql` template unqualified, so the inner
  // `item_type_id = id` matched the *subquery's own* id column and never
  // found a row. This shape cannot express that mistake, and it is the one
  // `computeTreasuryBalances` already uses.
  //
  // Run in sequence, not Promise.all: a transaction is one connection, and
  // firing three queries at it concurrently is how you get a driver error
  // instead of an answer.
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
 * Lock the item types a craft is about to touch.
 *
 * `item_types` rows stand in for the balances themselves, which are derived
 * and so have no row to lock. Two members crafting from the same materials at
 * the same moment queue up here instead of both reading a balance that only
 * one of them can spend — the same trick the laundering desk uses, extended to
 * a whole recipe.
 *
 * Ordered by id so two crafts sharing some but not all of their materials
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

/** One recipe with its lines, or null if it is not this faction's. */
export async function loadRecipe(
  factionId: string,
  recipeId: string,
  handle: TransactionLike | typeof db = db,
): Promise<LoadedRecipe | null> {
  const [recipe] = await handle
    .select()
    .from(craftingRecipes)
    .where(and(eq(craftingRecipes.id, recipeId), eq(craftingRecipes.factionId, factionId)))
    .limit(1);

  if (!recipe) return null;

  const lines = await handle
    .select({
      itemTypeId: craftingRecipeItems.itemTypeId,
      role: craftingRecipeItems.role,
      quantity: craftingRecipeItems.quantity,
      itemTypeName: itemTypes.name,
      unit: itemTypes.unit,
      isCurrency: itemTypes.isCurrency,
      icon: itemTypes.icon,
      isActive: itemTypes.isActive,
    })
    .from(craftingRecipeItems)
    .innerJoin(itemTypes, eq(craftingRecipeItems.itemTypeId, itemTypes.id))
    .where(eq(craftingRecipeItems.recipeId, recipeId));

  const toLine = (l: (typeof lines)[number]): RecipeLine => ({
    itemTypeId: l.itemTypeId,
    itemTypeName: l.itemTypeName,
    unit: l.unit,
    isCurrency: l.isCurrency,
    icon: l.icon,
    isActive: l.isActive,
    quantity: l.quantity,
  });

  return {
    id: recipe.id,
    name: recipe.name,
    description: recipe.description,
    creditOutputTo: recipe.creditOutputTo as CreditOutputTo,
    isActive: recipe.isActive,
    inputs: lines.filter((l) => l.role === 'input').map(toLine),
    outputs: lines.filter((l) => l.role === 'output').map(toLine),
  };
}

/**
 * How many times this recipe can be run right now.
 *
 * The number the craft screen needs to disable its own button before anybody
 * presses it. A recipe with no inputs could be run forever, which is not a
 * useful answer — it is capped, and a recipe like that is a data-entry mistake
 * the editor refuses anyway.
 */
export function maxCraftable(recipe: LoadedRecipe, balances: Map<string, string>): number {
  if (recipe.inputs.length === 0) return 0;

  let limit = Number.MAX_SAFE_INTEGER;
  for (const line of recipe.inputs) {
    const have = Number(balances.get(line.itemTypeId) ?? '0');
    const need = Number(line.quantity);
    // A line costing nothing constrains nothing.
    if (need <= 0) continue;
    limit = Math.min(limit, Math.floor(have / need));
  }
  return limit === Number.MAX_SAFE_INTEGER ? 0 : Math.max(0, limit);
}

/**
 * Which inputs the vault is short of for a batch of this size, and by how
 * much — so the screen can name the missing material rather than saying no.
 */
export interface Shortfall {
  itemTypeId: string;
  itemTypeName: string;
  unit: string;
  isCurrency: boolean;
  required: string;
  available: string;
}

export function shortfalls(
  recipe: LoadedRecipe,
  balances: Map<string, string>,
  batch: number,
): Shortfall[] {
  const out: Shortfall[] = [];
  for (const line of recipe.inputs) {
    const required = scaleQuantity(line.quantity, batch);
    const available = balances.get(line.itemTypeId) ?? '0';
    if (compareQuantity(available, required) < 0) {
      out.push({
        itemTypeId: line.itemTypeId,
        itemTypeName: line.itemTypeName,
        unit: line.unit,
        isCurrency: line.isCurrency,
        required,
        available,
      });
    }
  }
  return out;
}
