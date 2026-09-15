import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { and, eq, gte, inArray, isNull, or, sql } from 'drizzle-orm';
import { db } from '../db/index.js';
import {
  mapLayers,
  mapMarkers,
  factions,
  factionMembers,
  users,
  MAP_MARKER_KINDS,
} from '../db/schema.js';
import { success, error } from '../lib/response.js';
import { requireAuth } from '../middleware/auth.js';
import { requireFactionMember, requirePermission } from '../middleware/factionAccess.js';
import { createAuditLog } from '../lib/audit.js';
import { NO_RANK_LEVEL, viewerRankLevel } from '../lib/rank.js';

/**
 * The faction's maps.
 *
 * A **layer** is one named map — "Robbery routes", "Where friends live" — and
 * it is where permission lives. A **marker** is a point, route or area drawn
 * on exactly one layer, in game coordinates: the numbers a player reads off
 * `/coords`. Nothing here knows about tiles or pixels; that transform is in
 * the client and can be replaced without touching a row.
 *
 * One rule governs everything: **you can only see, and only change, a marker
 * whose layer you can open.** It is enforced here and only here. A marker the
 * viewer may not see is never sent, because filtering in the client would put
 * the faction's stash in a response anybody can read out of devtools — and a
 * marker they may not see cannot be edited by id either, which is the hole the
 * first version of this file left open.
 */
const router = Router({ mergeParams: true });

router.use(requireAuth, requireFactionMember);

const coordinate = z.object({
  // GTA V's world is roughly -4000..4500 on X and -4000..8000 on Y. The bounds
  // here are deliberately wider: interiors and custom MLOs sit outside the
  // vanilla map, and refusing them would be refusing real places.
  x: z.number().finite().min(-20000).max(20000),
  y: z.number().finite().min(-20000).max(20000),
  z: z.number().finite().min(-2000).max(5000).optional(),
});

const hexColor = z.string().regex(/^#[0-9a-fA-F]{6}$/, 'Colour must be a hex value like #a855f7');

const layerSchema = z.object({
  name: z.string().trim().min(1, 'Give the map a name').max(80),
  description: z.string().max(2000).optional(),
  color: hexColor.optional(),
  icon: z.string().max(16).optional(),
  minRankLevel: z.number().int().min(1).max(100).nullable().optional(),
});
const layerUpdateSchema = layerSchema.partial();

const markerSchema = z.object({
  layerId: z.string().uuid(),
  kind: z.enum(MAP_MARKER_KINDS),
  name: z.string().trim().min(1, 'Give the marker a name').max(120),
  description: z.string().max(2000).optional(),
  category: z.string().max(40).optional(),
  color: hexColor.optional(),
  icon: z.string().max(16).optional(),
  points: z.array(coordinate).min(1).max(200),
});
const markerUpdateSchema = markerSchema.partial();

/** A shape has to have enough corners to be the shape it claims to be. */
function shapeError(kind: string, points: unknown[]): string | null {
  if (kind === 'point' && points.length !== 1) return 'A point takes exactly one coordinate';
  if (kind === 'route' && points.length < 2) return 'A route needs at least two coordinates';
  if (kind === 'area' && points.length < 3) return 'An area needs at least three coordinates';
  return null;
}


/** Unrestricted, or restricted to a rank this viewer is at or above. */
function openTo(level: number) {
  return or(isNull(mapLayers.minRankLevel), gte(mapLayers.minRankLevel, level));
}

/**
 * The layer, if this viewer may open it.
 *
 * Every write goes through here, so "can I edit this?" and "can I see this?"
 * cannot drift apart: there is one answer and one query behind it.
 */
async function openLayer(factionId: string, layerId: string, level: number) {
  const [layer] = await db
    .select()
    .from(mapLayers)
    .where(and(eq(mapLayers.id, layerId), eq(mapLayers.factionId, factionId), openTo(level)))
    .limit(1);
  return layer ?? null;
}

// ── GET /layers — the maps this viewer may open ──────
router.get('/layers', async (req: Request, res: Response) => {
  const factionId = req.params.id as string;
  const level = await viewerRankLevel(factionId, req);

  const rows = await db
    .select({
      id: mapLayers.id,
      name: mapLayers.name,
      description: mapLayers.description,
      color: mapLayers.color,
      icon: mapLayers.icon,
      minRankLevel: mapLayers.minRankLevel,
      createdBy: mapLayers.createdBy,
      createdAt: mapLayers.createdAt,
      creatorName: sql<string>`COALESCE(${users.inGameName}, ${users.username})`,
      markerCount: sql<number>`(SELECT COUNT(*)::int FROM map_markers WHERE layer_id = ${mapLayers.id})`,
    })
    .from(mapLayers)
    .innerJoin(users, eq(mapLayers.createdBy, users.id))
    .where(and(eq(mapLayers.factionId, factionId), openTo(level)))
    .orderBy(mapLayers.name);

  success(res, { layers: rows });
});

// ── POST /layers ─────────────────────────────────────
router.post('/layers', requirePermission('manage_map'), async (req: Request, res: Response) => {
  const factionId = req.params.id as string;

  const parsed = layerSchema.safeParse(req.body);
  if (!parsed.success) {
    error(res, 'VALIDATION_ERROR', parsed.error.issues[0]!.message);
    return;
  }
  const data = parsed.data;
  const level = await viewerRankLevel(factionId, req);

  // Nobody may create a map they could not then open. Without this a leader
  // can lock themselves out of their own layer in one click, with no way back
  // through the interface.
  if (data.minRankLevel != null && data.minRankLevel < level) {
    error(res, 'VALIDATION_ERROR', 'You cannot restrict a map to a rank above your own — you would not be able to open it');
    return;
  }

  let row;
  try {
    [row] = await db
      .insert(mapLayers)
      .values({
        factionId,
        name: data.name,
        description: data.description?.trim() || null,
        color: data.color ?? null,
        icon: data.icon || null,
        minRankLevel: data.minRankLevel ?? null,
        createdBy: req.user!.id,
      })
      .returning();
  } catch (err) {
    if (typeof err === 'object' && err !== null && (err as { code?: string }).code === '23505') {
      error(res, 'VALIDATION_ERROR', 'This faction already has a map with that name');
      return;
    }
    throw err;
  }

  await createAuditLog({
    userId: req.user!.id,
    factionId,
    action: 'create',
    entityType: 'map_layer',
    entityId: row!.id,
    details: { name: data.name, minRankLevel: data.minRankLevel ?? null },
    req,
  });

  success(res, row, 201);
});

// ── PATCH /layers/:layerId ───────────────────────────
router.patch('/layers/:layerId', requirePermission('manage_map'), async (req: Request, res: Response) => {
  const factionId = req.params.id as string;
  const layerId = req.params.layerId as string;

  const parsed = layerUpdateSchema.safeParse(req.body);
  if (!parsed.success) {
    error(res, 'VALIDATION_ERROR', parsed.error.issues[0]!.message);
    return;
  }
  const data = parsed.data;
  const level = await viewerRankLevel(factionId, req);

  const existing = await openLayer(factionId, layerId, level);
  if (!existing) {
    // Deliberately the same answer as a layer that does not exist. Saying
    // "forbidden" would confirm that a map by that id is there.
    error(res, 'NOT_FOUND', 'Map not found', 404);
    return;
  }

  if (data.minRankLevel != null && data.minRankLevel < level) {
    error(res, 'VALIDATION_ERROR', 'You cannot restrict a map to a rank above your own — you would not be able to open it');
    return;
  }

  const updates: Record<string, unknown> = { updatedAt: new Date() };
  if (data.name !== undefined) updates.name = data.name;
  if (data.description !== undefined) updates.description = data.description.trim() || null;
  if (data.color !== undefined) updates.color = data.color;
  if (data.icon !== undefined) updates.icon = data.icon || null;
  if (data.minRankLevel !== undefined) updates.minRankLevel = data.minRankLevel;

  let row;
  try {
    [row] = await db.update(mapLayers).set(updates).where(eq(mapLayers.id, layerId)).returning();
  } catch (err) {
    if (typeof err === 'object' && err !== null && (err as { code?: string }).code === '23505') {
      error(res, 'VALIDATION_ERROR', 'This faction already has a map with that name');
      return;
    }
    throw err;
  }

  await createAuditLog({
    userId: req.user!.id,
    factionId,
    action: 'update',
    entityType: 'map_layer',
    entityId: layerId,
    details: { name: row!.name, minRankLevel: row!.minRankLevel },
    req,
  });

  success(res, row);
});

// ── DELETE /layers/:layerId ──────────────────────────
router.delete('/layers/:layerId', requirePermission('manage_map'), async (req: Request, res: Response) => {
  const factionId = req.params.id as string;
  const layerId = req.params.layerId as string;
  const level = await viewerRankLevel(factionId, req);

  const existing = await openLayer(factionId, layerId, level);
  if (!existing) {
    error(res, 'NOT_FOUND', 'Map not found', 404);
    return;
  }

  // Everything drawn on it goes too — the cascade is in the schema. A marker
  // outside every layer would be a marker nothing governs the visibility of.
  await db.delete(mapLayers).where(eq(mapLayers.id, layerId));

  await createAuditLog({
    userId: req.user!.id,
    factionId,
    action: 'delete',
    entityType: 'map_layer',
    entityId: layerId,
    details: { name: existing.name },
    req,
  });

  success(res, { deleted: true });
});

// ── GET / — markers on every layer this viewer may open ──
router.get('/', async (req: Request, res: Response) => {
  const factionId = req.params.id as string;
  const level = await viewerRankLevel(factionId, req);

  const rows = await db
    .select({
      id: mapMarkers.id,
      layerId: mapMarkers.layerId,
      kind: mapMarkers.kind,
      name: mapMarkers.name,
      description: mapMarkers.description,
      category: mapMarkers.category,
      color: mapMarkers.color,
      icon: mapMarkers.icon,
      points: mapMarkers.points,
      createdBy: mapMarkers.createdBy,
      createdAt: mapMarkers.createdAt,
      creatorName: sql<string>`COALESCE(${users.inGameName}, ${users.username})`,
    })
    .from(mapMarkers)
    .innerJoin(users, eq(mapMarkers.createdBy, users.id))
    // The join is the filter: a marker whose layer is closed to this viewer
    // has no row to join to and never reaches the response.
    .innerJoin(mapLayers, eq(mapMarkers.layerId, mapLayers.id))
    .where(and(eq(mapMarkers.factionId, factionId), openTo(level)))
    .orderBy(mapMarkers.createdAt);

  success(res, { markers: rows });
});

// ── POST / — draw something on a layer ───────────────
router.post('/', requirePermission('manage_map'), async (req: Request, res: Response) => {
  const factionId = req.params.id as string;

  const parsed = markerSchema.safeParse(req.body);
  if (!parsed.success) {
    error(res, 'VALIDATION_ERROR', parsed.error.issues[0]!.message);
    return;
  }
  const data = parsed.data;

  const bad = shapeError(data.kind, data.points);
  if (bad) {
    error(res, 'VALIDATION_ERROR', bad);
    return;
  }

  const level = await viewerRankLevel(factionId, req);
  if (!(await openLayer(factionId, data.layerId, level))) {
    error(res, 'NOT_FOUND', 'Map not found', 404);
    return;
  }

  const [row] = await db
    .insert(mapMarkers)
    .values({
      factionId,
      layerId: data.layerId,
      kind: data.kind,
      name: data.name,
      description: data.description?.trim() || null,
      category: data.category?.trim() || null,
      color: data.color ?? null,
      icon: data.icon || null,
      points: data.points,
      createdBy: req.user!.id,
    })
    .returning();

  await createAuditLog({
    userId: req.user!.id,
    factionId,
    action: 'create',
    entityType: 'map_marker',
    entityId: row!.id,
    // The coordinates stay out of the audit detail on purpose. A layer can be
    // closed to most of the faction, and the audit log is read by people who
    // may not be allowed to see where its markers are.
    details: { kind: data.kind, name: data.name, layerId: data.layerId },
    req,
  });

  success(res, row, 201);
});

/** The marker, if this viewer may open the layer it sits on. */
async function openMarker(factionId: string, markerId: string, level: number) {
  const [row] = await db
    .select({ marker: mapMarkers })
    .from(mapMarkers)
    .innerJoin(mapLayers, eq(mapMarkers.layerId, mapLayers.id))
    .where(and(eq(mapMarkers.id, markerId), eq(mapMarkers.factionId, factionId), openTo(level)))
    .limit(1);
  return row?.marker ?? null;
}

// ── PATCH /:markerId ─────────────────────────────────
router.patch('/:markerId', requirePermission('manage_map'), async (req: Request, res: Response) => {
  const factionId = req.params.id as string;
  const markerId = req.params.markerId as string;

  const parsed = markerUpdateSchema.safeParse(req.body);
  if (!parsed.success) {
    error(res, 'VALIDATION_ERROR', parsed.error.issues[0]!.message);
    return;
  }
  const data = parsed.data;
  const level = await viewerRankLevel(factionId, req);

  const existing = await openMarker(factionId, markerId, level);
  if (!existing) {
    error(res, 'NOT_FOUND', 'Marker not found', 404);
    return;
  }

  // Moving a marker to a layer the mover cannot open would hide it from
  // themselves, and moving one *out* of a closed layer would leak it.
  if (data.layerId !== undefined && !(await openLayer(factionId, data.layerId, level))) {
    error(res, 'NOT_FOUND', 'Map not found', 404);
    return;
  }

  // Either side of the pair can change, so the shape is checked against what
  // the marker will be, not against what was sent.
  const kind = data.kind ?? existing.kind;
  const points = data.points ?? existing.points;
  const bad = shapeError(kind, points);
  if (bad) {
    error(res, 'VALIDATION_ERROR', bad);
    return;
  }

  const updates: Record<string, unknown> = { updatedAt: new Date() };
  if (data.layerId !== undefined) updates.layerId = data.layerId;
  if (data.kind !== undefined) updates.kind = data.kind;
  if (data.name !== undefined) updates.name = data.name;
  if (data.description !== undefined) updates.description = data.description.trim() || null;
  if (data.category !== undefined) updates.category = data.category.trim() || null;
  if (data.color !== undefined) updates.color = data.color;
  if (data.icon !== undefined) updates.icon = data.icon || null;
  if (data.points !== undefined) updates.points = data.points;

  const [row] = await db
    .update(mapMarkers)
    .set(updates)
    .where(eq(mapMarkers.id, markerId))
    .returning();

  await createAuditLog({
    userId: req.user!.id,
    factionId,
    action: 'update',
    entityType: 'map_marker',
    entityId: markerId,
    details: { name: row!.name, kind: row!.kind, layerId: row!.layerId },
    req,
  });

  success(res, row);
});

// ── DELETE /:markerId ────────────────────────────────
router.delete('/:markerId', requirePermission('manage_map'), async (req: Request, res: Response) => {
  const factionId = req.params.id as string;
  const markerId = req.params.markerId as string;
  const level = await viewerRankLevel(factionId, req);

  const existing = await openMarker(factionId, markerId, level);
  if (!existing) {
    error(res, 'NOT_FOUND', 'Marker not found', 404);
    return;
  }

  // Really deleted. A marker is a note about a place, not a ledger row: there
  // is no balance that depends on it and nothing to reconcile later.
  await db.delete(mapMarkers).where(eq(mapMarkers.id, markerId));

  await createAuditLog({
    userId: req.user!.id,
    factionId,
    action: 'delete',
    entityType: 'map_marker',
    entityId: markerId,
    details: { name: existing.name, kind: existing.kind },
    req,
  });

  success(res, { deleted: true });
});

export default router;
