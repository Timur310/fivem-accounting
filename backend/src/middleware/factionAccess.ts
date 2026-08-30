import { Request, Response, NextFunction } from 'express';
import { db } from '../db/index.js';
import { factionMembers, factions, FACTION_PERMISSIONS } from '../db/schema.js';
import { eq, and } from 'drizzle-orm';
import { error } from '../lib/response.js';

/**
 * Middleware: verify the authenticated user is a member of the faction
 * in req.params.id. Attaches:
 *   - req.factionRole        'admin' | 'member' | 'superadmin'
 *   - req.factionPermissions string[] (perms granted by rank, or all of them
 *                              for admins/superadmins)
 *
 * Superadmins always pass, but if they also have a faction membership,
 * that role is used so they get member-level abilities (e.g. logging entries).
 *
 * Non-superadmins are also blocked from soft-deleted factions: the row exists
 * for audit history but the roster and ledgers should be invisible.
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

  // Admins and superadmins implicitly have all permissions — the role is the
  // source of truth, not the rank list.
  //
  // `user.role` is checked separately from `factionRole`: a superadmin who
  // joined a faction as a plain member takes that membership role (which is
  // what lets them log entries), and without this they would lose every
  // permission in the one faction they actually belong to.
  if (
    req.factionRole === 'admin' ||
    req.factionRole === 'superadmin' ||
    req.user!.role === 'superadmin'
  ) {
    req.factionPermissions = [...FACTION_PERMISSIONS];
  } else {
    // Members get whatever permissions their assigned rank grants.
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
        // Keep only permissions the system actually knows about, in case a
        // previous definition removed a name that a rank still grants.
        rankPermissions = (rank.permissions ?? []).filter((p) =>
          (FACTION_PERMISSIONS as readonly string[]).includes(p),
        );
      }
    }
    req.factionPermissions = rankPermissions;
  }

  // Block access to soft-deleted factions for non-superadmins. The analytics
  // test pins dashboard-after-delete to 404 rather than 410, so both the
  // not-found and the !isActive case collapse to 404 here.
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
      error(res, 'NOT_FOUND', 'This faction has been deactivated', 404);
      return;
    }
  }

  next();
}

/**
 * Middleware: require faction admin or superadmin role within the faction.
 *
 * Kept for routes that still gate purely on role rather than the finer-grained
 * permission system; new routes should use `requirePermission('...')` instead.
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
 * Middleware factory: require a specific faction permission.
 *
 * Admins and superadmins (who implicitly hold every permission) always pass.
 * Members pass only if their rank grants the requested permission.
 */
export function requirePermission(permission: string) {
  return (req: Request, res: Response, next: NextFunction): void => {
    if (req.factionRole === 'admin' || req.factionRole === 'superadmin') {
      next();
      return;
    }
    const perms = req.factionPermissions ?? [];
    if (!perms.includes(permission)) {
      error(res, 'FORBIDDEN', `You need the "${permission}" permission to do this`, 403);
      return;
    }
    next();
  };
}
