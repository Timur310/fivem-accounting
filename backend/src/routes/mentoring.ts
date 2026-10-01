import { Request, Response } from 'express';
import { asyncRouter } from '../lib/asyncRouter.js';
import { z } from 'zod';
import { aliasedTable, and, asc, desc, eq, inArray, ne, sql } from 'drizzle-orm';
import { db, type TransactionLike } from '../db/index.js';
import {
  factionMembers,
  factions,
  mentorNotes,
  mentorships,
  users,
  MENTOR_NOTE_KINDS,
  MENTOR_SCORE_AREAS,
} from '../db/schema.js';
import { success, error } from '../lib/response.js';
import { requireAuth } from '../middleware/auth.js';
import { requireFactionMember, requirePermission } from '../middleware/factionAccess.js';
import { requireModule } from '../lib/modules.js';
import { createAuditLog } from '../lib/audit.js';
import { notify } from '../lib/notify.js';

/**
 * Mentoring: a newcomer paired with an experienced member, and what the mentor
 * writes about how it is going.
 *
 * **Written for leadership, never for the mentee.** A mentor writes what the
 * newcomer is good at, what less, what to change, and the mistakes they make —
 * honestly, because the person it is about cannot read it. The mentee sees who
 * their mentor is and what the mentorship is for, and nothing that was written.
 *
 * **Who may do what.** `manage_mentoring` pairs people, reads everything,
 * extends, reassigns and closes. A mentor needs no permission: being assigned
 * is what lets them read and write about *their* mentee, and only theirs.
 *
 * **Mistake points** add up per mentorship. A faction can set a limit; reaching
 * it flags the mentee for review on the board. It is not a strike and changes
 * nothing else — leadership decides what it means.
 */
const router = asyncRouter({ mergeParams: true });

router.use(requireAuth, requireFactionMember, requireModule('mentoring'));

const factionId = (req: Request) => req.params.id as string;
const me = (req: Request) => req.user!.id;

function canManage(req: Request): boolean {
  if (req.factionRole === 'admin' || req.factionRole === 'superadmin') return true;
  return (req.factionPermissions ?? []).includes('manage_mentoring');
}

const mentee = aliasedTable(users, 'mentee');
const mentor = aliasedTable(users, 'mentor');
const nameOf = (u: typeof users) => sql<string>`COALESCE(${u.inGameName}, ${u.username})`;

const isoDate = z.string().datetime({ offset: true });

const createSchema = z.object({
  menteeUserId: z.string().uuid(),
  mentorUserId: z.string().uuid(),
  goal: z.string().trim().max(1000).optional(),
  dueAt: isoDate.nullable().optional(),
});

const updateSchema = z.object({
  mentorUserId: z.string().uuid().optional(),
  goal: z.string().trim().max(1000).nullable().optional(),
  dueAt: isoDate.nullable().optional(),
});

const closeSchema = z.object({
  outcome: z.enum(['passed', 'failed', 'cancelled']),
  summary: z.string().trim().max(4000).optional(),
  scores: z.record(z.enum(MENTOR_SCORE_AREAS), z.number().int().min(1).max(5)).optional(),
});

const noteSchema = z.object({
  kind: z.enum(MENTOR_NOTE_KINDS),
  body: z.string().trim().min(1, 'Write something').max(4000),
  points: z.number().int().min(1).max(5).optional(),
});

const noteUpdateSchema = z.object({
  kind: z.enum(MENTOR_NOTE_KINDS).optional(),
  body: z.string().trim().min(1).max(4000).optional(),
  points: z.number().int().min(1).max(5).optional(),
});

const settingsSchema = z.object({
  pointLimit: z.number().int().min(1).max(100).nullable(),
});

function firstIssue(err: z.ZodError) {
  return err.issues[0]?.message ?? 'Invalid input';
}

/** Only mistakes carry points, and a mistake always carries at least one. */
function pointsFor(kind: string, points: number | undefined) {
  return kind === 'mistake' ? points ?? 1 : 0;
}

// ── reading ───────────────────────────────────────────

const rowColumns = {
  id: mentorships.id,
  status: mentorships.status,
  goal: mentorships.goal,
  dueAt: mentorships.dueAt,
  startedAt: mentorships.startedAt,
  endedAt: mentorships.endedAt,
  summary: mentorships.summary,
  scores: mentorships.scores,
  menteeUserId: mentorships.menteeUserId,
  menteeName: nameOf(mentee),
  menteeAvatarUrl: mentee.avatarUrl,
  mentorUserId: mentorships.mentorUserId,
  mentorName: nameOf(mentor),
  mentorAvatarUrl: mentor.avatarUrl,
};

async function listRows(where: ReturnType<typeof and>, order: 'active' | 'finished') {
  const rows = await db.select(rowColumns)
    .from(mentorships)
    .innerJoin(mentee, eq(mentorships.menteeUserId, mentee.id))
    .innerJoin(mentor, eq(mentorships.mentorUserId, mentor.id))
    .where(where)
    .orderBy(order === 'active' ? asc(mentorships.startedAt) : desc(mentorships.endedAt));
  return withTallies(rows);
}

/** Notes counted per kind, mistake points added up, and when the last one was written. */
async function withTallies<T extends { id: string }>(rows: T[]) {
  if (rows.length === 0) return [];
  const tallies = await db.select({
    mentorshipId: mentorNotes.mentorshipId,
    kind: mentorNotes.kind,
    count: sql<number>`COUNT(*)::int`,
    points: sql<number>`COALESCE(SUM(${mentorNotes.points}), 0)::int`,
    last: sql<string | null>`MAX(${mentorNotes.createdAt})`,
  })
    .from(mentorNotes)
    .where(inArray(mentorNotes.mentorshipId, rows.map((r) => r.id)))
    .groupBy(mentorNotes.mentorshipId, mentorNotes.kind);

  return rows.map((row) => {
    const mine = tallies.filter((t) => t.mentorshipId === row.id);
    const counts = Object.fromEntries(MENTOR_NOTE_KINDS.map((k) => [k, mine.find((t) => t.kind === k)?.count ?? 0]));
    const last = mine.map((t) => t.last).filter(Boolean).sort().at(-1) ?? null;
    return {
      ...row,
      counts,
      points: mine.reduce((s, t) => s + t.points, 0),
      lastNoteAt: last,
    };
  });
}

async function pointLimitOf(id: string) {
  const [row] = await db.select({ limit: factions.mentorPointLimit }).from(factions).where(eq(factions.id, id));
  return row?.limit ?? null;
}

router.get('/', async (req: Request, res: Response) => {
  const id = factionId(req);
  const finished = req.query.status === 'finished';
  const statusFilter = finished ? ne(mentorships.status, 'active') : eq(mentorships.status, 'active');
  const manage = canManage(req);

  // Leadership sees the whole board; a mentor sees their own mentees.
  const rows = await listRows(
    and(
      eq(mentorships.factionId, id),
      statusFilter,
      manage ? undefined : eq(mentorships.mentorUserId, me(req)),
    ),
    finished ? 'finished' : 'active',
  );

  // And whoever is being mentored sees who by — and nothing that was written.
  const [asMentee] = await db.select({
    id: mentorships.id,
    mentorName: nameOf(mentor),
    mentorAvatarUrl: mentor.avatarUrl,
    goal: mentorships.goal,
    startedAt: mentorships.startedAt,
    dueAt: mentorships.dueAt,
  })
    .from(mentorships)
    .innerJoin(mentor, eq(mentorships.mentorUserId, mentor.id))
    .where(and(eq(mentorships.factionId, id), eq(mentorships.status, 'active'), eq(mentorships.menteeUserId, me(req))));

  success(res, {
    mentorships: rows,
    asMentee: asMentee ?? null,
    pointLimit: await pointLimitOf(id),
    canManage: manage,
  });
});

/** A member's mentoring history, for their profile. Leadership only. */
router.get('/member/:userId', requirePermission('manage_mentoring'), async (req: Request, res: Response) => {
  const rows = await listRows(
    and(eq(mentorships.factionId, factionId(req)), eq(mentorships.menteeUserId, req.params.userId as string)),
    'finished',
  );
  success(res, { mentorships: rows });
});

async function mentorshipOf(id: string, mentorshipId: string) {
  const [row] = await db.select().from(mentorships)
    .where(and(eq(mentorships.id, mentorshipId), eq(mentorships.factionId, id)));
  return row ?? null;
}

/** May this caller read (and, while active, write) this mentorship? */
const mayRead = (req: Request, row: { mentorUserId: string }) => canManage(req) || row.mentorUserId === me(req);

router.get('/:mentorshipId', async (req: Request, res: Response) => {
  const id = factionId(req);
  const row = await mentorshipOf(id, req.params.mentorshipId as string);
  // The mentee — and anyone else — gets the same answer as for a mentorship
  // that does not exist: there is nothing here for them, not even a refusal.
  if (!row || !mayRead(req, row)) {
    error(res, 'NOT_FOUND', 'No such mentorship', 404);
    return;
  }
  const [detail] = await listRows(eq(mentorships.id, row.id), 'active');
  const notes = await db.select({
    id: mentorNotes.id,
    kind: mentorNotes.kind,
    body: mentorNotes.body,
    points: mentorNotes.points,
    authorUserId: mentorNotes.authorUserId,
    authorName: nameOf(users as typeof users),
    createdAt: mentorNotes.createdAt,
    updatedAt: mentorNotes.updatedAt,
  })
    .from(mentorNotes)
    .innerJoin(users, eq(mentorNotes.authorUserId, users.id))
    .where(eq(mentorNotes.mentorshipId, row.id))
    .orderBy(desc(mentorNotes.createdAt));
  success(res, { mentorship: detail, notes, pointLimit: await pointLimitOf(id), canManage: canManage(req) });
});

// ── pairing (manage_mentoring) ────────────────────────

async function membersOf(id: string, userIds: string[]) {
  const rows = await db.select({ userId: factionMembers.userId, name: nameOf(users as typeof users) })
    .from(factionMembers)
    .innerJoin(users, eq(factionMembers.userId, users.id))
    .where(and(eq(factionMembers.factionId, id), inArray(factionMembers.userId, userIds)));
  return new Map(rows.map((r) => [r.userId, r.name]));
}

router.post('/', requirePermission('manage_mentoring'), async (req: Request, res: Response) => {
  const id = factionId(req);
  const parsed = createSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    error(res, 'VALIDATION_ERROR', firstIssue(parsed.error));
    return;
  }
  const { menteeUserId, mentorUserId, goal, dueAt } = parsed.data;
  if (menteeUserId === mentorUserId) {
    error(res, 'VALIDATION_ERROR', 'Nobody can mentor themselves');
    return;
  }
  const names = await membersOf(id, [menteeUserId, mentorUserId]);
  if (names.size !== 2) {
    error(res, 'VALIDATION_ERROR', 'Both people have to be members of this faction');
    return;
  }
  const [already] = await db.select({ id: mentorships.id }).from(mentorships)
    .where(and(eq(mentorships.factionId, id), eq(mentorships.menteeUserId, menteeUserId), eq(mentorships.status, 'active')));
  if (already) {
    error(res, 'VALIDATION_ERROR', `${names.get(menteeUserId)} already has a mentor — reassign that one instead`, 409);
    return;
  }

  const row = await db.transaction(async (tx: TransactionLike) => {
    const [created] = await tx.insert(mentorships).values({
      factionId: id, menteeUserId, mentorUserId, goal: goal || null,
      dueAt: dueAt ? new Date(dueAt) : null, createdBy: me(req),
    }).returning();
    await createAuditLog({
      userId: me(req), factionId: id, action: 'create', entityType: 'mentorship', entityId: created!.id,
      details: { menteeUserId, mentorUserId }, req, tx,
    });
    return created!;
  });

  if (mentorUserId !== me(req)) {
    await notify({
      userId: mentorUserId, type: 'mentor_assigned', factionId: id, linkView: 'mentoring',
      data: { mentee: names.get(menteeUserId) ?? '' },
    });
  }
  success(res, row, 201);
});

router.patch('/:mentorshipId', requirePermission('manage_mentoring'), async (req: Request, res: Response) => {
  const id = factionId(req);
  const parsed = updateSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    error(res, 'VALIDATION_ERROR', firstIssue(parsed.error));
    return;
  }
  const row = await mentorshipOf(id, req.params.mentorshipId as string);
  if (!row) {
    error(res, 'NOT_FOUND', 'No such mentorship', 404);
    return;
  }
  const { mentorUserId, goal, dueAt } = parsed.data;
  if (mentorUserId && row.status !== 'active') {
    error(res, 'VALIDATION_ERROR', 'A finished mentorship keeps the mentor it had');
    return;
  }
  let menteeName = '';
  if (mentorUserId && mentorUserId !== row.mentorUserId) {
    if (mentorUserId === row.menteeUserId) {
      error(res, 'VALIDATION_ERROR', 'Nobody can mentor themselves');
      return;
    }
    const names = await membersOf(id, [mentorUserId, row.menteeUserId]);
    if (!names.has(mentorUserId)) {
      error(res, 'VALIDATION_ERROR', 'The new mentor has to be a member of this faction');
      return;
    }
    menteeName = names.get(row.menteeUserId) ?? '';
  }

  const [updated] = await db.update(mentorships).set({
    ...(mentorUserId ? { mentorUserId } : {}),
    ...(goal !== undefined ? { goal: goal || null } : {}),
    ...(dueAt !== undefined ? { dueAt: dueAt ? new Date(dueAt) : null } : {}),
    updatedAt: new Date(),
  }).where(eq(mentorships.id, row.id)).returning();

  if (menteeName && mentorUserId && mentorUserId !== me(req)) {
    await notify({
      userId: mentorUserId, type: 'mentor_assigned', factionId: id, linkView: 'mentoring',
      data: { mentee: menteeName },
    });
  }
  success(res, updated);
});

router.post('/:mentorshipId/close', requirePermission('manage_mentoring'), async (req: Request, res: Response) => {
  const id = factionId(req);
  const parsed = closeSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    error(res, 'VALIDATION_ERROR', firstIssue(parsed.error));
    return;
  }
  const row = await mentorshipOf(id, req.params.mentorshipId as string);
  if (!row) {
    error(res, 'NOT_FOUND', 'No such mentorship', 404);
    return;
  }
  if (row.status !== 'active') {
    error(res, 'VALIDATION_ERROR', 'This mentorship is already closed', 409);
    return;
  }
  const { outcome, summary, scores } = parsed.data;
  const [updated] = await db.transaction(async (tx: TransactionLike) => {
    const result = await tx.update(mentorships).set({
      status: outcome, summary: summary || null, scores: scores ?? null,
      endedAt: new Date(), endedBy: me(req), updatedAt: new Date(),
    }).where(eq(mentorships.id, row.id)).returning();
    await createAuditLog({
      userId: me(req), factionId: id, action: 'update', entityType: 'mentorship', entityId: row.id,
      details: { outcome }, req, tx,
    });
    return result;
  });
  success(res, updated);
});

router.delete('/:mentorshipId', requirePermission('manage_mentoring'), async (req: Request, res: Response) => {
  const id = factionId(req);
  const row = await mentorshipOf(id, req.params.mentorshipId as string);
  if (!row) {
    error(res, 'NOT_FOUND', 'No such mentorship', 404);
    return;
  }
  await db.transaction(async (tx: TransactionLike) => {
    await tx.delete(mentorships).where(eq(mentorships.id, row.id));
    await createAuditLog({
      userId: me(req), factionId: id, action: 'delete', entityType: 'mentorship', entityId: row.id,
      details: { menteeUserId: row.menteeUserId, mentorUserId: row.mentorUserId }, req, tx,
    });
  });
  success(res, { id: row.id, deleted: true });
});

router.patch('/settings/limit', requirePermission('manage_mentoring'), async (req: Request, res: Response) => {
  const parsed = settingsSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    error(res, 'VALIDATION_ERROR', firstIssue(parsed.error));
    return;
  }
  await db.update(factions).set({ mentorPointLimit: parsed.data.pointLimit }).where(eq(factions.id, factionId(req)));
  success(res, { pointLimit: parsed.data.pointLimit });
});

// ── notes (the mentor, or leadership) ─────────────────

router.post('/:mentorshipId/notes', async (req: Request, res: Response) => {
  const id = factionId(req);
  const parsed = noteSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    error(res, 'VALIDATION_ERROR', firstIssue(parsed.error));
    return;
  }
  const row = await mentorshipOf(id, req.params.mentorshipId as string);
  if (!row || !mayRead(req, row)) {
    error(res, 'NOT_FOUND', 'No such mentorship', 404);
    return;
  }
  if (row.status !== 'active') {
    error(res, 'VALIDATION_ERROR', 'This mentorship is closed — its notes are kept as they were', 409);
    return;
  }
  const { kind, body, points } = parsed.data;
  const [note] = await db.insert(mentorNotes).values({
    factionId: id, mentorshipId: row.id, authorUserId: me(req), kind, body, points: pointsFor(kind, points),
  }).returning();
  await db.update(mentorships).set({ updatedAt: new Date() }).where(eq(mentorships.id, row.id));
  success(res, note, 201);
});

async function noteOf(id: string, noteId: string) {
  const [row] = await db.select({
    note: mentorNotes,
    status: mentorships.status,
    mentorUserId: mentorships.mentorUserId,
  })
    .from(mentorNotes)
    .innerJoin(mentorships, eq(mentorNotes.mentorshipId, mentorships.id))
    .where(and(eq(mentorNotes.id, noteId), eq(mentorNotes.factionId, id)));
  return row ?? null;
}

/** A note is changed by whoever wrote it, or by leadership. */
const mayChange = (req: Request, found: { note: { authorUserId: string }; mentorUserId: string }) =>
  canManage(req) || (found.note.authorUserId === me(req) && found.mentorUserId === me(req));

router.patch('/notes/:noteId', async (req: Request, res: Response) => {
  const id = factionId(req);
  const parsed = noteUpdateSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    error(res, 'VALIDATION_ERROR', firstIssue(parsed.error));
    return;
  }
  const found = await noteOf(id, req.params.noteId as string);
  if (!found || !mayChange(req, found)) {
    error(res, 'NOT_FOUND', 'No such note', 404);
    return;
  }
  if (found.status !== 'active') {
    error(res, 'VALIDATION_ERROR', 'This mentorship is closed — its notes are kept as they were', 409);
    return;
  }
  const kind = parsed.data.kind ?? found.note.kind;
  const points = parsed.data.points ?? (kind === 'mistake' ? found.note.points || 1 : 0);
  const [note] = await db.update(mentorNotes).set({
    kind,
    ...(parsed.data.body !== undefined ? { body: parsed.data.body } : {}),
    points: pointsFor(kind, points),
    updatedAt: new Date(),
  }).where(eq(mentorNotes.id, found.note.id)).returning();
  success(res, note);
});

router.delete('/notes/:noteId', async (req: Request, res: Response) => {
  const found = await noteOf(factionId(req), req.params.noteId as string);
  if (!found || !mayChange(req, found)) {
    error(res, 'NOT_FOUND', 'No such note', 404);
    return;
  }
  await db.delete(mentorNotes).where(eq(mentorNotes.id, found.note.id));
  success(res, { id: found.note.id, deleted: true });
});

export default router;
