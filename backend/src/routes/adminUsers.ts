import { Router, Request, Response } from 'express';
import { db } from '../db/index.js';
import { users } from '../db/schema.js';
import { eq, desc, sql } from 'drizzle-orm';
import { success } from '../lib/response.js';
import { requireAuth, requireSuperadmin } from '../middleware/auth.js';

/**
 * Everyone the system knows about, for the superadmin's roster.
 *
 * The provisional-users route answers a narrower question — which
 * registrations are still waiting for their person — and owns the writes that
 * go with it. This one is the read side of the whole population, so the two
 * lists can be shown as one: a registration and the account it turns into are
 * the same row, and splitting them across two tables made that look like two
 * different things.
 *
 * Superadmin only. It exposes every player's Discord ID.
 */
const router = Router();

router.use(requireAuth, requireSuperadmin);

// ── GET / — every real user ──────────────────────────
router.get('/', async (_req: Request, res: Response) => {
  const rows = await db
    .select({
      id: users.id,
      discordId: users.discordId,
      username: users.username,
      inGameName: users.inGameName,
      avatarUrl: users.avatarUrl,
      role: users.role,
      isProvisional: users.isProvisional,
      createdAt: users.createdAt,
      lastLogin: users.lastLogin,
      // `users.id` written out rather than interpolated: inside a raw subquery
      // the interpolated column does not correlate to the outer row.
      factionCount: sql<number>`(SELECT COUNT(*) FROM faction_members WHERE user_id = users.id)::int`,
      entryCount: sql<number>`(SELECT COUNT(*) FROM entries WHERE user_id = users.id AND is_deleted = false)::int`,
    })
    .from(users)
    // The anonymous placeholder is a row, not a person. It owns entries and
    // would otherwise sit in the roster looking like a player nobody can find.
    .where(eq(users.isSystem, false))
    .orderBy(
      // Registrations first, and fixed there: they are the ones still needing
      // something done about them, and the only ones a superadmin may rename.
      desc(users.isProvisional),
      // Then whoever was here most recently. A provisional row has never
      // logged in, so NULLS LAST keeps that from floating anyone to the top.
      sql`${users.lastLogin} DESC NULLS LAST`,
      desc(users.createdAt),
    );

  success(res, rows);
});

export default router;
