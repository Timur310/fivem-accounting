import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { db } from '../db/index.js';
import {
  announcements, announcementReads, users, factionMembers,
  ANNOUNCEMENT_PRIORITIES,
} from '../db/schema.js';
import { eq, and, or, desc, sql, gt, isNull } from 'drizzle-orm';
import { success, error } from '../lib/response.js';
import { requireAuth } from '../middleware/auth.js';
import { requireFactionMember, requirePermission } from '../middleware/factionAccess.js';
import { createAuditLog } from '../lib/audit.js';
import { dispatchDiscord } from '../lib/discordDispatch.js';
import { notifyMany } from '../lib/notify.js';

/**
 * The faction bulletin board.
 *
 * Reading is open to every member — an announcement nobody can see is not an
 * announcement. Writing runs on `manage_settings`, which is already the
 * permission that decides who speaks for the faction: ranks, quotas' rules and
 * the faction's own configuration all sit behind it, and "what the faction is
 * telling its members" belongs in the same hand rather than in a thirteenth
 * permission nobody would think to grant.
 */
const router = Router({ mergeParams: true });

router.use(requireAuth, requireFactionMember);

const createSchema = z.object({
  title: z.string().trim().min(1).max(200),
  body: z.string().trim().min(1).max(10_000),
  priority: z.enum(ANNOUNCEMENT_PRIORITIES).default('normal'),
  isPinned: z.boolean().default(false),
  // An explicit null clears an expiry; omitting the key leaves it alone.
  expiresAt: z.string().datetime().nullable().optional(),
});

const updateSchema = z.object({
  title: z.string().trim().min(1).max(200).optional(),
  body: z.string().trim().min(1).max(10_000).optional(),
  priority: z.enum(ANNOUNCEMENT_PRIORITIES).optional(),
  isPinned: z.boolean().optional(),
  expiresAt: z.string().datetime().nullable().optional(),
});

const listQuerySchema = z.object({
  // Expired notices are hidden by default but never deleted — a leader has to
  // be able to prove what was posted and when.
  include_expired: z.enum(['true', 'false']).optional(),
});

const canManage = (req: Request) =>
  (req.factionPermissions ?? []).includes('manage_settings');

// ── GET / — the board ────────────────────────────────
router.get('/', async (req: Request, res: Response) => {
  const factionId = req.params.id as string;
  const query = listQuerySchema.safeParse(req.query);
  if (!query.success) {
    error(res, 'VALIDATION_ERROR', query.error.issues[0]!.message);
    return;
  }

  const now = new Date();
  const rows = await db
    .select({
      id: announcements.id,
      title: announcements.title,
      body: announcements.body,
      priority: announcements.priority,
      isPinned: announcements.isPinned,
      expiresAt: announcements.expiresAt,
      createdAt: announcements.createdAt,
      updatedAt: announcements.updatedAt,
      authorId: announcements.authorId,
      authorUsername: users.username,
      authorInGameName: users.inGameName,
      authorAvatarUrl: users.avatarUrl,
      readCount: sql<number>`(
        SELECT COUNT(*)::int FROM announcement_reads
        WHERE announcement_id = ${announcements.id}
      )`,
      isReadByMe: sql<boolean>`EXISTS (
        SELECT 1 FROM announcement_reads
        WHERE announcement_id = ${announcements.id} AND user_id = ${req.user!.id}
      )`,
    })
    .from(announcements)
    .innerJoin(users, eq(announcements.authorId, users.id))
    .where(
      and(
        eq(announcements.factionId, factionId),
        eq(announcements.isDeleted, false),
        query.data.include_expired === 'true'
          ? undefined
          : or(isNull(announcements.expiresAt), gt(announcements.expiresAt, now)),
      ),
    )
    // Pinned first, then newest. A pinned notice that has aged out of the top
    // of the list is exactly the one someone pinned so it would not.
    .orderBy(desc(announcements.isPinned), desc(announcements.createdAt))
    .limit(100);

  success(res, rows);
});

// ── POST / — post one ────────────────────────────────
router.post('/', requirePermission('manage_settings'), async (req: Request, res: Response) => {
  const factionId = req.params.id as string;
  const parsed = createSchema.safeParse(req.body);
  if (!parsed.success) {
    error(res, 'VALIDATION_ERROR', parsed.error.issues[0]!.message);
    return;
  }
  const { title, body, priority, isPinned, expiresAt } = parsed.data;

  const [row] = await db
    .insert(announcements)
    .values({
      factionId,
      authorId: req.user!.id,
      title,
      body,
      priority,
      isPinned,
      expiresAt: expiresAt ? new Date(expiresAt) : null,
    })
    .returning();

  await createAuditLog({
    userId: req.user!.id,
    factionId,
    action: 'create',
    entityType: 'announcement',
    entityId: row!.id,
    details: { title, priority, isPinned },
    req,
  });

  // The whole point of a bulletin board is that people see it. Everyone on the
  // roster is told except the person who wrote it.
  const roster = await db
    .select({ userId: factionMembers.userId })
    .from(factionMembers)
    .where(eq(factionMembers.factionId, factionId));

  await notifyMany({
    userIds: roster.map((m) => m.userId),
    actorId: req.user!.id,
    type: 'announcement_posted',
    factionId,
    linkView: 'announcements',
    data: { title, priority },
  });

  void dispatchDiscord(factionId, {
    type: 'announcement_posted',
    actorUserId: req.user!.id,
    title,
    priority,
  });

  success(res, row, 201);
});

// ── POST /:announcementId/read — mark as read ────────
router.post('/:announcementId/read', async (req: Request, res: Response) => {
  const factionId = req.params.id as string;
  const announcementId = req.params.announcementId as string;

  const [existing] = await db
    .select({ id: announcements.id })
    .from(announcements)
    .where(
      and(
        eq(announcements.id, announcementId),
        eq(announcements.factionId, factionId),
        eq(announcements.isDeleted, false),
      ),
    )
    .limit(1);
  if (!existing) {
    error(res, 'NOT_FOUND', 'Announcement not found', 404);
    return;
  }

  // Reading twice is not an error, and the second read must not move the
  // timestamp — "when did they first see this" is the question it answers.
  await db
    .insert(announcementReads)
    .values({ announcementId, userId: req.user!.id })
    .onConflictDoNothing();

  success(res, { announcementId, read: true });
});

// ── GET /:announcementId/reads — who has seen it ─────
router.get('/:announcementId/reads', requirePermission('manage_settings'), async (req: Request, res: Response) => {
  const factionId = req.params.id as string;
  const announcementId = req.params.announcementId as string;

  const [existing] = await db
    .select({ id: announcements.id })
    .from(announcements)
    .where(and(eq(announcements.id, announcementId), eq(announcements.factionId, factionId)))
    .limit(1);
  if (!existing) {
    error(res, 'NOT_FOUND', 'Announcement not found', 404);
    return;
  }

  // The whole roster, each row saying whether they have read it — the useful
  // question is who has *not*, so returning only readers would be the wrong
  // half of the answer.
  const rows = await db
    .select({
      userId: factionMembers.userId,
      username: users.username,
      inGameName: users.inGameName,
      avatarUrl: users.avatarUrl,
      readAt: announcementReads.readAt,
    })
    .from(factionMembers)
    .innerJoin(users, eq(factionMembers.userId, users.id))
    .leftJoin(
      announcementReads,
      and(
        eq(announcementReads.userId, factionMembers.userId),
        eq(announcementReads.announcementId, announcementId),
      ),
    )
    .where(eq(factionMembers.factionId, factionId))
    .orderBy(users.username);

  success(res, rows);
});

// ── PATCH /:announcementId — edit ────────────────────
router.patch('/:announcementId', async (req: Request, res: Response) => {
  const factionId = req.params.id as string;
  const announcementId = req.params.announcementId as string;

  const parsed = updateSchema.safeParse(req.body);
  if (!parsed.success) {
    error(res, 'VALIDATION_ERROR', parsed.error.issues[0]!.message);
    return;
  }

  const [existing] = await db
    .select()
    .from(announcements)
    .where(
      and(
        eq(announcements.id, announcementId),
        eq(announcements.factionId, factionId),
        eq(announcements.isDeleted, false),
      ),
    )
    .limit(1);
  if (!existing) {
    error(res, 'NOT_FOUND', 'Announcement not found', 404);
    return;
  }

  // Editing is the author's, not the permission's. Someone else rewriting the
  // body under your name is a different thing from moderating the board, and
  // the audit log would carry your name on words you did not write.
  if (existing.authorId !== req.user!.id) {
    error(res, 'FORBIDDEN', 'Only the author can edit an announcement', 403);
    return;
  }

  const updates: Record<string, unknown> = { updatedAt: new Date() };
  if (parsed.data.title !== undefined) updates.title = parsed.data.title;
  if (parsed.data.body !== undefined) updates.body = parsed.data.body;
  if (parsed.data.priority !== undefined) updates.priority = parsed.data.priority;
  if (parsed.data.isPinned !== undefined) updates.isPinned = parsed.data.isPinned;
  if (parsed.data.expiresAt !== undefined) {
    updates.expiresAt = parsed.data.expiresAt ? new Date(parsed.data.expiresAt) : null;
  }

  const [row] = await db
    .update(announcements)
    .set(updates)
    .where(eq(announcements.id, announcementId))
    .returning();

  await createAuditLog({
    userId: req.user!.id,
    factionId,
    action: 'update',
    entityType: 'announcement',
    entityId: announcementId,
    details: { before: { title: existing.title, priority: existing.priority, isPinned: existing.isPinned }, after: updates },
    req,
  });

  success(res, row);
});

// ── DELETE /:announcementId — take it down ───────────
router.delete('/:announcementId', async (req: Request, res: Response) => {
  const factionId = req.params.id as string;
  const announcementId = req.params.announcementId as string;

  const [existing] = await db
    .select()
    .from(announcements)
    .where(
      and(
        eq(announcements.id, announcementId),
        eq(announcements.factionId, factionId),
        eq(announcements.isDeleted, false),
      ),
    )
    .limit(1);
  if (!existing) {
    error(res, 'NOT_FOUND', 'Announcement not found', 404);
    return;
  }

  // Unlike editing, taking a notice down is moderation: the author can retract
  // their own, and anyone who speaks for the faction can remove anybody's.
  if (existing.authorId !== req.user!.id && !canManage(req)) {
    error(res, 'FORBIDDEN', 'You can only remove your own announcements', 403);
    return;
  }

  await db
    .update(announcements)
    .set({ isDeleted: true, updatedAt: new Date() })
    .where(eq(announcements.id, announcementId));

  await createAuditLog({
    userId: req.user!.id,
    factionId,
    action: 'delete',
    entityType: 'announcement',
    entityId: announcementId,
    details: { title: existing.title },
    req,
  });

  success(res, { id: announcementId, deleted: true });
});

export default router;
