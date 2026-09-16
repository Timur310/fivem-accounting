import { Request, Response } from 'express';
import { asyncRouter } from '../lib/asyncRouter.js';
import { z } from 'zod';
import { db } from '../db/index.js';
import { users, factionMembers } from '../db/schema.js';
import { eq, sql, desc } from 'drizzle-orm';
import { success, error } from '../lib/response.js';
import { requireAuth, requireSuperadmin } from '../middleware/auth.js';
import { createAuditLog } from '../lib/audit.js';

/**
 * People who play in a faction but have never signed in.
 *
 * A provisional user is a full `users` row from the moment it is created — it
 * joins factions, holds entries, payouts, ranks and strikes — so when the
 * person finally logs in with the Discord ID it was registered under, the
 * OAuth callback lands on the same row and everything they had carries over.
 * The flag exists to say "nobody is behind this yet": it keeps inactivity off
 * their back and marks the row as one a superadmin may still rename.
 *
 * Superadmin only. Registering someone else's Discord ID decides who a stretch
 * of faction history belongs to, which is not a faction-level call.
 */
const router = asyncRouter();

router.use(requireAuth, requireSuperadmin);

// Discord snowflakes are 17–20 digits today. Checking the shape catches the
// typo that would otherwise stay invisible until the real person logs in,
// gets a second row, and leaves this one's history orphaned.
const discordIdField = z
  .string()
  .regex(/^\d{17,20}$/, 'Discord ID must be 17-20 digits');

const createSchema = z.object({
  discordId: discordIdField,
  /** What Discord shows for them; replaced by the real one when they log in. */
  username: z.string().min(1).max(32),
  inGameName: z.string().min(1).max(50).optional(),
});

const updateSchema = z.object({
  username: z.string().min(1).max(32).optional(),
  inGameName: z.string().min(1).max(50).nullable().optional(),
}).refine(
  (d) => d.username !== undefined || d.inGameName !== undefined,
  'Provide at least one of: username, inGameName',
);

/** The row, plus what it is already carrying, for the admin list. */
const listSelect = {
  id: users.id,
  discordId: users.discordId,
  username: users.username,
  inGameName: users.inGameName,
  avatarUrl: users.avatarUrl,
  createdAt: users.createdAt,
  // `users.id` written out rather than interpolated as a column: inside a raw
  // subquery the interpolated form does not correlate to the outer row, so both
  // counts came back 0 for every registration — including ones that were
  // already carrying a membership and a ledger's worth of entries.
  factionCount: sql<number>`(SELECT COUNT(*) FROM faction_members WHERE user_id = users.id)::int`,
  entryCount: sql<number>`(SELECT COUNT(*) FROM entries WHERE user_id = users.id AND is_deleted = false)::int`,
};

// ── GET / — every registration still waiting for its person ──
router.get('/', async (_req: Request, res: Response) => {
  const rows = await db
    .select(listSelect)
    .from(users)
    .where(eq(users.isProvisional, true))
    .orderBy(desc(users.createdAt));

  success(res, rows);
});

// ── POST / — register someone by Discord ID ──────────
router.post('/', async (req: Request, res: Response) => {
  const parsed = createSchema.safeParse(req.body);
  if (!parsed.success) {
    error(res, 'VALIDATION_ERROR', parsed.error.issues[0]!.message);
    return;
  }

  const { discordId, username, inGameName } = parsed.data;

  const [existing] = await db
    .select({ id: users.id, isProvisional: users.isProvisional })
    .from(users)
    .where(eq(users.discordId, discordId))
    .limit(1);
  if (existing) {
    error(
      res,
      'CONFLICT',
      existing.isProvisional
        ? 'That Discord ID is already registered'
        : 'That Discord ID belongs to an account that has already logged in',
      409,
    );
    return;
  }

  const [created] = await db
    .insert(users)
    .values({
      discordId,
      username,
      inGameName: inGameName ?? null,
      role: 'member',
      isProvisional: true,
    })
    .returning();
  if (!created) {
    error(res, 'INTERNAL_ERROR', 'Failed to register the user', 500);
    return;
  }

  await createAuditLog({
    userId: req.user!.id,
    factionId: null,
    action: 'create',
    entityType: 'user',
    entityId: created.id,
    details: { provisional: true, discordId, username, inGameName: inGameName ?? null },
    req,
  });

  success(res, created, 201);
});

// ── PATCH /:userId — fix the names ───────────────────
router.patch('/:userId', async (req: Request, res: Response) => {
  const userId = req.params.userId as string;

  const parsed = updateSchema.safeParse(req.body);
  if (!parsed.success) {
    error(res, 'VALIDATION_ERROR', parsed.error.issues[0]!.message);
    return;
  }

  const target = await loadProvisional(userId, res);
  if (!target) return;

  const updates: Record<string, unknown> = {};
  if (parsed.data.username !== undefined) updates.username = parsed.data.username;
  if (parsed.data.inGameName !== undefined) updates.inGameName = parsed.data.inGameName;

  const [updated] = await db
    .update(users)
    .set(updates)
    .where(eq(users.id, userId))
    .returning();

  await createAuditLog({
    userId: req.user!.id,
    factionId: null,
    action: 'update',
    entityType: 'user',
    entityId: userId,
    details: {
      provisional: true,
      before: { username: target.username, inGameName: target.inGameName },
      after: { username: updated?.username, inGameName: updated?.inGameName },
    },
    req,
  });

  success(res, updated);
});

// ── DELETE /:userId — take back a registration ───────
router.delete('/:userId', async (req: Request, res: Response) => {
  const userId = req.params.userId as string;

  const target = await loadProvisional(userId, res);
  if (!target) return;

  // Their rows are real ledger lines. Deleting the user would take entries and
  // payouts down with them, so a registration that has been used has to be
  // emptied deliberately rather than dropped by surprise.
  const [carried] = await db
    .select({
      entries: sql<number>`(SELECT COUNT(*) FROM entries WHERE user_id = ${userId})::int`,
      payouts: sql<number>`(SELECT COUNT(*) FROM payouts WHERE recipient_user_id = ${userId})::int`,
      strikes: sql<number>`(SELECT COUNT(*) FROM strikes WHERE target_user_id = ${userId})::int`,
    })
    .from(users)
    .where(eq(users.id, userId));

  const total = (carried?.entries ?? 0) + (carried?.payouts ?? 0) + (carried?.strikes ?? 0);
  if (total > 0) {
    error(
      res,
      'BAD_REQUEST',
      `This registration already carries ${carried?.entries ?? 0} entries, ${carried?.payouts ?? 0} payouts and ${carried?.strikes ?? 0} strikes. Remove those first.`,
    );
    return;
  }

  await db.delete(factionMembers).where(eq(factionMembers.userId, userId));
  await db.delete(users).where(eq(users.id, userId));

  await createAuditLog({
    userId: req.user!.id,
    factionId: null,
    action: 'delete',
    entityType: 'user',
    entityId: userId,
    details: { provisional: true, discordId: target.discordId, username: target.username },
    req,
  });

  success(res, { deleted: true });
});

/**
 * Loads the target and refuses anything that is not still provisional — once
 * someone has logged in, Discord owns their username and they own their
 * in-game name.
 */
async function loadProvisional(userId: string, res: Response) {
  const [row] = await db
    .select({
      id: users.id,
      discordId: users.discordId,
      username: users.username,
      inGameName: users.inGameName,
      isProvisional: users.isProvisional,
    })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);

  if (!row) {
    error(res, 'NOT_FOUND', 'User not found', 404);
    return null;
  }
  if (!row.isProvisional) {
    error(res, 'BAD_REQUEST', 'This user has logged in — their account is theirs to change now');
    return null;
  }
  return row;
}

export default router;
