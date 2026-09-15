import { and, eq, inArray } from 'drizzle-orm';
import { db } from '../db/index.js';
import {
  counterparties,
  craftingRecipeItems,
  craftingRecipes,
  currencyRates,
  itemTypes,
  productAddons,
  productPrices,
  quantityBreaks,
} from '../db/schema.js';
import { toCents, fromCents } from './treasury.js';

/**
 * The arithmetic behind the price calculator.
 *
 * It lives here, on the server, and the screen asks for every total rather
 * than computing its own. Duplicating the rounding in the browser is how the
 * number a seller reads out and the number the books record start differing by
 * a dollar — and a dollar is enough for a buyer to notice and an accountant to
 * spend an evening on.
 *
 * Everything is integer hundredths in BigInt. No amount in this file ever
 * touches a float.
 */

/** 100.00% — the denominator every percentage is measured against. */
const FULL_PERCENT = 10_000n;

/**
 * Divide, rounding halves away from zero.
 *
 * BigInt division truncates, which quietly loses a cent per line in the
 * faction's favour, every line, forever. Amounts here are never negative —
 * the routes refuse a negative price — but the sign is handled anyway rather
 * than left as a trap for the day something subtracts.
 */
export function divideRounded(numerator: bigint, denominator: bigint): bigint {
  if (denominator === 0n) throw new Error('divideRounded: denominator is zero');
  const negative = (numerator < 0n) !== (denominator < 0n);
  const n = numerator < 0n ? -numerator : numerator;
  const d = denominator < 0n ? -denominator : denominator;
  const magnitude = (n * 2n + d) / (d * 2n);
  return negative ? -magnitude : magnitude;
}

/** One millionth — the scale `currency_rates.rate` is stored at. */
const RATE_SCALE = 1_000_000n;

/** A decimal string with up to six places, as an integer count of millionths. */
export function toMicros(v: string): bigint {
  const [whole = '0', fraction = ''] = v.split('.');
  const negative = whole.startsWith('-');
  const digits = (negative ? whole.slice(1) : whole) || '0';
  const micros = BigInt(digits + `${fraction}000000`.slice(0, 6));
  return negative ? -micros : micros;
}

/** `from>to` to the agreed rate. Directional: the reverse is a separate row. */
export type RateMap = Map<string, string>;

export const rateKey = (from: string, to: string) => `${from}>${to}`;

export async function loadRates(factionId: string): Promise<RateMap> {
  const rows = await db
    .select({
      from: currencyRates.fromItemTypeId,
      to: currencyRates.toItemTypeId,
      rate: currencyRates.rate,
    })
    .from(currencyRates)
    .where(eq(currencyRates.factionId, factionId));
  return new Map(rows.map((r) => [rateKey(r.from, r.to), r.rate]));
}

/**
 * Convert an amount between two of the faction's currencies.
 *
 * Null when there is no rate for that direction. Deliberately no fallback to
 * the inverse of the opposite row: rates here are rarely symmetric — washing
 * money takes a cut — so a derived inverse would quietly quote a deal the
 * faction never agreed to.
 */
export function convertCents(
  cents: bigint,
  from: string,
  to: string,
  rates: RateMap,
): bigint | null {
  if (from === to) return cents;
  const rate = rates.get(rateKey(from, to));
  if (!rate) return null;
  return divideRounded(cents * toMicros(rate), RATE_SCALE);
}

// ── What the calculator reads ─────────────────────────

export interface AddonRow {
  id: string;
  name: string;
  price: string;
  itemTypeId: string | null;
  sortOrder: number;
  isActive: boolean;
}

export interface PriceRow {
  id: string;
  itemTypeId: string;
  itemTypeName: string;
  unit: string;
  isCurrency: boolean;
  icon: string | null;
  category: string;
  unitPrice: string;
  currencyItemTypeId: string;
  floorPrice: string | null;
  note: string | null;
  isActive: boolean;
  updatedAt: string;
  addons: AddonRow[];
}

export interface BreakRow {
  id: string;
  itemTypeId: string | null;
  minQuantity: string;
  discountPercent: string;
}

export interface CounterpartyRow {
  id: string;
  name: string;
  discountPercent: string;
  note: string | null;
  color: string | null;
  icon: string | null;
  isActive: boolean;
}

export interface CurrencyRef {
  itemTypeId: string;
  name: string;
  unit: string;
  isCurrency: boolean;
  icon: string | null;
}

/** The whole price book in one read — it is what the screen needs at once. */
export async function loadPriceBook(factionId: string): Promise<{
  prices: PriceRow[];
  breaks: BreakRow[];
  parties: CounterpartyRow[];
}> {
  const priceRows = await db
    .select({
      id: productPrices.id,
      itemTypeId: productPrices.itemTypeId,
      itemTypeName: itemTypes.name,
      unit: itemTypes.unit,
      isCurrency: itemTypes.isCurrency,
      icon: itemTypes.icon,
      category: itemTypes.category,
      unitPrice: productPrices.unitPrice,
      currencyItemTypeId: productPrices.currencyItemTypeId,
      floorPrice: productPrices.floorPrice,
      note: productPrices.note,
      isActive: productPrices.isActive,
      updatedAt: productPrices.updatedAt,
    })
    .from(productPrices)
    .innerJoin(itemTypes, eq(productPrices.itemTypeId, itemTypes.id))
    .where(eq(productPrices.factionId, factionId));

  const addonRows = priceRows.length === 0
    ? []
    : await db
      .select()
      .from(productAddons)
      .where(inArray(productAddons.productPriceId, priceRows.map((p) => p.id)));

  const byPrice = new Map<string, AddonRow[]>();
  for (const a of addonRows) {
    const list = byPrice.get(a.productPriceId) ?? [];
    list.push({
      id: a.id,
      name: a.name,
      price: a.price,
      itemTypeId: a.itemTypeId,
      sortOrder: a.sortOrder,
      isActive: a.isActive,
    });
    byPrice.set(a.productPriceId, list);
  }
  for (const list of byPrice.values()) {
    list.sort((x, y) => x.sortOrder - y.sortOrder || x.name.localeCompare(y.name));
  }

  const [breakRows, partyRows] = await Promise.all([
    db.select().from(quantityBreaks).where(eq(quantityBreaks.factionId, factionId)),
    db.select().from(counterparties).where(eq(counterparties.factionId, factionId)),
  ]);

  return {
    prices: priceRows
      .map((p) => ({
        ...p,
        updatedAt: p.updatedAt.toISOString(),
        addons: byPrice.get(p.id) ?? [],
      }))
      .sort((a, b) => a.itemTypeName.localeCompare(b.itemTypeName)),
    breaks: breakRows
      .map((b) => ({
        id: b.id,
        itemTypeId: b.itemTypeId,
        minQuantity: b.minQuantity,
        discountPercent: b.discountPercent,
      }))
      .sort((a, b) => Number(toCents(a.minQuantity) - toCents(b.minQuantity))),
    parties: partyRows
      .map((c) => ({
        id: c.id,
        name: c.name,
        discountPercent: c.discountPercent,
        note: c.note,
        color: c.color,
        icon: c.icon,
        isActive: c.isActive,
      }))
      .sort((a, b) => a.name.localeCompare(b.name)),
  };
}

/** What one of something costs the faction to make, and how we know. */
export interface CostRow {
  /** Per unit, in the currency the item's own price is quoted in. */
  unitCost: string;
  recipeName: string;
}

/**
 * What the faction's own crafting recipes say its products cost.
 *
 * This is the part of the calculator nobody can do in their head mid-deal, and
 * it is nearly free: a recipe already says 10 steel + 2 powder makes a pistol,
 * and the price list already says what steel is worth.
 *
 * Three rules, each of which is a refusal to guess:
 *
 * - A recipe whose inputs are not all priced yields no cost at all, rather
 *   than a total that silently counts the priced half.
 * - An input priced in another currency is converted, and if no rate exists
 *   the recipe yields no cost. A cost in mixed money is not a cost.
 * - Where two recipes make the same thing, the cheaper one wins. A faction
 *   with two ways to make something can make it the cheap way, and a margin
 *   quoted against the expensive route understates what the deal is worth.
 */
export async function loadCosts(
  factionId: string,
  book: { prices: PriceRow[] },
  rates: RateMap,
): Promise<Map<string, CostRow>> {
  const rows = await db
    .select({
      recipeId: craftingRecipes.id,
      recipeName: craftingRecipes.name,
      role: craftingRecipeItems.role,
      itemTypeId: craftingRecipeItems.itemTypeId,
      quantity: craftingRecipeItems.quantity,
    })
    .from(craftingRecipes)
    .innerJoin(craftingRecipeItems, eq(craftingRecipeItems.recipeId, craftingRecipes.id))
    .where(and(eq(craftingRecipes.factionId, factionId), eq(craftingRecipes.isActive, true)));

  const priceByItem = new Map(book.prices.filter((p) => p.isActive).map((p) => [p.itemTypeId, p]));
  const byRecipe = new Map<string, typeof rows>();
  for (const row of rows) {
    const list = byRecipe.get(row.recipeId) ?? [];
    list.push(row);
    byRecipe.set(row.recipeId, list);
  }

  const costs = new Map<string, CostRow>();

  for (const lines of byRecipe.values()) {
    const inputs = lines.filter((l) => l.role === 'input');
    const outputs = lines.filter((l) => l.role === 'output');
    if (inputs.length === 0 || outputs.length === 0) continue;

    for (const output of outputs) {
      const outPrice = priceByItem.get(output.itemTypeId);
      // Without a price for the product there is no currency to express its
      // cost in, and nothing on screen to compare a margin against.
      if (!outPrice) continue;

      let total = 0n;
      let known = true;
      for (const input of inputs) {
        const inPrice = priceByItem.get(input.itemTypeId);
        if (!inPrice) { known = false; break; }
        const perUnit = convertCents(
          toCents(inPrice.unitPrice),
          inPrice.currencyItemTypeId,
          outPrice.currencyItemTypeId,
          rates,
        );
        if (perUnit === null) { known = false; break; }
        total += divideRounded(perUnit * toCents(input.quantity), 100n);
      }
      if (!known) continue;

      const outQuantity = toCents(output.quantity);
      if (outQuantity <= 0n) continue;
      const unitCost = divideRounded(total * 100n, outQuantity);

      const existing = costs.get(output.itemTypeId);
      if (!existing || toCents(existing.unitCost) > unitCost) {
        costs.set(output.itemTypeId, {
          unitCost: fromCents(unitCost),
          recipeName: lines[0]!.recipeName,
        });
      }
    }
  }

  return costs;
}

// ── The quote ─────────────────────────────────────────

export interface QuoteLineInput {
  itemTypeId: string;
  quantity: string;
  addonIds?: string[];
}

export interface ComputedAddon {
  id: string;
  name: string;
  price: string;
}

export interface ComputedLine {
  itemTypeId: string;
  itemTypeName: string;
  unit: string;
  icon: string | null;
  isCurrency: boolean;
  quantity: string;
  /** The book price of one, before add-ons. */
  unitPrice: string;
  addons: ComputedAddon[];
  /** One, with its add-ons. What a buyer asking "each?" is told. */
  unitTotal: string;
  /** `unitTotal` × quantity, before any discount. */
  gross: string;
  counterpartyPercent: string;
  quantityBreakPercent: string;
  discountPercent: string;
  discount: string;
  total: string;
  floorPrice: string | null;
  /** The discounted price of one fell below the floor this item names. */
  belowFloor: boolean;
  /** Only present for viewers allowed to see them; see `marginMinRankLevel`. */
  unitCost?: string;
  cost?: string;
  margin?: string;
  /** Margin as a percentage of the line total, or null on a line given away. */
  marginPercent?: string | null;
  costRecipeName?: string;
  /** The line is priced in another currency and was converted to quote in. */
  convertedFrom?: { itemTypeId: string; name: string } | null;
}

export interface ComputedQuote {
  currency: CurrencyRef;
  counterparty: { id: string; name: string; discountPercent: string } | null;
  lines: ComputedLine[];
  subtotal: string;
  discountTotal: string;
  total: string;
  /** True where any line is under its floor — the screen colours those red. */
  belowFloor: boolean;
  costTotal?: string;
  marginTotal?: string;
  marginPercent?: string | null;
  /** Lines whose cost is unknown, so the margin shown is only part of it. */
  costIncomplete?: boolean;
}

export type QuoteError =
  | { code: 'NO_LINES'; message: string }
  | { code: 'NOT_PRICED'; message: string; itemTypeIds: string[] }
  | { code: 'MIXED_CURRENCY'; message: string }
  | { code: 'NO_RATE'; message: string }
  | { code: 'BAD_QUANTITY'; message: string }
  | { code: 'UNKNOWN_ADDON'; message: string };

/** Everything the quote needs beyond the price list itself. */
export interface QuoteExtras {
  rates?: RateMap;
  /** Omitted for viewers who may not see them — the figures are then absent. */
  costs?: Map<string, CostRow>;
}

export type QuoteResult =
  | { ok: true; quote: ComputedQuote }
  | { ok: false; error: QuoteError };

/**
 * Which rung of the quantity ladder a line has reached.
 *
 * An item with rungs of its own ignores the faction-wide ladder completely.
 * Merging the two would mean a price nobody can derive from the screen that
 * shows the ladders.
 */
function quantityBreakPercent(
  breaks: BreakRow[],
  itemTypeId: string,
  quantityCents: bigint,
): bigint {
  const own = breaks.filter((b) => b.itemTypeId === itemTypeId);
  const ladder = own.length > 0 ? own : breaks.filter((b) => b.itemTypeId === null);

  let best = 0n;
  for (const rung of ladder) {
    if (toCents(rung.minQuantity) <= quantityCents) {
      const percent = toCents(rung.discountPercent);
      if (percent > best) best = percent;
    }
  }
  return best;
}

/**
 * Price a basket.
 *
 * Discounts **add** rather than compound: an ally at 15% buying a bulk lot at
 * 10% pays 25% less, not 23.5%. Compounding is arguably more correct and is
 * the wrong choice here — the seller has to be able to say the number out loud
 * and have it check out against the buyer's own arithmetic. The sum is capped
 * at 100%, because a quote that owes the buyer money is not a quote.
 *
 * Rounding happens exactly twice per line: once turning a price and a quantity
 * into a gross, once turning a percentage into a discount amount. The total is
 * then `gross − discount` rather than a third rounded figure, which is what
 * makes the printed lines add up to the printed total.
 */
export function computeQuote(
  input: { counterpartyId?: string | null; lines: QuoteLineInput[]; currencyItemTypeId?: string | null },
  book: { prices: PriceRow[]; breaks: BreakRow[]; parties: CounterpartyRow[] },
  currencies: Map<string, CurrencyRef>,
  extras: QuoteExtras = {},
): QuoteResult {
  const rates = extras.rates ?? new Map<string, string>();
  if (input.lines.length === 0) {
    return { ok: false, error: { code: 'NO_LINES', message: 'A quote needs at least one line.' } };
  }

  const priceByItem = new Map(book.prices.map((p) => [p.itemTypeId, p]));
  const missing = input.lines
    .filter((l) => !priceByItem.get(l.itemTypeId)?.isActive)
    .map((l) => l.itemTypeId);
  if (missing.length > 0) {
    return {
      ok: false,
      error: {
        code: 'NOT_PRICED',
        message: 'Some of those items have no active price.',
        itemTypeIds: [...new Set(missing)],
      },
    };
  }

  // One quote, one currency — but the basket no longer has to be priced in it.
  // Where the caller names the currency to quote in, every line is converted
  // into it at the faction's own agreed rate. Where it does not and the basket
  // is mixed, the answer is a question rather than a guess: which currency?
  const currencyIds = new Set(input.lines.map((l) => priceByItem.get(l.itemTypeId)!.currencyItemTypeId));
  const currencyId = input.currencyItemTypeId ?? [...currencyIds][0]!;
  if (!input.currencyItemTypeId && currencyIds.size > 1) {
    return {
      ok: false,
      error: {
        code: 'MIXED_CURRENCY',
        message: 'Those items are priced in different currencies. Pick which one to quote in.',
      },
    };
  }
  const currency = currencies.get(currencyId);
  if (!currency) {
    return {
      ok: false,
      error: { code: 'MIXED_CURRENCY', message: 'The currency for those prices no longer exists.' },
    };
  }

  /** Into the quote's currency, or null when no rate covers that direction. */
  const intoQuote = (cents: bigint, from: string) => convertCents(cents, from, currencyId, rates);

  const party = input.counterpartyId
    ? book.parties.find((p) => p.id === input.counterpartyId && p.isActive) ?? null
    : null;
  const partyPercent = party ? toCents(party.discountPercent) : 0n;

  const lines: ComputedLine[] = [];
  let subtotal = 0n;
  let discountTotal = 0n;
  let costTotal = 0n;
  let costIncomplete = false;

  for (const line of input.lines) {
    const price = priceByItem.get(line.itemTypeId)!;
    const quantityCents = toCents(line.quantity);
    if (quantityCents <= 0n) {
      return {
        ok: false,
        error: { code: 'BAD_QUANTITY', message: `Quantity for ${price.itemTypeName} must be above zero.` },
      };
    }

    const wanted = new Set(line.addonIds ?? []);
    const addons = price.addons.filter((a) => wanted.has(a.id));
    if (addons.length !== wanted.size) {
      return {
        ok: false,
        error: {
          code: 'UNKNOWN_ADDON',
          message: `An add-on picked for ${price.itemTypeName} is not one of its own.`,
        },
      };
    }
    const inactive = addons.find((a) => !a.isActive);
    if (inactive) {
      return {
        ok: false,
        error: { code: 'UNKNOWN_ADDON', message: `The add-on "${inactive.name}" is no longer offered.` },
      };
    }

    const listedCents = addons.reduce((sum, a) => sum + toCents(a.price), toCents(price.unitPrice));
    // Converted once, at the unit, before anything else happens to it. Doing
    // it at the end instead would convert the gross and the discount
    // separately, and two rounded conversions do not add back up to the
    // converted total.
    const unitCents = intoQuote(listedCents, price.currencyItemTypeId);
    if (unitCents === null) {
      return {
        ok: false,
        error: {
          code: 'NO_RATE',
          message: `No exchange rate from ${currencies.get(price.currencyItemTypeId)?.name ?? 'that currency'}`
            + ` to ${currency.name}. Add one, or quote them separately.`,
        },
      };
    }
    // Quantities carry two decimals of their own, so the product is in
    // ten-thousandths and comes back down by 100.
    const gross = divideRounded(unitCents * quantityCents, 100n);

    const breakPercent = quantityBreakPercent(book.breaks, price.itemTypeId, quantityCents);
    const rawPercent = partyPercent + breakPercent;
    const percent = rawPercent > FULL_PERCENT ? FULL_PERCENT : rawPercent;
    const discount = divideRounded(gross * percent, FULL_PERCENT);
    const total = gross - discount;

    // The floor is a price per unit, so it is compared against one unit's
    // discounted share rather than the line — and in the quote's currency,
    // because that is the money actually changing hands.
    const netUnit = divideRounded(unitCents * (FULL_PERCENT - percent), FULL_PERCENT);
    const floorHere = price.floorPrice === null
      ? null
      : intoQuote(toCents(price.floorPrice), price.currencyItemTypeId);
    const belowFloor = floorHere !== null && netUnit < floorHere;

    // What it cost to make, for the viewers allowed to see it.
    const costRow = extras.costs?.get(price.itemTypeId);
    const unitCostHere = costRow
      ? intoQuote(toCents(costRow.unitCost), price.currencyItemTypeId)
      : null;
    const lineCost = unitCostHere === null
      ? null
      : divideRounded(unitCostHere * quantityCents, 100n);

    subtotal += gross;
    discountTotal += discount;
    if (lineCost === null) {
      if (extras.costs) costIncomplete = true;
    } else {
      costTotal += lineCost;
    }

    lines.push({
      itemTypeId: price.itemTypeId,
      itemTypeName: price.itemTypeName,
      unit: price.unit,
      icon: price.icon,
      isCurrency: price.isCurrency,
      quantity: fromCents(quantityCents),
      unitPrice: price.unitPrice,
      addons: addons.map((a) => ({ id: a.id, name: a.name, price: a.price })),
      unitTotal: fromCents(unitCents),
      gross: fromCents(gross),
      counterpartyPercent: fromCents(partyPercent),
      quantityBreakPercent: fromCents(breakPercent),
      discountPercent: fromCents(percent),
      discount: fromCents(discount),
      total: fromCents(total),
      floorPrice: price.floorPrice,
      belowFloor,
      ...(lineCost !== null && unitCostHere !== null ? {
        unitCost: fromCents(unitCostHere),
        cost: fromCents(lineCost),
        margin: fromCents(total - lineCost),
        // Margin against the price, not against the cost: "we keep 40% of
        // what they pay" is the figure a seller can hold in their head.
        marginPercent: total > 0n
          ? fromCents(divideRounded((total - lineCost) * FULL_PERCENT, total))
          : null,
        costRecipeName: costRow!.recipeName,
      } : {}),
      convertedFrom: price.currencyItemTypeId === currencyId
        ? null
        : {
          itemTypeId: price.currencyItemTypeId,
          name: currencies.get(price.currencyItemTypeId)?.name ?? 'another currency',
        },
    });
  }

  return {
    ok: true,
    quote: {
      currency,
      counterparty: party
        ? { id: party.id, name: party.name, discountPercent: party.discountPercent }
        : null,
      lines,
      subtotal: fromCents(subtotal),
      discountTotal: fromCents(discountTotal),
      total: fromCents(subtotal - discountTotal),
      belowFloor: lines.some((l) => l.belowFloor),
      ...(extras.costs ? {
        costTotal: fromCents(costTotal),
        marginTotal: fromCents(subtotal - discountTotal - costTotal),
        marginPercent: subtotal - discountTotal > 0n
          ? fromCents(divideRounded(
            (subtotal - discountTotal - costTotal) * FULL_PERCENT,
            subtotal - discountTotal,
          ))
          : null,
        costIncomplete,
      } : {}),
    },
  };
}

/** Every item type of this faction, for resolving currencies and names. */
export async function loadCurrencies(factionId: string): Promise<Map<string, CurrencyRef>> {
  const rows = await db
    .select({
      itemTypeId: itemTypes.id,
      name: itemTypes.name,
      unit: itemTypes.unit,
      isCurrency: itemTypes.isCurrency,
      icon: itemTypes.icon,
    })
    .from(itemTypes)
    .where(eq(itemTypes.factionId, factionId));
  return new Map(rows.map((r) => [r.itemTypeId, r]));
}

/** Is this item type one of the faction's own? Every write checks it. */
export async function ownsItemType(factionId: string, itemTypeId: string): Promise<boolean> {
  const [row] = await db
    .select({ id: itemTypes.id })
    .from(itemTypes)
    .where(and(eq(itemTypes.id, itemTypeId), eq(itemTypes.factionId, factionId)))
    .limit(1);
  return !!row;
}
