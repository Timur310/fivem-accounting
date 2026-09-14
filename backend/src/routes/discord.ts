import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { and, eq } from 'drizzle-orm';
import { db } from '../db/index.js';
import {
  discordIntegrations,
  discordChannelRoutes,
  users,
  DISCORD_EVENT_TYPES,
} from '../db/schema.js';
import { success, error } from '../lib/response.js';
import { requireAuth } from '../middleware/auth.js';
import { requireFactionMember, requirePermission } from '../middleware/factionAccess.js';
import { createAuditLog } from '../lib/audit.js';
import {
  buildBotInviteUrl,
  isDiscordConfigured,
  leaveGuild,
  listGuildChannels,
  postToChannel,
  recordDeliveryOutcome,
} from '../lib/discord.js';

const router = Router({ mergeParams: true });

// Every route here is administrative. There is no member-facing half of this
// screen, so the permission is applied once for the whole router rather than
// being repeated on each handler and eventually forgotten on one of them.
router.use(requireAuth, requireFactionMember, requirePermission('manage_discord'));

// ── GET / — connection status and current routing ─────
router.get('/', async (req: Request, res: Response) => {
  const factionId = req.params.id as string;

  const [integration] = await db
    .select({
      guildId: discordIntegrations.guildId,
      guildName: discordIntegrations.guildName,
      linkedAt: discordIntegrations.linkedAt,
      linkedByName: users.username,
      lastError: discordIntegrations.lastError,
      lastErrorAt: discordIntegrations.lastErrorAt,
    })
    .from(discordIntegrations)
    .innerJoin(users, eq(discordIntegrations.linkedBy, users.id))
    .where(eq(discordIntegrations.factionId, factionId))
    .limit(1);

  const routes = integration
    ? await db
        .select({
          eventType: discordChannelRoutes.eventType,
          channelId: discordChannelRoutes.channelId,
          channelName: discordChannelRoutes.channelName,
          isEnabled: discordChannelRoutes.isEnabled,
        })
        .from(discordChannelRoutes)
        .where(eq(discordChannelRoutes.factionId, factionId))
    : [];

  success(res, {
    // Three states the client has to tell apart, and they are not the same
    // thing: the operator never set a bot token, versus this faction has not
    // connected a server, versus connected but failing.
    configured: isDiscordConfigured(),
    integration: integration ?? null,
    routes,
    eventTypes: DISCORD_EVENT_TYPES,
  });
});

// ── GET /invite-url — start the invite ────────────────
router.get('/invite-url', async (req: Request, res: Response) => {
  if (!isDiscordConfigured()) {
    error(res, 'NOT_CONFIGURED', 'This deployment has no Discord bot configured', 503);
    return;
  }
  const factionId = req.params.id as string;
  success(res, { url: buildBotInviteUrl(factionId, req.user!.id) });
});

// ── DELETE / — disconnect the server ──────────────────
// `?leave=true` also makes the bot remove itself from the guild. Opt-in, never
// assumed: one Discord application can carry a bot doing several jobs, and the
// server a faction connected may be the one where that same bot already runs
// their whitelist. Leaving by default would break it silently.
router.delete('/', async (req: Request, res: Response) => {
  const factionId = req.params.id as string;
  const alsoLeave = req.query.leave === 'true';

  const [existing] = await db
    .select()
    .from(discordIntegrations)
    .where(eq(discordIntegrations.factionId, factionId))
    .limit(1);

  if (!existing) {
    error(res, 'NOT_FOUND', 'This faction is not connected to a Discord server', 404);
    return;
  }

  // The routes go with it. Keeping them would silently resurrect a faction's
  // old channel map if they later connected a different server, pointing
  // messages at channel ids from somewhere else entirely.
  await db.transaction(async (tx) => {
    await tx.delete(discordChannelRoutes).where(eq(discordChannelRoutes.factionId, factionId));
    await tx.delete(discordIntegrations).where(eq(discordIntegrations.factionId, factionId));
  });

  // Only after the local state is already gone. The disconnect is the part the
  // faction asked for and the part we can guarantee; leaving the guild is a
  // best-effort favour on top, and a failure there must not undo it.
  let left: boolean | null = null;
  let leaveError: string | undefined;
  if (alsoLeave) {
    const result = await leaveGuild(existing.guildId);
    left = result.ok;
    leaveError = result.error;
  }

  await createAuditLog({
    userId: req.user!.id,
    factionId,
    action: 'discord_unlinked',
    entityType: 'discord_integration',
    details: { guildId: existing.guildId, guildName: existing.guildName, leftGuild: left },
    req,
  });

  // `left` is null when they did not ask, false when we asked Discord and it
  // refused. The client says something different for each: nothing, or "the
  // bot is still in the server, remove it there".
  success(res, { unlinked: true, left, leaveError });
});

// ── GET /channels — the guild's text channels ─────────
router.get('/channels', async (req: Request, res: Response) => {
  const factionId = req.params.id as string;

  if (!isDiscordConfigured()) {
    error(res, 'NOT_CONFIGURED', 'This deployment has no Discord bot configured', 503);
    return;
  }

  const [integration] = await db
    .select({ guildId: discordIntegrations.guildId })
    .from(discordIntegrations)
    .where(eq(discordIntegrations.factionId, factionId))
    .limit(1);

  if (!integration) {
    error(res, 'NOT_FOUND', 'This faction is not connected to a Discord server', 404);
    return;
  }

  try {
    success(res, { channels: await listGuildChannels(integration.guildId) });
  } catch (err) {
    // Almost always the bot having been removed from the server by hand. Say
    // that, rather than leaving a settings screen showing an empty picker.
    console.error('[DISCORD] channel list failed', err);
    error(
      res,
      'DISCORD_UNAVAILABLE',
      'Could not read the channel list. The bot may have been removed from the server.',
      502,
    );
  }
});

// ── PUT /routes/:eventType — send this event here ─────
const routeSchema = z.object({
  channelId: z.string().regex(/^\d{17,20}$/, 'Not a valid Discord channel id'),
  channelName: z.string().max(120).optional(),
  isEnabled: z.boolean().optional().default(true),
});

router.put('/routes/:eventType', async (req: Request, res: Response) => {
  const factionId = req.params.id as string;
  const eventType = req.params.eventType as string;

  if (!(DISCORD_EVENT_TYPES as readonly string[]).includes(eventType)) {
    error(res, 'VALIDATION_ERROR', `Unknown event type "${eventType}"`);
    return;
  }

  const parsed = routeSchema.safeParse(req.body);
  if (!parsed.success) {
    error(res, 'VALIDATION_ERROR', parsed.error.issues[0]!.message);
    return;
  }

  const [integration] = await db
    .select({ guildId: discordIntegrations.guildId })
    .from(discordIntegrations)
    .where(eq(discordIntegrations.factionId, factionId))
    .limit(1);

  if (!integration) {
    error(res, 'NOT_FOUND', 'Connect a Discord server before routing events to it', 404);
    return;
  }

  const { channelId, channelName, isEnabled } = parsed.data;

  const [route] = await db
    .insert(discordChannelRoutes)
    .values({
      factionId,
      eventType,
      channelId,
      channelName: channelName ?? null,
      isEnabled,
    })
    .onConflictDoUpdate({
      // One channel per event type per faction; choosing a new one replaces
      // the old rather than adding a second destination.
      target: [discordChannelRoutes.factionId, discordChannelRoutes.eventType],
      set: {
        channelId,
        channelName: channelName ?? null,
        isEnabled,
        updatedAt: new Date(),
      },
    })
    .returning();

  await createAuditLog({
    userId: req.user!.id,
    factionId,
    action: 'discord_route_set',
    entityType: 'discord_channel_route',
    entityId: route!.id,
    details: { eventType, channelId, channelName: channelName ?? null, isEnabled },
    req,
  });

  success(res, route);
});

// ── DELETE /routes/:eventType — stop sending it ───────
router.delete('/routes/:eventType', async (req: Request, res: Response) => {
  const factionId = req.params.id as string;
  const eventType = req.params.eventType as string;

  const [deleted] = await db
    .delete(discordChannelRoutes)
    .where(
      and(
        eq(discordChannelRoutes.factionId, factionId),
        eq(discordChannelRoutes.eventType, eventType),
      ),
    )
    .returning();

  if (!deleted) {
    error(res, 'NOT_FOUND', 'That event is not routed anywhere', 404);
    return;
  }

  await createAuditLog({
    userId: req.user!.id,
    factionId,
    action: 'discord_route_cleared',
    entityType: 'discord_channel_route',
    details: { eventType, channelId: deleted.channelId },
    req,
  });

  success(res, { removed: true });
});

// ── POST /test — prove the wiring works ───────────────
const testSchema = z.object({
  channelId: z.string().regex(/^\d{17,20}$/, 'Not a valid Discord channel id'),
});

router.post('/test', async (req: Request, res: Response) => {
  const factionId = req.params.id as string;

  const parsed = testSchema.safeParse(req.body);
  if (!parsed.success) {
    error(res, 'VALIDATION_ERROR', parsed.error.issues[0]!.message);
    return;
  }

  const [integration] = await db
    .select({ guildId: discordIntegrations.guildId })
    .from(discordIntegrations)
    .where(eq(discordIntegrations.factionId, factionId))
    .limit(1);

  if (!integration) {
    error(res, 'NOT_FOUND', 'This faction is not connected to a Discord server', 404);
    return;
  }

  const result = await postToChannel(parsed.data.channelId, {
    embeds: [
      {
        title: 'Faction Accountant is connected',
        description:
          'If you can read this, notifications for this channel will arrive here.',
        color: 0x5865f2,
        footer: { text: `Test sent by ${req.user!.inGameName ?? req.user!.username}` },
        timestamp: new Date().toISOString(),
      },
    ],
  });

  await recordDeliveryOutcome(factionId, result);

  if (!result.ok) {
    // 200 with ok:false, not an error status. The request itself succeeded —
    // we asked Discord and Discord said no — and the reason is the useful part
    // of the answer, which the client should render rather than treat as a
    // failed call.
    success(res, { ok: false, error: result.error });
    return;
  }

  success(res, { ok: true });
});

export default router;
