import { Request, Response } from 'express';
import { asyncRouter } from '../lib/asyncRouter.js';
import { z } from 'zod';
import { and, asc, desc, eq, ilike, inArray, or, sql } from 'drizzle-orm';
import { db } from '../db/index.js';
import {
  auditLogs,
  factionMembers,
  users,
  vehicles,
  VEHICLE_CATEGORIES,
  VEHICLE_STATUSES,
} from '../db/schema.js';
import { success, error } from '../lib/response.js';
import { requireAuth } from '../middleware/auth.js';
import { requireFactionMember, requirePermission } from '../middleware/factionAccess.js';
import { createAuditLog } from '../lib/audit.js';
import { dispatchDiscord } from '../lib/discordDispatch.js';

/**
 * The faction's vehicle registry.
 *
 * A plate goes in and everything known about the car comes back: make, model,
 * colour, who drives it, where it currently is. Modelled on the police
 * registries these servers already run, which is what was asked for.
 *
 * **Reading is open to every member; changing needs `manage_vehicles`.** The
 * people who need to look a plate up — somebody staring at a car right now —
 * are usually the ones holding the fewest permissions, and a registry they
 * cannot read is a registry that does not do its job.
 *
 * Changes are not logged into a table of their own. Every write here goes into
 * the app's existing audit log with a before-and-after of exactly the fields
 * that moved, and the vehicle's own history endpoint reads them back. A second
 * log would be a second thing to keep correct.
 */
const router = asyncRouter({ mergeParams: true });

router.use(requireAuth, requireFactionMember);

const factionId = (req: Request) => req.params.id as string;

/** Anything a person can read off a plate, with room for the odd custom one. */
const plateField = z.string().trim().min(1, 'A vehicle needs a plate').max(16);

const vehicleSchema = z.object({
  plate: plateField,
  make: z.string().trim().max(60).nullable().optional(),
  model: z.string().trim().max(60).nullable().optional(),
  color: z.string().trim().max(40).nullable().optional(),
  category: z.enum(VEHICLE_CATEGORIES).optional(),
  // Wide enough for anything a server's vehicle pack might claim, narrow
  // enough that a typo in the plate field cannot land here unnoticed.
  year: z.number().int().min(1900).max(2200).nullable().optional(),
  status: z.enum(VEHICLE_STATUSES).optional(),
  statusNote: z.string().trim().max(200).nullable().optional(),
  ownerUserId: z.string().uuid().nullable().optional(),
  ownerName: z.string().trim().max(120).nullable().optional(),
  notes: z.string().max(2000).nullable().optional(),
});
const vehicleUpdateSchema = vehicleSchema.partial();

/** The fields a change is worth recording, in the order the card shows them. */
const TRACKED = [
  'plate', 'make', 'model', 'color', 'category', 'year',
  'status', 'statusNote', 'ownerUserId', 'ownerName', 'notes',
] as const;

/** Only a member of this faction can be named as the owner of its vehicles. */
async function ownsMember(id: string, userId: string): Promise<boolean> {
  const [row] = await db
    .select({ id: factionMembers.id })
    .from(factionMembers)
    .where(and(eq(factionMembers.factionId, id), eq(factionMembers.userId, userId)))
    .limit(1);
  return !!row;
}

/**
 * The owner as a name, for a message that has no roster beside it.
 *
 * The table resolves this in SQL for the screen; a Discord embed is read by
 * people who may not be in the app at all, so the linked member is turned into
 * a name here rather than sent as an id.
 */
async function ownerLabel(row: { ownerUserId: string | null; ownerName: string | null }) {
  if (!row.ownerUserId) return row.ownerName;
  const [owner] = await db
    .select({ username: users.username, inGameName: users.inGameName })
    .from(users)
    .where(eq(users.id, row.ownerUserId))
    .limit(1);
  return owner ? owner.inGameName || owner.username : row.ownerName;
}

/** One vehicle with its owner's display name resolved. */
const selection = {
  id: vehicles.id,
  plate: vehicles.plate,
  make: vehicles.make,
  model: vehicles.model,
  color: vehicles.color,
  category: vehicles.category,
  year: vehicles.year,
  status: vehicles.status,
  statusNote: vehicles.statusNote,
  ownerUserId: vehicles.ownerUserId,
  ownerName: vehicles.ownerName,
  notes: vehicles.notes,
  createdBy: vehicles.createdBy,
  createdAt: vehicles.createdAt,
  updatedBy: vehicles.updatedBy,
  updatedAt: vehicles.updatedAt,
  // The linked member's name when there is one, the typed name otherwise, so
  // every screen can show one owner field without deciding this itself.
  ownerDisplay: sql<string | null>`COALESCE(
    (SELECT COALESCE(u.in_game_name, u.username) FROM users u WHERE u.id = vehicles.owner_user_id),
    vehicles.owner_name
  )`,
};

// ── GET / — the table ─────────────────────────────────

router.get('/', async (req: Request, res: Response) => {
  const id = factionId(req);
  const page = Math.max(Number(req.query.page) || 1, 1);
  const pageSize = Math.min(Math.max(Number(req.query.page_size) || 50, 1), 200);
  const search = typeof req.query.q === 'string' ? req.query.q.trim() : '';

  const status = typeof req.query.status === 'string' ? req.query.status : '';
  const category = typeof req.query.category === 'string' ? req.query.category : '';
  const ownerUserId = typeof req.query.owner === 'string' ? req.query.owner : '';

  const filters = [eq(vehicles.factionId, id)];

  // One box over plate, owner, make and model — the four things somebody
  // actually has in front of them when they need to look a car up.
  if (search) {
    const like = `%${search}%`;
    filters.push(
      or(
        ilike(vehicles.plate, like),
        ilike(vehicles.ownerName, like),
        ilike(vehicles.make, like),
        ilike(vehicles.model, like),
        sql`EXISTS (
          SELECT 1 FROM users u
          WHERE u.id = vehicles.owner_user_id
            AND (u.username ILIKE ${like} OR u.in_game_name ILIKE ${like})
        )`,
      )!,
    );
  }
  if (status && (VEHICLE_STATUSES as readonly string[]).includes(status)) {
    filters.push(eq(vehicles.status, status));
  }
  if (category && (VEHICLE_CATEGORIES as readonly string[]).includes(category)) {
    filters.push(eq(vehicles.category, category));
  }
  if (ownerUserId) filters.push(eq(vehicles.ownerUserId, ownerUserId));

  const where = and(...filters);

  const sortable = {
    plate: vehicles.plate,
    updated: vehicles.updatedAt,
    year: vehicles.year,
    status: vehicles.status,
  } as const;
  const sortKey = (typeof req.query.sort === 'string' ? req.query.sort : 'plate') as keyof typeof sortable;
  const column = sortable[sortKey] ?? vehicles.plate;
  const direction = req.query.order === 'desc' ? desc : asc;

  const [rows, [counted]] = await Promise.all([
    db.select(selection).from(vehicles).where(where)
      .orderBy(direction(column))
      .limit(pageSize)
      .offset((page - 1) * pageSize),
    db.select({ total: sql<number>`COUNT(*)::int` }).from(vehicles).where(where),
  ]);

  // The counts behind the filter chips, over the whole registry rather than
  // the current page — a chip that said "3" because the page holds three
  // would be worse than no number at all.
  const statusCounts = await db
    .select({ status: vehicles.status, count: sql<number>`COUNT(*)::int` })
    .from(vehicles)
    .where(eq(vehicles.factionId, id))
    .groupBy(vehicles.status);

  success(res, {
    vehicles: rows,
    total: counted?.total ?? 0,
    page,
    pageSize,
    statusCounts: Object.fromEntries(statusCounts.map((r) => [r.status, r.count])),
  });
});

// ── GET /:vehicleId — the full card ───────────────────

router.get('/:vehicleId', async (req: Request, res: Response) => {
  const [row] = await db
    .select(selection)
    .from(vehicles)
    .where(and(
      eq(vehicles.id, req.params.vehicleId as string),
      eq(vehicles.factionId, factionId(req)),
    ))
    .limit(1);

  if (!row) {
    error(res, 'NOT_FOUND', 'Vehicle not found', 404);
    return;
  }
  success(res, row);
});

// ── GET /:vehicleId/history — what changed, and who ───
//
// Read out of the audit log rather than a table of its own. Open to whoever
// may change the registry, and to holders of `view_audit_logs`: somebody
// trusted to edit a record may see who edited it before them, and anyone who
// can already read the whole audit screen loses nothing here.

router.get('/:vehicleId/history', async (req: Request, res: Response) => {
  const id = factionId(req);
  const vehicleId = req.params.vehicleId as string;

  const permissions = req.factionPermissions ?? [];
  const privileged = req.factionRole === 'admin' || req.factionRole === 'superadmin'
    || permissions.includes('manage_vehicles') || permissions.includes('view_audit_logs');
  if (!privileged) {
    error(res, 'FORBIDDEN', 'You need the "manage_vehicles" permission to see the history', 403);
    return;
  }

  const [vehicle] = await db
    .select({ id: vehicles.id })
    .from(vehicles)
    .where(and(eq(vehicles.id, vehicleId), eq(vehicles.factionId, id)))
    .limit(1);
  if (!vehicle) {
    error(res, 'NOT_FOUND', 'Vehicle not found', 404);
    return;
  }

  const rows = await db
    .select({
      id: auditLogs.id,
      action: auditLogs.action,
      details: auditLogs.details,
      createdAt: auditLogs.createdAt,
      actorName: sql<string>`COALESCE(${users.inGameName}, ${users.username})`,
    })
    .from(auditLogs)
    .innerJoin(users, eq(auditLogs.userId, users.id))
    .where(and(
      eq(auditLogs.factionId, id),
      eq(auditLogs.entityType, 'vehicle'),
      eq(auditLogs.entityId, vehicleId),
    ))
    .orderBy(desc(auditLogs.createdAt))
    .limit(100);

  success(res, { history: rows });
});

// ── POST / ────────────────────────────────────────────

router.post('/', requirePermission('manage_vehicles'), async (req: Request, res: Response) => {
  const body = vehicleSchema.parse(req.body);
  const id = factionId(req);

  if (body.ownerUserId && !await ownsMember(id, body.ownerUserId)) {
    error(res, 'NOT_FOUND', 'That owner is not on this faction\'s roster', 404);
    return;
  }

  const [existing] = await db
    .select({ id: vehicles.id, plate: vehicles.plate })
    .from(vehicles)
    .where(and(eq(vehicles.factionId, id), sql`upper(${vehicles.plate}) = upper(${body.plate})`))
    .limit(1);
  if (existing) {
    error(res, 'VALIDATION_ERROR',
      `${existing.plate} is already in the registry. Open that record instead.`, 409);
    return;
  }

  const [row] = await db
    .insert(vehicles)
    .values({
      factionId: id,
      plate: body.plate,
      make: body.make ?? null,
      model: body.model ?? null,
      color: body.color ?? null,
      category: body.category ?? 'car',
      year: body.year ?? null,
      status: body.status ?? 'in_service',
      statusNote: body.statusNote ?? null,
      ownerUserId: body.ownerUserId ?? null,
      ownerName: body.ownerName ?? null,
      notes: body.notes ?? null,
      createdBy: req.user!.id,
      updatedBy: req.user!.id,
    })
    .returning();

  await createAuditLog({
    userId: req.user!.id,
    factionId: id,
    action: 'create',
    entityType: 'vehicle',
    entityId: row!.id,
    details: { plate: row!.plate, make: row!.make, model: row!.model, status: row!.status },
    req,
  });

  // Not awaited, like every other dispatch in the app: Discord being slow or
  // unreachable must not make adding a vehicle feel slow or fail.
  void dispatchDiscord(id, {
    type: 'vehicle_added',
    actorUserId: req.user!.id,
    plate: row!.plate,
    make: row!.make,
    model: row!.model,
    color: row!.color,
    owner: await ownerLabel(row!),
    status: row!.status,
  });

  success(res, row, 201);
});

// ── PATCH /:vehicleId ─────────────────────────────────

router.patch('/:vehicleId', requirePermission('manage_vehicles'), async (req: Request, res: Response) => {
  const body = vehicleUpdateSchema.parse(req.body);
  const id = factionId(req);
  const vehicleId = req.params.vehicleId as string;

  const [current] = await db
    .select()
    .from(vehicles)
    .where(and(eq(vehicles.id, vehicleId), eq(vehicles.factionId, id)))
    .limit(1);
  if (!current) {
    error(res, 'NOT_FOUND', 'Vehicle not found', 404);
    return;
  }

  if (body.ownerUserId && !await ownsMember(id, body.ownerUserId)) {
    error(res, 'NOT_FOUND', 'That owner is not on this faction\'s roster', 404);
    return;
  }

  if (body.plate && body.plate.toUpperCase() !== current.plate.toUpperCase()) {
    const [clash] = await db
      .select({ id: vehicles.id })
      .from(vehicles)
      .where(and(eq(vehicles.factionId, id), sql`upper(${vehicles.plate}) = upper(${body.plate})`))
      .limit(1);
    if (clash) {
      error(res, 'VALIDATION_ERROR', 'Another vehicle already has that plate.', 409);
      return;
    }
  }

  const updates: Record<string, unknown> = { updatedBy: req.user!.id, updatedAt: new Date() };
  for (const field of TRACKED) {
    if (body[field] !== undefined) updates[field] = body[field];
  }

  const [row] = await db
    .update(vehicles)
    .set(updates)
    .where(eq(vehicles.id, vehicleId))
    .returning();

  // Only what actually moved. A log that recorded every field on every save
  // would bury the one change somebody is looking for.
  const changes: Record<string, { from: unknown; to: unknown }> = {};
  for (const field of TRACKED) {
    if (body[field] === undefined) continue;
    const before = current[field] ?? null;
    const after = row![field] ?? null;
    if (before !== after) changes[field] = { from: before, to: after };
  }

  if (Object.keys(changes).length > 0) {
    await createAuditLog({
      userId: req.user!.id,
      factionId: id,
      action: 'update',
      entityType: 'vehicle',
      entityId: vehicleId,
      details: { plate: row!.plate, changes },
      req,
    });
  }

  success(res, row);
});

// ── DELETE /:vehicleId ────────────────────────────────
//
// Really deleted. A registry is a description of what exists now, and a car
// that was sold six months ago is noise on the screen that matters — the
// `sold` and `scrapped` statuses are there for the ones worth keeping.

router.delete('/:vehicleId', requirePermission('manage_vehicles'), async (req: Request, res: Response) => {
  const id = factionId(req);
  const [row] = await db
    .delete(vehicles)
    .where(and(eq(vehicles.id, req.params.vehicleId as string), eq(vehicles.factionId, id)))
    .returning();

  if (!row) {
    error(res, 'NOT_FOUND', 'Vehicle not found', 404);
    return;
  }

  await createAuditLog({
    userId: req.user!.id,
    factionId: id,
    action: 'delete',
    entityType: 'vehicle',
    entityId: row.id,
    details: { plate: row.plate, make: row.make, model: row.model },
    req,
  });

  void dispatchDiscord(id, {
    type: 'vehicle_removed',
    actorUserId: req.user!.id,
    plate: row.plate,
    make: row.make,
    model: row.model,
    owner: await ownerLabel(row),
  });

  success(res, { deleted: true });
});

export default router;
