import { Request, Response } from 'express';
import { asyncRouter } from '../lib/asyncRouter.js';
import { z } from 'zod';
import { and, desc, eq, inArray, sql } from 'drizzle-orm';
import { db, type TransactionLike } from '../db/index.js';
import {
  counterparties,
  currencyRates,
  entries,
  factions,
  itemTypes,
  payouts,
  productAddons,
  productPrices,
  quantityBreaks,
  saleLines,
  saleMovements,
  sales,
  users,
  CREDIT_SALE_TO,
} from '../db/schema.js';
import { success, error } from '../lib/response.js';
import { requireAuth } from '../middleware/auth.js';
import { requireFactionMember, requirePermission } from '../middleware/factionAccess.js';
import { createAuditLog } from '../lib/audit.js';
import {
  computeQuote, loadCosts, loadCurrencies, loadPriceBook, loadRates, ownsItemType,
  type QuoteExtras,
} from '../lib/pricing.js';
import { viewerRankLevel } from '../lib/rank.js';
import { resolveAnonymousUserId } from '../lib/anonymous.js';
import { todayDateString } from '../lib/date.js';
import { balancesFor, lockItemTypes, toCents } from '../lib/treasury.js';
import { compareQuantity } from '../lib/crafting.js';

/**
 * The price list, and the calculator that reads it.
 *
 * Three things a faction maintains — what each item sells for, what extras it
 * can be sold with, and who gets what discount — and one endpoint that turns a
 * basket into a number.
 *
 * **Reading is open to every member; writing needs `manage_prices`.** A price
 * list nobody may read is a price list nobody can sell from, and the people
 * standing at the counter are exactly the ones with the fewest rights.
 *
 * The quote endpoint is deliberately stateless. Phase 1 calculates; it does
 * not remember, and it does not touch the treasury. Booking a sale into the
 * ledger is the next phase, and building it as a side effect of a calculator
 * would mean every mistyped quantity landed in the books.
 */
const router = asyncRouter({ mergeParams: true });

router.use(requireAuth, requireFactionMember);

const factionId = (req: Request) => req.params.id as string;

/** A money figure as the columns hold it: up to 13 digits and 2 decimals. */
const amount = z
  .string()
  .trim()
  .regex(/^\d{1,13}(\.\d{1,2})?$/, 'Amount must be a number with up to two decimals');

const percent = z
  .string()
  .trim()
  .regex(/^\d{1,3}(\.\d{1,2})?$/, 'Percent must be a number with up to two decimals')
  .refine((v) => Number(v) <= 100, 'Percent cannot be above 100');

const priceSchema = z.object({
  itemTypeId: z.string().uuid(),
  unitPrice: amount,
  currencyItemTypeId: z.string().uuid(),
  floorPrice: amount.nullable().optional(),
  note: z.string().max(500).nullable().optional(),
  isActive: z.boolean().optional(),
});
const priceUpdateSchema = priceSchema.partial().omit({ itemTypeId: true });

const addonSchema = z.object({
  name: z.string().trim().min(1, 'Give the add-on a name').max(80),
  price: amount,
  itemTypeId: z.string().uuid().nullable().optional(),
  sortOrder: z.number().int().min(0).max(1000).optional(),
  isActive: z.boolean().optional(),
});
const addonUpdateSchema = addonSchema.partial();

const partySchema = z.object({
  name: z.string().trim().min(1, 'Give the partner a name').max(80),
  discountPercent: percent.optional(),
  note: z.string().max(500).nullable().optional(),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/, 'Colour must be a hex value like #a855f7').nullable().optional(),
  icon: z.string().max(16).nullable().optional(),
  isActive: z.boolean().optional(),
});
const partyUpdateSchema = partySchema.partial();

const breakSchema = z.object({
  itemTypeId: z.string().uuid().nullable().optional(),
  minQuantity: amount,
  discountPercent: percent,
});
const breakUpdateSchema = breakSchema.partial();

const quoteSchema = z.object({
  counterpartyId: z.string().uuid().nullable().optional(),
  /** Quote in this currency, converting anything priced in another. */
  currencyItemTypeId: z.string().uuid().nullable().optional(),
  lines: z
    .array(z.object({
      itemTypeId: z.string().uuid(),
      quantity: amount,
      addonIds: z.array(z.string().uuid()).max(20).optional(),
    }))
    .min(1, 'Add something to quote')
    // A basket this long is a spreadsheet, not a deal at a counter, and the
    // cap keeps one request from pricing the entire item list.
    .max(50),
});

/**
 * May this viewer see what things cost the faction?
 *
 * Null means everybody who can open the screen. Otherwise it is a rank level,
 * and lower is higher: `2` shows margins to the Boss and the Underboss and to
 * nobody below them. A soldier working the counter does not need to know the
 * markup, and a screenshot from them should not reveal it.
 */
async function marginsVisible(id: string, req: Request): Promise<boolean> {
  const [faction] = await db
    .select({ level: factions.marginMinRankLevel })
    .from(factions)
    .where(eq(factions.id, id))
    .limit(1);
  if (faction?.level == null) return true;
  return (await viewerRankLevel(id, req)) <= faction.level;
}

/**
 * Everything a quote needs, loaded once.
 *
 * The costs are omitted entirely rather than blanked for viewers who may not
 * see them: a field that is absent cannot be read out of a response by
 * somebody who knows where to look.
 */
async function quoteContext(id: string, req: Request) {
  const [book, currencies, rates, canSeeMargins] = await Promise.all([
    loadPriceBook(id),
    loadCurrencies(id),
    loadRates(id),
    marginsVisible(id, req),
  ]);
  const extras: QuoteExtras = { rates };
  if (canSeeMargins) extras.costs = await loadCosts(id, book, rates);
  return { book, currencies, extras, canSeeMargins };
}

// ── GET / — the whole book, in one read ───────────────

router.get('/', async (req: Request, res: Response) => {
  const id = factionId(req);
  const [book, rates, canSeeMargins, faction] = await Promise.all([
    loadPriceBook(id),
    db.select({
      id: currencyRates.id,
      fromItemTypeId: currencyRates.fromItemTypeId,
      toItemTypeId: currencyRates.toItemTypeId,
      rate: currencyRates.rate,
    }).from(currencyRates).where(eq(currencyRates.factionId, id)),
    marginsVisible(id, req),
    db.select({ marginMinRankLevel: factions.marginMinRankLevel })
      .from(factions).where(eq(factions.id, id)).limit(1),
  ]);

  const costs = canSeeMargins
    ? await loadCosts(id, book, new Map(rates.map((r) => [`${r.fromItemTypeId}>${r.toItemTypeId}`, r.rate])))
    : new Map();

  success(res, {
    ...book,
    rates,
    canSeeMargins,
    marginMinRankLevel: faction[0]?.marginMinRankLevel ?? null,
    // Attached to the price rows the viewer may see them for, so the list can
    // show cost beside price without a second request.
    prices: book.prices.map((p) => ({
      ...p,
      ...(costs.get(p.itemTypeId)
        ? {
          unitCost: costs.get(p.itemTypeId)!.unitCost,
          costRecipeName: costs.get(p.itemTypeId)!.recipeName,
        }
        : {}),
    })),
  });
});

// ── PATCH /settings — who may see margins ─────────────

const settingsSchema = z.object({
  marginMinRankLevel: z.number().int().min(1).max(100).nullable(),
});

router.patch('/settings', requirePermission('manage_prices'), async (req: Request, res: Response) => {
  const body = settingsSchema.parse(req.body);
  const id = factionId(req);

  await db.update(factions)
    .set({ marginMinRankLevel: body.marginMinRankLevel })
    .where(eq(factions.id, id));

  await createAuditLog({
    userId: req.user!.id,
    factionId: id,
    action: 'update',
    entityType: 'faction_settings',
    entityId: id,
    details: { marginMinRankLevel: body.marginMinRankLevel },
    req,
  });

  success(res, { marginMinRankLevel: body.marginMinRankLevel });
});

// ── Prices ────────────────────────────────────────────

router.post('/prices', requirePermission('manage_prices'), async (req: Request, res: Response) => {
  const body = priceSchema.parse(req.body);
  const id = factionId(req);

  // Both ids have to be this faction's. Without the check, one faction could
  // price another faction's item type, and the price list would name an item
  // nobody in the faction can see.
  for (const itemId of [body.itemTypeId, body.currencyItemTypeId]) {
    if (!await ownsItemType(id, itemId)) {
      error(res, 'NOT_FOUND', 'That item type is not this faction\'s', 404);
      return;
    }
  }

  const [existing] = await db
    .select({ id: productPrices.id })
    .from(productPrices)
    .where(and(eq(productPrices.factionId, id), eq(productPrices.itemTypeId, body.itemTypeId)))
    .limit(1);
  if (existing) {
    error(res, 'VALIDATION_ERROR', 'That item already has a price. Edit the one it has.', 409);
    return;
  }

  const [row] = await db
    .insert(productPrices)
    .values({
      factionId: id,
      itemTypeId: body.itemTypeId,
      unitPrice: body.unitPrice,
      currencyItemTypeId: body.currencyItemTypeId,
      floorPrice: body.floorPrice ?? null,
      note: body.note ?? null,
      isActive: body.isActive ?? true,
      updatedBy: req.user!.id,
    })
    .returning();

  await createAuditLog({
    userId: req.user!.id,
    factionId: id,
    action: 'create',
    entityType: 'product_price',
    entityId: row!.id,
    details: { itemTypeId: body.itemTypeId, unitPrice: body.unitPrice },
    req,
  });

  success(res, row, 201);
});

router.patch('/prices/:priceId', requirePermission('manage_prices'), async (req: Request, res: Response) => {
  const body = priceUpdateSchema.parse(req.body);
  const id = factionId(req);

  const [current] = await db
    .select()
    .from(productPrices)
    .where(and(eq(productPrices.id, (req.params.priceId as string)), eq(productPrices.factionId, id)))
    .limit(1);
  if (!current) {
    error(res, 'NOT_FOUND', 'Price not found', 404);
    return;
  }

  if (body.currencyItemTypeId && !await ownsItemType(id, body.currencyItemTypeId)) {
    error(res, 'NOT_FOUND', 'That currency is not this faction\'s', 404);
    return;
  }

  const [row] = await db
    .update(productPrices)
    .set({
      ...(body.unitPrice !== undefined ? { unitPrice: body.unitPrice } : {}),
      ...(body.currencyItemTypeId !== undefined ? { currencyItemTypeId: body.currencyItemTypeId } : {}),
      ...(body.floorPrice !== undefined ? { floorPrice: body.floorPrice } : {}),
      ...(body.note !== undefined ? { note: body.note } : {}),
      ...(body.isActive !== undefined ? { isActive: body.isActive } : {}),
      updatedBy: req.user!.id,
      updatedAt: new Date(),
    })
    .where(eq(productPrices.id, current.id))
    .returning();

  await createAuditLog({
    userId: req.user!.id,
    factionId: id,
    action: 'update',
    entityType: 'product_price',
    entityId: current.id,
    // The old price alongside the new one: "who dropped the pistol price" is
    // the question this log exists to answer.
    details: { from: current.unitPrice, to: row!.unitPrice },
    req,
  });

  success(res, row);
});

router.delete('/prices/:priceId', requirePermission('manage_prices'), async (req: Request, res: Response) => {
  const id = factionId(req);
  const [row] = await db
    .delete(productPrices)
    .where(and(eq(productPrices.id, (req.params.priceId as string)), eq(productPrices.factionId, id)))
    .returning();
  if (!row) {
    error(res, 'NOT_FOUND', 'Price not found', 404);
    return;
  }

  await createAuditLog({
    userId: req.user!.id,
    factionId: id,
    action: 'delete',
    entityType: 'product_price',
    entityId: row.id,
    details: { itemTypeId: row.itemTypeId, unitPrice: row.unitPrice },
    req,
  });

  success(res, { deleted: true });
});

// ── Add-ons ───────────────────────────────────────────

/** The price this add-on hangs off, if it is this faction's. */
async function ownPrice(id: string, priceId: string) {
  const [row] = await db
    .select()
    .from(productPrices)
    .where(and(eq(productPrices.id, priceId), eq(productPrices.factionId, id)))
    .limit(1);
  return row ?? null;
}

router.post('/prices/:priceId/addons', requirePermission('manage_prices'), async (req: Request, res: Response) => {
  const body = addonSchema.parse(req.body);
  const id = factionId(req);

  const price = await ownPrice(id, (req.params.priceId as string));
  if (!price) {
    error(res, 'NOT_FOUND', 'Price not found', 404);
    return;
  }
  if (body.itemTypeId && !await ownsItemType(id, body.itemTypeId)) {
    error(res, 'NOT_FOUND', 'That item type is not this faction\'s', 404);
    return;
  }

  const [row] = await db
    .insert(productAddons)
    .values({
      productPriceId: price.id,
      name: body.name,
      price: body.price,
      itemTypeId: body.itemTypeId ?? null,
      sortOrder: body.sortOrder ?? 0,
      isActive: body.isActive ?? true,
    })
    .returning();

  await createAuditLog({
    userId: req.user!.id,
    factionId: id,
    action: 'create',
    entityType: 'product_addon',
    entityId: row!.id,
    details: { name: body.name, price: body.price },
    req,
  });

  success(res, row, 201);
});

router.patch('/addons/:addonId', requirePermission('manage_prices'), async (req: Request, res: Response) => {
  const body = addonUpdateSchema.parse(req.body);
  const id = factionId(req);

  // The join is the authorization: an add-on reaches this faction only through
  // a price row that belongs to it.
  const [found] = await db
    .select({ addon: productAddons })
    .from(productAddons)
    .innerJoin(productPrices, eq(productAddons.productPriceId, productPrices.id))
    .where(and(eq(productAddons.id, (req.params.addonId as string)), eq(productPrices.factionId, id)))
    .limit(1);
  if (!found) {
    error(res, 'NOT_FOUND', 'Add-on not found', 404);
    return;
  }

  if (body.itemTypeId && !await ownsItemType(id, body.itemTypeId)) {
    error(res, 'NOT_FOUND', 'That item type is not this faction\'s', 404);
    return;
  }

  const [row] = await db
    .update(productAddons)
    .set({
      ...(body.name !== undefined ? { name: body.name } : {}),
      ...(body.price !== undefined ? { price: body.price } : {}),
      ...(body.itemTypeId !== undefined ? { itemTypeId: body.itemTypeId } : {}),
      ...(body.sortOrder !== undefined ? { sortOrder: body.sortOrder } : {}),
      ...(body.isActive !== undefined ? { isActive: body.isActive } : {}),
    })
    .where(eq(productAddons.id, found.addon.id))
    .returning();

  success(res, row);
});

router.delete('/addons/:addonId', requirePermission('manage_prices'), async (req: Request, res: Response) => {
  const id = factionId(req);
  const [found] = await db
    .select({ addon: productAddons })
    .from(productAddons)
    .innerJoin(productPrices, eq(productAddons.productPriceId, productPrices.id))
    .where(and(eq(productAddons.id, (req.params.addonId as string)), eq(productPrices.factionId, id)))
    .limit(1);
  if (!found) {
    error(res, 'NOT_FOUND', 'Add-on not found', 404);
    return;
  }

  await db.delete(productAddons).where(eq(productAddons.id, found.addon.id));
  success(res, { deleted: true });
});

// ── Counterparties ────────────────────────────────────

router.post('/counterparties', requirePermission('manage_prices'), async (req: Request, res: Response) => {
  const body = partySchema.parse(req.body);
  const id = factionId(req);

  const [existing] = await db
    .select({ id: counterparties.id })
    .from(counterparties)
    .where(and(eq(counterparties.factionId, id), eq(counterparties.name, body.name)))
    .limit(1);
  if (existing) {
    error(res, 'VALIDATION_ERROR', 'A partner by that name already exists.', 409);
    return;
  }

  const [row] = await db
    .insert(counterparties)
    .values({
      factionId: id,
      name: body.name,
      discountPercent: body.discountPercent ?? '0',
      note: body.note ?? null,
      color: body.color ?? null,
      icon: body.icon ?? null,
      isActive: body.isActive ?? true,
      createdBy: req.user!.id,
    })
    .returning();

  await createAuditLog({
    userId: req.user!.id,
    factionId: id,
    action: 'create',
    entityType: 'counterparty',
    entityId: row!.id,
    details: { name: body.name, discountPercent: row!.discountPercent },
    req,
  });

  success(res, row, 201);
});

router.patch('/counterparties/:partyId', requirePermission('manage_prices'), async (req: Request, res: Response) => {
  const body = partyUpdateSchema.parse(req.body);
  const id = factionId(req);

  const [current] = await db
    .select()
    .from(counterparties)
    .where(and(eq(counterparties.id, (req.params.partyId as string)), eq(counterparties.factionId, id)))
    .limit(1);
  if (!current) {
    error(res, 'NOT_FOUND', 'Partner not found', 404);
    return;
  }

  const [row] = await db
    .update(counterparties)
    .set({
      ...(body.name !== undefined ? { name: body.name } : {}),
      ...(body.discountPercent !== undefined ? { discountPercent: body.discountPercent } : {}),
      ...(body.note !== undefined ? { note: body.note } : {}),
      ...(body.color !== undefined ? { color: body.color } : {}),
      ...(body.icon !== undefined ? { icon: body.icon } : {}),
      ...(body.isActive !== undefined ? { isActive: body.isActive } : {}),
      updatedAt: new Date(),
    })
    .where(eq(counterparties.id, current.id))
    .returning();

  await createAuditLog({
    userId: req.user!.id,
    factionId: id,
    action: 'update',
    entityType: 'counterparty',
    entityId: current.id,
    details: { from: current.discountPercent, to: row!.discountPercent },
    req,
  });

  success(res, row);
});

router.delete('/counterparties/:partyId', requirePermission('manage_prices'), async (req: Request, res: Response) => {
  const id = factionId(req);
  const [row] = await db
    .delete(counterparties)
    .where(and(eq(counterparties.id, (req.params.partyId as string)), eq(counterparties.factionId, id)))
    .returning();
  if (!row) {
    error(res, 'NOT_FOUND', 'Partner not found', 404);
    return;
  }

  await createAuditLog({
    userId: req.user!.id,
    factionId: id,
    action: 'delete',
    entityType: 'counterparty',
    entityId: row.id,
    details: { name: row.name },
    req,
  });

  success(res, { deleted: true });
});

// ── Quantity breaks ───────────────────────────────────

router.post('/breaks', requirePermission('manage_prices'), async (req: Request, res: Response) => {
  const body = breakSchema.parse(req.body);
  const id = factionId(req);

  if (body.itemTypeId && !await ownsItemType(id, body.itemTypeId)) {
    error(res, 'NOT_FOUND', 'That item type is not this faction\'s', 404);
    return;
  }

  try {
    const [row] = await db
      .insert(quantityBreaks)
      .values({
        factionId: id,
        itemTypeId: body.itemTypeId ?? null,
        minQuantity: body.minQuantity,
        discountPercent: body.discountPercent,
      })
      .returning();
    success(res, row, 201);
  } catch {
    // The unique indexes are the real guard — checking first and inserting
    // after would race two people adding the same rung.
    error(res, 'VALIDATION_ERROR', 'A rung already starts at that quantity.', 409);
  }
});

router.patch('/breaks/:breakId', requirePermission('manage_prices'), async (req: Request, res: Response) => {
  const body = breakUpdateSchema.parse(req.body);
  const id = factionId(req);

  const [current] = await db
    .select()
    .from(quantityBreaks)
    .where(and(eq(quantityBreaks.id, (req.params.breakId as string)), eq(quantityBreaks.factionId, id)))
    .limit(1);
  if (!current) {
    error(res, 'NOT_FOUND', 'Quantity break not found', 404);
    return;
  }

  if (body.itemTypeId && !await ownsItemType(id, body.itemTypeId)) {
    error(res, 'NOT_FOUND', 'That item type is not this faction\'s', 404);
    return;
  }

  try {
    const [row] = await db
      .update(quantityBreaks)
      .set({
        ...(body.itemTypeId !== undefined ? { itemTypeId: body.itemTypeId } : {}),
        ...(body.minQuantity !== undefined ? { minQuantity: body.minQuantity } : {}),
        ...(body.discountPercent !== undefined ? { discountPercent: body.discountPercent } : {}),
      })
      .where(eq(quantityBreaks.id, current.id))
      .returning();
    success(res, row);
  } catch {
    error(res, 'VALIDATION_ERROR', 'A rung already starts at that quantity.', 409);
  }
});

router.delete('/breaks/:breakId', requirePermission('manage_prices'), async (req: Request, res: Response) => {
  const id = factionId(req);
  const [row] = await db
    .delete(quantityBreaks)
    .where(and(eq(quantityBreaks.id, (req.params.breakId as string)), eq(quantityBreaks.factionId, id)))
    .returning();
  if (!row) {
    error(res, 'NOT_FOUND', 'Quantity break not found', 404);
    return;
  }
  success(res, { deleted: true });
});

// ── POST /quote — price a basket ──────────────────────
//
// A POST that changes nothing, because the basket is too big for a query
// string and too structured to flatten into one. Open to every member: it
// reads the same price list they can already read.

router.post('/quote', async (req: Request, res: Response) => {
  const body = quoteSchema.parse(req.body);
  const id = factionId(req);

  const { book, currencies, extras } = await quoteContext(id, req);
  const result = computeQuote(body, book, currencies, extras);

  if (!result.ok) {
    error(res, result.error.code === 'NOT_PRICED' ? 'NOT_FOUND' : 'VALIDATION_ERROR',
      result.error.message,
      result.error.code === 'NOT_PRICED' ? 404 : 400);
    return;
  }

  success(res, result.quote);
});

// ── Exchange rates ────────────────────────────────────
//
// Directional and never inverted automatically. A row says dirty → clean;
// quoting the other way needs its own row. Deriving the reverse as 1/rate
// looks helpful and produces a number the faction never agreed to — rates here
// are rarely symmetric, because washing money takes a cut.

const rateSchema = z.object({
  fromItemTypeId: z.string().uuid(),
  toItemTypeId: z.string().uuid(),
  rate: z.string().trim()
    .regex(/^\d{1,12}(\.\d{1,6})?$/, 'Rate must be a number with up to six decimals')
    .refine((v) => Number(v) > 0, 'Rate must be above zero'),
});

router.put('/rates', requirePermission('manage_prices'), async (req: Request, res: Response) => {
  const body = rateSchema.parse(req.body);
  const id = factionId(req);

  if (body.fromItemTypeId === body.toItemTypeId) {
    error(res, 'VALIDATION_ERROR', 'A currency is always worth one of itself.', 400);
    return;
  }
  for (const itemId of [body.fromItemTypeId, body.toItemTypeId]) {
    if (!await ownsItemType(id, itemId)) {
      error(res, 'NOT_FOUND', 'That currency is not this faction\'s', 404);
      return;
    }
  }

  // Upsert: a faction editing a rate is changing the one deal, not keeping a
  // history of what dirty money used to be worth.
  const [row] = await db
    .insert(currencyRates)
    .values({
      factionId: id,
      fromItemTypeId: body.fromItemTypeId,
      toItemTypeId: body.toItemTypeId,
      rate: body.rate,
      updatedBy: req.user!.id,
    })
    .onConflictDoUpdate({
      target: [currencyRates.factionId, currencyRates.fromItemTypeId, currencyRates.toItemTypeId],
      set: { rate: body.rate, updatedBy: req.user!.id, updatedAt: new Date() },
    })
    .returning();

  await createAuditLog({
    userId: req.user!.id,
    factionId: id,
    action: 'update',
    entityType: 'currency_rate',
    entityId: row!.id,
    details: { from: body.fromItemTypeId, to: body.toItemTypeId, rate: body.rate },
    req,
  });

  success(res, row);
});

router.delete('/rates/:rateId', requirePermission('manage_prices'), async (req: Request, res: Response) => {
  const id = factionId(req);
  const [row] = await db
    .delete(currencyRates)
    .where(and(eq(currencyRates.id, req.params.rateId as string), eq(currencyRates.factionId, id)))
    .returning();
  if (!row) {
    error(res, 'NOT_FOUND', 'Rate not found', 404);
    return;
  }
  success(res, { deleted: true });
});

// ── Sales — the quote, booked ─────────────────────────
//
// Phase 2. Pressing Sold turns the basket into ledger rows: the payment as one
// entry, each item handed over as a completed payout. Nothing here invents a
// new kind of money, so every balance, report and export in the app counts a
// sale correctly without knowing that sales exist.
//
// The figures are recomputed here from the price list rather than taken from
// the request. The browser is welcome to display a total; it is not allowed to
// decide one, or a seller with devtools could book any number they liked.

const saleSchema = quoteSchema.extend({
  notes: z.string().max(500).optional(),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Date must be YYYY-MM-DD').optional(),
  creditSaleTo: z.enum(CREDIT_SALE_TO).optional(),
});

router.post('/sales', requirePermission('sell'), async (req: Request, res: Response) => {
  const body = saleSchema.parse(req.body);
  const id = factionId(req);

  // Margins never reach this response — a sale books money, and what the
  // faction made on it is a separate question with its own rank behind it.
  const [book, currencies, rates] = await Promise.all([
    loadPriceBook(id), loadCurrencies(id), loadRates(id),
  ]);
  const computed = computeQuote(body, book, currencies, { rates });
  if (!computed.ok) {
    error(res, computed.error.code === 'NOT_PRICED' ? 'NOT_FOUND' : 'VALIDATION_ERROR',
      computed.error.message,
      computed.error.code === 'NOT_PRICED' ? 404 : 400);
    return;
  }
  const quote = computed.quote;

  const saleDate = body.date ?? todayDateString();
  const creditSaleTo = body.creditSaleTo ?? 'nobody';
  const note = body.notes?.trim()
    || (quote.counterparty ? `Sold to ${quote.counterparty.name}` : 'Sold');

  const result = await db.transaction(async (tx: TransactionLike) => {
    // Everything the sale touches: the money coming in, the goods going out,
    // and any add-on that is itself stock.
    const touched = new Set<string>([quote.currency.itemTypeId]);
    for (const line of quote.lines) {
      touched.add(line.itemTypeId);
      for (const addon of line.addons) {
        const stocked = book.prices
          .find((p) => p.itemTypeId === line.itemTypeId)?.addons
          .find((a) => a.id === addon.id)?.itemTypeId;
        if (stocked) touched.add(stocked);
      }
    }
    await lockItemTypes(tx, [...touched]);

    const [sale] = await tx
      .insert(sales)
      .values({
        factionId: id,
        counterpartyId: quote.counterparty?.id ?? null,
        counterpartyName: quote.counterparty?.name ?? null,
        counterpartyDiscountPercent: quote.counterparty?.discountPercent ?? '0',
        currencyItemTypeId: quote.currency.itemTypeId,
        subtotal: quote.subtotal,
        discountTotal: quote.discountTotal,
        total: quote.total,
        creditSaleTo,
        soldBy: req.user!.id,
        saleDate,
        notes: body.notes?.trim() || null,
      })
      .returning();
    if (!sale) throw new Error('Failed to record the sale');

    const anonymousUserId = await resolveAnonymousUserId(tx);
    // Whose entry the payment is. `nobody` keeps selling off the leaderboards
    // the way laundering is kept off; `seller` is for factions where working
    // the counter is the contribution being measured.
    const paymentOwner = creditSaleTo === 'seller' ? req.user!.id : anonymousUserId;

    const movements: (typeof saleMovements.$inferInsert)[] = [];

    // The payment in. A sale given away entirely — a partner at 100% — books
    // no entry, because a zero-amount row on the treasury screen reads as a
    // mistake rather than as a gift.
    if (toCents(quote.total) > 0n) {
      const [entry] = await tx
        .insert(entries)
        .values({
          factionId: id,
          userId: paymentOwner,
          itemTypeId: quote.currency.itemTypeId,
          amount: quote.total,
          description: note,
          entryDate: saleDate,
        })
        .returning();
      if (!entry) throw new Error('Failed to record the payment');
      movements.push({
        saleId: sale.id,
        role: 'money_in',
        itemTypeId: quote.currency.itemTypeId,
        quantity: quote.total,
        entryId: entry.id,
      });
    }

    // The goods out, as completed payouts against the placeholder: they left
    // the vault the moment they changed hands, and no member received them.
    const handOver = async (itemTypeId: string, quantity: string, description: string) => {
      const [payout] = await tx
        .insert(payouts)
        .values({
          factionId: id,
          recipientUserId: anonymousUserId,
          createdBy: req.user!.id,
          itemTypeId,
          amount: quantity,
          description,
          payoutDate: saleDate,
          status: 'completed',
        })
        .returning();
      if (!payout) throw new Error('Failed to record the goods sold');
      movements.push({ saleId: sale.id, role: 'goods_out', itemTypeId, quantity, payoutId: payout.id });
    };

    for (const line of quote.lines) {
      const priceRow = book.prices.find((p) => p.itemTypeId === line.itemTypeId)!;
      await tx.insert(saleLines).values({
        saleId: sale.id,
        itemTypeId: line.itemTypeId,
        itemTypeName: line.itemTypeName,
        quantity: line.quantity,
        unitPrice: line.unitPrice,
        addons: line.addons.map((a) => ({
          name: a.name,
          price: a.price,
          itemTypeId: priceRow.addons.find((x) => x.id === a.id)?.itemTypeId ?? null,
        })),
        discountPercent: line.discountPercent,
        gross: line.gross,
        discount: line.discount,
        total: line.total,
      });

      await handOver(line.itemTypeId, line.quantity, `${note} — ${line.itemTypeName}`);

      // An add-on that is itself stock leaves the vault too. One that is pure
      // margin ("engraved", "delivered") is only ever a number on the receipt.
      for (const addon of line.addons) {
        const stocked = priceRow.addons.find((a) => a.id === addon.id)?.itemTypeId;
        if (stocked) await handOver(stocked, line.quantity, `${note} — ${addon.name}`);
      }
    }

    await tx.insert(saleMovements).values(movements);

    // What the vault now holds of everything that went out. Reported, not
    // enforced: selling from a personal stash before the treasury catches up
    // is ordinary, and a till that refuses the sale in front of the buyer is
    // worse than one that says the books are behind.
    const goods = movements.filter((m) => m.role === 'goods_out');
    const balances = await balancesFor(id, [...new Set(goods.map((m) => m.itemTypeId))], tx);
    const shortfalls = goods
      .filter((m) => compareQuantity(balances.get(m.itemTypeId) ?? '0', '0') < 0)
      .map((m) => ({
        itemTypeId: m.itemTypeId,
        itemTypeName: currencies.get(m.itemTypeId)?.name ?? 'that item',
        available: balances.get(m.itemTypeId) ?? '0',
      }));

    await createAuditLog({
      userId: req.user!.id,
      factionId: id,
      action: 'create',
      entityType: 'sale',
      entityId: sale.id,
      details: {
        counterparty: quote.counterparty?.name ?? null,
        total: quote.total,
        creditSaleTo,
        lines: quote.lines.map((l) => ({
          itemTypeName: l.itemTypeName, quantity: l.quantity, total: l.total,
        })),
      },
      req,
      tx,
    });

    return { sale, shortfalls };
  });

  success(res, { sale: result.sale, quote, shortfalls: result.shortfalls }, 201);
});

// ── GET /sales — what has been sold ───────────────────

router.get('/sales', async (req: Request, res: Response) => {
  const id = factionId(req);
  const limit = Math.min(Number(req.query.limit) || 50, 200);

  const rows = await db
    .select({
      id: sales.id,
      counterpartyName: sales.counterpartyName,
      counterpartyDiscountPercent: sales.counterpartyDiscountPercent,
      currencyItemTypeId: sales.currencyItemTypeId,
      currencyName: itemTypes.name,
      currencyUnit: itemTypes.unit,
      currencyIsCurrency: itemTypes.isCurrency,
      subtotal: sales.subtotal,
      discountTotal: sales.discountTotal,
      total: sales.total,
      creditSaleTo: sales.creditSaleTo,
      saleDate: sales.saleDate,
      notes: sales.notes,
      soldBy: sales.soldBy,
      sellerName: sql<string>`COALESCE(${users.inGameName}, ${users.username})`,
      revertedAt: sales.revertedAt,
      createdAt: sales.createdAt,
    })
    .from(sales)
    .innerJoin(users, eq(sales.soldBy, users.id))
    .innerJoin(itemTypes, eq(sales.currencyItemTypeId, itemTypes.id))
    .where(eq(sales.factionId, id))
    .orderBy(desc(sales.createdAt))
    .limit(limit);

  const ids = rows.map((r) => r.id);
  const lines = ids.length
    ? await db.select().from(saleLines).where(inArray(saleLines.saleId, ids))
    : [];

  success(res, {
    sales: rows.map((r) => ({ ...r, lines: lines.filter((l) => l.saleId === r.id) })),
  });
});

// ── POST /sales/:saleId/revert — take it back ─────────
//
// Reverting needs `manage_prices` rather than `sell`, mirroring crafting: the
// till books, leadership unbooks. A revert moves money back out of the vault,
// and that is not the same authority as taking money in.

router.post('/sales/:saleId/revert', requirePermission('manage_prices'), async (req: Request, res: Response) => {
  const id = factionId(req);
  const saleId = req.params.saleId as string;

  let outcome: { ok: true } | { ok: false; code: 'NOT_FOUND' | 'ALREADY' | 'OVERSPENT'; message: string };

  outcome = await db.transaction(async (tx: TransactionLike) => {
    const [sale] = await tx
      .select()
      .from(sales)
      .where(and(eq(sales.id, saleId), eq(sales.factionId, id)))
      .limit(1)
      .for('update');

    if (!sale) return { ok: false as const, code: 'NOT_FOUND' as const, message: 'Sale not found' };
    if (sale.revertedAt) {
      return { ok: false as const, code: 'ALREADY' as const, message: 'That sale has already been reverted.' };
    }

    const moves = await tx.select().from(saleMovements).where(eq(saleMovements.saleId, saleId));
    await lockItemTypes(tx, [...new Set(moves.map((m) => m.itemTypeId))]);

    // Returning the goods is free; taking the payment back out is not. If the
    // faction has already spent what the sale brought in, undoing it would
    // drive that balance below zero — a real state the app allows, but never
    // one it should enter by accident on a correction.
    const payment = moves.filter((m) => m.role === 'money_in');
    if (payment.length > 0) {
      const balances = await balancesFor(id, [sale.currencyItemTypeId], tx);
      const have = balances.get(sale.currencyItemTypeId) ?? '0';
      if (compareQuantity(have, sale.total) < 0) {
        return {
          ok: false as const,
          code: 'OVERSPENT' as const,
          message: `Reverting needs ${sale.total} back out and the treasury holds ${have}.`,
        };
      }
    }

    const entryIds = moves.map((m) => m.entryId).filter((x): x is string => !!x);
    const payoutIds = moves.map((m) => m.payoutId).filter((x): x is string => !!x);

    // Soft-deleted, not removed: the ledger keeps saying what happened, and
    // every balance query in the app already ignores `is_deleted` rows.
    if (entryIds.length) {
      await tx.update(entries)
        .set({ isDeleted: true, updatedAt: new Date() })
        .where(inArray(entries.id, entryIds));
    }
    if (payoutIds.length) {
      await tx.update(payouts)
        .set({ isDeleted: true, updatedAt: new Date() })
        .where(inArray(payouts.id, payoutIds));
    }

    await tx.update(sales)
      .set({ revertedAt: new Date(), revertedBy: req.user!.id })
      .where(eq(sales.id, saleId));

    await createAuditLog({
      userId: req.user!.id,
      factionId: id,
      action: 'delete',
      entityType: 'sale',
      entityId: saleId,
      details: { total: sale.total, counterparty: sale.counterpartyName },
      req,
      tx,
    });

    return { ok: true as const };
  });

  if (!outcome.ok) {
    error(res, outcome.code === 'NOT_FOUND' ? 'NOT_FOUND' : 'VALIDATION_ERROR',
      outcome.message, outcome.code === 'NOT_FOUND' ? 404 : 400);
    return;
  }

  success(res, { reverted: true });
});

export default router;
