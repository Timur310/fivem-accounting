import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { db } from '../db/index.js';
import { itemTypes } from '../db/schema.js';
import { eq, and, desc, sql } from 'drizzle-orm';
import { success, error } from '../lib/response.js';
import { requireAuth } from '../middleware/auth.js';
import { requireFactionMember, requireFactionAdminOrSuperadmin } from '../middleware/factionAccess.js';
import { createAuditLog } from '../lib/audit.js';

const router = Router({ mergeParams: true });

router.use(requireAuth, requireFactionMember);

// ── Validation schemas ────────────────────────────────

const createItemTypeSchema = z.object({
  name: z.string().min(1).max(100),
  unit: z.string().min(1).max(20).default('$'),
});

const updateItemTypeSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  unit: z.string().min(1).max(20).optional(),
  isActive: z.boolean().optional(),
});

// ── POST / — create item type ───────────────────────
router.post('/', requireFactionAdminOrSuperadmin, async (req: Request, res: Response) => {
  const factionId = req.params.id as string;
  const parsed = createItemTypeSchema.safeParse(req.body);
  if (!parsed.success) {
    error(res, 'VALIDATION_ERROR', parsed.error.issues[0]!.message);
    return;
  }

  const { name, unit } = parsed.data;

  const [created] = await db
    .insert(itemTypes)
    .values({ factionId, name, unit })
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
    details: { name, unit },
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
      isActive: itemTypes.isActive,
      createdAt: itemTypes.createdAt,
      entryCount: sql<number>`(SELECT COUNT(*) FROM entries WHERE item_type_id = item_types.id AND is_deleted = false)::int`,
    })
    .from(itemTypes)
    .where(eq(itemTypes.factionId, factionId))
    .orderBy(desc(itemTypes.createdAt));

  success(res, types);
});

// ── PATCH /:typeId — update item type ───────────────
router.patch('/:typeId', requireFactionAdminOrSuperadmin, async (req: Request, res: Response) => {
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
    details: { before: { name: existing.name, unit: existing.unit, isActive: existing.isActive }, after: updates },
    req,
  });

  success(res, updated);
});

// ── DELETE /:typeId — soft-delete item type ──────────
router.delete('/:typeId', requireFactionAdminOrSuperadmin, async (req: Request, res: Response) => {
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
