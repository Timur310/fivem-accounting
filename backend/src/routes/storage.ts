import { Request, Response } from 'express';
import { asyncRouter } from '../lib/asyncRouter.js';
import { z } from 'zod';
import { and, asc, desc, eq, ilike, inArray, sql } from 'drizzle-orm';
import { db, type TransactionLike } from '../db/index.js';
import {
  factions,
  itemTypes,
  mapMarkers,
  payouts,
  storageContainers,
  storageContents,
  storageMovements,
  storageRooms,
  users,
  STORAGE_CONTAINER_KINDS,
  STORAGE_TILE_KINDS,
  type StorageMovementKind,
} from '../db/schema.js';
import { fromCents, toCents, computeTreasuryBalances, balancesFor, lockItemTypes } from '../lib/treasury.js';
import { success, error } from '../lib/response.js';
import { requireAuth } from '../middleware/auth.js';
import { requireFactionMember, requirePermission } from '../middleware/factionAccess.js';
import { requireModule } from '../lib/modules.js';
import { createAuditLog } from '../lib/audit.js';
import { dispatchDiscord } from '../lib/discordDispatch.js';
import {
  droppedBelowMin,
  fitProblem,
  layoutProblem,
  MAX_CONTAINER_SIDE,
  MAX_CONTAINERS_PER_ROOM,
  MAX_CONTENTS_PER_CONTAINER,
  MAX_ROOM_HEIGHT,
  MAX_ROOM_WIDTH,
  MIN_ROOM_SIZE,
} from '../lib/storage.js';

/**
 * The storage planner: the faction's depots drawn as rooms, the benches,
 * chests and safes in them, and what each one holds.
 *
 * **In beta.** The screen says so; nothing here is less careful for it.
 *
 * **Its own inventory.** Counts are kept by hand and never touch the ledger —
 * taking three pistols out of a chest is not a payout, and making it one would
 * turn every trip to the depot into bookkeeping. `/compare` puts the two side
 * by side instead, so what the faction owns but has not put anywhere shows.
 *
 * **Three levels.** Every member may look: the person fetching from a bench is
 * the one who needs to know which bench. `update_storage` changes counts and
 * moves things between containers. `manage_storage` draws rooms — walls,
 * doors, where each container stands and how much it holds.
 *
 * Every change to a count is written to `storage_movements`, which is what a
 * container's history reads.
 */
const router = asyncRouter({ mergeParams: true });

router.use(requireAuth, requireFactionMember, requireModule('storage'));

const factionId = (req: Request) => req.params.id as string;
const memberName = sql<string>`COALESCE(${users.inGameName}, ${users.username})`;

const quantityField = z
  .string()
  .trim()
  .regex(/^\d{1,13}(\.\d{1,2})?$/, 'A count looks like 12 or 12.5');

const hexColor = z.string().regex(/^#[0-9a-fA-F]{6}$/, 'Colour must be a hex value like #a855f7');

const tileSchema = z.object({
  x: z.number().int(),
  y: z.number().int(),
  kind: z.enum(STORAGE_TILE_KINDS),
});

const containerSchema = z.object({
  id: z.string().uuid().optional(),
  kind: z.enum(STORAGE_CONTAINER_KINDS),
  name: z.string().trim().min(1, 'Every container needs a name').max(80),
  color: hexColor.nullable().optional(),
  tags: z.array(z.string().trim().min(1).max(30)).max(10).optional(),
  x: z.number().int(),
  y: z.number().int(),
  w: z.number().int().min(1).max(MAX_CONTAINER_SIDE),
  h: z.number().int().min(1).max(MAX_CONTAINER_SIDE),
  capacity: quantityField.nullable().optional(),
  notes: z.string().max(1000).nullable().optional(),
});

const roomSize = {
  width: z.number().int().min(MIN_ROOM_SIZE).max(MAX_ROOM_WIDTH),
  height: z.number().int().min(MIN_ROOM_SIZE).max(MAX_ROOM_HEIGHT),
};

const layoutSchema = z.object({
  ...roomSize,
  tiles: z.array(tileSchema).max(MAX_ROOM_WIDTH * MAX_ROOM_HEIGHT),
  containers: z.array(containerSchema).max(MAX_CONTAINERS_PER_ROOM),
});

const createRoomSchema = z.object({
  name: z.string().trim().min(1, 'Give the room a name').max(80),
  ...roomSize,
  // A template arrives with its walls and containers already drawn.
  tiles: z.array(tileSchema).max(MAX_ROOM_WIDTH * MAX_ROOM_HEIGHT).optional(),
  containers: z.array(containerSchema.omit({ id: true })).max(MAX_CONTAINERS_PER_ROOM).optional(),
});

const updateRoomSchema = z.object({
  name: z.string().trim().min(1).max(80).optional(),
  mapMarkerId: z.string().uuid().nullable().optional(),
  sortOrder: z.number().int().min(0).max(10_000).optional(),
});

const addContentSchema = z.object({
  itemTypeId: z.string().uuid().optional(),
  label: z.string().trim().min(1).max(100).optional(),
  quantity: quantityField,
  minQuantity: quantityField.nullable().optional(),
  maxQuantity: quantityField.nullable().optional(),
}).refine((d) => !!d.itemTypeId !== !!d.label, 'Pick one of the faction\'s items, or type a name — not both');

const changeContentSchema = z.object({
  /** Add (positive) or take (negative), relative to what is there now. */
  delta: z.string().trim().regex(/^-?\d{1,13}(\.\d{1,2})?$/).optional(),
  /** Or: this is what is there now (a count). */
  quantity: quantityField.optional(),
  minQuantity: quantityField.nullable().optional(),
  maxQuantity: quantityField.nullable().optional(),
}).refine((d) => !(d.delta !== undefined && d.quantity !== undefined), 'Either add/take or set the count, not both');

const moveSchema = z.object({
  toContainerId: z.string().uuid(),
  amount: quantityField.refine((v) => toCents(v) > 0n, 'Move at least something'),
});

function holds(req: Request, permission: string): boolean {
  if (req.factionRole === 'admin' || req.factionRole === 'superadmin') return true;
  return (req.factionPermissions ?? []).includes(permission);
}

function firstIssue(err: z.ZodError): string {
  return err.issues[0]?.message ?? 'Invalid input';
}

// ── reading ───────────────────────────────────────────

async function roomOf(id: string, roomId: string) {
  const [room] = await db.select().from(storageRooms)
    .where(and(eq(storageRooms.id, roomId), eq(storageRooms.factionId, id)));
  return room ?? null;
}

/** A room with its containers and everything in them, the way the screen draws it. */
async function roomDetail(id: string, roomId: string) {
  const room = await roomOf(id, roomId);
  if (!room) return null;
  const containers = await db.select({
    id: storageContainers.id,
    kind: storageContainers.kind,
    name: storageContainers.name,
    color: storageContainers.color,
    tags: storageContainers.tags,
    x: storageContainers.x,
    y: storageContainers.y,
    w: storageContainers.w,
    h: storageContainers.h,
    capacity: storageContainers.capacity,
    notes: storageContainers.notes,
    checkedAt: storageContainers.checkedAt,
    checkedByName: memberName,
  })
    .from(storageContainers)
    .leftJoin(users, eq(storageContainers.checkedBy, users.id))
    .where(eq(storageContainers.roomId, roomId))
    .orderBy(asc(storageContainers.y), asc(storageContainers.x));

  const ids = containers.map((c) => c.id);
  const contents = ids.length
    ? await db.select({
      id: storageContents.id,
      containerId: storageContents.containerId,
      itemTypeId: storageContents.itemTypeId,
      label: storageContents.label,
      quantity: storageContents.quantity,
      minQuantity: storageContents.minQuantity,
      maxQuantity: storageContents.maxQuantity,
      updatedAt: storageContents.updatedAt,
    })
      .from(storageContents)
      .where(inArray(storageContents.containerId, ids))
      .orderBy(asc(storageContents.label))
    : [];

  const byContainer = new Map<string, typeof contents>();
  for (const c of contents) byContainer.set(c.containerId, [...(byContainer.get(c.containerId) ?? []), c]);

  return {
    room,
    containers: containers.map((c) => ({
      ...c,
      checkedByName: c.checkedAt ? c.checkedByName : null,
      contents: byContainer.get(c.id) ?? [],
    })),
  };
}

/** Is this faction's storage held to its treasury? */
async function isLinked(id: string, handle: TransactionLike | typeof db = db): Promise<boolean> {
  const [row] = await handle.select({ linked: factions.storageLinked }).from(factions).where(eq(factions.id, id));
  return row?.linked ?? true;
}

router.get('/rooms', async (req: Request, res: Response) => {
  const linked = await isLinked(factionId(req));
  const rows = await db.select({
    id: storageRooms.id,
    name: storageRooms.name,
    width: storageRooms.width,
    height: storageRooms.height,
    mapMarkerId: storageRooms.mapMarkerId,
    sortOrder: storageRooms.sortOrder,
    // Spelled out: inside a subquery Drizzle writes the column unqualified,
    // and a bare "id" there means the container's own id.
    containerCount: sql<number>`(SELECT COUNT(*)::int FROM storage_containers c WHERE c.room_id = storage_rooms.id)`,
  })
    .from(storageRooms)
    .where(eq(storageRooms.factionId, factionId(req)))
    .orderBy(asc(storageRooms.sortOrder), asc(storageRooms.createdAt));
  success(res, { rooms: rows, linked });
});

// Linking storage to the treasury, or not. Drawing rooms is the authority
// that decides how storage works, so it is the same permission.
router.patch('/settings', requirePermission('manage_storage'), async (req: Request, res: Response) => {
  const parsed = z.object({ linked: z.boolean() }).safeParse(req.body ?? {});
  if (!parsed.success) {
    error(res, 'VALIDATION_ERROR', 'Say whether storage is linked to the treasury');
    return;
  }
  await db.update(factions).set({ storageLinked: parsed.data.linked }).where(eq(factions.id, factionId(req)));
  await createAuditLog({
    userId: req.user!.id, factionId: factionId(req), action: 'update', entityType: 'storage_settings',
    entityId: factionId(req), details: { linked: parsed.data.linked }, req,
  });
  success(res, { linked: parsed.data.linked });
});

router.get('/rooms/:roomId', async (req: Request, res: Response) => {
  const detail = await roomDetail(factionId(req), req.params.roomId as string);
  if (!detail) {
    error(res, 'NOT_FOUND', 'No such room', 404);
    return;
  }
  success(res, detail);
});

// "Where is X?" across every room: each container holding something whose
// name matches.
router.get('/search', async (req: Request, res: Response) => {
  const q = typeof req.query.q === 'string' ? req.query.q.trim() : '';
  if (q.length < 1) {
    success(res, { results: [] });
    return;
  }
  const pattern = `%${q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
  const rows = await db.select({
    roomId: storageRooms.id,
    roomName: storageRooms.name,
    containerId: storageContainers.id,
    containerName: storageContainers.name,
    contentId: storageContents.id,
    itemTypeId: storageContents.itemTypeId,
    label: storageContents.label,
    quantity: storageContents.quantity,
  })
    .from(storageContents)
    .innerJoin(storageContainers, eq(storageContents.containerId, storageContainers.id))
    .innerJoin(storageRooms, eq(storageContainers.roomId, storageRooms.id))
    .where(and(eq(storageContents.factionId, factionId(req)), ilike(storageContents.label, pattern)))
    .orderBy(asc(storageRooms.name), asc(storageContainers.name))
    .limit(200);
  success(res, { results: rows });
});

// What the books say the faction owns next to what is counted in storage,
// per item. Only items somebody put in storage or the treasury holds.
router.get('/compare', async (req: Request, res: Response) => {
  const id = factionId(req);
  const [stored, balances] = await Promise.all([
    db.select({
      itemTypeId: storageContents.itemTypeId,
      total: sql<string>`COALESCE(SUM(${storageContents.quantity}), 0)::text`,
      containers: sql<number>`COUNT(DISTINCT ${storageContents.containerId})::int`,
    })
      .from(storageContents)
      .where(and(eq(storageContents.factionId, id), sql`${storageContents.itemTypeId} IS NOT NULL`))
      .groupBy(storageContents.itemTypeId),
    computeTreasuryBalances(id, { onlyWithActivity: true }),
  ]);

  const storedBy = new Map(stored.map((s) => [s.itemTypeId!, s]));
  const items = await db.select({ id: itemTypes.id, name: itemTypes.name, unit: itemTypes.unit, isCurrency: itemTypes.isCurrency })
    .from(itemTypes).where(eq(itemTypes.factionId, id));

  const rows = items
    .map((item) => {
      const balance = balances.find((b) => b.itemTypeId === item.id);
      const s = storedBy.get(item.id);
      return {
        itemTypeId: item.id,
        name: item.name,
        unit: item.unit,
        isCurrency: item.isCurrency,
        inBooks: balance ? balance.balance.toFixed(2) : null,
        inStorage: s ? fromCents(toCents(s.total)) : '0.00',
        containers: s?.containers ?? 0,
      };
    })
    .filter((r) => r.inBooks !== null || r.containers > 0)
    .sort((a, b) => a.name.localeCompare(b.name));
  success(res, { items: rows });
});

router.get('/containers/:containerId/history', async (req: Request, res: Response) => {
  const rows = await db.select({
    id: storageMovements.id,
    kind: storageMovements.kind,
    label: storageMovements.label,
    amount: storageMovements.amount,
    before: storageMovements.before,
    containerId: storageMovements.containerId,
    containerName: storageMovements.containerName,
    toContainerId: storageMovements.toContainerId,
    toContainerName: storageMovements.toContainerName,
    userName: memberName,
    createdAt: storageMovements.createdAt,
  })
    .from(storageMovements)
    .innerJoin(users, eq(storageMovements.userId, users.id))
    .where(and(
      eq(storageMovements.factionId, factionId(req)),
      sql`(${storageMovements.containerId} = ${req.params.containerId} OR ${storageMovements.toContainerId} = ${req.params.containerId})`,
    ))
    .orderBy(desc(storageMovements.createdAt))
    .limit(100);
  success(res, { history: rows });
});

// ── rooms and layout (manage_storage) ─────────────────

type ContainerInput = z.infer<typeof containerSchema>;

function containerValues(c: Omit<ContainerInput, 'id'>) {
  return {
    kind: c.kind,
    name: c.name,
    color: c.color ?? null,
    tags: [...new Set((c.tags ?? []).map((t) => t.trim()).filter(Boolean))],
    x: c.x,
    y: c.y,
    w: c.w,
    h: c.h,
    capacity: c.capacity ?? null,
    notes: c.notes ?? null,
  };
}

router.post('/rooms', requirePermission('manage_storage'), async (req: Request, res: Response) => {
  const id = factionId(req);
  const parsed = createRoomSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    error(res, 'VALIDATION_ERROR', firstIssue(parsed.error));
    return;
  }
  const { name, width, height, tiles = [], containers = [] } = parsed.data;
  const problem = layoutProblem(width, height, tiles, containers);
  if (problem) {
    error(res, 'VALIDATION_ERROR', problem);
    return;
  }

  const room = await db.transaction(async (tx: TransactionLike) => {
    const [row] = await tx.insert(storageRooms).values({
      factionId: id, name, width, height, tiles, createdBy: req.user!.id,
    }).returning();
    if (containers.length > 0) {
      await tx.insert(storageContainers).values(containers.map((c) => ({
        factionId: id, roomId: row!.id, ...containerValues(c),
      })));
    }
    await createAuditLog({
      userId: req.user!.id, factionId: id, action: 'create', entityType: 'storage_room',
      entityId: row!.id, details: { name, width, height, containers: containers.length }, req, tx,
    });
    return row!;
  });

  success(res, room, 201);
});

router.patch('/rooms/:roomId', requirePermission('manage_storage'), async (req: Request, res: Response) => {
  const id = factionId(req);
  const parsed = updateRoomSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    error(res, 'VALIDATION_ERROR', firstIssue(parsed.error));
    return;
  }
  const room = await roomOf(id, req.params.roomId as string);
  if (!room) {
    error(res, 'NOT_FOUND', 'No such room', 404);
    return;
  }
  if (parsed.data.mapMarkerId) {
    const [marker] = await db.select({ id: mapMarkers.id }).from(mapMarkers)
      .where(and(eq(mapMarkers.id, parsed.data.mapMarkerId), eq(mapMarkers.factionId, id)));
    if (!marker) {
      error(res, 'VALIDATION_ERROR', 'That map pin is not one of this faction\'s');
      return;
    }
  }
  const [row] = await db.update(storageRooms)
    .set({ ...parsed.data, updatedAt: new Date() })
    .where(eq(storageRooms.id, room.id))
    .returning();
  success(res, row);
});

/**
 * Save a room's whole drawing at once: size, walls and doors, and every
 * container. The editor works on a copy with its own undo, so saving is one
 * request, and a room is never left half-redrawn.
 *
 * A container sent with its id keeps its contents; one sent without is new;
 * one left out is removed, and what was in it with it. The editor asks before
 * sending a layout that removes a container with something in it.
 */
router.put('/rooms/:roomId/layout', requirePermission('manage_storage'), async (req: Request, res: Response) => {
  const id = factionId(req);
  const parsed = layoutSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    error(res, 'VALIDATION_ERROR', firstIssue(parsed.error));
    return;
  }
  const room = await roomOf(id, req.params.roomId as string);
  if (!room) {
    error(res, 'NOT_FOUND', 'No such room', 404);
    return;
  }
  const { width, height, tiles, containers } = parsed.data;
  const problem = layoutProblem(width, height, tiles, containers);
  if (problem) {
    error(res, 'VALIDATION_ERROR', problem);
    return;
  }

  const existing = await db.select({ id: storageContainers.id, name: storageContainers.name })
    .from(storageContainers).where(eq(storageContainers.roomId, room.id));
  const existingIds = new Set(existing.map((c) => c.id));
  const unknown = containers.find((c) => c.id && !existingIds.has(c.id));
  if (unknown) {
    error(res, 'VALIDATION_ERROR', `"${unknown.name}" is not in this room any more — reload and try again`, 409);
    return;
  }
  const kept = new Set(containers.map((c) => c.id).filter(Boolean));
  const removed = existing.filter((c) => !kept.has(c.id));

  await db.transaction(async (tx: TransactionLike) => {
    await tx.update(storageRooms)
      .set({ width, height, tiles, updatedAt: new Date() })
      .where(eq(storageRooms.id, room.id));
    if (removed.length > 0) {
      await tx.delete(storageContainers).where(inArray(storageContainers.id, removed.map((c) => c.id)));
    }
    for (const c of containers) {
      if (c.id) {
        await tx.update(storageContainers)
          .set({ ...containerValues(c), updatedAt: new Date() })
          .where(eq(storageContainers.id, c.id));
      } else {
        await tx.insert(storageContainers).values({ factionId: id, roomId: room.id, ...containerValues(c) });
      }
    }
    await createAuditLog({
      userId: req.user!.id, factionId: id, action: 'update', entityType: 'storage_room',
      entityId: room.id,
      details: { width, height, containers: containers.length, removed: removed.map((c) => c.name) },
      req, tx,
    });
  });

  success(res, await roomDetail(id, room.id));
});

router.delete('/rooms/:roomId', requirePermission('manage_storage'), async (req: Request, res: Response) => {
  const id = factionId(req);
  const room = await roomOf(id, req.params.roomId as string);
  if (!room) {
    error(res, 'NOT_FOUND', 'No such room', 404);
    return;
  }
  await db.transaction(async (tx: TransactionLike) => {
    await tx.delete(storageRooms).where(eq(storageRooms.id, room.id));
    await createAuditLog({
      userId: req.user!.id, factionId: id, action: 'delete', entityType: 'storage_room',
      entityId: room.id, details: { name: room.name }, req, tx,
    });
  });
  success(res, { id: room.id, deleted: true });
});

// ── counts (update_storage) ───────────────────────────

/** Lock a container and read it with everything in it. */
async function lockContainer(tx: TransactionLike, id: string, containerId: string) {
  await tx.execute(sql`SELECT id FROM storage_containers WHERE id = ${containerId} AND faction_id = ${id} FOR UPDATE`);
  const [container] = await tx.select({
    id: storageContainers.id,
    name: storageContainers.name,
    capacity: storageContainers.capacity,
    roomName: storageRooms.name,
  })
    .from(storageContainers)
    .innerJoin(storageRooms, eq(storageContainers.roomId, storageRooms.id))
    .where(and(eq(storageContainers.id, containerId), eq(storageContainers.factionId, id)));
  if (!container) return null;
  const contents = await tx.select().from(storageContents).where(eq(storageContents.containerId, containerId));
  return { container, contents };
}

const sumOf = (rows: { quantity: string }[]) => rows.reduce((s, r) => s + toCents(r.quantity), 0n);

class Refusal extends Error {
  constructor(message: string, public status = 400) { super(message); }
}

interface LowStock { roomName: string; containerName: string; label: string; quantity: string; minQuantity: string }

async function logMovement(tx: TransactionLike, row: {
  factionId: string; userId: string; kind: StorageMovementKind;
  containerId: string; containerName: string; toContainerId?: string; toContainerName?: string;
  itemTypeId: string | null; label: string; amount: string; before?: string; payoutId?: string;
}) {
  await tx.insert(storageMovements).values(row);
}

// ── storage held to the treasury ──────────────────────
//
// With the faction's storage linked (the default), a line of one of its own
// items is a place where part of the treasury physically is. So:
//
// - putting more away is refused past what the treasury holds, counted over
//   every container — nobody can store pistols the books never had;
// - taking some out is a withdrawal: a completed payout to whoever took it,
//   linked from the container's history;
// - moving between containers, correcting a count down and removing a line
//   are bookkeeping about *where* things are, and touch nothing.
//
// Typed-in items that are not one of the faction's item types have no
// treasury to be held to and are never linked. The item type is locked first,
// the way crafting locks it, so two people storing at once cannot both use
// the same last units.

async function storedTotal(tx: TransactionLike, id: string, itemTypeId: string): Promise<bigint> {
  const [row] = await tx.select({ total: sql<string>`COALESCE(SUM(${storageContents.quantity}), 0)::text` })
    .from(storageContents)
    .where(and(eq(storageContents.factionId, id), eq(storageContents.itemTypeId, itemTypeId)));
  return toCents(row?.total ?? '0');
}

/** Refuse putting `growth` more of an item away than the treasury holds. */
async function ensureTreasuryHolds(tx: TransactionLike, id: string, itemTypeId: string, label: string, growth: bigint) {
  await lockItemTypes(tx, [itemTypeId]);
  const balance = toCents((await balancesFor(id, [itemTypeId], tx)).get(itemTypeId) ?? '0');
  const stored = await storedTotal(tx, id, itemTypeId);
  if (stored + growth > balance) {
    const room = balance - stored > 0n ? balance - stored : 0n;
    throw new Refusal(
      `The treasury holds ${fromCents(balance)} ${label} and ${fromCents(stored)} are already in storage, so at most ${fromCents(room)} more can go in. Log them into the treasury first.`,
    );
  }
}

/** Taking out of storage: a completed withdrawal to whoever took it. */
async function withdrawFromTreasury(
  tx: TransactionLike,
  req: Request,
  id: string,
  line: { itemTypeId: string; label: string },
  where: { containerName: string; roomName: string },
  amount: bigint,
) {
  await lockItemTypes(tx, [line.itemTypeId]);
  const balance = toCents((await balancesFor(id, [line.itemTypeId], tx)).get(line.itemTypeId) ?? '0');
  if (balance < amount) {
    throw new Refusal(
      `The treasury shows only ${fromCents(balance > 0n ? balance : 0n)} ${line.label}, so ${fromCents(amount)} cannot be withdrawn. If the count here is wrong, correct it with "It is exactly this" instead.`,
    );
  }
  const [payout] = await tx.insert(payouts).values({
    factionId: id,
    recipientUserId: req.user!.id,
    createdBy: req.user!.id,
    itemTypeId: line.itemTypeId,
    amount: fromCents(amount),
    description: `Taken from storage: ${where.containerName} (${where.roomName})`,
    payoutDate: new Date().toISOString().slice(0, 10),
    status: 'completed',
    approvedBy: req.user!.id,
    approvedAt: new Date(),
  }).returning();
  await createAuditLog({
    userId: req.user!.id, factionId: id, action: 'create', entityType: 'payout', entityId: payout!.id,
    details: { itemTypeId: line.itemTypeId, amount: payout!.amount, status: 'completed', storage: where }, req, tx,
  });
  return payout!;
}

function alertLow(id: string, actorUserId: string, low: LowStock | null) {
  if (!low) return;
  void dispatchDiscord(id, { type: 'storage_low', actorUserId, ...low });
}

router.post('/containers/:containerId/contents', requirePermission('update_storage'), async (req: Request, res: Response) => {
  const id = factionId(req);
  const parsed = addContentSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    error(res, 'VALIDATION_ERROR', firstIssue(parsed.error));
    return;
  }
  const { itemTypeId, quantity, minQuantity = null, maxQuantity = null } = parsed.data;

  let label = parsed.data.label ?? '';
  if (itemTypeId) {
    const [item] = await db.select({ name: itemTypes.name }).from(itemTypes)
      .where(and(eq(itemTypes.id, itemTypeId), eq(itemTypes.factionId, id)));
    if (!item) {
      error(res, 'VALIDATION_ERROR', 'That item is not one of this faction\'s');
      return;
    }
    label = item.name;
  }

  try {
    const row = await db.transaction(async (tx: TransactionLike) => {
      const locked = await lockContainer(tx, id, req.params.containerId as string);
      if (!locked) throw new Refusal('No such container', 404);
      const { container, contents } = locked;
      const twin = contents.find((c) => (itemTypeId
        ? c.itemTypeId === itemTypeId
        : c.itemTypeId === null && c.label.toLowerCase() === label.toLowerCase()));
      if (twin) throw new Refusal(`${label} is already in ${container.name} — change its count instead`, 409);
      if (contents.length >= MAX_CONTENTS_PER_CONTAINER) throw new Refusal('This container already lists as many things as it can');

      const before = sumOf(contents);
      const problem = fitProblem({
        label, quantity, previousQuantity: '0',
        total: fromCents(before + toCents(quantity)), previousTotal: fromCents(before),
        capacity: container.capacity, maxQuantity,
      });
      if (problem) throw new Refusal(problem);
      if (itemTypeId && await isLinked(id, tx)) {
        await ensureTreasuryHolds(tx, id, itemTypeId, label, toCents(quantity));
      }

      const [created] = await tx.insert(storageContents).values({
        factionId: id, containerId: container.id, itemTypeId: itemTypeId ?? null, label,
        quantity, minQuantity, maxQuantity,
      }).returning();
      await logMovement(tx, {
        factionId: id, userId: req.user!.id, kind: 'add', containerId: container.id,
        containerName: container.name, itemTypeId: itemTypeId ?? null, label, amount: quantity,
      });
      return created!;
    });
    success(res, row, 201);
  } catch (err) {
    if (err instanceof Refusal) {
      error(res, err.status === 404 ? 'NOT_FOUND' : 'VALIDATION_ERROR', err.message, err.status);
      return;
    }
    throw err;
  }
});

async function contentOf(id: string, contentId: string) {
  const [row] = await db.select({ containerId: storageContents.containerId }).from(storageContents)
    .where(and(eq(storageContents.id, contentId), eq(storageContents.factionId, id)));
  return row ?? null;
}

router.patch('/contents/:contentId', requirePermission('update_storage'), async (req: Request, res: Response) => {
  const id = factionId(req);
  const parsed = changeContentSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    error(res, 'VALIDATION_ERROR', firstIssue(parsed.error));
    return;
  }
  const found = await contentOf(id, req.params.contentId as string);
  if (!found) {
    error(res, 'NOT_FOUND', 'Not in storage any more', 404);
    return;
  }

  let low: LowStock | null = null;
  let withdrawal: typeof payouts.$inferSelect | null = null;
  try {
    const row = await db.transaction(async (tx: TransactionLike) => {
      const locked = await lockContainer(tx, id, found.containerId);
      if (!locked) throw new Refusal('No such container', 404);
      const { container, contents } = locked;
      const line = contents.find((c) => c.id === req.params.contentId);
      if (!line) throw new Refusal('Not in storage any more', 404);

      const { delta, quantity: setTo } = parsed.data;
      const minQuantity = parsed.data.minQuantity !== undefined ? parsed.data.minQuantity : line.minQuantity;
      const maxQuantity = parsed.data.maxQuantity !== undefined ? parsed.data.maxQuantity : line.maxQuantity;
      if (minQuantity !== null && maxQuantity !== null && toCents(minQuantity) > toCents(maxQuantity)) {
        throw new Refusal('The minimum is above the maximum');
      }

      let next = toCents(line.quantity);
      if (delta !== undefined) next += toCents(delta.replace('-', '')) * (delta.startsWith('-') ? -1n : 1n);
      if (setTo !== undefined) next = toCents(setTo);
      if (next < 0n) throw new Refusal(`There are only ${line.quantity} ${line.label} in ${container.name}`);

      const before = sumOf(contents);
      const total = before - toCents(line.quantity) + next;
      const problem = fitProblem({
        label: line.label, quantity: fromCents(next), previousQuantity: line.quantity,
        total: fromCents(total), previousTotal: fromCents(before),
        capacity: container.capacity, maxQuantity,
      });
      if (problem) throw new Refusal(problem);

      const change = next - toCents(line.quantity);
      const linked = line.itemTypeId !== null && await isLinked(id, tx);
      if (linked && change > 0n) {
        await ensureTreasuryHolds(tx, id, line.itemTypeId!, line.label, change);
      }
      // Only taking is a withdrawal; a correction down says where things are not.
      if (linked && change < 0n && setTo === undefined) {
        withdrawal = await withdrawFromTreasury(
          tx, req, id, { itemTypeId: line.itemTypeId!, label: line.label },
          { containerName: container.name, roomName: container.roomName }, -change,
        );
      }

      const [updated] = await tx.update(storageContents)
        .set({ quantity: fromCents(next), minQuantity, maxQuantity, updatedAt: new Date() })
        .where(eq(storageContents.id, line.id))
        .returning();

      if (change !== 0n) {
        await logMovement(tx, {
          factionId: id, userId: req.user!.id,
          kind: setTo !== undefined ? 'set' : change > 0n ? 'add' : 'take',
          containerId: container.id, containerName: container.name,
          itemTypeId: line.itemTypeId, label: line.label,
          amount: fromCents(change < 0n ? -change : change),
          ...(setTo !== undefined ? { before: line.quantity } : {}),
          ...(withdrawal ? { payoutId: (withdrawal as { id: string }).id } : {}),
        });
      }
      if (droppedBelowMin(line.quantity, fromCents(next), minQuantity)) {
        low = {
          roomName: container.roomName, containerName: container.name, label: line.label,
          quantity: fromCents(next), minQuantity: minQuantity!,
        };
      }
      return updated!;
    });
    alertLow(id, req.user!.id, low);
    const paid = withdrawal as (typeof payouts.$inferSelect) | null;
    if (paid) {
      void dispatchDiscord(id, {
        type: 'payout_completed', actorUserId: req.user!.id, recipientUserId: paid.recipientUserId,
        itemTypeId: paid.itemTypeId, amount: paid.amount,
      });
    }
    success(res, { ...row, withdrawal: paid ? { id: paid.id, amount: paid.amount } : null });
  } catch (err) {
    if (err instanceof Refusal) {
      error(res, err.status === 404 ? 'NOT_FOUND' : 'VALIDATION_ERROR', err.message, err.status);
      return;
    }
    throw err;
  }
});

router.delete('/contents/:contentId', requirePermission('update_storage'), async (req: Request, res: Response) => {
  const id = factionId(req);
  const found = await contentOf(id, req.params.contentId as string);
  if (!found) {
    error(res, 'NOT_FOUND', 'Not in storage any more', 404);
    return;
  }
  await db.transaction(async (tx: TransactionLike) => {
    const locked = await lockContainer(tx, id, found.containerId);
    const line = locked?.contents.find((c) => c.id === req.params.contentId);
    if (!locked || !line) return;
    await tx.delete(storageContents).where(eq(storageContents.id, line.id));
    await logMovement(tx, {
      factionId: id, userId: req.user!.id, kind: 'remove',
      containerId: locked.container.id, containerName: locked.container.name,
      itemTypeId: line.itemTypeId, label: line.label, amount: line.quantity,
    });
  });
  success(res, { id: req.params.contentId, deleted: true });
});

/**
 * Move some of one line into another container.
 *
 * Merges into the same item there if it is already listed, and otherwise adds
 * it — carrying no minimum or maximum across, since those were about the
 * container it came from. Both containers are locked, in id order, so two
 * moves in opposite directions cannot deadlock.
 */
router.post('/contents/:contentId/move', requirePermission('update_storage'), async (req: Request, res: Response) => {
  const id = factionId(req);
  const parsed = moveSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    error(res, 'VALIDATION_ERROR', firstIssue(parsed.error));
    return;
  }
  const found = await contentOf(id, req.params.contentId as string);
  if (!found) {
    error(res, 'NOT_FOUND', 'Not in storage any more', 404);
    return;
  }
  const { toContainerId, amount } = parsed.data;
  if (toContainerId === found.containerId) {
    error(res, 'VALIDATION_ERROR', 'It is already there');
    return;
  }

  let low: LowStock | null = null;
  try {
    await db.transaction(async (tx: TransactionLike) => {
      const [firstId, secondId] = [found.containerId, toContainerId].sort();
      const first = await lockContainer(tx, id, firstId!);
      const second = await lockContainer(tx, id, secondId!);
      const from = first?.container.id === found.containerId ? first : second;
      const to = first?.container.id === toContainerId ? first : second;
      if (!from || !to) throw new Refusal('No such container', 404);

      const line = from.contents.find((c) => c.id === req.params.contentId);
      if (!line) throw new Refusal('Not in storage any more', 404);
      const moving = toCents(amount);
      const left = toCents(line.quantity) - moving;
      if (left < 0n) throw new Refusal(`There are only ${line.quantity} ${line.label} in ${from.container.name}`);

      const twin = to.contents.find((c) => (line.itemTypeId
        ? c.itemTypeId === line.itemTypeId
        : c.itemTypeId === null && c.label.toLowerCase() === line.label.toLowerCase()));
      const before = sumOf(to.contents);
      const arriving = (twin ? toCents(twin.quantity) : 0n) + moving;
      const problem = fitProblem({
        label: line.label, quantity: fromCents(arriving), previousQuantity: twin?.quantity ?? '0',
        total: fromCents(before + moving), previousTotal: fromCents(before),
        capacity: to.container.capacity, maxQuantity: twin?.maxQuantity ?? null,
      });
      if (problem) throw new Refusal(`${to.container.name}: ${problem}`);
      if (!twin && to.contents.length >= MAX_CONTENTS_PER_CONTAINER) {
        throw new Refusal(`${to.container.name} already lists as many things as it can`);
      }

      await tx.update(storageContents).set({ quantity: fromCents(left), updatedAt: new Date() })
        .where(eq(storageContents.id, line.id));
      if (twin) {
        await tx.update(storageContents).set({ quantity: fromCents(arriving), updatedAt: new Date() })
          .where(eq(storageContents.id, twin.id));
      } else {
        await tx.insert(storageContents).values({
          factionId: id, containerId: to.container.id, itemTypeId: line.itemTypeId,
          label: line.label, quantity: fromCents(arriving),
        });
      }
      await logMovement(tx, {
        factionId: id, userId: req.user!.id, kind: 'move',
        containerId: from.container.id, containerName: from.container.name,
        toContainerId: to.container.id, toContainerName: to.container.name,
        itemTypeId: line.itemTypeId, label: line.label, amount,
      });
      if (droppedBelowMin(line.quantity, fromCents(left), line.minQuantity)) {
        low = {
          roomName: from.container.roomName, containerName: from.container.name, label: line.label,
          quantity: fromCents(left), minQuantity: line.minQuantity!,
        };
      }
    });
    alertLow(id, req.user!.id, low);
    success(res, { moved: amount });
  } catch (err) {
    if (err instanceof Refusal) {
      error(res, err.status === 404 ? 'NOT_FOUND' : 'VALIDATION_ERROR', err.message, err.status);
      return;
    }
    throw err;
  }
});

// Stocktake: "I looked, and every count in here is right."
router.post('/containers/:containerId/checked', requirePermission('update_storage'), async (req: Request, res: Response) => {
  const [row] = await db.update(storageContainers)
    .set({ checkedAt: new Date(), checkedBy: req.user!.id })
    .where(and(eq(storageContainers.id, req.params.containerId as string), eq(storageContainers.factionId, factionId(req))))
    .returning({ id: storageContainers.id, checkedAt: storageContainers.checkedAt });
  if (!row) {
    error(res, 'NOT_FOUND', 'No such container', 404);
    return;
  }
  success(res, row);
});

export default router;
