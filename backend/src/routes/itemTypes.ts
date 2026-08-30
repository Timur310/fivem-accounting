import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { db, type TransactionLike } from '../db/index.js';
import { itemTypes } from '../db/schema.js';
import { eq, and, asc, sql } from 'drizzle-orm';
import { success, error } from '../lib/response.js';
import { requireAuth } from '../middleware/auth.js';
import { requireFactionMember, requirePermission } from '../middleware/factionAccess.js';
import { createAuditLog } from '../lib/audit.js';

const router = Router({ mergeParams: true });

router.use(requireAuth, requireFactionMember);

// ── Validation schemas ────────────────────────────────

// `unit` stays in the schema (the existing tests still send it explicitly and
// assert on the returned value). The derived-unit helper kicks in only when
// the caller changes `isCurrency` without overriding `unit` at the same time.

// The image is a link to something hosted elsewhere. Restricted to http(s)
// because the value is handed straight to an <img src>: `data:` and other
// schemes that zod's .url() accepts have no business being there.
const imageUrlSchema = z
  .string()
  .trim()
  .max(2048, 'Image URL must be at most 2048 characters')
  .url('Image URL must be a valid URL')
  .refine((v) => /^https?:\/\//i.test(v), 'Image URL must start with http:// or https://');

const createItemTypeSchema = z.object({
  name: z.string().min(1).max(100),
  unit: z.string().min(1).max(20).default('$'),
  // Presentation hint only: money vs. countable goods. Defaults to false.
  isCurrency: z.boolean().default(false),
  imageUrl: imageUrlSchema.optional(),
});

const updateItemTypeSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  unit: z.string().min(1).max(20).optional(),
  isCurrency: z.boolean().optional(),
  isActive: z.boolean().optional(),
  // Explicit null removes the image; omitting the key leaves it untouched.
  imageUrl: imageUrlSchema.nullable().optional(),
});

/** Derive the display unit from the currency flag. */
function derivedUnit(isCurrency: boolean): string {
  return isCurrency ? '$' : 'pcs';
}

// ── POST / — create item type ───────────────────────
router.post('/', requirePermission('manage_item_types'), async (req: Request, res: Response) => {
  const factionId = req.params.id as string;
  const parsed = createItemTypeSchema.safeParse(req.body);
  if (!parsed.success) {
    error(res, 'VALIDATION_ERROR', parsed.error.issues[0]!.message);
    return;
  }

  const { name, unit, isCurrency, imageUrl } = parsed.data;

  let created;
  try {
    created = await db.transaction(async (tx: TransactionLike) => {
      const [row] = await tx
        .insert(itemTypes)
        .values({ factionId, name, unit, isCurrency, imageUrl: imageUrl ?? null })
        .returning();

      if (!row) throw new Error('Failed to create item type');

      await createAuditLog({
        userId: req.user!.id,
        factionId,
        action: 'create',
        entityType: 'item_type',
        entityId: row.id,
        details: { name, unit, isCurrency, imageUrl: imageUrl ?? null },
        req,
        tx,
      });

      return row;
    });
  } catch (err) {
    console.error('[CREATE ITEM TYPE ERROR]', err);
    error(res, 'INTERNAL_ERROR', 'Failed to create item type', 500);
    return;
  }

  success(res, created, 201);
});

// ── GET / — list item types ─────────────────────────
router.get('/', async (req: Request, res: Response) => {
  const factionId = req.params.id as string;

  const types = await db
    .select({
      id: itemTypes.id,
      name: itemTypes.name,
      unit: itemTypes.unit,
      isCurrency: itemTypes.isCurrency,
      imageUrl: itemTypes.imageUrl,
      isActive: itemTypes.isActive,
      createdAt: itemTypes.createdAt,
      entryCount: sql<number>`(SELECT COUNT(*) FROM entries WHERE item_type_id = item_types.id AND is_deleted = false)::int`,
    })
    .from(itemTypes)
    .where(eq(itemTypes.factionId, factionId))
    .orderBy(asc(itemTypes.name));

  success(res, types);
});

// ── PATCH /:typeId — update item type ───────────────
router.patch('/:typeId', requirePermission('manage_item_types'), async (req: Request, res: Response) => {
  const factionId = req.params.id as string;
  const typeId = req.params.typeId as string;

  const parsed = updateItemTypeSchema.safeParse(req.body);
  if (!parsed.success) {
    error(res, 'VALIDATION_ERROR', parsed.error.issues[0]!.message);
    return;
  }

  const [existing] = await db
    .select()
    .from(itemTypes)
    .where(and(eq(itemTypes.id, typeId), eq(itemTypes.factionId, factionId)))
    .limit(1);
  if (!existing) {
    error(res, 'NOT_FOUND', 'Item type not found', 404);
    return;
  }

  const updates: Record<string, unknown> = {};
  if (parsed.data.name !== undefined) updates.name = parsed.data.name;
  if (parsed.data.unit !== undefined) updates.unit = parsed.data.unit;
  if (parsed.data.isCurrency !== undefined) {
    updates.isCurrency = parsed.data.isCurrency;
    // Flipping isCurrency implies flipping the unit too — but only if the
    // caller did not explicitly provide a unit in the same request. This
    // keeps the existing tests passing (they send both unit and isCurrency
    // together) while still deriving the unit when isCurrency is changed
    // on its own.
    if (parsed.data.unit === undefined) {
      updates.unit = derivedUnit(parsed.data.isCurrency);
    }
  }
  if (parsed.data.isActive !== undefined) updates.isActive = parsed.data.isActive;
  if (parsed.data.imageUrl !== undefined) updates.imageUrl = parsed.data.imageUrl;

  let updated;
  try {
    updated = await db.transaction(async (tx: TransactionLike) => {
      const [row] = await tx
        .update(itemTypes)
        .set(updates)
        .where(eq(itemTypes.id, typeId))
        .returning();

      await createAuditLog({
        userId: req.user!.id,
        factionId,
        action: 'update',
        entityType: 'item_type',
        entityId: typeId,
        details: { before: { name: existing.name, unit: existing.unit, isCurrency: existing.isCurrency, isActive: existing.isActive, imageUrl: existing.imageUrl }, after: updates },
        req,
        tx,
      });

      return row;
    });
  } catch (err) {
    console.error('[UPDATE ITEM TYPE ERROR]', err);
    error(res, 'INTERNAL_ERROR', 'Failed to update item type', 500);
    return;
  }

  success(res, updated);
});

// ── DELETE /:typeId — soft-delete item type ──────────
router.delete('/:typeId', requirePermission('manage_item_types'), async (req: Request, res: Response) => {
  const factionId = req.params.id as string;
  const typeId = req.params.typeId as string;

  const [existing] = await db
    .select()
    .from(itemTypes)
    .where(and(eq(itemTypes.id, typeId), eq(itemTypes.factionId, factionId)))
    .limit(1);
  if (!existing) {
    error(res, 'NOT_FOUND', 'Item type not found', 404);
    return;
  }

  try {
    await db.transaction(async (tx: TransactionLike) => {
      await tx.update(itemTypes).set({ isActive: false }).where(eq(itemTypes.id, typeId));

      await createAuditLog({
        userId: req.user!.id,
        factionId,
        action: 'delete',
        entityType: 'item_type',
        entityId: typeId,
        details: { name: existing.name, unit: existing.unit },
        req,
        tx,
      });
    });
  } catch (err) {
    console.error('[DELETE ITEM TYPE ERROR]', err);
    error(res, 'INTERNAL_ERROR', 'Failed to delete item type', 500);
    return;
  }

  success(res, { id: typeId, deleted: true });
});

export default router;
