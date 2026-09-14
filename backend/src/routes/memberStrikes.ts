import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { db } from '../db/index.js';
import { strikes, users, factionMembers, STRIKE_SEVERITIES } from '../db/schema.js';
import { eq, and, desc } from 'drizzle-orm';
import { success, error } from '../lib/response.js';
import { requireAuth } from '../middleware/auth.js';
import { requireFactionMember, requirePermission } from '../middleware/factionAccess.js';
import { createAuditLog } from '../lib/audit.js';
import { dispatchDiscord } from '../lib/discordDispatch.js';
import { notify } from '../lib/notify.js';
import { resolveStrikeExpiry, effectiveStatus } from '../lib/strikes.js';

const router = Router({ mergeParams: true });

router.use(requireAuth, requireFactionMember);

// ── Validation schemas ────────────────────────────────

const issueStrikeSchema = z.object({
  reason: z.string().min(1).max(2000),
  severity: z.enum(STRIKE_SEVERITIES),
});

// Only the outcome of a strike can be changed after issuing. The reason and
// severity stay as issued so the record cannot be quietly rewritten later.
const updateStrikeSchema = z.object({
  status: z.enum(['appealed', 'revoked', 'active']),
});

const ALLOWED_STATUS_CHANGES: Record<string, readonly string[]> = {
  active: ['appealed', 'revoked'],
  appealed: ['active', 'revoked'],
  revoked: [],
  expired: [],
};

// ── POST / — issue a strike (admin) ──────────────────
router.post('/', requirePermission('manage_strikes'), async (req: Request, res: Response) => {
  const factionId = req.params.id as string;
  const targetUserId = req.params.userId as string;

  const parsed = issueStrikeSchema.safeParse(req.body);
  if (!parsed.success) {
    error(res, 'VALIDATION_ERROR', parsed.error.issues[0]!.message);
    return;
  }

  const [membership] = await db
    .select({ id: factionMembers.id })
    .from(factionMembers)
    .where(and(eq(factionMembers.factionId, factionId), eq(factionMembers.userId, targetUserId)))
    .limit(1);
  if (!membership) {
    error(res, 'NOT_FOUND', 'Member not found in this faction', 404);
    return;
  }

  if (targetUserId === req.user!.id) {
    error(res, 'VALIDATION_ERROR', 'You cannot issue a strike against yourself');
    return;
  }

  const { reason, severity } = parsed.data;
  const expiresAt = await resolveStrikeExpiry(factionId, severity);

  const [strike] = await db
    .insert(strikes)
    .values({ factionId, targetUserId, issuedBy: req.user!.id, reason, severity, expiresAt })
    .returning();

  if (!strike) {
    error(res, 'INTERNAL_ERROR', 'Failed to issue strike', 500);
    return;
  }

  await createAuditLog({
    userId: req.user!.id,
    factionId,
    action: 'create',
    entityType: 'strike',
    entityId: strike.id,
    details: { targetUserId, severity, expiresAt: expiresAt?.toISOString() ?? null },
    req,
  });

  // Discovering a strike by stumbling on it is the worst way to find out.
  await notify({
    userId: targetUserId,
    type: 'strike_issued',
    factionId,
    linkView: 'strikes',
    data: { severity, reason: parsed.data.reason ?? null },
  });

  void dispatchDiscord(factionId, {
    type: 'strike_issued',
    actorUserId: req.user!.id,
    targetUserId,
    severity,
    reason,
  });

  success(res, { ...strike, effectiveStatus: effectiveStatus(strike) }, 201);
});

// ── GET / — list a member's strikes ──────────────────
// Admins can read anyone's; a member can read their own.
router.get('/', async (req: Request, res: Response) => {
  const factionId = req.params.id as string;
  const targetUserId = req.params.userId as string;

  // Same rule as the faction-wide list: `manage_strikes` reads anyone's
  // record, everyone else reads their own. Issuing and revoking already run
  // on that permission, so reading was the one place a delegate was still
  // treated as a plain member.
  const canSeeEveryone = (req.factionPermissions ?? []).includes('manage_strikes');
  if (!canSeeEveryone && targetUserId !== req.user!.id) {
    error(res, 'FORBIDDEN', 'You can only view your own strikes', 403);
    return;
  }

  const rows = await db
    .select({
      id: strikes.id,
      reason: strikes.reason,
      severity: strikes.severity,
      status: strikes.status,
      expiresAt: strikes.expiresAt,
      createdAt: strikes.createdAt,
      updatedAt: strikes.updatedAt,
      issuedBy: strikes.issuedBy,
      issuerUsername: users.username,
      issuerInGameName: users.inGameName,
      issuerAvatarUrl: users.avatarUrl,
    })
    .from(strikes)
    .innerJoin(users, eq(strikes.issuedBy, users.id))
    .where(and(eq(strikes.factionId, factionId), eq(strikes.targetUserId, targetUserId)))
    .orderBy(desc(strikes.createdAt));

  success(res, rows.map((r) => ({ ...r, effectiveStatus: effectiveStatus(r) })));
});

// ── PATCH /:strikeId — appeal, revoke or reinstate ───
router.patch('/:strikeId', requirePermission('manage_strikes'), async (req: Request, res: Response) => {
  const factionId = req.params.id as string;
  const targetUserId = req.params.userId as string;
  const strikeId = req.params.strikeId as string;

  const parsed = updateStrikeSchema.safeParse(req.body);
  if (!parsed.success) {
    error(res, 'VALIDATION_ERROR', parsed.error.issues[0]!.message);
    return;
  }

  const [existing] = await db
    .select()
    .from(strikes)
    .where(
      and(
        eq(strikes.id, strikeId),
        eq(strikes.factionId, factionId),
        eq(strikes.targetUserId, targetUserId),
      ),
    )
    .limit(1);
  if (!existing) {
    error(res, 'NOT_FOUND', 'Strike not found', 404);
    return;
  }

  const current = effectiveStatus(existing);
  const allowed = ALLOWED_STATUS_CHANGES[current] ?? [];
  if (parsed.data.status !== current && !allowed.includes(parsed.data.status)) {
    error(
      res,
      'BAD_REQUEST',
      `Cannot change strike status from '${current}' to '${parsed.data.status}'`,
    );
    return;
  }

  const [updated] = await db
    .update(strikes)
    .set({ status: parsed.data.status, updatedAt: new Date() })
    .where(eq(strikes.id, strikeId))
    .returning();

  await createAuditLog({
    userId: req.user!.id,
    factionId,
    action: 'update',
    entityType: 'strike',
    entityId: strikeId,
    details: { targetUserId, before: current, after: parsed.data.status },
    req,
  });

  // Only revocation is announced. 'appealed' is a conversation in progress and
  // 'active' is the normal state; neither is news, and a channel that reports
  // every click on a strike stops being read.
  if (parsed.data.status === 'revoked' && current !== 'revoked') {
    void dispatchDiscord(factionId, {
      type: 'strike_revoked',
      actorUserId: req.user!.id,
      targetUserId,
      severity: existing.severity,
    });
  }

  success(res, updated ? { ...updated, effectiveStatus: effectiveStatus(updated) } : null);
});

export default router;
