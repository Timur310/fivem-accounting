import crypto from 'node:crypto';
import axios from 'axios';
import jwt from 'jsonwebtoken';
import { eq } from 'drizzle-orm';
import { db } from '../db/index.js';
import { discordIntegrations } from '../db/schema.js';
import { env } from './env.js';

const API = 'https://discord.com/api/v10';

/**
 * What the bot is invited with. Deliberately the smallest set that can do the
 * job — see the channel list, post, and render an embed:
 *
 *   VIEW_CHANNEL (1 << 10) | SEND_MESSAGES (1 << 11) | EMBED_LINKS (1 << 14)
 *   | MENTION_EVERYONE (1 << 17)
 *
 * Asking for Administrator would be one fewer thing to think about, and a very
 * good reason for a faction leader to refuse the invite. They are handing a
 * third-party app access to their community's server; Discord's dialog shows
 * them exactly this list before they agree.
 *
 * MENTION_EVERYONE was left out at first, on the reasoning that reminders did
 * not need to ping `@everyone`. That was true and beside the point: the same
 * permission is what lets a bot ping a **role**, and Discord creates roles
 * with "allow anyone to @mention this role" switched off. Without it, nearly
 * every role in a normal server is unpingable and the tag picker greys out.
 *
 * It does not make the bot noisy on its own. Every message is sent with
 * `allowed_mentions` naming the exact ids chosen, so `@everyone` can only ever
 * be pinged if something deliberately asks for it — and nothing does.
 */
export const BOT_PERMISSIONS = String((1 << 10) | (1 << 11) | (1 << 14) | (1 << 17));

/** The bit that lets the bot ping a role that is not marked mentionable. */
const MENTION_EVERYONE = 1n << 17n;

/** How long a leader has to finish the invite before the link expires. */
const STATE_TTL_SECONDS = 10 * 60;

/**
 * The bot-link state is signed with a key *derived* from JWT_SECRET rather
 * than with JWT_SECRET itself.
 *
 * The state rides through Discord inside a redirect URL, so it turns up in
 * browser history, proxy logs and referrer headers. Signed with the session
 * key it would *be* a session: `verifyJwt` casts whatever it decodes to a
 * JwtPayload and `requireAuth` loads the user named by `userId`, so a leaked
 * state token pasted into the session cookie would authenticate as its
 * subject.
 *
 * A separate key removes the crossover entirely — neither token verifies
 * against the other's secret, whatever it contains.
 */
const STATE_SECRET = crypto
  .createHmac('sha256', env.JWT_SECRET)
  .update('discord-bot-link-v1')
  .digest('hex');

interface BotLinkState {
  factionId: string;
  userId: string;
  purpose: 'discord_bot_link';
}

/** Is a bot token configured at all? Everything else checks this first. */
export function isDiscordConfigured(): boolean {
  return env.DISCORD_BOT_TOKEN.length > 0;
}

/** Where Discord sends the leader back after they pick a server. */
export function botRedirectUri(): string {
  if (env.DISCORD_BOT_REDIRECT_URI) return env.DISCORD_BOT_REDIRECT_URI;
  // Fall back to the login redirect's origin, so a deployment that set only
  // the OAuth URI still gets a working default.
  const login = new URL(env.DISCORD_REDIRECT_URI);
  login.pathname = '/api/v1/auth/discord/bot-callback';
  return login.toString();
}

export function signBotLinkState(factionId: string, userId: string): string {
  const payload: BotLinkState = { factionId, userId, purpose: 'discord_bot_link' };
  return jwt.sign(payload, STATE_SECRET, { expiresIn: STATE_TTL_SECONDS });
}

export function verifyBotLinkState(token: string): BotLinkState | null {
  try {
    const decoded = jwt.verify(token, STATE_SECRET, { algorithms: ['HS256'] }) as BotLinkState;
    // Belt and braces: the derived secret already makes a session token fail
    // here, but an explicit purpose check costs nothing and states the intent.
    if (decoded.purpose !== 'discord_bot_link') return null;
    if (!decoded.factionId || !decoded.userId) return null;
    return decoded;
  } catch {
    return null;
  }
}

/**
 * The URL that opens Discord's "add this bot to a server" dialog.
 *
 * `response_type=code` asks Discord to come back through our callback with an
 * exchangeable code rather than leaving the leader on a Discord page. That
 * matters for more than tidiness: the code is what proves the callback is
 * genuine. Without it, anyone could hit the callback with a guild_id of their
 * choosing and claim a server they have nothing to do with.
 */
export function buildBotInviteUrl(factionId: string, userId: string): string {
  const params = new URLSearchParams({
    client_id: env.DISCORD_CLIENT_ID,
    scope: 'bot',
    permissions: BOT_PERMISSIONS,
    response_type: 'code',
    redirect_uri: botRedirectUri(),
    state: signBotLinkState(factionId, userId),
  });
  return `${API}/oauth2/authorize?${params.toString()}`;
}

interface BotAuthorizationResult {
  guildId: string;
  guildName: string | null;
}

/**
 * Exchange the callback code, and take the guild the bot was actually added to
 * from Discord's own answer.
 *
 * The callback also carries a `guild_id` query parameter, which is tempting
 * and wrong to trust: it is whatever the caller put in the URL. The guild in
 * the token response is what Discord says happened.
 */
export async function exchangeBotCode(code: string): Promise<BotAuthorizationResult | null> {
  try {
    const res = await axios.post<{ guild?: { id: string; name?: string } }>(
      `${API}/oauth2/token`,
      new URLSearchParams({
        client_id: env.DISCORD_CLIENT_ID,
        client_secret: env.DISCORD_CLIENT_SECRET,
        grant_type: 'authorization_code',
        code,
        redirect_uri: botRedirectUri(),
      }),
      { headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, timeout: 10_000 },
    );
    const guild = res.data.guild;
    if (!guild?.id) return null;
    return { guildId: guild.id, guildName: guild.name ?? null };
  } catch (err) {
    console.error('[DISCORD] bot code exchange failed', err);
    return null;
  }
}

export interface DiscordChannel {
  id: string;
  name: string;
  /** Category name, so the picker can group the way Discord itself does. */
  parentName: string | null;
  position: number;
}

// Channel types the bot can post into. 0 = text, 5 = announcement. Voice,
// categories, forums and threads are filtered out: offering a channel the bot
// cannot post to only produces a delivery failure later.
const POSTABLE_CHANNEL_TYPES = new Set([0, 5]);
const CATEGORY_CHANNEL_TYPE = 4;

interface RawChannel {
  id: string;
  name: string;
  type: number;
  position: number;
  parent_id: string | null;
}

/**
 * The text channels of a linked guild.
 *
 * Throws on failure rather than swallowing it, because the caller is a
 * settings screen somebody is actively looking at: "could not reach Discord"
 * is the answer they need, not an empty list that reads as "no channels".
 */
export async function listGuildChannels(guildId: string): Promise<DiscordChannel[]> {
  const res = await axios.get<RawChannel[]>(`${API}/guilds/${guildId}/channels`, {
    headers: { Authorization: `Bot ${env.DISCORD_BOT_TOKEN}` },
    timeout: 10_000,
  });

  const categories = new Map<string, string>();
  for (const c of res.data) {
    if (c.type === CATEGORY_CHANNEL_TYPE) categories.set(c.id, c.name);
  }

  return res.data
    .filter((c) => POSTABLE_CHANNEL_TYPES.has(c.type))
    .map((c) => ({
      id: c.id,
      name: c.name,
      parentName: c.parent_id ? categories.get(c.parent_id) ?? null : null,
      position: c.position,
    }))
    .sort((a, b) => a.position - b.position);
}

export interface DiscordEmbed {
  title?: string;
  description?: string;
  color?: number;
  /** Shown above the title, small, with an optional avatar beside it. */
  author?: { name: string; icon_url?: string; url?: string };
  fields?: { name: string; value: string; inline?: boolean }[];
  /** Square artwork in the top-right corner. Must be an http(s) URL. */
  thumbnail?: { url: string };
  footer?: { text: string; icon_url?: string };
  timestamp?: string;
}

export interface DiscordRole {
  id: string;
  name: string;
  /**
   * Whether anybody may ping it. A bot can mention a role that is not
   * mentionable only with MENTION_EVERYONE, which this bot deliberately never
   * asked for — so the picker has to say which roles will actually ping.
   */
  mentionable: boolean;
  position: number;
}

/**
 * The guild's roles, for the reminder mention picker.
 *
 * Throws on failure, like `listGuildChannels`: the caller is a settings screen
 * somebody is looking at, and an empty list would read as "no roles".
 */
export async function listGuildRoles(guildId: string): Promise<DiscordRole[]> {
  const res = await axios.get<{ id: string; name: string; mentionable: boolean; position: number; managed?: boolean }[]>(
    `${API}/guilds/${guildId}/roles`,
    { headers: { Authorization: `Bot ${env.DISCORD_BOT_TOKEN}` }, timeout: 10_000 },
  );

  return res.data
    // @everyone is every guild's id-as-role and is not a thing to offer here;
    // managed roles belong to other bots and integrations and pinging them
    // does nothing useful.
    .filter((r) => r.id !== guildId && !r.managed)
    .map((r) => ({ id: r.id, name: r.name, mentionable: r.mentionable, position: r.position }))
    .sort((a, b) => b.position - a.position);
}

/**
 * Can the bot ping any role in this guild, or only the mentionable ones?
 *
 * A faction that connected before MENTION_EVERYONE was asked for still has the
 * old, narrower grant — Discord does not widen an existing bot's permissions
 * when the invite URL changes. They have to re-invite, and the settings screen
 * can only tell them that if it knows.
 *
 * `GET /users/@me/guilds` carries the bot's permission bitfield per guild and
 * needs no privileged intent, unlike fetching the bot's member object.
 *
 * Returns null when the question cannot be answered, which the caller treats
 * as "assume the narrow case" rather than guessing generously.
 */
export async function botCanMentionAnyRole(guildId: string): Promise<boolean | null> {
  try {
    const res = await axios.get<{ id: string; permissions: string }[]>(
      `${API}/users/@me/guilds`,
      { headers: { Authorization: `Bot ${env.DISCORD_BOT_TOKEN}` }, timeout: 10_000 },
    );
    const guild = res.data.find((g) => g.id === guildId);
    if (!guild) return null;
    return (BigInt(guild.permissions) & MENTION_EVERYONE) !== 0n;
  } catch (err) {
    console.error('[DISCORD] could not read guild permissions', err);
    return null;
  }
}

/**
 * Who a message is allowed to ping.
 *
 * Always sent, and always explicit. Discord's default is to honour every
 * mention it finds in the text, so a reminder body containing `@everyone`
 * would ping the server. Naming the exact ids means the message pings those
 * and nothing else, whatever the text happens to contain.
 */
export interface AllowedMentions {
  parse: never[];
  users?: string[];
  roles?: string[];
}

export interface DeliveryResult {
  ok: boolean;
  error?: string;
}

/**
 * Post to a channel.
 *
 * **Never throws**, on the same reasoning as `notify()`: a Discord message is a
 * courtesy attached to something that has already happened for real. An
 * outage, a kicked bot or a deleted channel must not roll back the entry that
 * triggered it, and must not turn a successful request into a 500.
 *
 * Honours one 429 retry, because Discord rate-limits per channel and a faction
 * logging a burst of entries will hit that legitimately.
 */
export async function postToChannel(
  channelId: string,
  payload: { content?: string; embeds?: DiscordEmbed[]; allowed_mentions?: AllowedMentions },
  attempt = 0,
): Promise<DeliveryResult> {
  if (!isDiscordConfigured()) {
    return { ok: false, error: 'Discord bot token is not configured' };
  }

  try {
    await axios.post(`${API}/channels/${channelId}/messages`, payload, {
      headers: { Authorization: `Bot ${env.DISCORD_BOT_TOKEN}` },
      timeout: 10_000,
    });
    return { ok: true };
  } catch (err) {
    if (axios.isAxiosError(err)) {
      const status = err.response?.status;

      // Rate limited. retry_after is in seconds and can be fractional.
      if (status === 429 && attempt === 0) {
        const retryAfter = Number(err.response?.data?.retry_after ?? 1);
        const waitMs = Math.min(Math.max(retryAfter, 0) * 1000, 5_000);
        await new Promise((resolve) => setTimeout(resolve, waitMs));
        return postToChannel(channelId, payload, attempt + 1);
      }

      const reason =
        status === 403 ? 'The bot is not allowed to post in that channel'
        : status === 404 ? 'That channel no longer exists'
        : status === 401 ? 'The bot token was rejected by Discord'
        : `Discord returned ${status ?? 'no response'}`;
      console.error('[DISCORD] delivery failed', channelId, status);
      return { ok: false, error: reason };
    }
    console.error('[DISCORD] delivery failed', channelId, err);
    return { ok: false, error: 'Could not reach Discord' };
  }
}

/**
 * Make the bot leave a guild.
 *
 * A bot can remove itself — it needs no permission beyond already being there
 * — which is what lets "disconnect" be one action instead of a settings screen
 * and a homework assignment in Discord.
 *
 * Offered rather than implied, and never the default. One Discord application
 * can carry a bot that does several jobs, so the server a faction connected
 * may be the same one where that bot already runs a whitelist or hands out
 * roles. Leaving on every disconnect would silently break the other job. The
 * caller decides; this function only does as it is told.
 *
 * **Never throws.** Disconnecting is a local decision that has already been
 * made; failing to also leave the guild must not undo it.
 */
export async function leaveGuild(guildId: string): Promise<DeliveryResult> {
  if (!isDiscordConfigured()) {
    return { ok: false, error: 'Discord bot token is not configured' };
  }

  try {
    await axios.delete(`${API}/users/@me/guilds/${guildId}`, {
      headers: { Authorization: `Bot ${env.DISCORD_BOT_TOKEN}` },
      timeout: 10_000,
    });
    return { ok: true };
  } catch (err) {
    if (axios.isAxiosError(err)) {
      const status = err.response?.status;
      // Already gone is the outcome the caller wanted, not a failure: somebody
      // kicked the bot by hand before pressing the button.
      if (status === 404) return { ok: true };
      console.error('[DISCORD] leave guild failed', guildId, status);
      return { ok: false, error: `Discord returned ${status ?? 'no response'}` };
    }
    console.error('[DISCORD] leave guild failed', guildId, err);
    return { ok: false, error: 'Could not reach Discord' };
  }
}

/**
 * Remember the last thing that went wrong for a faction, or clear it once a
 * delivery succeeds. Best-effort by design: failing to record a failure is not
 * worth surfacing a second one.
 */
export async function recordDeliveryOutcome(factionId: string, result: DeliveryResult): Promise<void> {
  try {
    await db
      .update(discordIntegrations)
      .set(
        result.ok
          ? { lastError: null, lastErrorAt: null }
          : { lastError: result.error ?? 'Unknown error', lastErrorAt: new Date() },
      )
      .where(eq(discordIntegrations.factionId, factionId));
  } catch (err) {
    console.error('[DISCORD] could not record delivery outcome', err);
  }
}
