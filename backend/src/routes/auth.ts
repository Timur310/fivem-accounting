import { Router, Request, Response } from 'express';
import axios from 'axios';
import { z } from 'zod';
import { db } from '../db/index.js';
import { users, factionMembers, factions } from '../db/schema.js';
import { eq, and, notInArray } from 'drizzle-orm';
import { success, error } from '../lib/response.js';
import { env } from '../lib/env.js';
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
import type { User } from '../db/schema.js';

const router = Router();

/**
 * Build the full user response payload (used by both GET and PATCH /auth/me).
 *
 * The frontend's `useAppStore.user` expects this exact shape — anything that
 * replaces the whole user object (e.g. after PATCH /auth/me) MUST include
 * `factions` and `browseableFactions`, otherwise `user.factions.find(...)`
 * in AppShell throws.
 */
async function buildUserResponse(user: User) {
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

  // Superadmins can browse every active faction from the admin UI, even ones
  // they aren't a member of. Compute that list here so the SPA doesn't need
  // a second round-trip. Members / faction admins don't get this list.
  let browseableFactions: { id: string; name: string }[] | undefined;
  if (user.role === 'superadmin') {
    const memberFactionIds = memberships.map((m) => m.factionId);
    const browsableRows = memberFactionIds.length > 0
      ? await db
        .select({ id: factions.id, name: factions.name })
        .from(factions)
        .where(
          and(
            eq(factions.isActive, true),
            notInArray(factions.id, memberFactionIds),
          ),
        )
        .orderBy(factions.name)
      : await db
        .select({ id: factions.id, name: factions.name })
        .from(factions)
        .where(eq(factions.isActive, true))
        .orderBy(factions.name);
    browseableFactions = browsableRows;
  }

  return {
    id: user.id,
    discordId: user.discordId,
    username: user.username,
    inGameName: user.inGameName,
    avatarUrl: user.avatarUrl,
    role: user.role,
    createdAt: user.createdAt,
    lastLogin: user.lastLogin,
    factions: memberships,
    ...(browseableFactions ? { browseableFactions } : {}),
  };
}

// ── Helpers ──────────────────────────────────────────

function avatarUrl(discordId: string, avatar: string | null): string | null {
  if (!avatar) return null;
  return `https://cdn.discordapp.com/avatars/${discordId}/${avatar}.png`;
}

// ── GET /auth/discord — redirect to Discord OAuth ─────
router.get('/discord', async (_req: Request, res: Response) => {
  try {
    const { url } = await buildDiscordAuthUrl();
    res.redirect(url);
  } catch {
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

  const frontendBase = new URL(env.FRONTEND_URL);

  try {
    // Exchange code for token
    const tokenRes = await exchangeCode(code, codeVerifier);

    // Fetch Discord user profile
    const discordUser = await getDiscordUser(tokenRes.access_token);

    // Upsert the user. `inGameName` is intentionally absent from the
    // `set` clause: once a player has chosen their in-character name we
    // never overwrite it on re-login, even if their Discord username
    // changes. Only `username` (the Discord handle) syncs on each login.
    const [user] = await db
      .insert(users)
      .values({
        discordId: discordUser.id,
        username: discordUser.username,
        avatarUrl: avatarUrl(discordUser.id, discordUser.avatar),
        role: 'member',
        lastLogin: new Date(),
      })
      .onConflictDoUpdate({
        target: users.discordId,
        set: {
          username: discordUser.username,
          avatarUrl: avatarUrl(discordUser.id, discordUser.avatar),
          lastLogin: new Date(),
        },
      })
      .returning();

    if (!user) {
      throw new Error('User upsert returned no row');
    }

    // Sign JWT
    const token = signJwt({ userId: user.id, role: user.role });

    // Set HTTP-only cookie
    res.cookie(COOKIE_NAME, token, COOKIE_OPTIONS);

    // Audit log — deliberately omit discordId; the user id is enough and
    // Discord ids are PII we don't need to duplicate across audit rows.
    await createAuditLog({
      userId: user.id,
      action: 'login',
      entityType: 'user',
      entityId: user.id,
      details: { method: 'discord_oauth' },
      req,
    });

    // Redirect to the frontend with a success marker so the SPA knows to
    // re-fetch /auth/me. Always 302 to the same origin — never JSON — so
    // the browser completes the OAuth round-trip cleanly.
    const redirect = new URL('/', frontendBase);
    redirect.searchParams.set('auth', 'success');
    res.redirect(redirect.toString());
  } catch (err) {
    // Don't leak axios response bodies into logs; the message is enough.
    if (axios.isAxiosError(err)) {
      console.error('[AUTH CALLBACK ERROR]', err.message);
    } else {
      console.error('[AUTH CALLBACK ERROR]', err instanceof Error ? err.message : err);
    }

    // If we haven't started writing a response yet, redirect the user back
    // to the frontend with an error flag — JSON 500s would render as a
    // broken page in the browser mid-OAuth-flow.
    if (!res.headersSent) {
      const redirect = new URL('/', frontendBase);
      redirect.searchParams.set('auth', 'error');
      res.redirect(redirect.toString());
    }
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
  // 204 No Content — no body. res.end() rather than res.json(null) so we
  // don't accidentally send "null" as the JSON body.
  res.status(204).end();
});

// ── PATCH /auth/me — update the player's in-game name ──
const updateMeSchema = z.object({
  inGameName: z
    .string()
    .trim()
    .min(2, 'In-game name must be at least 2 characters')
    .max(50, 'In-game name must be at most 50 characters'),
});

router.patch('/me', requireAuth, async (req: Request, res: Response) => {
  const parsed = updateMeSchema.safeParse(req.body);
  if (!parsed.success) {
    error(res, 'VALIDATION_ERROR', parsed.error.issues[0]!.message);
    return;
  }

  const before = req.user!.inGameName ?? null;
  const after = parsed.data.inGameName;

  // No-op if the player re-submitted the same value — still audit log it so
  // admins can see the attempt.
  const [updated] = await db
    .update(users)
    .set({ inGameName: after })
    .where(eq(users.id, req.user!.id))
    .returning();

  if (!updated) {
    error(res, 'NOT_FOUND', 'User not found', 404);
    return;
  }

  await createAuditLog({
    userId: req.user!.id,
    action: 'update_profile',
    entityType: 'user',
    entityId: req.user!.id,
    details: { inGameName: after, previousInGameName: before },
    req,
  });

  // Return the FULL user shape (same as GET /auth/me) so the frontend can
  // replace the whole user object without losing `factions` / `browseableFactions`.
  success(res, await buildUserResponse(updated));
});

// ── GET /auth/me — current user + factions ─────────────
router.get('/me', requireAuth, async (req: Request, res: Response) => {
  success(res, await buildUserResponse(req.user!));
});

export default router;