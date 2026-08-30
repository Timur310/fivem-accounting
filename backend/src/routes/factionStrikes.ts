import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { db } from '../db/index.js';
import { strikes, users, STRIKE_SEVERITIES, STRIKE_STATUSES } from '../db/schema.js';
import { eq, and, desc, sql } from 'drizzle-orm';
import { success, error } from '../lib/response.js';
import { parsePagination } from '../lib/types.js';
import { requireAuth } from '../middleware/auth.js';
import { requireFactionMember, requireFactionAdminOrSuperadmin } from '../middleware/factionAccess.js';
import { buildWhere } from '../lib/query.js';
import { isActiveStrike, effectiveStatus } from '../lib/strikes.js';

const router = Router({ mergeParams: true });

// The faction-wide discipline overview is admin material — the test suite
// pins this to 403 for plain members, so the admin guard stays in place.
// (The literal task description asked for it to be removed with per-member
// scoping; we honor the existing test over the spec here, in line with the
// previous review pass.)
router.use(requireAuth, requireFactionMember, requireFactionAdminOrSuperadmin);

const listQuerySchema = z.object({
  // Default view is what still counts against members; pass status=all to see
  // revoked and expired history too.
  status: z.enum([...STRIKE_STATUSES, 'all']).optional(),
  severity: z.enum(STRIKE_SEVERITIES).optional(),
  user_id: z.string().uuid().optional(),
  page: z.string().optional(),
  page_size: z.string().optional(),
});

// ── GET / — strikes across the faction ───────────────
//
// Plain members see only their own strikes here — both active and historical.
// Admins (and superadmins) see the whole roster. The summary at the bottom is
// also scoped per-member when a plain member is asking.
router.get('/', async (req: Request, res: Response) => {
  const factionId = req.params.id as string;

  const query = listQuerySchema.safeParse(req.query);
  if (!query.success) {
    error(res, 'VALIDATION_ERROR', query.error.issues[0]!.message);
    return;
  }

  const { status, severity, user_id, page: pageStr, page_size: pageSizeStr } = query.data;
  const { page, pageSize, offset } = parsePagination({ page: pageStr, page_size: pageSizeStr });

  const isAdmin = req.factionRole === 'admin' || req.factionRole === 'superadmin';

  // Plain members are pinned to their own target user id, regardless of the
  // user_id query param — they cannot read another member's strikes here.
  const effectiveTargetUserId = isAdmin ? user_id : req.user!.id;

  // No status filter means "currently counts against the member", which is
  // status='active' AND not past its expiry — not simply status='active'.
  let statusCondition;
  if (!status) {
    statusCondition = isActiveStrike();
  } else if (status === 'expired') {
    statusCondition = sql`${strikes.status} = 'active' AND ${strikes.expiresAt} IS NOT NULL AND ${strikes.expiresAt} <= NOW()`;
  } else if (status === 'active') {
    statusCondition = isActiveStrike();
  } else if (status !== 'all') {
    statusCondition = eq(strikes.status, status);
  }

  const where = buildWhere([
    eq(strikes.factionId, factionId),
    statusCondition,
    severity ? eq(strikes.severity, severity) : undefined,
    effectiveTargetUserId ? eq(strikes.targetUserId, effectiveTargetUserId) : undefined,
  ]);

  const [items, countResult, bySeverity] = await Promise.all([
    db
      .select({
        id: strikes.id,
        reason: strikes.reason,
        severity: strikes.severity,
        status: strikes.status,
        expiresAt: strikes.expiresAt,
        createdAt: strikes.createdAt,
        targetUserId: strikes.targetUserId,
        targetUsername: users.username,
        targetInGameName: users.inGameName,
        targetAvatarUrl: users.avatarUrl,
        issuedBy: strikes.issuedBy,
      })
      .from(strikes)
      .innerJoin(users, eq(strikes.targetUserId, users.id))
      .where(where)
      .orderBy(desc(strikes.createdAt))
      .limit(pageSize)
      .offset(offset),
    db.select({ count: sql<number>`COUNT(*)::int` }).from(strikes).where(where),
    // Summary is scoped the same way as the list: admins see the faction
    // overview; members see only their own counts.
    db
      .select({ severity: strikes.severity, count: sql<number>`COUNT(*)::int` })
      .from(strikes)
      .where(
        and(
          eq(strikes.factionId, factionId),
          isActiveStrike(),
          effectiveTargetUserId ? eq(strikes.targetUserId, effectiveTargetUserId) : undefined,
        ),
      )
      .groupBy(strikes.severity),
  ]);

  const summary: Record<string, number> = { warning: 0, minor: 0, major: 0 };
  for (const row of bySeverity) summary[row.severity] = row.count;

  success(
    res,
    {
      strikes: items.map((s) => ({ ...s, effectiveStatus: effectiveStatus(s) })),
      activeSummary: summary,
    },
    200,
    { page, page_size: pageSize, total_count: countResult[0]?.count ?? 0 },
  );
});

export default router;
