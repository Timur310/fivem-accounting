import { Request, Response } from 'express';
import { asyncRouter } from '../lib/asyncRouter.js';
import { z } from 'zod';
import { db } from '../db/index.js';
import {
  supportTickets, users, factions,
  SUPPORT_TICKET_KINDS, SUPPORT_TICKET_STATUSES,
} from '../db/schema.js';
import { eq, desc, sql } from 'drizzle-orm';
import { success, error } from '../lib/response.js';
import { requireAuth, requireSuperadmin } from '../middleware/auth.js';
import { buildWhere } from '../lib/query.js';
import { parsePagination } from '../lib/types.js';
import { notify } from '../lib/notify.js';

/**
 * Bug reports and feature requests, from anyone with an account to whoever
 * maintains the app.
 *
 * This router is deliberately outside the faction permission system. Reporting
 * that a screen is broken is not a faction action, and gating it behind a rank
 * would silence exactly the people most likely to hit a bug — ordinary members
 * with the fewest permissions. Being signed in is the whole requirement.
 *
 * Reading other people's tickets is the opposite: it crosses every faction
 * boundary at once, so it is superadmin and nothing else.
 */
const router = asyncRouter();

router.use(requireAuth);

const isSuperadmin = (req: Request) => req.user?.role === 'superadmin';

// Rows as the reporter and the maintainer both see them. The reporter's own
// ticket carries the resolution note, which is the point of writing one.
const ticketColumns = {
  id: supportTickets.id,
  kind: supportTickets.kind,
  subject: supportTickets.subject,
  message: supportTickets.message,
  status: supportTickets.status,
  resolutionNote: supportTickets.resolutionNote,
  resolvedAt: supportTickets.resolvedAt,
  createdAt: supportTickets.createdAt,
  updatedAt: supportTickets.updatedAt,
  factionId: supportTickets.factionId,
};

const createSchema = z.object({
  kind: z.enum(SUPPORT_TICKET_KINDS),
  subject: z.string().trim().min(3, 'Subject must be at least 3 characters').max(120),
  message: z.string().trim().min(10, 'Message must be at least 10 characters').max(4000),
  // Context only: which faction the reporter was looking at. Never trusted for
  // authorisation, and a stale or unknown id simply records nothing.
  factionId: z.string().uuid().optional(),
});

// ── POST / — send a ticket (any signed-in user) ──────
router.post('/', async (req: Request, res: Response) => {
  const parsed = createSchema.safeParse(req.body);
  if (!parsed.success) {
    error(res, 'VALIDATION_ERROR', parsed.error.issues[0]!.message);
    return;
  }
  const { kind, subject, message, factionId } = parsed.data;

  // An unknown faction id is dropped rather than refused: it is a breadcrumb
  // for the reader, and losing it must never cost someone their bug report.
  let contextFactionId: string | null = null;
  if (factionId) {
    const [faction] = await db
      .select({ id: factions.id })
      .from(factions)
      .where(eq(factions.id, factionId))
      .limit(1);
    contextFactionId = faction?.id ?? null;
  }

  const [row] = await db
    .insert(supportTickets)
    .values({
      userId: req.user!.id,
      factionId: contextFactionId,
      kind,
      subject,
      message,
    })
    .returning();

  success(res, row, 201);
});

// ── GET /mine — the reporter's own tickets ───────────
// Declared before the superadmin list so neither path shadows the other.
router.get('/mine', async (req: Request, res: Response) => {
  const rows = await db
    .select(ticketColumns)
    .from(supportTickets)
    .where(eq(supportTickets.userId, req.user!.id))
    .orderBy(desc(supportTickets.createdAt))
    .limit(50);

  success(res, rows);
});

// ── GET /open-count — badge for the maintainer's inbox ──
router.get('/open-count', requireSuperadmin, async (_req: Request, res: Response) => {
  const [row] = await db
    .select({ count: sql<number>`COUNT(*)::int` })
    .from(supportTickets)
    .where(eq(supportTickets.status, 'open'));

  success(res, { open: row?.count ?? 0 });
});

const listQuerySchema = z.object({
  status: z.enum(SUPPORT_TICKET_STATUSES).optional(),
  kind: z.enum(SUPPORT_TICKET_KINDS).optional(),
  page: z.string().optional(),
  page_size: z.string().optional(),
});

// ── GET / — every ticket (superadmin) ────────────────
router.get('/', requireSuperadmin, async (req: Request, res: Response) => {
  const query = listQuerySchema.safeParse(req.query);
  if (!query.success) {
    error(res, 'VALIDATION_ERROR', query.error.issues[0]!.message);
    return;
  }
  const { status, kind } = query.data;
  const { page, pageSize, offset } = parsePagination(query.data);

  const where = buildWhere([
    status ? eq(supportTickets.status, status) : undefined,
    kind ? eq(supportTickets.kind, kind) : undefined,
  ]);

  const [items, countResult] = await Promise.all([
    db
      .select({
        ...ticketColumns,
        userId: supportTickets.userId,
        reporterUsername: users.username,
        reporterInGameName: users.inGameName,
        reporterAvatarUrl: users.avatarUrl,
        factionName: factions.name,
        resolvedBy: supportTickets.resolvedBy,
      })
      .from(supportTickets)
      .innerJoin(users, eq(supportTickets.userId, users.id))
      // Left join: a ticket outlives the faction it was sent from.
      .leftJoin(factions, eq(supportTickets.factionId, factions.id))
      .where(where)
      // Open first, then newest — the inbox should open on the work, not on
      // the history of it.
      .orderBy(sql`CASE WHEN ${supportTickets.status} = 'open' THEN 0 ELSE 1 END`, desc(supportTickets.createdAt))
      .limit(pageSize)
      .offset(offset),
    db
      .select({ count: sql<number>`COUNT(*)::int` })
      .from(supportTickets)
      .where(where),
  ]);

  success(res, items, 200, { page, page_size: pageSize, total_count: countResult[0]?.count ?? 0 });
});

const updateSchema = z.object({
  status: z.enum(['resolved', 'declined', 'cancelled']),
  resolutionNote: z.string().trim().max(2000).optional(),
});

// ── PATCH /:ticketId — close a ticket ────────────────
//
// Two callers, two powers. The maintainer resolves or declines anything. The
// reporter may only cancel their own, and only while it is still open: once it
// has been answered, withdrawing it would erase the answer.
router.patch('/:ticketId', async (req: Request, res: Response) => {
  const ticketId = req.params.ticketId as string;

  const parsed = updateSchema.safeParse(req.body);
  if (!parsed.success) {
    error(res, 'VALIDATION_ERROR', parsed.error.issues[0]!.message);
    return;
  }
  const { status, resolutionNote } = parsed.data;

  const [existing] = await db
    .select()
    .from(supportTickets)
    .where(eq(supportTickets.id, ticketId))
    .limit(1);
  if (!existing) {
    error(res, 'NOT_FOUND', 'Ticket not found', 404);
    return;
  }

  const superadmin = isSuperadmin(req);
  const isMine = existing.userId === req.user!.id;

  if (!superadmin) {
    if (!isMine) {
      error(res, 'FORBIDDEN', 'You can only act on your own tickets', 403);
      return;
    }
    if (status !== 'cancelled') {
      error(res, 'FORBIDDEN', 'You can only cancel your own ticket', 403);
      return;
    }
    if (existing.status !== 'open') {
      error(res, 'FORBIDDEN', 'This ticket has already been closed', 403);
      return;
    }
  }

  const [row] = await db
    .update(supportTickets)
    .set({
      status,
      // A note is the maintainer answering. A cancellation is the reporter
      // walking away, and carries none.
      resolutionNote: superadmin && status !== 'cancelled' ? (resolutionNote || null) : null,
      resolvedBy: req.user!.id,
      resolvedAt: new Date(),
      updatedAt: new Date(),
    })
    .where(eq(supportTickets.id, ticketId))
    .returning();

  // Answering a ticket is worth nothing if the person who sent it never finds
  // out. A cancellation raises nothing — the reporter did that themselves.
  if (superadmin && status !== 'cancelled') {
    await notify({
      userId: existing.userId,
      type: status === 'resolved' ? 'support_resolved' : 'support_declined',
      linkView: 'support',
      data: { subject: existing.subject },
    });
  }

  success(res, row);
});

// ── DELETE /:ticketId — remove a ticket for good ─────
// Superadmin only, and a real delete: a ticket is correspondence, not ledger
// history, so there is nothing for a soft-delete to preserve.
router.delete('/:ticketId', requireSuperadmin, async (req: Request, res: Response) => {
  const ticketId = req.params.ticketId as string;

  const deleted = await db
    .delete(supportTickets)
    .where(eq(supportTickets.id, ticketId))
    .returning({ id: supportTickets.id });

  if (deleted.length === 0) {
    error(res, 'NOT_FOUND', 'Ticket not found', 404);
    return;
  }

  success(res, { id: ticketId, deleted: true });
});

export default router;
