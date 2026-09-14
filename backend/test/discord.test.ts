import { describe, it, expect, beforeEach, vi } from 'vitest';
import jwt from 'jsonwebtoken';
import { eq } from 'drizzle-orm';
import { api, resetDatabase, seedBasicWorld, createFaction, type BasicWorld } from './helpers.js';
import { db } from '../src/db/index.js';
import { discordIntegrations, discordChannelRoutes } from '../src/db/schema.js';
import { signBotLinkState, verifyBotLinkState, buildBotInviteUrl } from '../src/lib/discord.js';

/**
 * The one thing in this suite that would otherwise reach Discord.
 *
 * Only `leaveGuild` is replaced — `importOriginal` keeps the rest of the
 * module real, so the state-signing tests below still exercise the actual
 * implementation rather than a stub.
 */
const leaveGuildMock = vi.hoisted(() => vi.fn(async () => ({ ok: true })));
vi.mock('../src/lib/discord.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../src/lib/discord.js')>()),
  leaveGuild: leaveGuildMock,
}));

let w: BasicWorld;
const f = () => `/api/v1/factions/${w.faction.id}`;
const base = () => `${f()}/discord`;

// A real Discord snowflake is 17-20 digits. The routes validate the shape, so
// the tests have to use a plausible one.
const CHANNEL = '123456789012345678';
const OTHER_CHANNEL = '876543210987654321';
const GUILD = '555000111222333444';

beforeEach(async () => {
  await resetDatabase();
  w = await seedBasicWorld();
  leaveGuildMock.mockClear();
  leaveGuildMock.mockResolvedValue({ ok: true });
});

/** Define a rank with the given permissions and put the plain member on it. */
async function giveMemberRank(permissions: string[], name = 'Underboss') {
  const ranks = await api().patch(`${f()}/settings`).set('Cookie', w.admin.cookie)
    .send({ ranks: [{ name, level: 1, permissions }] });
  expect(ranks.status).toBe(200);
  const assigned = await api().patch(`${f()}/members/${w.member.id}`)
    .set('Cookie', w.admin.cookie).send({ rank: name });
  expect(assigned.status).toBe(200);
}

/**
 * Connect a server without going through Discord.
 *
 * The invite round trip cannot run in a test — it ends at Discord's servers —
 * so everything downstream of "a guild is linked" is set up directly. The
 * callback's own checks are covered separately, against the signed state.
 */
async function linkGuild(guildId = GUILD) {
  await db.insert(discordIntegrations).values({
    factionId: w.faction.id,
    guildId,
    guildName: 'Test Server',
    linkedBy: w.admin.id,
  });
}

describe('permissions', () => {
  it('refuses a plain member — this aims where the faction talks', async () => {
    const res = await api().get(base()).set('Cookie', w.member.cookie);
    expect(res.status).toBe(403);
    expect(res.body.error.message).toMatch(/manage_discord/);
  });

  it('refuses someone who is not in the faction at all', async () => {
    expect((await api().get(base()).set('Cookie', w.outsider.cookie)).status).toBe(403);
  });

  it('lets a faction admin in', async () => {
    expect((await api().get(base()).set('Cookie', w.admin.cookie)).status).toBe(200);
  });

  it('lets a rank holding manage_discord in', async () => {
    await giveMemberRank(['manage_discord']);
    expect((await api().get(base()).set('Cookie', w.member.cookie)).status).toBe(200);
  });

  // The whole point of a separate permission: a rank can run the money side
  // without also being able to point the faction's traffic at a channel.
  it('is not granted by manage_settings', async () => {
    await giveMemberRank(['manage_settings', 'manage_expenses']);
    expect((await api().get(base()).set('Cookie', w.member.cookie)).status).toBe(403);
  });
});

describe('GET /discord', () => {
  it('reports an unconnected faction without pretending it is broken', async () => {
    const res = await api().get(base()).set('Cookie', w.admin.cookie);
    expect(res.status).toBe(200);
    expect(res.body.data.configured).toBe(true);
    expect(res.body.data.integration).toBeNull();
    expect(res.body.data.routes).toEqual([]);
    expect(res.body.data.eventTypes).toContain('entry_logged');
  });

  it('reports the connected server and who connected it', async () => {
    await linkGuild();
    const res = await api().get(base()).set('Cookie', w.admin.cookie);
    expect(res.body.data.integration.guildId).toBe(GUILD);
    expect(res.body.data.integration.guildName).toBe('Test Server');
    expect(res.body.data.integration.linkedByName).toBe(w.admin.username);
  });
});

describe('GET /discord/invite-url', () => {
  it('hands back a Discord authorize URL carrying a signed state', async () => {
    const res = await api().get(`${base()}/invite-url`).set('Cookie', w.admin.cookie);
    expect(res.status).toBe(200);

    const url = new URL(res.body.data.url);
    expect(url.host).toBe('discord.com');
    expect(url.searchParams.get('scope')).toBe('bot');
    // response_type=code is what makes the callback provable rather than
    // something anyone could forge; losing it would be a silent hole.
    expect(url.searchParams.get('response_type')).toBe('code');

    const state = verifyBotLinkState(url.searchParams.get('state')!);
    expect(state?.factionId).toBe(w.faction.id);
    expect(state?.userId).toBe(w.admin.id);
  });

  it('asks for the narrowest permissions that can do the job, not admin', async () => {
    const url = new URL(buildBotInviteUrl(w.faction.id, w.admin.id));
    // VIEW_CHANNEL | SEND_MESSAGES | EMBED_LINKS | MENTION_EVERYONE
    expect(url.searchParams.get('permissions'))
      .toBe(String((1 << 10) | (1 << 11) | (1 << 14) | (1 << 17)));
  });

  // MENTION_EVERYONE is what lets the bot ping a *role*, which is the reason
  // it is asked for. Discord creates roles with @mention switched off, so
  // without it nearly every role in a normal server is unpingable.
  it('asks for MENTION_EVERYONE, because role pings need it', async () => {
    const url = new URL(buildBotInviteUrl(w.faction.id, w.admin.id));
    expect(BigInt(url.searchParams.get('permissions')!) & (1n << 17n)).not.toBe(0n);
  });

  // Everything else stays out. Administrator would be one fewer thing to think
  // about and a very good reason for a leader to refuse the invite.
  it('does not ask for administrator or message management', async () => {
    const granted = BigInt(new URL(buildBotInviteUrl(w.faction.id, w.admin.id))
      .searchParams.get('permissions')!);
    expect(granted & (1n << 3n)).toBe(0n);   // ADMINISTRATOR
    expect(granted & (1n << 13n)).toBe(0n);  // MANAGE_MESSAGES
    expect(granted & (1n << 28n)).toBe(0n);  // MANAGE_ROLES
  });
});

describe('the bot-link state', () => {
  it('round-trips', () => {
    const token = signBotLinkState(w.faction.id, w.admin.id);
    expect(verifyBotLinkState(token)).toMatchObject({
      factionId: w.faction.id,
      userId: w.admin.id,
      purpose: 'discord_bot_link',
    });
  });

  it('rejects something signed with the session secret', () => {
    // The state travels through a redirect URL, so it shows up in history and
    // logs. These two token families must not be interchangeable in either
    // direction — this is the half that keeps a session out of the state.
    const sessionish = jwt.sign(
      { factionId: w.faction.id, userId: w.admin.id, purpose: 'discord_bot_link' },
      process.env.JWT_SECRET!,
      { expiresIn: '1d' },
    );
    expect(verifyBotLinkState(sessionish)).toBeNull();
  });

  it('rejects a state that is not for linking a bot', () => {
    expect(verifyBotLinkState('not-a-token')).toBeNull();
  });

  // And the other half: a state token must not work as a session cookie.
  it('is not accepted as a session', async () => {
    const state = signBotLinkState(w.faction.id, w.admin.id);
    const res = await api().get(base()).set('Cookie', `faction_session=${state}`);
    expect(res.status).toBe(401);
  });
});

describe('PUT /discord/routes/:eventType', () => {
  it('refuses to route anything before a server is connected', async () => {
    const res = await api().put(`${base()}/routes/entry_logged`)
      .set('Cookie', w.admin.cookie).send({ channelId: CHANNEL });
    expect(res.status).toBe(404);
  });

  it('records where an event goes', async () => {
    await linkGuild();
    const res = await api().put(`${base()}/routes/entry_logged`)
      .set('Cookie', w.admin.cookie)
      .send({ channelId: CHANNEL, channelName: 'ledger' });
    expect(res.status).toBe(200);
    expect(res.body.data.channelId).toBe(CHANNEL);
    expect(res.body.data.isEnabled).toBe(true);
  });

  // One channel per event type. Picking a new one has to move the event, not
  // start sending it to both.
  it('replaces the channel rather than adding a second one', async () => {
    await linkGuild();
    const put = (channelId: string) =>
      api().put(`${base()}/routes/entry_logged`).set('Cookie', w.admin.cookie).send({ channelId });

    await put(CHANNEL);
    await put(OTHER_CHANNEL);

    const rows = await db
      .select()
      .from(discordChannelRoutes)
      .where(eq(discordChannelRoutes.factionId, w.faction.id));
    expect(rows).toHaveLength(1);
    expect(rows[0]!.channelId).toBe(OTHER_CHANNEL);
  });

  it('refuses an event type the app does not raise', async () => {
    await linkGuild();
    const res = await api().put(`${base()}/routes/someone_said_something`)
      .set('Cookie', w.admin.cookie).send({ channelId: CHANNEL });
    expect(res.status).toBe(400);
  });

  it('refuses a channel id that is not a snowflake', async () => {
    await linkGuild();
    const res = await api().put(`${base()}/routes/entry_logged`)
      .set('Cookie', w.admin.cookie).send({ channelId: 'general' });
    expect(res.status).toBe(400);
  });
});

describe('DELETE /discord/routes/:eventType', () => {
  it('stops sending the event', async () => {
    await linkGuild();
    await api().put(`${base()}/routes/strike_issued`)
      .set('Cookie', w.admin.cookie).send({ channelId: CHANNEL });

    expect((await api().delete(`${base()}/routes/strike_issued`)
      .set('Cookie', w.admin.cookie)).status).toBe(200);

    const rows = await db
      .select()
      .from(discordChannelRoutes)
      .where(eq(discordChannelRoutes.factionId, w.faction.id));
    expect(rows).toHaveLength(0);
  });

  it('404s when the event was not routed anywhere', async () => {
    await linkGuild();
    expect((await api().delete(`${base()}/routes/strike_issued`)
      .set('Cookie', w.admin.cookie)).status).toBe(404);
  });
});

describe('DELETE /discord', () => {
  it('disconnects the server and takes the routing with it', async () => {
    await linkGuild();
    await api().put(`${base()}/routes/entry_logged`)
      .set('Cookie', w.admin.cookie).send({ channelId: CHANNEL });

    const res = await api().delete(base()).set('Cookie', w.admin.cookie);
    expect(res.status).toBe(200);

    // Leaving the routes behind would silently aim a future connection at
    // channel ids belonging to a server this faction no longer uses.
    const routes = await db
      .select()
      .from(discordChannelRoutes)
      .where(eq(discordChannelRoutes.factionId, w.faction.id));
    expect(routes).toHaveLength(0);

    const integrations = await db
      .select()
      .from(discordIntegrations)
      .where(eq(discordIntegrations.factionId, w.faction.id));
    expect(integrations).toHaveLength(0);
  });

  it('404s when there was nothing connected', async () => {
    expect((await api().delete(base()).set('Cookie', w.admin.cookie)).status).toBe(404);
  });

  // The bot may be doing other jobs in that server — a whitelist, roles — for
  // a faction that connected their main community Discord. Kicking it out on
  // every disconnect would break those silently.
  it('leaves the bot in the server unless asked', async () => {
    await linkGuild();
    const res = await api().delete(base()).set('Cookie', w.admin.cookie);
    expect(res.body.data.left).toBeNull();
    expect(leaveGuildMock).not.toHaveBeenCalled();
  });

  it('removes the bot from the server when asked', async () => {
    await linkGuild();
    const res = await api().delete(`${base()}?leave=true`).set('Cookie', w.admin.cookie);
    expect(res.status).toBe(200);
    expect(res.body.data.left).toBe(true);
    expect(leaveGuildMock).toHaveBeenCalledWith(GUILD);
  });

  // Disconnecting is the part they asked for and the part we can guarantee.
  // Failing to also leave must not leave them still connected.
  it('still disconnects when Discord refuses to let the bot leave', async () => {
    await linkGuild();
    leaveGuildMock.mockResolvedValue({ ok: false, error: 'Discord returned 500' });

    const res = await api().delete(`${base()}?leave=true`).set('Cookie', w.admin.cookie);
    expect(res.status).toBe(200);
    expect(res.body.data.unlinked).toBe(true);
    expect(res.body.data.left).toBe(false);
    expect(res.body.data.leaveError).toBe('Discord returned 500');

    const rows = await db
      .select()
      .from(discordIntegrations)
      .where(eq(discordIntegrations.factionId, w.faction.id));
    expect(rows).toHaveLength(0);
  });
});

describe('one server, one faction', () => {
  it('will not let two factions claim the same guild', async () => {
    await linkGuild();

    const rival = await createFaction('Rival Faction', w.superadmin.id);

    await expect(
      db.insert(discordIntegrations).values({
        factionId: rival.id,
        guildId: GUILD,
        guildName: 'Test Server',
        linkedBy: w.superadmin.id,
      }),
    ).rejects.toThrow();
  });
});

describe('POST /discord/test', () => {
  it('refuses before a server is connected, without calling Discord', async () => {
    const res = await api().post(`${base()}/test`)
      .set('Cookie', w.admin.cookie).send({ channelId: CHANNEL });
    expect(res.status).toBe(404);
  });

  it('validates the channel id before anything else', async () => {
    await linkGuild();
    const res = await api().post(`${base()}/test`)
      .set('Cookie', w.admin.cookie).send({ channelId: 'nope' });
    expect(res.status).toBe(400);
  });
});
