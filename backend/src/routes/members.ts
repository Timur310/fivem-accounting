import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { db } from '../db/index.js';
import { factionMembers, users, entries, factions } from '../db/schema.js';
import { eq, and, sql, desc, count as countFn } from 'drizzle-orm';
import { success, error } from '../lib/response.js';
import { parsePagination } from '../lib/types.js';
import { requireAuth } from '../middleware/auth.js';
import { requireFactionMember, requireFactionAdminOrSuperadmin } from '../middleware/factionAccess.js';
import { createAuditLog } from '../lib/audit.js';

const router = Router({ mergeParams: true });

// All routes require faction membership
router.use(requireAuth, requireFactionMember);

// ── Validation schemas ────────────────────────────────

const addMemberSchema = z.object({
  discordId: z.string().min(1, 'Discord ID is required'),
});

const updateMemberSchema = z.object({
  role: z.enum(['admin', 'member']),
});

// ── POST / — add member to faction ───────────────────
router.post('/', requireFactionAdminOrSuperadmin, async (req: Request, res: Response) => {
  const factionId = req.params.id as string;
  const parsed = addMemberSchema.safeParse(req.body);
  if (!parsed.success) {
    error(res, 'VALIDATION_ERROR', parsed.error.issues[0]!.message);
    return;
  }

  const { discordId } = parsed.data;

  // Find user by Discord ID
  const [targetUser] = await db
    .select()
    .from(users)
    .where(eq(users.discordId, discordId))
    .limit(1);
  if (!targetUser) {
    error(res, 'NOT_FOUND', `No user found with Discord ID: ${discordId}. They must log in first.`);
    return;
  }

  // Check already a member
  const [existing] = await db
    .select()
    .from(factionMembers)
    .where(
      and(
        eq(factionMembers.factionId, factionId),
        eq(factionMembers.userId, targetUser.id),
      ),
    )
    .limit(1);
  if (existing) {
    error(res, 'CONFLICT', 'User is already a member of this faction', 409);
    return;
  }

  const [member] = await db
    .insert(factionMembers)
    .values({ factionId, userId: targetUser.id, role: 'member' })
    .returning();

  if (!member) {
    error(res, 'INTERNAL_ERROR', 'Failed to add member', 500);
    return;
  }

  await createAuditLog({
    userId: req.user!.id,
    factionId,
    action: 'create',
    entityType: 'member',
    entityId: member.id,
    details: { addedUserId: targetUser.id, discordId: targetUser.discordId, username: targetUser.username },
    req,
  });

  success(res, { ...member, username: targetUser.username, avatarUrl: targetUser.avatarUrl, discordId: targetUser.discordId }, 201);
});

// ── GET / — list faction members ─────────────────────
router.get('/', async (req: Request, res: Response) => {
  const factionId = req.params.id as string;

  const memberList = await db
    .select({
      id: factionMembers.id,
      userId: factionMembers.userId,
      role: factionMembers.role,
      joinedAt: factionMembers.joinedAt,
      username: users.username,
      avatarUrl: users.avatarUrl,
      discordId: users.discordId,
      entryCount: sql<number>`(SELECT COUNT(*) FROM entries WHERE user_id = users.id AND faction_id = ${sql.raw(`'${factionId}'::uuid`)} AND is_deleted = false)::int`,
    })
    .from(factionMembers)
    .innerJoin(users, eq(factionMembers.userId, users.id))
    .where(eq(factionMembers.factionId, factionId))
    .orderBy(factionMembers.joinedAt);

  success(res, memberList);
});

// ── PATCH /:userId — update member role ──────────────
router.patch('/:userId', requireFactionAdminOrSuperadmin, async (req: Request, res: Response) => {
  const factionId = req.params.id as string;
  const targetUserId = req.params.userId as string;

  const parsed = updateMemberSchema.safeParse(req.body);
  if (!parsed.success) {
    error(res, 'VALIDATION_ERROR', parsed.error.issues[0]!.message);
    return;
  }

  const [membership] = await db
    .select()
    .from(factionMembers)
    .where(
      and(
        eq(factionMembers.factionId, factionId),
        eq(factionMembers.userId, targetUserId),
      ),
    )
    .limit(1);
  if (!membership) {
    error(res, 'NOT_FOUND', 'Member not found in this faction', 404);
    return;
  }

  const oldRole = membership.role;
  const [updated] = await db
    .update(factionMembers)
    .set({ role: parsed.data.role })
    .where(eq(factionMembers.id, membership.id))
    .returning();

  // If promoting to admin, update user's global role
  if (parsed.data.role === 'admin') {
    const [targetUser] = await db.select().from(users).where(eq(users.id, targetUserId)).limit(1);
    if (targetUser && targetUser.role === 'member') {
      await db.update(users).set({ role: 'faction_admin' }).where(eq(users.id, targetUserId));
    }
  }

  await createAuditLog({
    userId: req.user!.id,
    factionId,
    action: 'update',
    entityType: 'member',
    entityId: membership.id,
    details: { userId: targetUserId, before: { role: oldRole }, after: { role: parsed.data.role } },
    req,
  });

  success(res, updated);
});

// ── DELETE /:userId — remove member ───────────────────
router.delete('/:userId', requireFactionAdminOrSuperadmin, async (req: Request, res: Response) => {
  const factionId = req.params.id as string;
  const targetUserId = req.params.userId as string;

  const [membership] = await db
    .select()
    .from(factionMembers)
    .where(
      and(
        eq(factionMembers.factionId, factionId),
        eq(factionMembers.userId, targetUserId),
      ),
    )
    .limit(1);
  if (!membership) {
    error(res, 'NOT_FOUND', 'Member not found in this faction', 404);
    return;
  }

  // Prevent removing the last admin
  if (membership.role === 'admin') {
    const [adminCount] = await db
      .select({ count: sql<number>`COUNT(*)::int` })
      .from(factionMembers)
      .where(
        and(
          eq(factionMembers.factionId, factionId),
          eq(factionMembers.role, 'admin'),
        ),
      );
    if (adminCount!.count <= 1) {
      error(res, 'BAD_REQUEST', 'Cannot remove the last admin of a faction. Promote another member first.');
      return;
    }
  }

  await db.delete(factionMembers).where(eq(factionMembers.id, membership.id));

  await createAuditLog({
    userId: req.user!.id,
    factionId,
    action: 'delete',
    entityType: 'member',
    entityId: membership.id,
    details: { removedUserId: targetUserId, role: membership.role },
    req,
  });

  success(res, { removed: true });
});

export default router;
