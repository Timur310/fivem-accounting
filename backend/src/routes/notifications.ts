import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { db } from '../db/index.js';
import { notifications, factions } from '../db/schema.js';
import { eq, and, desc, sql, isNull } from 'drizzle-orm';
import { success, error } from '../lib/response.js';
import { requireAuth } from '../middleware/auth.js';

/**
 * The bell.
 *
 * Every route here is scoped to `req.user` and nothing else — there is no
 * permission to hold and no faction to belong to, because a notification is
 * addressed to one person by construction. Nobody can read anybody else's,
 * superadmin included: this is the one place in the app where that would be
 * reading someone's mail rather than auditing a faction.
 */
const router = Router();

router.use(requireAuth);

const listQuerySchema = z.object({
  unread: z.enum(['true', 'false']).optional(),
  limit: z.string().optional(),
});

// ── GET / — the caller's notifications, newest first ──
router.get('/', async (req: Request, res: Response) => {
  const query = listQuerySchema.safeParse(req.query);
  if (!query.success) {
    error(res, 'VALIDATION_ERROR', query.error.issues[0]!.message);
    return;
  }
  const limit = Math.min(100, Math.max(1, Number(query.data.limit) || 30));

  const rows = await db
    .select({
      id: notifications.id,
      type: notifications.type,
      data: notifications.data,
      linkView: notifications.linkView,
      readAt: notifications.readAt,
      createdAt: notifications.createdAt,
      factionId: notifications.factionId,
      factionName: factions.name,
    })
    .from(notifications)
    .leftJoin(factions, eq(notifications.factionId, factions.id))
    .where(
      and(
        eq(notifications.userId, req.user!.id),
        query.data.unread === 'true' ? isNull(notifications.readAt) : undefined,
      ),
    )
    .orderBy(desc(notifications.createdAt))
    .limit(limit);

  success(res, rows);
});

// ── GET /unread-count — the badge ────────────────────
router.get('/unread-count', async (req: Request, res: Response) => {
  const [row] = await db
    .select({ count: sql<number>`COUNT(*)::int` })
    .from(notifications)
    .where(and(eq(notifications.userId, req.user!.id), isNull(notifications.readAt)));

  success(res, { unread: row?.count ?? 0 });
});

// ── POST /read-all — clear the badge ─────────────────
// Declared before /:id so the literal path is not captured as an id.
router.post('/read-all', async (req: Request, res: Response) => {
  const now = new Date();
  await db
    .update(notifications)
    .set({ readAt: now })
    .where(and(eq(notifications.userId, req.user!.id), isNull(notifications.readAt)));

  success(res, { readAt: now.toISOString() });
});

// ── POST /:notificationId/read — mark one read ───────
router.post('/:notificationId/read', async (req: Request, res: Response) => {
  const notificationId = req.params.notificationId as string;

  // The ownership check lives in the WHERE clause rather than a separate
  // read: a row belonging to somebody else simply matches nothing, and
  // answers 404 the same as one that never existed. Nothing leaks either way.
  const updated = await db
    .update(notifications)
    .set({ readAt: new Date() })
    .where(and(eq(notifications.id, notificationId), eq(notifications.userId, req.user!.id)))
    .returning({ id: notifications.id, readAt: notifications.readAt });

  if (updated.length === 0) {
    error(res, 'NOT_FOUND', 'Notification not found', 404);
    return;
  }

  success(res, updated[0]);
});

// ── DELETE / — clear the list ────────────────────────
router.delete('/', async (req: Request, res: Response) => {
  await db.delete(notifications).where(eq(notifications.userId, req.user!.id));
  success(res, { cleared: true });
});

export default router;
