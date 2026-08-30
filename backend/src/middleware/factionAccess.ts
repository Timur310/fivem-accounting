import { Request, Response, NextFunction } from 'express';
import { db } from '../db/index.js';
import { factionMembers } from '../db/schema.js';
import { eq, and } from 'drizzle-orm';
import { error } from '../lib/response.js';

/**
 * Middleware: verify the authenticated user is a member of the faction
 * in req.params.id. Attaches req.factionRole (admin | member | superadmin).
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

  next();
}

/**
 * Middleware: require faction admin or superadmin role within the faction.
 */
export function requireFactionAdminOrSuperadmin(req: Request, res: Response, next: NextFunction): void {
  const role = req.factionRole;
  if (role !== 'superadmin' && role !== 'admin') {
    error(res, 'FORBIDDEN', 'Faction admin access required', 403);
    return;
  }
  next();
}