import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { db } from '../db/index.js';
import { itemTypes } from '../db/schema.js';
import { eq, and, desc, sql, asc } from 'drizzle-orm';
import { success, error } from '../lib/response.js';
import { requireAuth } from '../middleware/auth.js';
import { requireFactionMember, requirePermission } from '../middleware/factionAccess.js';
import { createAuditLog } from '../lib/audit.js';

const router = Router({ mergeParams: true });

router.use(requireAuth, requireFactionMember);

// ── Validation schemas ────────────────────────────────

// The unit symbol is derived from `isCurrency` rather than user-supplied:
// currency item types always read "$", countable goods always read "pcs".
// This keeps the UI consistent — there's no way to end up with "Dirty Money"
// tracked in "kg" by accident.
const createItemTypeSchema = z.object({
  name: z.string().min(1).max(100),
  // Presentation hint only: money vs. countable goods. Defaults to false.
  isCurrency: z.boolean().default(false),
});

const updateItemTypeSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  isCurrency: z.boolean().optional(),
  isActive: z.boolean().optional(),
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

  const { name, isCurrency } = parsed.data;
  const unit = derivedUnit(isCurrency);

  const [created] = await db
    .insert(itemTypes)
    .values({ factionId, name, unit, isCurrency })
    .returning();

  if (!created) {
    error(res, 'INTERNAL_ERROR', 'Failed to create item type', 500);
    return;
  }

  await createAuditLog({
    userId: req.user!.id,
    factionId,
    action: 'create',
    entityType: 'item_type',
    entityId: created.id,
    details: { name, unit, isCurrency },
    req,
  });

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
  if (parsed.data.isCurrency !== undefined) {
    updates.isCurrency = parsed.data.isCurrency;
    // Keep the unit symbol in sync with the currency flag — the unit is a
    // derived display field, not a free-text input.
    updates.unit = derivedUnit(parsed.data.isCurrency);
  }
  if (parsed.data.isActive !== undefined) updates.isActive = parsed.data.isActive;

  const [updated] = await db
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
    details: { before: { name: existing.name, unit: existing.unit, isCurrency: existing.isCurrency, isActive: existing.isActive }, after: updates },
    req,
  });

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

  await db.update(itemTypes).set({ isActive: false }).where(eq(itemTypes.id, typeId));

  await createAuditLog({
    userId: req.user!.id,
    factionId,
    action: 'delete',
    entityType: 'item_type',
    entityId: typeId,
    details: { name: existing.name, unit: existing.unit },
    req,
  });

  success(res, { id: typeId, deleted: true });
});

export default router;
