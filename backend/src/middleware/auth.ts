import { Request, Response, NextFunction } from 'express';
import { verifyJwt, COOKIE_NAME } from '../auth/index.js';
import { db } from '../db/index.js';
import { users } from '../db/schema.js';
import { eq } from 'drizzle-orm';
import { error } from '../lib/response.js';

export async function requireAuth(req: Request, res: Response, next: NextFunction): Promise<void> {
  const token = req.cookies?.[COOKIE_NAME];
  if (!token) {
    error(res, 'UNAUTHENTICATED', 'Authentication required', 401);
    return;
  }

  const payload = verifyJwt(token);
  if (!payload) {
    error(res, 'UNAUTHENTICATED', 'Invalid or expired session', 401);
    return;
  }

  const [user] = await db
    .select()
    .from(users)
    .where(eq(users.id, payload.userId))
    .limit(1);

  if (!user) {
    error(res, 'UNAUTHENTICATED', 'User not found', 401);
    return;
  }

  req.user = user;
  next();
}

export function requireSuperadmin(req: Request, res: Response, next: NextFunction): void {
  if (req.user?.role !== 'superadmin') {
    error(res, 'FORBIDDEN', 'Superadmin access required', 403);
    return;
  }
  next();
}

export function requireFactionAdmin(req: Request, res: Response, next: NextFunction): void {
  if (req.user?.role !== 'superadmin' && req.user?.role !== 'faction_admin') {
    error(res, 'FORBIDDEN', 'Faction admin access required', 403);
    return;
  }
  // Superadmins pass through — they have access to everything
  next();
}
