import { Request, Response } from 'express';
import { asyncRouter } from '../lib/asyncRouter.js';
import { z } from 'zod';
import { db } from '../db/index.js';
import { strikes, users, STRIKE_SEVERITIES, STRIKE_STATUSES } from '../db/schema.js';
import { eq, and, desc, sql } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import { success, error } from '../lib/response.js';
import { parsePagination } from '../lib/types.js';
import { resolveSort } from '../lib/sort.js';
import { requireAuth } from '../middleware/auth.js';
import { requireFactionMember } from '../middleware/factionAccess.js';
import { requireModule } from '../lib/modules.js';
import { buildWhere } from '../lib/query.js';
import { isActiveStrike, effectiveStatus } from '../lib/strikes.js';

const router = asyncRouter({ mergeParams: true });

// The same table twice: a strike names the member it is against and the
// member who wrote it, and both are people on this roster.
const issuers = alias(users, 'issuers');

// Membership is enough to reach this route — what it answers with depends on
// who is asking. A member has to be able to see the strikes held against them,
// including the ones that no longer count; reading the rest of the faction's
// discipline record is what `manage_strikes` is for.
router.use(requireAuth, requireFactionMember, requireModule('strikes'));

const listQuerySchema = z.object({
  sort: z.string().max(40).optional(),
  dir: z.enum(['asc', 'desc']).optional(),
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
// Holders of `manage_strikes` — admins and superadmins among them, since a
// role implies every permission — see the whole roster and default to the
// strikes that still count. Everyone else sees their own record and defaults
// to all of it: a member reading their own history has nothing to gain from
// hiding the revoked and expired entries, and the expiry date is the part
// they most often want to check. The summary is scoped the same way.
router.get('/', async (req: Request, res: Response) => {
  const factionId = req.params.id as string;

  const query = listQuerySchema.safeParse(req.query);
  if (!query.success) {
    error(res, 'VALIDATION_ERROR', query.error.issues[0]!.message);
    return;
  }

  const { status, severity, user_id, page: pageStr, page_size: pageSizeStr } = query.data;
  const { page, pageSize, offset } = parsePagination({ page: pageStr, page_size: pageSizeStr });

  const canSeeEveryone = (req.factionPermissions ?? []).includes('manage_strikes');

  // Without that permission the caller is pinned to their own target user id,
  // regardless of the user_id query param — they cannot read another member's
  // strikes here.
  const effectiveTargetUserId = canSeeEveryone ? user_id : req.user!.id;

  // For the faction-wide view, no status filter means "currently counts
  // against the member", which is status='active' AND not past its expiry —
  // not simply status='active'. Reading your own record defaults to the whole
  // history instead.
  let statusCondition;
  if (!status) {
    statusCondition = canSeeEveryone ? isActiveStrike() : undefined;
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
        // Who wrote it, which the detail view shows and this list used to
        // leave out entirely.
        issuerUsername: issuers.username,
        issuerInGameName: issuers.inGameName,
        issuerAvatarUrl: issuers.avatarUrl,
      })
      .from(strikes)
      .innerJoin(users, eq(strikes.targetUserId, users.id))
      // Left, not inner: a strike outlives the account that issued it, and
      // losing rows from a discipline record because an admin was deleted
      // would be a worse bug than a missing name.
      .leftJoin(issuers, eq(strikes.issuedBy, issuers.id))
      .where(where)
      .orderBy(...resolveSort(
        query.data,
        {
          date: strikes.createdAt,
          severity: strikes.severity,
          status: strikes.status,
          member: users.username,
        },
        { key: 'date', dir: 'desc' },
        strikes.createdAt,
      ))
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
