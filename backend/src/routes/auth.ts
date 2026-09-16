import { Request, Response } from 'express';
import { asyncRouter } from '../lib/asyncRouter.js';
import { z } from 'zod';
import axios from 'axios';
import { db } from '../db/index.js';
import { users, factionMembers, factions, discordIntegrations, FACTION_PERMISSIONS } from '../db/schema.js';
import { eq } from 'drizzle-orm';
import { success, error } from '../lib/response.js';
import { env } from '../lib/env.js';
import {
  buildDiscordAuthUrl,
  exchangeCode,
  getDiscordUser,
  consumeState,
  resolveAvatarUrl,
  signJwt,
  COOKIE_NAME,
  COOKIE_OPTIONS,
} from '../auth/index.js';
import { requireAuth } from '../middleware/auth.js';
import { resolveFactionAccess } from '../middleware/factionAccess.js';
import { exchangeBotCode, verifyBotLinkState } from '../lib/discord.js';
import { createAuditLog } from '../lib/audit.js';

const router = asyncRouter();

/**
 * Build the standard /me response shape from a user record.
 *
 * Used by both GET /me and PATCH /me so the response is identical regardless
 * of how the user was reached — clients can refresh their state by calling
 * either endpoint and trust the shape.
 */
async function buildUserResponse(user: typeof users.$inferSelect) {
  // Get user's faction memberships (active factions only — soft-deleted ones
  // stay in the table for audit history but should not show up here).
  const memberships = await db
    .select({
      id: factionMembers.id,
      factionId: factionMembers.factionId,
      role: factionMembers.role,
      joinedAt: factionMembers.joinedAt,
      factionName: factions.name,
      factionActive: factions.isActive,
      // The faction switcher paints every row, so it needs each faction's own
      // colour — not just the selected one's.
      factionBrandColor: factions.brandColor,
      // Needed to resolve what the member's rank grants, below.
      rank: factionMembers.rank,
      factionRanks: factions.ranks,
    })
    .from(factionMembers)
    .innerJoin(factions, eq(factionMembers.factionId, factions.id))
    .where(eq(factionMembers.userId, user.id));

  // What this user may actually do in each faction. The client hides menus by
  // this, so it has to answer exactly what requireFactionMember would decide
  // server-side — a menu the API then refuses is worse than no menu at all.
  //
  // A superadmin holds every permission everywhere, including in a faction
  // they joined as a plain member — the middleware resolves it the same way.
  const membershipsWithPermissions = memberships.map(({ rank, factionRanks, ...m }) => {
    let permissions: string[];
    if (m.role === 'admin' || user.role === 'superadmin') {
      permissions = [...FACTION_PERMISSIONS];
    } else {
      const definition = (factionRanks ?? []).find((r) => r.name === rank);
      // Drop anything the system no longer knows about, in case a rank still
      // grants a permission that has since been removed.
      permissions = (definition?.permissions ?? []).filter((perm) =>
        (FACTION_PERMISSIONS as readonly string[]).includes(perm),
      );
    }
    return { ...m, rank, permissions };
  });

  // Superadmins can browse every active faction even without a membership.
  let browseableFactions: { id: string; name: string; brandColor: string | null }[] = [];
  if (user.role === 'superadmin') {
    browseableFactions = await db
      .select({ id: factions.id, name: factions.name, brandColor: factions.brandColor })
      .from(factions)
      .where(eq(factions.isActive, true));
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
    factions: membershipsWithPermissions,
    browseableFactions,
  };
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

const botCallbackSchema = z.object({
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

    // Upsert user by discord_id. The on-conflict update keeps username and
    // avatar fresh without clobbering inGameName (which the user owns) or role
    // (which is governed by the bootstrap script and faction membership).
    //
    // This is also where a provisional registration becomes a real account: a
    // superadmin may have created the row by Discord ID before this person
    // ever signed in, and landing on the same row is what carries their
    // entries, payouts, ranks and strikes over. Clearing `isProvisional` is
    // the whole conversion — the id never changes, so nothing has to move.
    const [user] = await db
      .insert(users)
      .values({
        discordId: discordUser.id,
        username: discordUser.username,
        avatarUrl: resolveAvatarUrl(discordUser),
        role: 'member',
        lastLogin: new Date(),
      })
      .onConflictDoUpdate({
        target: users.discordId,
        set: {
          username: discordUser.username,
          avatarUrl: resolveAvatarUrl(discordUser),
          lastLogin: new Date(),
          isProvisional: false,
        },
      })
      .returning();

    if (!user) {
      const redirect = new URL(env.FRONTEND_URL);
      redirect.searchParams.set('auth', 'error');
      res.redirect(redirect.toString());
      return;
    }

    // Sign JWT
    const token = signJwt({ userId: user.id, role: user.role });

    // Set HTTP-only cookie
    res.cookie(COOKIE_NAME, token, COOKIE_OPTIONS);

    // Audit log — Discord ID is deliberately not recorded: a user cannot read
    // their own audit trail, but reducing the surface we keep here is still
    // the right move.
    await createAuditLog({
      userId: user.id,
      action: 'login',
      entityType: 'user',
      entityId: user.id,
      details: { method: 'discord_oauth' },
      req,
    });

    const redirect = new URL(env.FRONTEND_URL);
    redirect.searchParams.set('auth', 'success');
    res.redirect(redirect.toString());
  } catch (err: unknown) {
    if (axios.isAxiosError(err)) {
      console.error('[AUTH CALLBACK ERROR]', err.response?.data ?? err.message);
    } else {
      console.error('[AUTH CALLBACK ERROR]', err);
    }

    // Send the user home with an error flag — they can try again from there.
    if (!res.headersSent) {
      const redirect = new URL(env.FRONTEND_URL);
      redirect.searchParams.set('auth', 'error');
      res.redirect(redirect.toString());
    }
  }
});

// ── GET /auth/discord/bot-callback ─────────────────────
// Where Discord returns a faction leader after they add the bot to a server.
//
// It lives here, rather than under the faction's own Discord routes, because
// Discord matches redirect URIs exactly — there is no way to carry a faction
// id in the path. The faction comes from the signed `state` instead, and every
// check the faction-scoped router would have applied is applied here by hand.
//
// This handler always ends in a redirect back to the app, never in a JSON
// error: the person reading it is looking at a browser tab, not a client.
router.get('/discord/bot-callback', requireAuth, async (req: Request, res: Response) => {
  const backToSettings = (status: string) => {
    const redirect = new URL(env.FRONTEND_URL);
    redirect.searchParams.set('discord', status);
    return redirect.toString();
  };

  const parsed = botCallbackSchema.safeParse(req.query);
  if (!parsed.success) {
    // Discord sends the leader here with ?error=access_denied when they back
    // out of the invite dialog. That is a decision, not a fault.
    res.redirect(backToSettings(req.query.error ? 'cancelled' : 'invalid'));
    return;
  }

  const state = verifyBotLinkState(parsed.data.state);
  if (!state) {
    res.redirect(backToSettings('expired'));
    return;
  }

  // The session must be the same person who started the invite. Without this,
  // a state token captured from a URL could be replayed by whoever holds it.
  if (state.userId !== req.user!.id) {
    res.redirect(backToSettings('mismatch'));
    return;
  }

  // Re-check the permission now, rather than trusting that it still holds from
  // when the invite URL was issued. Ten minutes is long enough to be demoted.
  const access = await resolveFactionAccess(state.factionId, req.user!);
  if (!access || !access.permissions.includes('manage_discord')) {
    res.redirect(backToSettings('forbidden'));
    return;
  }

  const authorization = await exchangeBotCode(parsed.data.code);
  if (!authorization) {
    res.redirect(backToSettings('error'));
    return;
  }

  // A Discord server belongs to one faction. Without this check, a leader
  // could point their faction at a server another faction already uses and
  // start receiving — or, with the routes below, aiming — its traffic.
  const [claimed] = await db
    .select({ factionId: discordIntegrations.factionId })
    .from(discordIntegrations)
    .where(eq(discordIntegrations.guildId, authorization.guildId))
    .limit(1);

  if (claimed && claimed.factionId !== state.factionId) {
    res.redirect(backToSettings('guild_taken'));
    return;
  }

  await db
    .insert(discordIntegrations)
    .values({
      factionId: state.factionId,
      guildId: authorization.guildId,
      guildName: authorization.guildName,
      linkedBy: req.user!.id,
    })
    .onConflictDoUpdate({
      // Re-running the invite for a faction that is already connected moves it
      // to the newly chosen server and clears any stale failure.
      target: discordIntegrations.factionId,
      set: {
        guildId: authorization.guildId,
        guildName: authorization.guildName,
        linkedBy: req.user!.id,
        linkedAt: new Date(),
        lastError: null,
        lastErrorAt: null,
      },
    });

  await createAuditLog({
    userId: req.user!.id,
    factionId: state.factionId,
    action: 'discord_linked',
    entityType: 'discord_integration',
    details: { guildId: authorization.guildId, guildName: authorization.guildName },
    req,
  });

  res.redirect(backToSettings('linked'));
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
  res.status(204).end();
});

// ── PATCH /auth/me — update in-game name ──────────────
const updateMeSchema = z.object({
  inGameName: z.string().trim().min(2).max(50),
});

router.patch('/me', requireAuth, async (req: Request, res: Response) => {
  const parsed = updateMeSchema.safeParse(req.body);
  if (!parsed.success) {
    error(res, 'VALIDATION_ERROR', parsed.error.issues[0]!.message);
    return;
  }

  const before = req.user!.inGameName;
  const [updated] = await db
    .update(users)
    .set({ inGameName: parsed.data.inGameName })
    .where(eq(users.id, req.user!.id))
    .returning();

  if (!updated) {
    error(res, 'INTERNAL_ERROR', 'Failed to update profile', 500);
    return;
  }

  await createAuditLog({
    userId: req.user!.id,
    action: 'update_profile',
    entityType: 'user',
    entityId: updated.id,
    details: { inGameName: updated.inGameName, previousInGameName: before },
    req,
  });

  success(res, await buildUserResponse(updated));
});

// ── GET /auth/me — current user + factions ─────────────
router.get('/me', requireAuth, async (req: Request, res: Response) => {
  success(res, await buildUserResponse(req.user!));
});

export default router;
