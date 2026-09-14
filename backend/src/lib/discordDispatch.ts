import { and, eq, inArray } from 'drizzle-orm';
import { db } from '../db/index.js';
import {
  discordIntegrations,
  discordChannelRoutes,
  itemTypes,
  users,
  type DiscordEventType,
} from '../db/schema.js';
import { postToChannel, recordDeliveryOutcome, type DiscordEmbed } from './discord.js';

/**
 * What happened, in ids rather than sentences.
 *
 * Call sites pass what they already hold; every name is resolved here, and
 * only after a route is known to exist. A faction with Discord switched off —
 * which is every faction until it opts in — costs one indexed lookup and
 * nothing else.
 */
export type DiscordEvent =
  | { type: 'entry_logged'; actorUserId: string; itemTypeId: string; amount: string; description?: string | null; anonymous?: boolean }
  | { type: 'payout_requested'; actorUserId: string; recipientUserId: string; itemTypeId: string; amount: string; description?: string | null }
  | { type: 'payout_approved'; actorUserId: string; recipientUserId: string; itemTypeId: string; amount: string }
  | { type: 'payout_rejected'; actorUserId: string; recipientUserId: string; itemTypeId: string; amount: string; reason?: string | null }
  | { type: 'payout_completed'; actorUserId: string; recipientUserId: string; itemTypeId: string; amount: string }
  | { type: 'expense_recorded'; actorUserId: string; itemTypeId: string; amount: string; category: string; description?: string | null }
  | { type: 'strike_issued'; actorUserId: string; targetUserId: string; severity: string; reason: string }
  | { type: 'announcement_posted'; actorUserId: string; title: string; priority: string }
  | { type: 'member_joined'; actorUserId: string; targetUserId: string }
  | { type: 'member_left'; actorUserId: string; targetUserId: string }
  | { type: 'laundering_completed'; actorUserId: string; fromItemTypeId: string; fromAmount: string; toItemTypeId: string; toAmount: string }
  | { type: 'entry_deleted'; actorUserId: string; ownerUserId: string; itemTypeId: string; amount: string; selfUndone?: boolean }
  | { type: 'payout_deleted'; actorUserId: string; recipientUserId: string; itemTypeId: string; amount: string; status: string; selfCancelled?: boolean }
  | { type: 'expense_deleted'; actorUserId: string; itemTypeId: string; amount: string; category: string }
  | { type: 'strike_revoked'; actorUserId: string; targetUserId: string; severity: string }
  | { type: 'announcement_removed'; actorUserId: string; title: string };

/** Discord's own blurple, plus a green/red/amber for direction and trouble. */
const COLOR = {
  in: 0x22c55e,
  out: 0xef4444,
  trouble: 0xf59e0b,
  info: 0x5865f2,
  // Grey, deliberately not red: a removal is a correction, not an alarm, and
  // red already means money leaving the vault on these embeds.
  removed: 0x6b7280,
} as const;

/**
 * Thousand separators without going through Number.
 *
 * Amounts are decimal strings because the column is decimal, and FiveM money
 * runs long. `Number('9007199254740993')` already lies, so the grouping is
 * done on the digits themselves.
 */
function formatAmount(amount: string): string {
  const [whole = '0', fraction] = amount.split('.');
  const sign = whole.startsWith('-') ? '-' : '';
  const digits = sign ? whole.slice(1) : whole;
  const grouped = digits.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  // Trailing zeros on a decimal column are noise in a chat message.
  const rest = fraction && /[1-9]/.test(fraction) ? `.${fraction.replace(/0+$/, '')}` : '';
  return `${sign}${grouped}${rest}`;
}

/** Names of the people and item types an event mentions, in one round trip each. */
async function resolveNames(userIds: string[], itemTypeIds: string[]) {
  const wantedUsers = [...new Set(userIds.filter(Boolean))];
  const wantedItems = [...new Set(itemTypeIds.filter(Boolean))];

  const [userRows, itemRows] = await Promise.all([
    wantedUsers.length
      ? db
          .select({ id: users.id, username: users.username, inGameName: users.inGameName, isSystem: users.isSystem })
          .from(users)
          .where(inArray(users.id, wantedUsers))
      : Promise.resolve([]),
    wantedItems.length
      ? db
          .select({ id: itemTypes.id, name: itemTypes.name })
          .from(itemTypes)
          .where(inArray(itemTypes.id, wantedItems))
      : Promise.resolve([]),
  ]);

  const userName = new Map<string, string>();
  for (const u of userRows) {
    // The shared placeholder is not a person, and naming it in a public
    // channel would read as an accusation against whoever it is called.
    userName.set(u.id, u.isSystem ? 'the faction' : (u.inGameName ?? u.username));
  }
  const itemName = new Map<string, string>();
  for (const i of itemRows) itemName.set(i.id, i.name);

  return {
    user: (id: string) => userName.get(id) ?? 'someone',
    item: (id: string) => itemName.get(id) ?? 'an item',
  };
}

type Names = Awaited<ReturnType<typeof resolveNames>>;

/**
 * The message itself.
 *
 * English only for now, and deliberately: a Discord message has no viewer —
 * it is one text read by everybody in the channel — so it cannot follow each
 * member's chosen language the way the interface does. `discord_integrations`
 * carries a `locale` column and the settings screen shows a (disabled) picker,
 * so the faction can choose one later without a migration.
 */
function render(event: DiscordEvent, names: Names): DiscordEmbed {
  const stamp = new Date().toISOString();

  switch (event.type) {
    case 'entry_logged':
      return {
        title: 'Entry logged',
        description: `**${event.anonymous ? 'Anonymous' : names.user(event.actorUserId)}** added **${formatAmount(event.amount)} ${names.item(event.itemTypeId)}**`,
        color: COLOR.in,
        ...(event.description ? { fields: [{ name: 'Note', value: event.description }] } : {}),
        timestamp: stamp,
      };

    case 'payout_requested':
      return {
        title: 'Withdrawal requested',
        description: `**${names.user(event.recipientUserId)}** requested **${formatAmount(event.amount)} ${names.item(event.itemTypeId)}**`,
        color: COLOR.info,
        ...(event.description ? { fields: [{ name: 'Note', value: event.description }] } : {}),
        timestamp: stamp,
      };

    case 'payout_approved':
      return {
        title: 'Withdrawal approved',
        description: `**${formatAmount(event.amount)} ${names.item(event.itemTypeId)}** for **${names.user(event.recipientUserId)}**`,
        color: COLOR.info,
        footer: { text: `Approved by ${names.user(event.actorUserId)}` },
        timestamp: stamp,
      };

    case 'payout_rejected':
      return {
        title: 'Withdrawal rejected',
        description: `**${formatAmount(event.amount)} ${names.item(event.itemTypeId)}** for **${names.user(event.recipientUserId)}**`,
        color: COLOR.trouble,
        ...(event.reason ? { fields: [{ name: 'Reason', value: event.reason }] } : {}),
        footer: { text: `Rejected by ${names.user(event.actorUserId)}` },
        timestamp: stamp,
      };

    case 'payout_completed':
      return {
        title: 'Withdrawal paid out',
        description: `**${names.user(event.recipientUserId)}** received **${formatAmount(event.amount)} ${names.item(event.itemTypeId)}**`,
        color: COLOR.out,
        timestamp: stamp,
      };

    case 'expense_recorded':
      return {
        title: 'Expense recorded',
        description: `**${formatAmount(event.amount)} ${names.item(event.itemTypeId)}** left the vault`,
        color: COLOR.out,
        fields: [
          { name: 'Category', value: event.category, inline: true },
          ...(event.description ? [{ name: 'Note', value: event.description }] : []),
        ],
        footer: { text: `Recorded by ${names.user(event.actorUserId)}` },
        timestamp: stamp,
      };

    case 'strike_issued':
      return {
        title: 'Strike issued',
        description: `**${names.user(event.targetUserId)}** — ${event.severity}`,
        color: COLOR.trouble,
        fields: [{ name: 'Reason', value: event.reason }],
        footer: { text: `Issued by ${names.user(event.actorUserId)}` },
        timestamp: stamp,
      };

    case 'announcement_posted':
      return {
        title: 'Announcement',
        description: `**${event.title}**`,
        color: event.priority === 'urgent' ? COLOR.trouble : COLOR.info,
        footer: { text: `Posted by ${names.user(event.actorUserId)}` },
        timestamp: stamp,
      };

    case 'member_joined':
      return {
        title: 'Member joined',
        description: `**${names.user(event.targetUserId)}** joined the faction`,
        color: COLOR.in,
        timestamp: stamp,
      };

    case 'member_left':
      return {
        title: 'Member left',
        description: `**${names.user(event.targetUserId)}** left the faction`,
        color: COLOR.trouble,
        timestamp: stamp,
      };

    case 'entry_deleted':
      return removal(
        'Entry removed',
        `**${formatAmount(event.amount)} ${names.item(event.itemTypeId)}** logged by **${names.user(event.ownerUserId)}**`,
        // The 5-minute self-undo and a leader striking a row out are different
        // acts and the channel should not blur them.
        event.selfUndone ? 'Undone by the member within 5 minutes' : `Removed by ${names.user(event.actorUserId)}`,
        stamp,
      );

    case 'payout_deleted':
      return removal(
        event.selfCancelled ? 'Withdrawal request cancelled' : 'Withdrawal removed',
        `**${formatAmount(event.amount)} ${names.item(event.itemTypeId)}** for **${names.user(event.recipientUserId)}** (was ${event.status})`,
        event.selfCancelled ? 'Cancelled by the requester' : `Removed by ${names.user(event.actorUserId)}`,
        stamp,
      );

    case 'expense_deleted':
      return removal(
        'Expense removed',
        `**${formatAmount(event.amount)} ${names.item(event.itemTypeId)}** — ${event.category}`,
        `Removed by ${names.user(event.actorUserId)}`,
        stamp,
      );

    case 'strike_revoked':
      return removal(
        'Strike revoked',
        `**${names.user(event.targetUserId)}** — ${event.severity} no longer counts against them`,
        `Revoked by ${names.user(event.actorUserId)}`,
        stamp,
      );

    case 'announcement_removed':
      return removal(
        'Announcement removed',
        `**${event.title}**`,
        `Removed by ${names.user(event.actorUserId)}`,
        stamp,
      );

    case 'laundering_completed':
      return {
        title: 'Laundering completed',
        description:
          `**${formatAmount(event.fromAmount)} ${names.item(event.fromItemTypeId)}** became ` +
          `**${formatAmount(event.toAmount)} ${names.item(event.toItemTypeId)}**`,
        color: COLOR.info,
        footer: { text: `Run by ${names.user(event.actorUserId)}` },
        timestamp: stamp,
      };
  }
}

/**
 * A removal, said plainly.
 *
 * Worth its own colour and a consistent shape: somebody reading the channel
 * later needs to see at a glance that value came back *out* of the ledger,
 * without reading the sentence twice.
 */
function removal(title: string, description: string, footer: string, stamp: string): DiscordEmbed {
  return { title, description, color: COLOR.removed, footer: { text: footer }, timestamp: stamp };
}

/** The ids each event mentions, so they can be looked up in one go. */
function referencedIds(event: DiscordEvent): { userIds: string[]; itemTypeIds: string[] } {
  const userIds = [event.actorUserId];
  const itemTypeIds: string[] = [];

  if ('recipientUserId' in event) userIds.push(event.recipientUserId);
  if ('targetUserId' in event) userIds.push(event.targetUserId);
  if ('ownerUserId' in event) userIds.push(event.ownerUserId);
  if ('itemTypeId' in event) itemTypeIds.push(event.itemTypeId);
  if ('fromItemTypeId' in event) itemTypeIds.push(event.fromItemTypeId, event.toItemTypeId);

  return { userIds, itemTypeIds };
}

/**
 * Send one faction event to Discord, if the faction asked for it.
 *
 * **Never throws.** Same contract as `notify()` and `postToChannel()`: the
 * entry was really logged, the strike was really issued. A Discord outage must
 * not roll that back or turn a successful request into a 500.
 *
 * **Do not await this at the call site.** A Discord round trip is a couple of
 * hundred milliseconds, and nobody logging an entry should wait for it. Call
 * it with `void` and let it finish on its own; because it never rejects, there
 * is no unhandled rejection to leak.
 */
export async function dispatchDiscord(factionId: string, event: DiscordEvent): Promise<void> {
  try {
    // One indexed lookup, and for most factions the story ends here. The join
    // means a route left behind by some future bug cannot send anything once
    // the integration is gone.
    const [target] = await db
      .select({
        channelId: discordChannelRoutes.channelId,
        isEnabled: discordChannelRoutes.isEnabled,
      })
      .from(discordChannelRoutes)
      .innerJoin(
        discordIntegrations,
        eq(discordChannelRoutes.factionId, discordIntegrations.factionId),
      )
      .where(
        and(
          eq(discordChannelRoutes.factionId, factionId),
          eq(discordChannelRoutes.eventType, event.type satisfies DiscordEventType),
        ),
      )
      .limit(1);

    if (!target || !target.isEnabled) return;

    const { userIds, itemTypeIds } = referencedIds(event);
    const names = await resolveNames(userIds, itemTypeIds);
    const result = await postToChannel(target.channelId, { embeds: [render(event, names)] });
    await recordDeliveryOutcome(factionId, result);
  } catch (err) {
    // Reached only if the lookup itself fails; postToChannel does not throw.
    console.error('[DISCORD DISPATCH ERROR]', event.type, err);
  }
}
