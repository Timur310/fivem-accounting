import { inArray } from 'drizzle-orm';
import { db } from '../db/index.js';
import { users, type DiscordReminder } from '../db/schema.js';
import type { AllowedMentions, DiscordEmbed } from './discord.js';

/**
 * What actually gets posted for a reminder.
 *
 * Shared by the scheduled runner and the "send now" button so the two cannot
 * drift — a preview that differs from the real thing is worse than no preview.
 */
export interface ReminderMessage {
  content?: string;
  embeds: DiscordEmbed[];
  allowed_mentions: AllowedMentions;
}

/**
 * Turn stored ids into the ping text.
 *
 * People are stored as this app's user ids and resolved to Discord ids here.
 * Somebody who has since been removed from the faction, or whose row is gone,
 * simply drops out: a reminder written months ago should not fail because one
 * name in it left, and a ping to an id nobody recognises renders as raw text
 * in the channel.
 *
 * Provisional users are skipped too. Their Discord id is a registration a
 * superadmin typed in, not a confirmed account, and pinging one that was
 * mistyped would be a stranger's notification.
 */
async function resolveMentions(reminder: DiscordReminder): Promise<{
  content?: string;
  users: string[];
  roles: string[];
}> {
  const roles = reminder.mentionRoleIds ?? [];
  const wantedUserIds = reminder.mentionUserIds ?? [];

  let discordIds: string[] = [];
  if (wantedUserIds.length > 0) {
    const rows = await db
      .select({ discordId: users.discordId, isProvisional: users.isProvisional, isSystem: users.isSystem })
      .from(users)
      .where(inArray(users.id, wantedUserIds));
    discordIds = rows
      .filter((r) => !r.isProvisional && !r.isSystem)
      .map((r) => r.discordId);
  }

  if (roles.length === 0 && discordIds.length === 0) {
    return { users: [], roles: [] };
  }

  // Mentions only fire from a message's content. The same text inside an embed
  // renders as a link and pings nobody — which is the single most common way
  // this feature is built wrong.
  const content = [
    ...roles.map((id) => `<@&${id}>`),
    ...discordIds.map((id) => `<@${id}>`),
  ].join(' ');

  return { content, users: discordIds, roles };
}

/**
 * Build the message.
 *
 * The date is written as Discord's own `<t:unix:F>` markup rather than a
 * formatted string. Discord renders it in each reader's timezone and locale,
 * so a faction with somebody playing from another country sees the right wall
 * clock without the app knowing anything about where they are.
 */
export async function buildReminderMessage(
  reminder: DiscordReminder,
  sentAt: Date = new Date(),
): Promise<ReminderMessage> {
  const mentions = await resolveMentions(reminder);
  const unix = Math.floor(sentAt.getTime() / 1000);

  return {
    ...(mentions.content ? { content: mentions.content } : {}),
    embeds: [
      {
        // Always titled. An untitled embed is a wall of text with no handle,
        // and "Reminder" is at least honest about what it is.
        title: reminder.title || 'Reminder',
        description: reminder.message,
        color: 0x5865f2,
        fields: [{ name: 'When', value: `<t:${unix}:F>` }],
        timestamp: sentAt.toISOString(),
      },
    ],
    // Explicit and exhaustive: `parse: []` refuses every mention Discord would
    // otherwise find in the text, and only the listed ids are allowed through.
    // An @everyone typed into a reminder body cannot ping the server.
    allowed_mentions: {
      parse: [],
      ...(mentions.users.length ? { users: mentions.users } : {}),
      ...(mentions.roles.length ? { roles: mentions.roles } : {}),
    },
  };
}
