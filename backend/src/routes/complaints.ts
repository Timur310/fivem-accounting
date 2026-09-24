import { Request, Response } from 'express';
import { asyncRouter } from '../lib/asyncRouter.js';
import { z } from 'zod';
import { and, desc, eq, or, sql } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import { db } from '../db/index.js';
import {
  factionMembers,
  factionReports,
  users,
  FACTION_REPORT_CATEGORIES,
  FACTION_REPORT_STATUSES,
} from '../db/schema.js';
import { success, error } from '../lib/response.js';
import { requireAuth } from '../middleware/auth.js';
import { requireFactionMember } from '../middleware/factionAccess.js';
import { requireModule } from '../lib/modules.js';
import { createAuditLog } from '../lib/audit.js';
import { dispatchDiscord } from '../lib/discordDispatch.js';
import { buildWhere } from '../lib/query.js';

/**
 * What members raise with their own leadership.
 *
 * Two kinds, and the difference is one nullable column: a complaint about
 * another member, or one about the faction itself — how it is run, a rule
 * nobody likes, a decision that went badly. Both end up in the same queue,
 * because a faction that only hears about individuals hears half of what is
 * wrong with it.
 *
 * **Writing one needs nothing but membership.** A complaints box only the
 * trusted may write into is not a complaints box, so there is one permission
 * here rather than the usual pair: `manage_complaints`, to read the queue and
 * settle what is in it.
 *
 * **A complaint is never shown to the person it is about.** There is no
 * setting for it and no code path that does it — being named in one gives you
 * no read of it at all, whatever else you hold short of `manage_complaints`.
 *
 * **Anonymous means anonymous.** No author is written to the row, and no audit
 * entry is written for the filing either, because an audit log a faction admin
 * can read would hand back exactly the name the member was promised was not
 * being kept.
 */
const router = asyncRouter({ mergeParams: true });

router.use(requireAuth, requireFactionMember, requireModule('complaints'));

const factionId = (req: Request) => req.params.id as string;

/** May this caller read and settle the whole queue? */
function canHandle(req: Request): boolean {
  if (req.factionRole === 'admin' || req.factionRole === 'superadmin') return true;
  return (req.factionPermissions ?? []).includes('manage_complaints');
}

const createSchema = z.object({
  /** Omitted or null means the complaint is about the faction, not a person. */
  targetUserId: z.string().uuid().nullable().optional(),
  category: z.enum(FACTION_REPORT_CATEGORIES).optional(),
  subject: z.string().trim().min(1, 'A complaint needs a subject').max(140),
  body: z.string().trim().min(1, 'Say what happened').max(4000),
  isAnonymous: z.boolean().optional(),
});

const updateSchema = z.object({
  status: z.enum(FACTION_REPORT_STATUSES).optional(),
  resolutionNote: z.string().trim().max(2000).nullable().optional(),
});

const listSchema = z.object({
  status: z.enum(FACTION_REPORT_STATUSES).optional(),
  category: z.enum(FACTION_REPORT_CATEGORIES).optional(),
  /** Only meaningful with `manage_complaints`; ignored otherwise. */
  targetUserId: z.string().uuid().optional(),
  mine: z.enum(['true', 'false']).optional(),
  limit: z.coerce.number().int().min(1).max(200).default(100),
});

const authors = alias(users, 'complaint_authors');
const targets = alias(users, 'complaint_targets');
const handlers = alias(users, 'complaint_handlers');


const columns = {
  id: factionReports.id,
  authorUserId: factionReports.authorUserId,
  authorName: sql<string | null>`COALESCE(${authors.inGameName}, ${authors.username})`,
  authorAvatarUrl: authors.avatarUrl,
  isAnonymous: factionReports.isAnonymous,
  targetUserId: factionReports.targetUserId,
  targetName: sql<string | null>`COALESCE(${targets.inGameName}, ${targets.username})`,
  targetAvatarUrl: targets.avatarUrl,
  category: factionReports.category,
  subject: factionReports.subject,
  body: factionReports.body,
  status: factionReports.status,
  resolutionNote: factionReports.resolutionNote,
  handledBy: factionReports.handledBy,
  handlerName: sql<string | null>`COALESCE(${handlers.inGameName}, ${handlers.username})`,
  handledAt: factionReports.handledAt,
  createdAt: factionReports.createdAt,
  updatedAt: factionReports.updatedAt,
};

type Row = {
  isAnonymous: boolean;
  authorUserId: string | null;
  authorName: string | null;
  authorAvatarUrl: string | null;
};

/**
 * The row as anybody is allowed to read it.
 *
 * The author of an anonymous complaint is stripped here as well as never being
 * stored, so that a future column, join or debug endpoint cannot quietly
 * reintroduce it. Two locks on the same door, because this is the one thing on
 * this route that cannot be undone by apologising.
 */
function present<T extends Row>(row: T) {
  if (!row.isAnonymous) return row;
  return { ...row, authorUserId: null, authorName: null, authorAvatarUrl: null };
}

/** Every complaint query reads the same three joins. */
function selectComplaints() {
  return db
    .select(columns)
    .from(factionReports)
    .leftJoin(authors, eq(factionReports.authorUserId, authors.id))
    .leftJoin(targets, eq(factionReports.targetUserId, targets.id))
    .leftJoin(handlers, eq(factionReports.handledBy, handlers.id));
}

// ── GET / — the queue, or your own ────────────────────

router.get('/', async (req: Request, res: Response) => {
  const id = factionId(req);
  const query = listSchema.safeParse(req.query);
  if (!query.success) {
    error(res, 'VALIDATION_ERROR', query.error.issues[0]!.message);
    return;
  }

  const handles = canHandle(req);
  // Narrowed rather than refused: a member can always read what they filed,
  // and being told 403 for your own complaint would be its own small insult.
  //
  // Anonymous ones drop out of even that. Nothing on the row says who wrote
  // it, so there is nothing to match the caller against — which is the
  // promise working, not a bug. The screen says so before you tick the box.
  const ownOnly = !handles || query.data.mine === 'true';

  const rows = await selectComplaints()
    .where(buildWhere([
      eq(factionReports.factionId, id),
      ownOnly ? eq(factionReports.authorUserId, req.user!.id) : undefined,
      query.data.status ? eq(factionReports.status, query.data.status) : undefined,
      query.data.category ? eq(factionReports.category, query.data.category) : undefined,
      handles && query.data.targetUserId
        ? eq(factionReports.targetUserId, query.data.targetUserId)
        : undefined,
    ]))
    .orderBy(desc(factionReports.createdAt))
    .limit(query.data.limit);

  success(res, {
    complaints: rows.map(present),
    /** False means the list is only what the caller filed themselves. */
    handlesQueue: handles,
    openCount: handles
      ? (await db
          .select({ count: sql<number>`COUNT(*)::int` })
          .from(factionReports)
          .where(and(
            eq(factionReports.factionId, id),
            or(eq(factionReports.status, 'open'), eq(factionReports.status, 'in_review'))!,
          )))[0]?.count ?? 0
      : 0,
  });
});

// ── POST / — raise something ──────────────────────────

router.post('/', async (req: Request, res: Response) => {
  const id = factionId(req);
  const parsed = createSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    error(res, 'VALIDATION_ERROR', parsed.error.issues[0]!.message);
    return;
  }

  const targetUserId = parsed.data.targetUserId ?? null;
  if (targetUserId) {
    if (targetUserId === req.user!.id) {
      error(res, 'VALIDATION_ERROR', 'You cannot file a complaint about yourself');
      return;
    }
    // Only about somebody in this faction. Without the check, any user id at
    // all could be named in a queue that person can never see or answer.
    const [member] = await db
      .select({ id: factionMembers.id })
      .from(factionMembers)
      .where(and(eq(factionMembers.factionId, id), eq(factionMembers.userId, targetUserId)))
      .limit(1);
    if (!member) {
      error(res, 'VALIDATION_ERROR', 'That person is not in this faction');
      return;
    }
  }

  const isAnonymous = parsed.data.isAnonymous === true;

  const [row] = await db
    .insert(factionReports)
    .values({
      factionId: id,
      // Not stored at all when anonymous, rather than stored and hidden.
      authorUserId: isAnonymous ? null : req.user!.id,
      isAnonymous,
      targetUserId,
      category: parsed.data.category ?? 'other',
      subject: parsed.data.subject,
      body: parsed.data.body,
    })
    .returning();

  // No audit row for an anonymous complaint. An audit log a faction admin can
  // read would hand back the one thing the member was told was not kept.
  if (!isAnonymous) {
    await createAuditLog({
      userId: req.user!.id,
      factionId: id,
      action: 'create',
      entityType: 'complaint',
      entityId: row!.id,
      details: { category: row!.category, aboutMember: !!targetUserId },
      req,
    });
  }

  // Deliberately thin: the category, and whether it is about a member or about
  // the faction. No subject, no names, no body — a channel is read by whoever
  // was given the link, and a complaint is read in the app by the people who
  // may read it.
  void dispatchDiscord(id, {
    type: 'complaint_filed',
    category: row!.category,
    aboutMember: !!targetUserId,
    isAnonymous,
  });

  // Read back through the same joins every other endpoint uses, so a created
  // complaint and a listed one are the same shape on the screen.
  const [full] = await selectComplaints().where(eq(factionReports.id, row!.id)).limit(1);
  success(res, present(full!), 201);
});

// ── GET /:complaintId ─────────────────────────────────

router.get('/:complaintId', async (req: Request, res: Response) => {
  const id = factionId(req);
  const [row] = await selectComplaints()
    .where(and(
      eq(factionReports.id, req.params.complaintId as string),
      eq(factionReports.factionId, id),
    ))
    .limit(1);

  if (!row) {
    error(res, 'NOT_FOUND', 'Complaint not found', 404);
    return;
  }

  // Being named in one gives you no read of it. Only the person who filed it
  // and the people who settle them.
  const isAuthor = !row.isAnonymous && row.authorUserId === req.user!.id;
  if (!canHandle(req) && !isAuthor) {
    error(res, 'NOT_FOUND', 'Complaint not found', 404);
    return;
  }

  success(res, present(row));
});

// ── PATCH /:complaintId ───────────────────────────────

router.patch('/:complaintId', async (req: Request, res: Response) => {
  const id = factionId(req);
  const complaintId = req.params.complaintId as string;

  const parsed = updateSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    error(res, 'VALIDATION_ERROR', parsed.error.issues[0]!.message);
    return;
  }

  const [existing] = await db
    .select()
    .from(factionReports)
    .where(and(eq(factionReports.id, complaintId), eq(factionReports.factionId, id)))
    .limit(1);
  if (!existing) {
    error(res, 'NOT_FOUND', 'Complaint not found', 404);
    return;
  }

  const handles = canHandle(req);
  const isAuthor = !existing.isAnonymous && existing.authorUserId === req.user!.id;

  if (!handles) {
    // The author's only move is to take it back. They cannot mark their own
    // complaint resolved, which would let anybody close their own case.
    if (!isAuthor || parsed.data.status !== 'withdrawn' || parsed.data.resolutionNote !== undefined) {
      error(res, 'FORBIDDEN', 'You can only withdraw a complaint you filed', 403);
      return;
    }
  }

  const status = parsed.data.status ?? existing.status;
  const settled = status === 'resolved' || status === 'dismissed';

  await db
    .update(factionReports)
    .set({
      status,
      resolutionNote: parsed.data.resolutionNote === undefined
        ? existing.resolutionNote
        : parsed.data.resolutionNote,
      // Stamped by whoever settled it, so the author reads a name with the
      // answer rather than a verdict from nobody.
      handledBy: handles && settled ? req.user!.id : existing.handledBy,
      handledAt: settled ? (existing.handledAt ?? new Date()) : null,
      updatedAt: new Date(),
    })
    .where(eq(factionReports.id, complaintId));

  await createAuditLog({
    userId: req.user!.id,
    factionId: id,
    action: 'update',
    entityType: 'complaint',
    entityId: complaintId,
    details: { status, settled },
    req,
  });

  const [full] = await selectComplaints()
    .where(eq(factionReports.id, complaintId))
    .limit(1);

  success(res, present(full!));
});

export default router;
