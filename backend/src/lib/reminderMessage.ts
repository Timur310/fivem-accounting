import { eq, inArray } from 'drizzle-orm';
import { db } from '../db/index.js';
import { factions, users, type DiscordReminder } from '../db/schema.js';
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
 * Members registered by Discord id who have never signed in **are** pinged.
 * They were skipped at first, on the reasoning that an unconfirmed id might be
 * mistyped and would then notify a stranger. That reasoning was wrong: Discord
 * does not notify somebody who is not in the guild and cannot see the channel,
 * so a mistyped id renders as an unresolved mention and reaches nobody. The
 * risk did not exist, and the cost was the whole feature — in these factions
 * most of the roster is registered by Discord id and never signs into the
 * accounting app, so tagging silently reached almost nobody.
 *
 * The real check is whether the person is in the server, and that runs when
 * the reminder is saved, where it can be reported to somebody who can act on
 * it. See unpingableMembers in routes/discordReminders.ts.
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
      .select({ discordId: users.discordId, isSystem: users.isSystem })
      .from(users)
      .where(inArray(users.id, wantedUserIds));
    // The shared placeholder is not a person and owns no Discord account.
    discordIds = rows
      .filter((r) => !r.isSystem)
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

const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

/** `1st`, `2nd`, `23rd` — for the monthly line. */
function ordinal(n: number): string {
  const tens = n % 100;
  if (tens >= 11 && tens <= 13) return `${n}th`;
  const suffix = ['th', 'st', 'nd', 'rd'][n % 10] ?? 'th';
  return `${n}${suffix}`;
}

/**
 * How often this reminder comes round, in a sentence.
 *
 * The old embed carried a "When" field holding the moment the message was
 * sent, which Discord was already printing under it — so the one field on the
 * reminder said nothing the reader did not have. The useful answer to "when"
 * on a recurring reminder is the recurrence, and it is the thing nobody in the
 * channel can look up for themselves.
 */
function recurrence(reminder: DiscordReminder): string | null {
  const time = reminder.timeOfDay;

  switch (reminder.scheduleType) {
    case 'daily':
      return time ? `Every day at ${time}` : 'Every day';

    case 'weekly': {
      const days = (reminder.weekdays ?? [])
        .filter((d) => d >= 0 && d <= 6)
        .sort((a, b) => a - b)
        .map((d) => WEEKDAYS[d]);
      if (days.length === 0) return null;
      const list =
        days.length === 1
          ? days[0]
          : `${days.slice(0, -1).join(', ')} and ${days[days.length - 1]}`;
      return time ? `Every ${list} at ${time}` : `Every ${list}`;
    }

    case 'monthly': {
      if (!reminder.dayOfMonth) return null;
      // 31 is stored as "the last day" and clamped per month, so saying the
      // 31st in a 30-day month would be a lie the runner does not tell.
      const day = reminder.dayOfMonth >= 31 ? 'the last day' : `the ${ordinal(reminder.dayOfMonth)}`;
      return time ? `Monthly on ${day} at ${time}` : `Monthly on ${day}`;
    }

    // A one-off has no next time worth printing: this is the only one there
    // was ever going to be.
    default:
      return null;
  }
}

/** The faction's brand colour as Discord wants it, or blurple. */
function colorFor(brandColor: string | null): number {
  if (brandColor && /^#[0-9a-fA-F]{6}$/.test(brandColor.trim())) {
    return parseInt(brandColor.trim().slice(1), 16);
  }
  return 0x5865f2;
}

/**
 * Build the message.
 *
 * The date is written as Discord's own `<t:unix:…>` markup rather than a
 * formatted string. Discord renders it in each reader's timezone and locale,
 * so a faction with somebody playing from another country sees the right wall
 * clock without the app knowing anything about where they are.
 */
export async function buildReminderMessage(
  reminder: DiscordReminder,
  sentAt: Date = new Date(),
): Promise<ReminderMessage> {
  const [mentions, [faction]] = await Promise.all([
    resolveMentions(reminder),
    db
      .select({ name: factions.name, brandColor: factions.brandColor })
      .from(factions)
      .where(eq(factions.id, reminder.factionId))
      .limit(1),
  ]);

  const unix = Math.floor(sentAt.getTime() / 1000);
  const every = recurrence(reminder);

  // The title carries the bell and the reminder's own name; the body is the
  // message itself, given a heading so it is the thing the eye lands on rather
  // than one grey paragraph among the channel's other grey paragraphs.
  const title = reminder.title?.trim() || 'Reminder';

  // A short single-line message reads well as a heading. A paragraph does not
  // — Discord only styles the first line, so the rest would drop to body size
  // mid-sentence and look broken rather than emphatic.
  const body = reminder.message;
  const asHeading = !body.includes('\n') && body.length <= 80;

  return {
    ...(mentions.content ? { content: mentions.content } : {}),
    embeds: [
      {
        // Always titled. An untitled embed is a wall of text with no handle,
        // and "Reminder" is at least honest about what it is.
        title: `\u{1F514}  ${title}`,
        description: asHeading ? `### ${body}` : body,
        color: colorFor(faction?.brandColor ?? null),
        fields: [
          { name: 'Sent', value: `<t:${unix}:f>`, inline: true },
          ...(every ? [{ name: 'Repeats', value: every, inline: true }] : []),
        ],
        footer: {
          text: faction?.name
            ? `${faction.name} • reminder`
            : 'Reminder',
        },
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
