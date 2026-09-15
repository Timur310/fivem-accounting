import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { and, eq } from 'drizzle-orm';
import { db } from '../db/index.js';
import {
  counterparties,
  itemTypes,
  productAddons,
  productPrices,
  quantityBreaks,
} from '../db/schema.js';
import { success, error } from '../lib/response.js';
import { requireAuth } from '../middleware/auth.js';
import { requireFactionMember, requirePermission } from '../middleware/factionAccess.js';
import { createAuditLog } from '../lib/audit.js';
import {
  computeQuote, loadCurrencies, loadPriceBook, ownsItemType,
} from '../lib/pricing.js';

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
const router = Router({ mergeParams: true });

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

// ── GET / — the whole book, in one read ───────────────

router.get('/', async (req: Request, res: Response) => {
  const book = await loadPriceBook(factionId(req));
  success(res, book);
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

  const [book, currencies] = await Promise.all([loadPriceBook(id), loadCurrencies(id)]);
  const result = computeQuote(body, book, currencies);

  if (!result.ok) {
    error(res, result.error.code === 'NOT_PRICED' ? 'NOT_FOUND' : 'VALIDATION_ERROR',
      result.error.message,
      result.error.code === 'NOT_PRICED' ? 404 : 400);
    return;
  }

  success(res, result.quote);
});

export default router;
