import { Request, Response } from 'express';
import { asyncRouter } from '../lib/asyncRouter.js';
import { z } from 'zod';
import { and, asc, desc, eq, isNull, lt, sql } from 'drizzle-orm';
import { db, type TransactionLike } from '../db/index.js';
import { shifts, users, SHIFT_KINDS } from '../db/schema.js';
import { success, error } from '../lib/response.js';
import { requireAuth } from '../middleware/auth.js';
import { requireFactionMember, requirePermission } from '../middleware/factionAccess.js';
import { requireModule } from '../lib/modules.js';
import { createAuditLog } from '../lib/audit.js';
import { dispatchDiscord } from '../lib/discordDispatch.js';
import { buildWhere } from '../lib/query.js';

/**
 * The timesheet: who was on duty, doing what, and for how long.
 *
 * For the factions that run a business in the city rather than a crew — a
 * restaurant, a garage, a taxi firm, a hospital. Somebody starts work, clocks
 * in, and clocks out when they are done, and at the end of the week there is a
 * record of who actually turned up instead of an argument about it.
 *
 * **Three permissions, which is one more than anything else here.**
 * `log_shifts` clocks yourself in and out. `view_shifts` reads everybody
 * else's — a rota is mildly sensitive, it says who was around and when, so a
 * faction can decide whether that is crew-wide or not. `manage_shifts`
 * corrects them after the fact, which is a different authority again: an
 * edited timesheet is somebody's hours being rewritten by another person.
 *
 * Without `view_shifts` every read here quietly narrows to the caller's own
 * shifts rather than refusing, so the screen works for everybody and simply
 * shows less.
 */
const router = asyncRouter({ mergeParams: true });

router.use(requireAuth, requireFactionMember, requireModule('shifts'));

const factionId = (req: Request) => req.params.id as string;

/** A shift nobody sane worked, which is what a forgotten clock-out looks like. */
const MAX_SHIFT_HOURS = 24;

/**
 * When an open shift starts to look forgotten rather than long.
 *
 * Half the hard cap. A twelve-hour stint is possible in a game people play all
 * evening, so this only flags it — the person, or a manager, closes it with the
 * time it really ended. Without the flag a forgotten shift sat on the duty
 * board as "on duty" indefinitely, and the clock-out refused it once it passed
 * the cap, so there was no obvious way out.
 */
const STALE_SHIFT_HOURS = 12;

/** A minute of slack for clocks that disagree about what "now" is. */
const CLOCK_SLACK_MS = 60_000;

/**
 * Does the caller hold this permission?
 *
 * Read off what `requireFactionMember` already resolved, and admits admins the
 * same way `requirePermission` does — a faction admin holding every permission
 * has to mean the same thing whether it is a middleware or a branch asking.
 */
function holds(req: Request, permission: string): boolean {
  if (req.factionRole === 'admin' || req.factionRole === 'superadmin') return true;
  return (req.factionPermissions ?? []).includes(permission);
}

/** May this caller see shifts other than their own? */
const canSeeEveryone = (req: Request) => holds(req, 'view_shifts');
/** May this caller change a shift that is not theirs? */
const canManage = (req: Request) => holds(req, 'manage_shifts');

/**
 * What the shift was, in the member's own words.
 *
 * `kind` says who it was for — the faction, or something the character does on
 * the side — and `position` says what they actually did, as free text. Nothing
 * here is a configured list: a faction should not have to define "delivery
 * driver" in a settings screen before somebody can clock in as one.
 */
const workFields = {
  kind: z.enum(SHIFT_KINDS).optional(),
  position: z.string().trim().max(60).nullable().optional(),
} as const;

const clockInSchema = z.object({
  ...workFields,
  location: z.string().trim().max(120).nullable().optional(),
  notes: z.string().trim().max(1000).nullable().optional(),
  /**
   * When the shift actually started, for somebody who remembers ten minutes
   * late. Never in the future: a shift that has not begun is not a shift, and
   * an open row dated tomorrow would sit on the rota as "on duty" until then.
   */
  startedAt: z.string().datetime({ offset: true }).optional(),
});

const clockOutSchema = z.object({
  endedAt: z.string().datetime({ offset: true }).optional(),
  breakMinutes: z.number().int().min(0).max(24 * 60).optional(),
  notes: z.string().trim().max(1000).nullable().optional(),
});

/** A whole shift at once: the one somebody forgot to clock at all. */
const manualSchema = z.object({
  ...workFields,
  userId: z.string().uuid().optional(),
  location: z.string().trim().max(120).nullable().optional(),
  notes: z.string().trim().max(1000).nullable().optional(),
  startedAt: z.string().datetime({ offset: true }),
  endedAt: z.string().datetime({ offset: true }),
  breakMinutes: z.number().int().min(0).max(24 * 60).optional(),
});

const editSchema = z.object({
  ...workFields,
  location: z.string().trim().max(120).nullable().optional(),
  notes: z.string().trim().max(1000).nullable().optional(),
  startedAt: z.string().datetime({ offset: true }).optional(),
  endedAt: z.string().datetime({ offset: true }).nullable().optional(),
  breakMinutes: z.number().int().min(0).max(24 * 60).optional(),
});

/**
 * A window bound: an exact instant, or a bare `YYYY-MM-DD`.
 *
 * The screen sends instants — the start and end of the month *in the viewer's
 * own timezone*. A bare day was all this took at first, and the server read it
 * as UTC midnight, which in Hungary is two in the morning: a shift started at
 * one a.m. on the first of the month was in neither month's view. Bare days
 * are still accepted so an old client or a hand-written URL keeps working.
 */
const windowBound = z.union([
  z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  z.string().datetime({ offset: true }),
]);

const listSchema = z.object({
  /** Where the window starts; inclusive. */
  from: windowBound.optional(),
  /** Where it ends: a bare day is inclusive, an instant is exclusive. */
  to: windowBound.optional(),
  userId: z.string().uuid().optional(),
  position: z.string().trim().max(60).optional(),
  kind: z.enum(SHIFT_KINDS).optional(),
  limit: z.coerce.number().int().min(1).max(500).default(200),
});

/**
 * What a pair of times is worth in minutes, after the break comes off.
 *
 * Null for a shift still running: an open shift has no length yet, and
 * counting one as "so far" would put a number in a weekly total that changes
 * every time the page is loaded.
 */
function workedMinutes(row: { startedAt: Date; endedAt: Date | null; breakMinutes: number }): number | null {
  if (!row.endedAt) return null;
  const gross = Math.round((row.endedAt.getTime() - row.startedAt.getTime()) / 60_000);
  return Math.max(0, gross - row.breakMinutes);
}

/** The checks every start/end pair has to pass, whoever is writing it. */
function validateSpan(startedAt: Date, endedAt: Date, breakMinutes: number):
  | { ok: true }
  | { ok: false; message: string } {
  if (endedAt.getTime() <= startedAt.getTime()) {
    return { ok: false, message: 'A shift has to end after it started' };
  }
  // Nothing checked this before, so a clock-out could be dated tomorrow and
  // count hours nobody had worked yet.
  if (endedAt.getTime() > Date.now() + CLOCK_SLACK_MS) {
    return { ok: false, message: 'A shift cannot end in the future' };
  }
  const gross = (endedAt.getTime() - startedAt.getTime()) / 3_600_000;
  if (gross > MAX_SHIFT_HOURS) {
    return { ok: false, message: `A shift cannot run longer than ${MAX_SHIFT_HOURS} hours` };
  }
  if (breakMinutes * 60_000 >= endedAt.getTime() - startedAt.getTime()) {
    return { ok: false, message: 'The break cannot be as long as the shift' };
  }
  return { ok: true };
}

const BARE_DAY = /^\d{4}-\d{2}-\d{2}$/;

/** Where a window starts, as an instant. */
function windowStart(bound: string): Date {
  return BARE_DAY.test(bound) ? new Date(`${bound}T00:00:00.000Z`) : new Date(bound);
}

/** Where a window ends, exclusively: the midnight after a bare day. */
function windowEnd(bound: string): Date {
  if (!BARE_DAY.test(bound)) return new Date(bound);
  const date = new Date(`${bound}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + 1);
  return date;
}

/**
 * Shifts that *overlap* the window, not only the ones that started inside it.
 *
 * Asking "did it start this month" was the midnight bug. A shift from 18:00 to
 * 02:00 started yesterday, so today's view never saw it, and the two hours
 * after midnight belonged to no day but the one before. A shift is in a window
 * if any minute of it is — including one still running.
 */
function overlaps(from?: string, to?: string) {
  return [
    to ? lt(shifts.startedAt, windowEnd(to)) : undefined,
    from
      ? sql`(${shifts.endedAt} IS NULL OR ${shifts.endedAt} > ${windowStart(from)})`
      : undefined,
  ];
}

/**
 * The worked minutes of a finished shift that fall inside the window.
 *
 * A shift that crosses the window's edge counts only its part inside — so a
 * night shift on the last day of the month is split between the two months
 * rather than counted twice or dropped from one. The break is shared out in
 * proportion to the time inside, because nothing records *when* it was taken.
 */
function clippedMinutes(from?: string, to?: string) {
  const start = from ? sql`GREATEST(${shifts.startedAt}, ${windowStart(from)})` : sql`${shifts.startedAt}`;
  const end = to ? sql`LEAST(${shifts.endedAt}, ${windowEnd(to)})` : sql`${shifts.endedAt}`;
  const inside = sql`GREATEST(0, EXTRACT(EPOCH FROM (${end} - ${start})) / 60)`;
  const gross = sql`NULLIF(EXTRACT(EPOCH FROM (${shifts.endedAt} - ${shifts.startedAt})) / 60, 0)`;
  return sql`GREATEST(0, ROUND(${inside} - ${shifts.breakMinutes} * ${inside} / ${gross}))`;
}

const memberName = sql<string>`COALESCE(${users.inGameName}, ${users.username})`;

/** The shape every endpoint here answers with, so one screen can read them all. */
const shiftColumns = {
  id: shifts.id,
  userId: shifts.userId,
  userName: memberName,
  avatarUrl: users.avatarUrl,
  kind: shifts.kind,
  position: shifts.position,
  location: shifts.location,
  startedAt: shifts.startedAt,
  endedAt: shifts.endedAt,
  breakMinutes: shifts.breakMinutes,
  notes: shifts.notes,
  editedBy: shifts.editedBy,
  createdAt: shifts.createdAt,
};

type ShiftRow = {
  startedAt: Date;
  endedAt: Date | null;
  breakMinutes: number;
};

/** The row as the client reads it, with the arithmetic already done. */
function present<T extends ShiftRow>(row: T) {
  return {
    ...row,
    workedMinutes: workedMinutes(row),
    /** Still open after long enough that it was probably forgotten. */
    stale: !row.endedAt && Date.now() - row.startedAt.getTime() > STALE_SHIFT_HOURS * 3_600_000,
  };
}

// ── GET / — the shifts in a window ────────────────────

router.get('/', async (req: Request, res: Response) => {
  const id = factionId(req);
  const query = listSchema.safeParse(req.query);
  if (!query.success) {
    error(res, 'VALIDATION_ERROR', query.error.issues[0]!.message);
    return;
  }

  // Narrowed rather than refused: somebody without `view_shifts` still has a
  // timesheet of their own to read, and a 403 would leave them staring at an
  // error on a screen that is partly theirs.
  const everyone = canSeeEveryone(req);
  const scopeUserId = everyone ? query.data.userId : req.user!.id;

  const rows = await db
    .select(shiftColumns)
    .from(shifts)
    .innerJoin(users, eq(shifts.userId, users.id))
    .where(buildWhere([
      eq(shifts.factionId, id),
      scopeUserId ? eq(shifts.userId, scopeUserId) : undefined,
      query.data.position ? eq(shifts.position, query.data.position) : undefined,
      query.data.kind ? eq(shifts.kind, query.data.kind) : undefined,
      ...overlaps(query.data.from, query.data.to),
    ]))
    .orderBy(desc(shifts.startedAt))
    .limit(query.data.limit);

  success(res, {
    shifts: rows.map(present),
    /** False means the list is the caller's own, whatever was asked for. */
    seesEveryone: everyone,
  });
});

// ── GET /on-duty — who is working right now ───────────
//
// The question a manager opens this screen to answer, and the one the list
// answers worst: an open shift is somewhere in a month of rows, sorted by a
// start time that says nothing about whether it has finished.

router.get('/on-duty', async (req: Request, res: Response) => {
  const id = factionId(req);
  const everyone = canSeeEveryone(req);

  const rows = await db
    .select(shiftColumns)
    .from(shifts)
    .innerJoin(users, eq(shifts.userId, users.id))
    .where(buildWhere([
      eq(shifts.factionId, id),
      isNull(shifts.endedAt),
      everyone ? undefined : eq(shifts.userId, req.user!.id),
    ]))
    .orderBy(asc(shifts.startedAt));

  success(res, {
    onDuty: rows.map(present),
    /** The caller's own open shift, which is what the clock button reads. */
    mine: rows.filter((r) => r.userId === req.user!.id).map(present)[0] ?? null,
    seesEveryone: everyone,
  });
});

// ── GET /positions — what this faction calls its jobs ──
//
// Instead of a setup screen. Whatever has been typed before is offered as a
// suggestion, so a faction converges on a list of job titles without anybody
// having to sit down and write one.

router.get('/positions', async (req: Request, res: Response) => {
  const rows = await db
    .selectDistinct({ position: shifts.position })
    .from(shifts)
    .where(and(eq(shifts.factionId, factionId(req)), sql`${shifts.position} IS NOT NULL`))
    .orderBy(asc(shifts.position))
    .limit(100);

  success(res, { positions: rows.map((r) => r.position).filter((p): p is string => !!p) });
});

// ── GET /summary — hours per member over a window ─────

router.get('/summary', async (req: Request, res: Response) => {
  const id = factionId(req);
  const query = listSchema.safeParse(req.query);
  if (!query.success) {
    error(res, 'VALIDATION_ERROR', query.error.issues[0]!.message);
    return;
  }

  const everyone = canSeeEveryone(req);
  const scopeUserId = everyone ? query.data.userId : req.user!.id;

  // Finished shifts only. An open one has no length yet, and counting the time
  // so far would make a weekly total that changes while you look at it.
  const rows = await db
    .select({
      userId: shifts.userId,
      userName: memberName,
      avatarUrl: users.avatarUrl,
      shiftCount: sql<number>`COUNT(*)::int`,
      minutes: sql<number>`COALESCE(SUM(${clippedMinutes(query.data.from, query.data.to)}), 0)::int`,
      lastShiftAt: sql<string | null>`MAX(${shifts.startedAt})`,
    })
    .from(shifts)
    .innerJoin(users, eq(shifts.userId, users.id))
    .where(buildWhere([
      eq(shifts.factionId, id),
      sql`${shifts.endedAt} IS NOT NULL`,
      scopeUserId ? eq(shifts.userId, scopeUserId) : undefined,
      query.data.position ? eq(shifts.position, query.data.position) : undefined,
      query.data.kind ? eq(shifts.kind, query.data.kind) : undefined,
      ...overlaps(query.data.from, query.data.to),
    ]))
    .groupBy(shifts.userId, users.username, users.inGameName, users.avatarUrl)
    .orderBy(desc(sql`SUM(${clippedMinutes(query.data.from, query.data.to)})`));

  success(res, {
    members: rows,
    totalMinutes: rows.reduce((a, r) => a + r.minutes, 0),
    seesEveryone: everyone,
  });
});

// ── POST /clock-in ────────────────────────────────────

router.post('/clock-in', requirePermission('log_shifts'), async (req: Request, res: Response) => {
  const id = factionId(req);
  const parsed = clockInSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    error(res, 'VALIDATION_ERROR', parsed.error.issues[0]!.message);
    return;
  }

  const startedAt = parsed.data.startedAt ? new Date(parsed.data.startedAt) : new Date();
  if (startedAt.getTime() > Date.now() + 60_000) {
    error(res, 'VALIDATION_ERROR', 'A shift cannot start in the future');
    return;
  }

  const outcome = await db.transaction(async (tx: TransactionLike) => {
    // One open shift per person. Two would make "on duty" ambiguous and the
    // clock-out button guess which one it meant.
    const [open] = await tx
      .select({ id: shifts.id })
      .from(shifts)
      .where(and(
        eq(shifts.factionId, id),
        eq(shifts.userId, req.user!.id),
        isNull(shifts.endedAt),
      ))
      .limit(1)
      .for('update');

    if (open) {
      return { ok: false as const, message: 'You are already clocked in. Clock out first.' };
    }

    const [row] = await tx
      .insert(shifts)
      .values({
        factionId: id,
        userId: req.user!.id,
        kind: parsed.data.kind ?? 'faction',
        position: parsed.data.position ?? null,
        location: parsed.data.location ?? null,
        notes: parsed.data.notes ?? null,
        startedAt,
      })
      .returning();

    return { ok: true as const, row: row! };
  });

  if (!outcome.ok) {
    error(res, 'VALIDATION_ERROR', outcome.message, 409);
    return;
  }

  await createAuditLog({
    userId: req.user!.id,
    factionId: id,
    action: 'create',
    entityType: 'shift',
    entityId: outcome.row.id,
    details: { position: outcome.row.position, startedAt: outcome.row.startedAt.toISOString() },
    req,
  });

  // Routed separately from the clock-out on purpose: a restaurant with eight
  // staff is sixteen messages an evening, and plenty of factions will want
  // only one half of that — the duty board, or the hours.
  void dispatchDiscord(id, {
    type: 'shift_started',
    actorUserId: req.user!.id,
    kind: outcome.row.kind,
    position: outcome.row.position,
    location: outcome.row.location,
    startedAt: outcome.row.startedAt.toISOString(),
  });

  success(res, present(outcome.row), 201);
});

// ── POST /clock-out ───────────────────────────────────

router.post('/clock-out', requirePermission('log_shifts'), async (req: Request, res: Response) => {
  const id = factionId(req);
  const parsed = clockOutSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    error(res, 'VALIDATION_ERROR', parsed.error.issues[0]!.message);
    return;
  }

  const outcome = await db.transaction(async (tx: TransactionLike) => {
    const [open] = await tx
      .select()
      .from(shifts)
      .where(and(
        eq(shifts.factionId, id),
        eq(shifts.userId, req.user!.id),
        isNull(shifts.endedAt),
      ))
      .limit(1)
      .for('update');

    if (!open) return { ok: false as const, message: 'You are not clocked in.' };

    const endedAt = parsed.data.endedAt ? new Date(parsed.data.endedAt) : new Date();
    const breakMinutes = parsed.data.breakMinutes ?? open.breakMinutes;
    const span = validateSpan(open.startedAt, endedAt, breakMinutes);
    if (!span.ok) return { ok: false as const, message: span.message };

    const [row] = await tx
      .update(shifts)
      .set({
        endedAt,
        breakMinutes,
        notes: parsed.data.notes === undefined ? open.notes : parsed.data.notes,
        updatedAt: new Date(),
      })
      .where(eq(shifts.id, open.id))
      .returning();

    return { ok: true as const, row: row! };
  });

  if (!outcome.ok) {
    error(res, 'VALIDATION_ERROR', outcome.message, 400);
    return;
  }

  await createAuditLog({
    userId: req.user!.id,
    factionId: id,
    action: 'update',
    entityType: 'shift',
    entityId: outcome.row.id,
    details: { closed: true, minutes: workedMinutes(outcome.row) },
    req,
  });

  void dispatchDiscord(id, {
    type: 'shift_ended',
    actorUserId: req.user!.id,
    kind: outcome.row.kind,
    position: outcome.row.position,
    location: outcome.row.location,
    startedAt: outcome.row.startedAt.toISOString(),
    endedAt: outcome.row.endedAt!.toISOString(),
    workedMinutes: workedMinutes(outcome.row) ?? 0,
    breakMinutes: outcome.row.breakMinutes,
  });

  success(res, present(outcome.row));
});

// ── POST / — a whole shift at once ────────────────────
//
// For the one somebody forgot to clock at all, which in a game people are
// playing is most of them. Writing your own needs `log_shifts`; writing
// somebody else's is `manage_shifts`, because that is the same authority as
// correcting their hours afterwards.

router.post('/', requirePermission('log_shifts'), async (req: Request, res: Response) => {
  const id = factionId(req);
  const parsed = manualSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    error(res, 'VALIDATION_ERROR', parsed.error.issues[0]!.message);
    return;
  }

  const targetUserId = parsed.data.userId ?? req.user!.id;
  if (targetUserId !== req.user!.id && !canManage(req)) {
    error(res, 'FORBIDDEN', "You can only record your own shifts", 403);
    return;
  }

  const startedAt = new Date(parsed.data.startedAt);
  const endedAt = new Date(parsed.data.endedAt);
  const breakMinutes = parsed.data.breakMinutes ?? 0;
  const span = validateSpan(startedAt, endedAt, breakMinutes);
  if (!span.ok) {
    error(res, 'VALIDATION_ERROR', span.message);
    return;
  }
  if (startedAt.getTime() > Date.now() + 60_000) {
    error(res, 'VALIDATION_ERROR', 'A shift cannot start in the future');
    return;
  }

  const [row] = await db
    .insert(shifts)
    .values({
      factionId: id,
      userId: targetUserId,
      kind: parsed.data.kind ?? 'faction',
      position: parsed.data.position ?? null,
      location: parsed.data.location ?? null,
      notes: parsed.data.notes ?? null,
      startedAt,
      endedAt,
      breakMinutes,
      editedBy: targetUserId === req.user!.id ? null : req.user!.id,
    })
    .returning();

  await createAuditLog({
    userId: req.user!.id,
    factionId: id,
    action: 'create',
    entityType: 'shift',
    entityId: row!.id,
    details: { forUserId: targetUserId, manual: true, minutes: workedMinutes(row!) },
    req,
  });

  success(res, present(row!), 201);
});

// ── PATCH /:shiftId ───────────────────────────────────

router.patch('/:shiftId', async (req: Request, res: Response) => {
  const id = factionId(req);
  const shiftId = req.params.shiftId as string;

  const parsed = editSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    error(res, 'VALIDATION_ERROR', parsed.error.issues[0]!.message);
    return;
  }

  const [existing] = await db
    .select()
    .from(shifts)
    .where(and(eq(shifts.id, shiftId), eq(shifts.factionId, id)))
    .limit(1);
  if (!existing) {
    error(res, 'NOT_FOUND', 'Shift not found', 404);
    return;
  }

  const mine = existing.userId === req.user!.id;
  if (!mine && !canManage(req)) {
    error(res, 'FORBIDDEN', "You can only change your own shifts", 403);
    return;
  }
  if (mine && !holds(req, 'log_shifts') && !canManage(req)) {
    error(res, 'FORBIDDEN', 'You do not have permission to record shifts', 403);
    return;
  }

  const startedAt = parsed.data.startedAt ? new Date(parsed.data.startedAt) : existing.startedAt;
  // Explicit null reopens a shift, which is how a clock-out in the wrong
  // minute gets taken back rather than deleted and retyped.
  const endedAt = parsed.data.endedAt === undefined
    ? existing.endedAt
    : parsed.data.endedAt === null ? null : new Date(parsed.data.endedAt);
  const breakMinutes = parsed.data.breakMinutes ?? existing.breakMinutes;

  if (endedAt) {
    const span = validateSpan(startedAt, endedAt, breakMinutes);
    if (!span.ok) {
      error(res, 'VALIDATION_ERROR', span.message);
      return;
    }
  } else if (breakMinutes > 0 && breakMinutes * 60_000 >= Date.now() - startedAt.getTime()) {
    // An open shift's break is added to as it happens now, from the buttons
    // on the clock. It still cannot outrun the shift, or the clock-out would
    // refuse it later for a reason nobody could see coming.
    error(res, 'VALIDATION_ERROR', 'The break cannot be longer than the shift so far');
    return;
  }

  const [row] = await db
    .update(shifts)
    .set({
      kind: parsed.data.kind ?? existing.kind,
      position: parsed.data.position === undefined ? existing.position : parsed.data.position,
      location: parsed.data.location === undefined ? existing.location : parsed.data.location,
      notes: parsed.data.notes === undefined ? existing.notes : parsed.data.notes,
      startedAt,
      endedAt,
      breakMinutes,
      // Stamped only when somebody else did it: a member fixing their own
      // times has not had their timesheet rewritten by anybody.
      editedBy: mine ? existing.editedBy : req.user!.id,
      updatedAt: new Date(),
    })
    .where(eq(shifts.id, shiftId))
    .returning();

  await createAuditLog({
    userId: req.user!.id,
    factionId: id,
    action: 'update',
    entityType: 'shift',
    entityId: shiftId,
    details: { forUserId: existing.userId, minutes: workedMinutes(row!) },
    req,
  });

  success(res, present(row!));
});

// ── DELETE /:shiftId ──────────────────────────────────
//
// A hard delete, and it can be: a shift is time rather than value, nothing in
// the books points at it, and a wrong one is simply noise on a rota. The audit
// row carries what it was.

router.delete('/:shiftId', async (req: Request, res: Response) => {
  const id = factionId(req);
  const shiftId = req.params.shiftId as string;

  const [existing] = await db
    .select()
    .from(shifts)
    .where(and(eq(shifts.id, shiftId), eq(shifts.factionId, id)))
    .limit(1);
  if (!existing) {
    error(res, 'NOT_FOUND', 'Shift not found', 404);
    return;
  }

  if (existing.userId !== req.user!.id && !canManage(req)) {
    error(res, 'FORBIDDEN', "You can only remove your own shifts", 403);
    return;
  }

  await createAuditLog({
    userId: req.user!.id,
    factionId: id,
    action: 'delete',
    entityType: 'shift',
    entityId: shiftId,
    details: {
      forUserId: existing.userId,
      position: existing.position,
      startedAt: existing.startedAt.toISOString(),
      endedAt: existing.endedAt?.toISOString() ?? null,
    },
    req,
  });

  await db.delete(shifts).where(eq(shifts.id, shiftId));

  success(res, { deleted: true });
});

export default router;
