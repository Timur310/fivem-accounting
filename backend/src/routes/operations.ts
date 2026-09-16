import { Request, Response } from 'express';
import { asyncRouter } from '../lib/asyncRouter.js';
import { z } from 'zod';
import { and, desc, eq, inArray, sql } from 'drizzle-orm';
import { db, type TransactionLike } from '../db/index.js';
import {
  entries,
  factionMembers,
  itemTypes,
  operationLoot,
  operationMovements,
  operationParticipants,
  operations,
  users,
  OPERATION_KINDS,
} from '../db/schema.js';
import { success, error } from '../lib/response.js';
import { requireAuth } from '../middleware/auth.js';
import { requireFactionMember, requirePermission } from '../middleware/factionAccess.js';
import { createAuditLog } from '../lib/audit.js';
import { dispatchDiscord } from '../lib/discordDispatch.js';
import { resolveAnonymousUserId } from '../lib/anonymous.js';
import { balancesFor, lockItemTypes, toCents } from '../lib/treasury.js';
import { compareQuantity } from '../lib/crafting.js';
import { splitHaul, type SplitLine } from '../lib/operations.js';

/**
 * Jobs the crew ran together, and the split of what they brought back.
 *
 * Everything about this route exists to replace one conversation: four people
 * come back from a bank with cash and gold, and then argue in Discord about
 * who logs what. Logging it here is one form — who was there, what came back,
 * what the faction takes off the top — and the app writes an entry per person
 * per item that adds up to the haul exactly.
 *
 * **Reading is open to the faction; logging needs `log_operations`; reverting
 * needs `manage_operations`.** The crew can record their own night's work.
 * Taking a whole split back out of everybody's totals is leadership, the same
 * way reverting a sale is.
 */
const router = asyncRouter({ mergeParams: true });

router.use(requireAuth, requireFactionMember);

const factionId = (req: Request) => req.params.id as string;

/** A quantity as the ledger writes them: positive, two decimals, no commas. */
const quantity = z
  .string()
  .trim()
  .regex(/^\d+(\.\d{1,2})?$/, 'A quantity looks like 1500 or 1500.50')
  .refine((v) => toCents(v) > 0n, 'A loot line needs an amount above zero');

const participantSchema = z.object({
  userId: z.string().uuid(),
  // The weight, capped where it stops meaning anything: a crew member on 999
  // shares and one on 1 is already a rounding error away from taking it all.
  share: z.number().int().min(1).max(999).optional(),
});

const lootSchema = z.object({
  itemTypeId: z.string().uuid(),
  quantity,
});

const splitInputSchema = z.object({
  participants: z.array(participantSchema).min(1, 'An operation needs at least one person on it'),
  loot: z.array(lootSchema).min(1, 'An operation needs at least one thing taken'),
  factionCutPercent: z
    .string()
    .trim()
    .regex(/^\d+(\.\d{1,2})?$/)
    .refine((v) => toCents(v) <= toCents('100'), 'A cut cannot be more than all of it')
    .optional(),
});

const operationSchema = splitInputSchema.extend({
  name: z.string().trim().min(1, 'An operation needs a name').max(120),
  kind: z.enum(OPERATION_KINDS).optional(),
  location: z.string().trim().max(120).nullable().optional(),
  // Sent by the client as an ISO instant. Defaults to now, because the common
  // case is logging it the moment everybody is still in the voice channel.
  occurredAt: z.string().datetime().optional(),
  notes: z.string().max(2000).nullable().optional(),
});

/** One person can only be on the crew once, however the client built the list. */
function dedupeParticipants(list: { userId: string; share?: number }[]) {
  const seen = new Map<string, { userId: string; share: number }>();
  for (const p of list) {
    if (!seen.has(p.userId)) seen.set(p.userId, { userId: p.userId, share: p.share ?? 1 });
  }
  return [...seen.values()];
}

/** Loot lines for the same item type are one line, so the split runs once. */
function mergeLoot(list: { itemTypeId: string; quantity: string }[]) {
  const merged = new Map<string, bigint>();
  for (const line of list) {
    merged.set(line.itemTypeId, (merged.get(line.itemTypeId) ?? 0n) + toCents(line.quantity));
  }
  return [...merged.entries()].map(([itemTypeId, cents]) => ({
    itemTypeId,
    quantity: `${cents / 100n}.${(cents % 100n).toString().padStart(2, '0')}`,
  }));
}

/**
 * Check the crew are members and the loot is the faction's own, then split.
 *
 * Shared by the preview and the save so the numbers the crew agreed to on
 * screen are the numbers that get written — computed by the same code from the
 * same input, not by the browser and then trusted.
 */
async function prepare(id: string, body: z.infer<typeof splitInputSchema>): Promise<
  | { ok: true; participants: { userId: string; share: number }[]; loot: { itemTypeId: string; quantity: string }[]; names: Map<string, { name: string; unit: string; isCurrency: boolean; icon: string | null }>; lines: SplitLine[] }
  | { ok: false; status: number; code: 'NOT_FOUND' | 'VALIDATION_ERROR'; message: string }
> {
  const participants = dedupeParticipants(body.participants);
  const loot = mergeLoot(body.loot);

  const members = await db
    .select({ userId: factionMembers.userId })
    .from(factionMembers)
    .where(and(
      eq(factionMembers.factionId, id),
      inArray(factionMembers.userId, participants.map((p) => p.userId)),
    ));
  const onRoster = new Set(members.map((m) => m.userId));
  const stranger = participants.find((p) => !onRoster.has(p.userId));
  if (stranger) {
    return { ok: false, status: 404, code: 'NOT_FOUND', message: 'One of the people on this crew is not a member of the faction' };
  }

  const types = await db
    .select({ id: itemTypes.id, name: itemTypes.name, unit: itemTypes.unit, isCurrency: itemTypes.isCurrency, icon: itemTypes.icon })
    .from(itemTypes)
    .where(and(eq(itemTypes.factionId, id), inArray(itemTypes.id, loot.map((l) => l.itemTypeId))));
  const names = new Map(types.map((t) => [t.id, { name: t.name, unit: t.unit, isCurrency: t.isCurrency, icon: t.icon }]));
  if (names.size !== loot.length) {
    return { ok: false, status: 404, code: 'NOT_FOUND', message: 'One of these items is not one the faction tracks' };
  }

  const lines = splitHaul(loot, participants, body.factionCutPercent ?? '0');
  return { ok: true, participants, loot, names, lines };
}

/** The split turned round: what each person walks away with, in one list. */
function perMember(lines: SplitLine[]) {
  const totals = new Map<string, { itemTypeId: string; quantity: string }[]>();
  for (const line of lines) {
    for (const share of line.shares) {
      if (toCents(share.quantity) === 0n) continue;
      const list = totals.get(share.userId) ?? [];
      list.push({ itemTypeId: line.itemTypeId, quantity: share.quantity });
      totals.set(share.userId, list);
    }
  }
  return [...totals.entries()].map(([userId, items]) => ({ userId, items }));
}

// ── POST /preview — what the split would look like ────
//
// A POST that changes nothing, like the price quote: the crew and the haul are
// too big for a query string, and the answer has to come from the server so
// that what the crew sees before they agree is what actually gets written.

router.post('/preview', async (req: Request, res: Response) => {
  const body = splitInputSchema.parse(req.body);
  const prepared = await prepare(factionId(req), body);
  if (!prepared.ok) {
    error(res, prepared.code, prepared.message, prepared.status);
    return;
  }

  success(res, {
    lines: prepared.lines.map((line) => ({
      ...line,
      itemTypeName: prepared.names.get(line.itemTypeId)!.name,
      unit: prepared.names.get(line.itemTypeId)!.unit,
      isCurrency: prepared.names.get(line.itemTypeId)!.isCurrency,
    })),
    perMember: perMember(prepared.lines),
  });
});

// ── POST / — log it and book the split ────────────────

router.post('/', requirePermission('log_operations'), async (req: Request, res: Response) => {
  const body = operationSchema.parse(req.body);
  const id = factionId(req);

  const prepared = await prepare(id, body);
  if (!prepared.ok) {
    error(res, prepared.code, prepared.message, prepared.status);
    return;
  }

  const occurredAt = body.occurredAt ? new Date(body.occurredAt) : new Date();
  // The ledger works in dates, and the date that matters is the night of the
  // job — not the morning somebody finally wrote it down.
  const entryDate = occurredAt.toISOString().slice(0, 10);
  const cut = body.factionCutPercent ?? '0';

  const result = await db.transaction(async (tx: TransactionLike) => {
    await lockItemTypes(tx, prepared.loot.map((l) => l.itemTypeId));

    const [operation] = await tx
      .insert(operations)
      .values({
        factionId: id,
        name: body.name,
        kind: body.kind ?? 'other',
        location: body.location?.trim() || null,
        occurredAt,
        factionCutPercent: cut,
        notes: body.notes?.trim() || null,
        loggedBy: req.user!.id,
      })
      .returning();
    if (!operation) throw new Error('Failed to record the operation');

    await tx.insert(operationParticipants).values(
      prepared.participants.map((p) => ({ operationId: operation.id, userId: p.userId, share: p.share })),
    );
    await tx.insert(operationLoot).values(
      prepared.loot.map((l) => ({
        operationId: operation.id,
        itemTypeId: l.itemTypeId,
        itemTypeName: prepared.names.get(l.itemTypeId)!.name,
        quantity: l.quantity,
      })),
    );

    const anonymousUserId = await resolveAnonymousUserId(tx);
    const movements: (typeof operationMovements.$inferInsert)[] = [];

    // One entry per person per item. Ordinary entries on purpose: every
    // balance, quota, leaderboard and report in the app counts them already,
    // and not one of them had to learn what an operation is.
    const credit = async (
      userId: string,
      itemTypeId: string,
      amount: string,
      role: 'share' | 'faction_cut',
      description: string,
    ) => {
      // A share rounded to nothing writes no row. A zero on the treasury
      // screen reads as a mistake, and a crew member who was there but took
      // nothing is already on the operation's own record.
      if (toCents(amount) === 0n) return;
      const [entry] = await tx
        .insert(entries)
        .values({ factionId: id, userId, itemTypeId, amount, description, entryDate })
        .returning();
      if (!entry) throw new Error('Failed to record a share');
      movements.push({ operationId: operation.id, role, userId, itemTypeId, quantity: amount, entryId: entry.id });
    };

    for (const line of prepared.lines) {
      const itemName = prepared.names.get(line.itemTypeId)!.name;
      await credit(anonymousUserId, line.itemTypeId, line.factionCut, 'faction_cut',
        `${body.name} — faction cut (${itemName})`);
      for (const share of line.shares) {
        await credit(share.userId, line.itemTypeId, share.quantity, 'share',
          `${body.name} — share (${itemName})`);
      }
    }

    if (movements.length > 0) await tx.insert(operationMovements).values(movements);

    await createAuditLog({
      userId: req.user!.id,
      factionId: id,
      action: 'create',
      entityType: 'operation',
      entityId: operation.id,
      details: {
        name: operation.name,
        kind: operation.kind,
        crew: prepared.participants.length,
        factionCutPercent: cut,
        loot: prepared.loot.map((l) => ({ itemTypeName: prepared.names.get(l.itemTypeId)!.name, quantity: l.quantity })),
      },
      req,
      tx,
    });

    return operation;
  });

  const crewNames = await displayNames(prepared.participants.map((p) => p.userId));

  void dispatchDiscord(id, {
    type: 'operation_logged',
    actorUserId: req.user!.id,
    name: result.name,
    kind: result.kind,
    location: result.location,
    occurredAt: result.occurredAt.toISOString(),
    crew: prepared.participants.map((p) => crewNames.get(p.userId) ?? 'Someone'),
    loot: prepared.loot.map((l) => ({
      itemTypeName: prepared.names.get(l.itemTypeId)!.name,
      quantity: l.quantity,
      unit: prepared.names.get(l.itemTypeId)!.unit,
    })),
    factionCutPercent: cut,
  });

  success(res, {
    operation: result,
    lines: prepared.lines,
    perMember: perMember(prepared.lines),
  }, 201);
});

/** Display names for a handful of user ids, for a message with no roster. */
async function displayNames(userIds: string[]): Promise<Map<string, string>> {
  if (userIds.length === 0) return new Map();
  const rows = await db
    .select({ id: users.id, name: sql<string>`COALESCE(${users.inGameName}, ${users.username})` })
    .from(users)
    .where(inArray(users.id, [...new Set(userIds)]));
  return new Map(rows.map((r) => [r.id, r.name]));
}

// ── GET / — the log of what the faction has run ───────

router.get('/', async (req: Request, res: Response) => {
  const id = factionId(req);
  const limit = Math.min(Number(req.query.limit) || 50, 200);

  const rows = await db
    .select({
      id: operations.id,
      name: operations.name,
      kind: operations.kind,
      location: operations.location,
      occurredAt: operations.occurredAt,
      factionCutPercent: operations.factionCutPercent,
      notes: operations.notes,
      loggedBy: operations.loggedBy,
      loggedByName: sql<string>`COALESCE(${users.inGameName}, ${users.username})`,
      revertedAt: operations.revertedAt,
      createdAt: operations.createdAt,
    })
    .from(operations)
    .innerJoin(users, eq(operations.loggedBy, users.id))
    .where(eq(operations.factionId, id))
    .orderBy(desc(operations.occurredAt))
    .limit(limit);

  const ids = rows.map((r) => r.id);
  if (ids.length === 0) {
    success(res, { operations: [] });
    return;
  }

  const [loot, crew, moves] = await Promise.all([
    // Joined rather than snapshotted: the name on the row is what it was
    // called on the night, but `$` or `pcs` is how the number is written, and
    // a screen with neither has to guess.
    db
      .select({
        id: operationLoot.id,
        operationId: operationLoot.operationId,
        itemTypeId: operationLoot.itemTypeId,
        itemTypeName: operationLoot.itemTypeName,
        quantity: operationLoot.quantity,
        unit: itemTypes.unit,
        isCurrency: itemTypes.isCurrency,
      })
      .from(operationLoot)
      .innerJoin(itemTypes, eq(operationLoot.itemTypeId, itemTypes.id))
      .where(inArray(operationLoot.operationId, ids)),
    db
      .select({
        operationId: operationParticipants.operationId,
        userId: operationParticipants.userId,
        share: operationParticipants.share,
        name: sql<string>`COALESCE(${users.inGameName}, ${users.username})`,
      })
      .from(operationParticipants)
      .innerJoin(users, eq(operationParticipants.userId, users.id))
      .where(inArray(operationParticipants.operationId, ids)),
    db
      .select({
        operationId: operationMovements.operationId,
        role: operationMovements.role,
        userId: operationMovements.userId,
        itemTypeId: operationMovements.itemTypeId,
        quantity: operationMovements.quantity,
      })
      .from(operationMovements)
      .where(inArray(operationMovements.operationId, ids)),
  ]);

  success(res, {
    operations: rows.map((row) => ({
      ...row,
      loot: loot.filter((l) => l.operationId === row.id),
      crew: crew.filter((c) => c.operationId === row.id),
      movements: moves.filter((m) => m.operationId === row.id),
    })),
  });
});

// ── POST /:operationId/revert — take the whole split back out ──
//
// `manage_operations` rather than `log_operations`, mirroring sales and
// crafting: the crew books its own night, leadership unbooks it. A revert
// removes credit from several people's totals at once, which is not the same
// authority as adding your own.

router.post('/:operationId/revert', requirePermission('manage_operations'), async (req: Request, res: Response) => {
  const id = factionId(req);
  const operationId = req.params.operationId as string;

  const outcome = await db.transaction(async (tx: TransactionLike) => {
    const [operation] = await tx
      .select()
      .from(operations)
      .where(and(eq(operations.id, operationId), eq(operations.factionId, id)))
      .limit(1)
      .for('update');

    if (!operation) return { ok: false as const, code: 'NOT_FOUND' as const, message: 'Operation not found' };
    if (operation.revertedAt) {
      return { ok: false as const, code: 'ALREADY' as const, message: 'That operation has already been reverted.' };
    }

    const moves = await tx.select().from(operationMovements).where(eq(operationMovements.operationId, operationId));
    const itemTypeIds = [...new Set(moves.map((m) => m.itemTypeId))];
    await lockItemTypes(tx, itemTypeIds);

    // The haul went into the vault; reverting takes it back out. If it has
    // been paid out or spent since, undoing the split would drive the balance
    // below zero — a state the app allows, but never one it should walk into
    // sideways on a correction.
    const needed = new Map<string, bigint>();
    for (const m of moves) needed.set(m.itemTypeId, (needed.get(m.itemTypeId) ?? 0n) + toCents(m.quantity));
    const balances = await balancesFor(id, itemTypeIds, tx);
    for (const [itemTypeId, cents] of needed) {
      const have = balances.get(itemTypeId) ?? '0';
      const back = `${cents / 100n}.${(cents % 100n).toString().padStart(2, '0')}`;
      if (compareQuantity(have, back) < 0) {
        return {
          ok: false as const,
          code: 'OVERSPENT' as const,
          message: `Reverting needs ${back} back out and the treasury holds ${have}.`,
        };
      }
    }

    const entryIds = moves.map((m) => m.entryId).filter((x): x is string => !!x);
    // Soft-deleted, not removed: the ledger keeps saying what happened, and
    // every balance query in the app already ignores deleted rows.
    if (entryIds.length) {
      await tx.update(entries)
        .set({ isDeleted: true, updatedAt: new Date() })
        .where(inArray(entries.id, entryIds));
    }

    await tx.update(operations)
      .set({ revertedAt: new Date(), revertedBy: req.user!.id })
      .where(eq(operations.id, operationId));

    await createAuditLog({
      userId: req.user!.id,
      factionId: id,
      action: 'delete',
      entityType: 'operation',
      entityId: operationId,
      details: { name: operation.name, shares: moves.length },
      req,
      tx,
    });

    return { ok: true as const, operation };
  });

  if (!outcome.ok) {
    error(res, outcome.code === 'NOT_FOUND' ? 'NOT_FOUND' : 'VALIDATION_ERROR',
      outcome.message, outcome.code === 'NOT_FOUND' ? 404 : 400);
    return;
  }

  void dispatchDiscord(id, {
    type: 'operation_reverted',
    actorUserId: req.user!.id,
    name: outcome.operation.name,
    occurredAt: outcome.operation.occurredAt.toISOString(),
  });

  success(res, { reverted: true });
});

export default router;
