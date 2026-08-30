import { Request, Response, NextFunction } from 'express';
import { db } from '../db/index.js';
import { factionMembers, factions, FACTION_PERMISSIONS } from '../db/schema.js';
import { eq, and } from 'drizzle-orm';
import { error } from '../lib/response.js';

/**
 * Middleware: verify the authenticated user is a member of the faction
 * in req.params.id, AND that the faction is still active.
 *
 * Attaches:
 *   req.factionRole — 'admin' | 'member' | 'superadmin'
 *   req.factionPermissions — string[] of permissions from the member's rank
 *
 * Admins and superadmins implicitly have ALL permissions (see
 * FACTION_PERMISSIONS in schema.ts). Non-admin members get only the
 * permissions defined on their custom rank.
 *
 * Superadmins always pass, but if they also have a faction membership,
 * that role is used so they get member-level abilities (e.g. logging entries).
 */
export async function requireFactionMember(req: Request, res: Response, next: NextFunction): Promise<void> {
  const factionId = req.params.id as string;
  if (!factionId) {
    error(res, 'VALIDATION_ERROR', 'Faction ID required', 400);
    return;
  }

  // Always check faction membership — even for superadmins,
  // so we can use their membership role for member-level actions.
  const [membership] = await db
    .select()
    .from(factionMembers)
    .where(
      and(
        eq(factionMembers.factionId, factionId),
        eq(factionMembers.userId, req.user!.id),
      ),
    )
    .limit(1);

  if (membership) {
    // User is a member — use their faction role
    req.factionRole = membership.role as 'admin' | 'member';
  } else if (req.user!.role === 'superadmin') {
    // Superadmin without membership — still gets access, but flagged
    // as 'superadmin' so entry creation etc. can be restricted.
    req.factionRole = 'superadmin';
  } else {
    error(res, 'FORBIDDEN', 'You are not a member of this faction', 403);
    return;
  }

  // Admins and superadmins implicitly have all permissions.
  if (req.factionRole === 'admin' || req.factionRole === 'superadmin') {
    req.factionPermissions = [...FACTION_PERMISSIONS];
  } else {
    // Load the member's custom rank permissions from the faction's ranks JSONB.
    // The rank name on the membership row must match one of the faction's
    // defined ranks. If it doesn't (or the member has no rank), they get
    // zero permissions — they can still do member-level things like logging
    // their own entries, but cannot manage anything.
    let rankPermissions: string[] = [];
    if (membership?.rank) {
      const [faction] = await db
        .select({ ranks: factions.ranks })
        .from(factions)
        .where(eq(factions.id, factionId))
        .limit(1);
      const ranks = faction?.ranks ?? [];
      const rank = ranks.find((r) => r.name === membership.rank);
      if (rank) {
        // Filter to only known permissions — ignore stale ones if the
        // permission list was changed after the rank was saved.
        rankPermissions = (rank.permissions ?? []).filter((p) =>
          (FACTION_PERMISSIONS as readonly string[]).includes(p),
        );
      }
    }
    req.factionPermissions = rankPermissions;
  }

  // Block writes/reads against a soft-deleted faction. Superadmins bypass
  // this so the admin-factions UI can still inspect a deactivated faction.
  if (req.user!.role !== 'superadmin') {
    const [faction] = await db
      .select({ isActive: factions.isActive })
      .from(factions)
      .where(eq(factions.id, factionId))
      .limit(1);
    if (!faction) {
      error(res, 'NOT_FOUND', 'Faction not found', 404);
      return;
    }
    if (!faction.isActive) {
      error(res, 'NOT_FOUND', 'This faction has been deactivated', 410);
      return;
    }
  }

  next();
}

/**
 * Middleware: require faction admin or superadmin role within the faction.
 * This is the old coarse-grained check. For finer control, use
 * `requirePermission('manage_payouts')` etc. instead — admins and
 * superadmins always pass those too.
 */
export function requireFactionAdminOrSuperadmin(req: Request, res: Response, next: NextFunction): void {
  const role = req.factionRole;
  if (role !== 'superadmin' && role !== 'admin') {
    error(res, 'FORBIDDEN', 'Faction admin access required', 403);
    return;
  }
  next();
}

/**
 * Middleware factory: require a specific granular permission.
 *
 * Admins and superadmins implicitly have all permissions. Non-admin members
 * must have the permission on their custom rank (loaded by
 * `requireFactionMember` into `req.factionPermissions`).
 *
 * Usage:
 *   router.post('/', requirePermission('manage_payouts'), handler)
 *
 * This replaces `requireFactionAdminOrSuperadmin` on routes where custom
 * ranks should be able to act. Truly admin-only operations (like changing
 * the faction name or deactivating it) should keep using
 * `requireFactionAdminOrSuperadmin` or `requireSuperadmin`.
 */
export function requirePermission(permission: string) {
  return (req: Request, res: Response, next: NextFunction): void => {
    // Admins and superadmins always pass.
    if (req.factionRole === 'admin' || req.factionRole === 'superadmin') {
      next();
      return;
    }
    // Check the member's rank permissions (loaded by requireFactionMember).
    const perms = req.factionPermissions ?? [];
    if (!perms.includes(permission)) {
      error(
        res,
        'FORBIDDEN',
        `You need the "${permission}" permission to do this`,
        403,
      );
      return;
    }
    next();
  };
}
