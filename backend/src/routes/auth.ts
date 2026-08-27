import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { db } from '../db/index.js';
import { users, factionMembers, factions } from '../db/schema.js';
import { eq } from 'drizzle-orm';
import { success, error } from '../lib/response.js';
import {
  buildDiscordAuthUrl,
  exchangeCode,
  getDiscordUser,
  consumeState,
  signJwt,
  COOKIE_NAME,
  COOKIE_OPTIONS,
} from '../auth/index.js';
import { requireAuth } from '../middleware/auth.js';
import { createAuditLog } from '../lib/audit.js';

const router = Router();

// ── GET /auth/discord — redirect to Discord OAuth ─────
router.get('/discord', async (_req: Request, res: Response) => {
  try {
    const { url } = await buildDiscordAuthUrl();
    res.redirect(url);
  } catch (err) {
    error(res, 'OAUTH_ERROR', 'Failed to initiate Discord OAuth', 500);
  }
});

// ── GET /auth/callback — handle OAuth callback ─────────
const callbackSchema = z.object({
  code: z.string().min(1),
  state: z.string().min(1),
});

router.get('/callback', async (req: Request, res: Response) => {
  const parsed = callbackSchema.safeParse(req.query);
  if (!parsed.success) {
    error(res, 'VALIDATION_ERROR', 'Missing code or state parameter', 400);
    return;
  }

  const { code, state } = parsed.data;

  // Validate state & get code verifier
  const codeVerifier = consumeState(state);
  if (!codeVerifier) {
    error(res, 'INVALID_STATE', 'Invalid or expired OAuth state. Please try again.', 400);
    return;
  }

  try {
    // Exchange code for token
    const tokenRes = await exchangeCode(code, codeVerifier);

    // Fetch Discord user profile
    const discordUser = await getDiscordUser(tokenRes.access_token);

    // Upsert user
    const [existing] = await db
      .select()
      .from(users)
      .where(eq(users.discordId, discordUser.id))
      .limit(1);

    let userId: string;

    if (existing) {
      // Update username/avatar and last login
      await db
        .update(users)
        .set({
          username: discordUser.username,
          avatarUrl: discordUser.avatar
            ? `https://cdn.discordapp.com/avatars/${discordUser.id}/${discordUser.avatar}.png`
            : null,
          lastLogin: new Date(),
        })
        .where(eq(users.id, existing.id));
      userId = existing.id;
    } else {
      // Create new user
      const [newUser] = await db
        .insert(users)
        .values({
          discordId: discordUser.id,
          username: discordUser.username,
          avatarUrl: discordUser.avatar
            ? `https://cdn.discordapp.com/avatars/${discordUser.id}/${discordUser.avatar}.png`
            : null,
          role: 'member',
          lastLogin: new Date(),
        })
        .returning();
      userId = newUser!.id;
    }

    // Fetch final user record for JWT
    const [user] = await db
      .select()
      .from(users)
      .where(eq(users.id, userId))
      .limit(1);

    // Sign JWT
    const token = signJwt({ userId: user!.id, role: user!.role });

    // Set HTTP-only cookie
    res.cookie(COOKIE_NAME, token, COOKIE_OPTIONS);

    // Audit log
    await createAuditLog({
      userId: user!.id,
      action: 'login',
      entityType: 'user',
      entityId: user!.id,
      details: { method: 'discord_oauth', discordId: discordUser.id },
      req,
    });

    // Redirect to frontend dashboard
    const frontendUrl = process.env.NODE_ENV === 'production'
      ? '/'
      : 'http://localhost:3000';
    res.redirect(frontendUrl);
  } catch (err: any) {
    console.error('[AUTH CALLBACK ERROR]', err?.response?.data || err?.message);
    error(res, 'OAUTH_ERROR', 'Failed to complete authentication', 500);
  }
});

// ── POST /auth/logout ──────────────────────────────────
router.post('/logout', requireAuth, async (req: Request, res: Response) => {
  await createAuditLog({
    userId: req.user!.id,
    action: 'logout',
    entityType: 'user',
    entityId: req.user!.id,
    req,
  });

  res.clearCookie(COOKIE_NAME, { path: '/' });
  success(res, null, 204);
});

// ── GET /auth/me — current user + factions ─────────────
router.get('/me', requireAuth, async (req: Request, res: Response) => {
  const user = req.user!;

  // Get user's faction memberships
  const memberships = await db
    .select({
      id: factionMembers.id,
      factionId: factionMembers.factionId,
      role: factionMembers.role,
      joinedAt: factionMembers.joinedAt,
      factionName: factions.name,
      factionActive: factions.isActive,
    })
    .from(factionMembers)
    .innerJoin(factions, eq(factionMembers.factionId, factions.id))
    .where(eq(factionMembers.userId, user.id));

  success(res, {
    id: user.id,
    discordId: user.discordId,
    username: user.username,
    avatarUrl: user.avatarUrl,
    role: user.role,
    createdAt: user.createdAt,
    lastLogin: user.lastLogin,
    factions: memberships,
  });
});

export default router;
