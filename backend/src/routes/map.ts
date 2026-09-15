import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { and, eq, gte, isNull, or, sql } from 'drizzle-orm';
import { db } from '../db/index.js';
import {
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

/**
 * The faction's map.
 *
 * Points, areas and routes in **game coordinates** — the numbers a player
 * reads off `/coords` in game. Nothing here knows about tiles, zoom levels or
 * pixels; that transform lives in the client and can be replaced with a
 * different map image without touching a row.
 *
 * Visibility is enforced here and only here. A marker the viewer may not see
 * is never sent: filtering it in the client would put the location of the
 * faction's main stash in a network response that anybody can open devtools
 * and read.
 */
const router = Router({ mergeParams: true });

router.use(requireAuth, requireFactionMember);

/** Every rank a member could hold; no rank at all is lower than all of them. */
const NO_RANK_LEVEL = 1000;

const coordinate = z.object({
  // GTA V's world is roughly -4000..4500 on X and -4000..8000 on Y. The bounds
  // here are deliberately wider than that: interiors and custom MLOs sit
  // outside the vanilla map, and refusing them would be refusing real places.
  x: z.number().finite().min(-20000).max(20000),
  y: z.number().finite().min(-20000).max(20000),
  z: z.number().finite().min(-2000).max(5000).optional(),
});

const markerSchema = z.object({
  kind: z.enum(MAP_MARKER_KINDS),
  name: z.string().trim().min(1, 'Give the marker a name').max(120),
  description: z.string().max(2000).optional(),
  category: z.string().max(40).optional(),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/, 'Colour must be a hex value like #a855f7').optional(),
  icon: z.string().max(16).optional(),
  points: z.array(coordinate).min(1).max(200),
  /** Null or absent means everybody in the faction can see it. */
  minRankLevel: z.number().int().min(1).max(100).nullable().optional(),
});

const markerUpdateSchema = markerSchema.partial();

/** A shape has to have enough corners to be the shape it claims to be. */
function shapeError(kind: string, points: unknown[]): string | null {
  if (kind === 'point' && points.length !== 1) return 'A point takes exactly one coordinate';
  if (kind === 'route' && points.length < 2) return 'A route needs at least two coordinates';
  if (kind === 'area' && points.length < 3) return 'An area needs at least three coordinates';
  return null;
}

/**
 * How high the viewer sits in the hierarchy, as a rank level.
 *
 * Lower is higher: level 1 is the boss. Admins and superadmins get 0, which is
 * above every rank a faction can define, so they see everything — the same
 * rule every other permission in the app follows.
 */
async function viewerRankLevel(factionId: string, req: Request): Promise<number> {
  if (req.factionRole === 'admin' || req.factionRole === 'superadmin') return 0;

  const [membership] = await db
    .select({ rank: factionMembers.rank })
    .from(factionMembers)
    .where(and(eq(factionMembers.factionId, factionId), eq(factionMembers.userId, req.user!.id)))
    .limit(1);

  if (!membership?.rank) return NO_RANK_LEVEL;

  const [faction] = await db
    .select({ ranks: factions.ranks })
    .from(factions)
    .where(eq(factions.id, factionId))
    .limit(1);

  const rank = (faction?.ranks ?? []).find((r) => r.name === membership.rank);
  // A rank the faction has since deleted leaves the member holding a name
  // nothing defines. Treating that as "no rank" is the safe read: it can only
  // ever hide a marker, never reveal one.
  return rank?.level ?? NO_RANK_LEVEL;
}

// ── GET / — the markers this viewer may see ──────────
router.get('/', async (req: Request, res: Response) => {
  const factionId = req.params.id as string;
  const level = await viewerRankLevel(factionId, req);

  const rows = await db
    .select({
      id: mapMarkers.id,
      kind: mapMarkers.kind,
      name: mapMarkers.name,
      description: mapMarkers.description,
      category: mapMarkers.category,
      color: mapMarkers.color,
      icon: mapMarkers.icon,
      points: mapMarkers.points,
      minRankLevel: mapMarkers.minRankLevel,
      createdBy: mapMarkers.createdBy,
      createdAt: mapMarkers.createdAt,
      creatorName: sql<string>`COALESCE(${users.inGameName}, ${users.username})`,
    })
    .from(mapMarkers)
    .innerJoin(users, eq(mapMarkers.createdBy, users.id))
    .where(
      and(
        eq(mapMarkers.factionId, factionId),
        // Unrestricted, or restricted to a rank this viewer is at or above.
        or(isNull(mapMarkers.minRankLevel), gte(mapMarkers.minRankLevel, level)),
      ),
    )
    .orderBy(mapMarkers.createdAt);

  success(res, { markers: rows });
});

// ── POST / — put something on the map ────────────────
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

  const [row] = await db
    .insert(mapMarkers)
    .values({
      factionId,
      kind: data.kind,
      name: data.name,
      description: data.description?.trim() || null,
      category: data.category?.trim() || null,
      color: data.color ?? null,
      icon: data.icon || null,
      points: data.points,
      minRankLevel: data.minRankLevel ?? null,
      createdBy: req.user!.id,
    })
    .returning();

  await createAuditLog({
    userId: req.user!.id,
    factionId,
    action: 'create',
    entityType: 'map_marker',
    entityId: row!.id,
    // The coordinates stay out of the audit detail on purpose. A marker can be
    // hidden from most of the faction, and the audit log is read by people who
    // may not be allowed to see where it is.
    details: { kind: data.kind, name: data.name, minRankLevel: data.minRankLevel ?? null },
    req,
  });

  success(res, row, 201);
});

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

  const [existing] = await db
    .select()
    .from(mapMarkers)
    .where(and(eq(mapMarkers.id, markerId), eq(mapMarkers.factionId, factionId)))
    .limit(1);

  if (!existing) {
    error(res, 'NOT_FOUND', 'Marker not found', 404);
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
  if (data.kind !== undefined) updates.kind = data.kind;
  if (data.name !== undefined) updates.name = data.name;
  if (data.description !== undefined) updates.description = data.description.trim() || null;
  if (data.category !== undefined) updates.category = data.category.trim() || null;
  if (data.color !== undefined) updates.color = data.color;
  if (data.icon !== undefined) updates.icon = data.icon || null;
  if (data.points !== undefined) updates.points = data.points;
  if (data.minRankLevel !== undefined) updates.minRankLevel = data.minRankLevel;

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
    details: { name: row!.name, kind: row!.kind, minRankLevel: row!.minRankLevel },
    req,
  });

  success(res, row);
});

// ── DELETE /:markerId ────────────────────────────────
router.delete('/:markerId', requirePermission('manage_map'), async (req: Request, res: Response) => {
  const factionId = req.params.id as string;
  const markerId = req.params.markerId as string;

  const [existing] = await db
    .select({ id: mapMarkers.id, name: mapMarkers.name, kind: mapMarkers.kind })
    .from(mapMarkers)
    .where(and(eq(mapMarkers.id, markerId), eq(mapMarkers.factionId, factionId)))
    .limit(1);

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
