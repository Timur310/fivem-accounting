import { and, eq, inArray, isNull, or } from 'drizzle-orm';
import { db, type TransactionLike } from '../db/index.js';
import {
  craftingRecipes,
  craftingRecipeItems,
  craftMovements,
  crafts,
  itemTypes,
  type CreditOutputTo,
} from '../db/schema.js';
import { toCents } from './treasury.js';

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

/** Compare two decimal strings without going through a float. */
export function compareQuantity(a: string, b: string): number {
  const x = toCents(a);
  const y = toCents(b);
  return x < y ? -1 : x > y ? 1 : 0;
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

  // Divided in hundredths like everything else that touches a treasury
  // figure. This is only a display hint — the real guard runs in the craft
  // transaction — but a card that says "can make 4" when the answer is 3 sends
  // somebody to a button that then refuses them, which is the exact experience
  // this feature exists to remove.
  let limit: bigint | null = null;
  for (const line of recipe.inputs) {
    const need = toCents(line.quantity);
    // A line costing nothing constrains nothing.
    if (need <= 0n) continue;
    const have = toCents(balances.get(line.itemTypeId) ?? '0');
    const possible = have <= 0n ? 0n : have / need;
    limit = limit === null || possible < limit ? possible : limit;
  }
  if (limit === null) return 0;
  // Clamped: the number is rendered and used as an input max, and a batch
  // beyond this is refused by the route anyway.
  return Number(limit > 1000n ? 1000n : limit);
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

/**
 * Is any of these rows part of a craft that has not been reverted?
 *
 * A craft's movements are ordinary entries and completed payouts — which is
 * what lets every balance, report and export count them without knowing
 * crafting exists, and is also what leaves them deletable one at a time.
 *
 * That has to be refused, because the halves are not independent. Deleting a
 * craft's **input** payouts returns the materials while the product stays,
 * which is free crafting and repeatable. Deleting its **output** entry — which
 * a crafter can do inside the five-minute undo window when the recipe credits
 * them — consumes the materials and destroys the product. Editing an amount
 * does the same damage more quietly.
 *
 * Revert exists to undo a craft properly: both sides at once, guarded against
 * overdrawing the vault, and leaving the craft in history saying so. Callers
 * point people at it rather than explaining the invariant.
 *
 * Returns the recipe name of the first row that is spoken for, or null.
 */
export async function craftHolding(
  rows: { entryIds?: string[]; payoutIds?: string[] },
  handle: TransactionLike | typeof db = db,
): Promise<string | null> {
  const entryIds = rows.entryIds?.filter(Boolean) ?? [];
  const payoutIds = rows.payoutIds?.filter(Boolean) ?? [];
  if (entryIds.length === 0 && payoutIds.length === 0) return null;

  const matches = [
    ...(entryIds.length ? [inArray(craftMovements.entryId, entryIds)] : []),
    ...(payoutIds.length ? [inArray(craftMovements.payoutId, payoutIds)] : []),
  ];

  const [held] = await handle
    .select({ recipeName: crafts.recipeName })
    .from(craftMovements)
    .innerJoin(crafts, eq(craftMovements.craftId, crafts.id))
    .where(and(isNull(crafts.revertedAt), matches.length === 1 ? matches[0] : or(...matches)))
    .limit(1);

  return held?.recipeName ?? null;
}

/** The refusal, worded the same way wherever it is raised. */
export function craftHoldingMessage(recipeName: string): string {
  return `This is part of the craft "${recipeName}". Revert that craft instead — it puts the materials back and takes the product out together.`;
}
