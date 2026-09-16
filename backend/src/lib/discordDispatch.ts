import { and, eq, inArray } from 'drizzle-orm';
import { db } from '../db/index.js';
import {
  discordIntegrations,
  discordChannelRoutes,
  factions,
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
  | { type: 'craft_completed'; actorUserId: string; recipeName: string; quantity: number; inputs: { itemTypeId: string; amount: string }[]; outputs: { itemTypeId: string; amount: string }[] }
  | { type: 'craft_reverted'; actorUserId: string; recipeName: string; quantity: number; crafterUserId: string }
  | { type: 'entry_deleted'; actorUserId: string; ownerUserId: string; itemTypeId: string; amount: string; selfUndone?: boolean }
  | { type: 'payout_deleted'; actorUserId: string; recipientUserId: string; itemTypeId: string; amount: string; status: string; selfCancelled?: boolean }
  | { type: 'expense_deleted'; actorUserId: string; itemTypeId: string; amount: string; category: string }
  | { type: 'strike_revoked'; actorUserId: string; targetUserId: string; severity: string }
  | { type: 'announcement_removed'; actorUserId: string; title: string }
  | { type: 'vehicle_added'; actorUserId: string; plate: string; make?: string | null; model?: string | null; color?: string | null; owner?: string | null; status: string }
  | { type: 'vehicle_removed'; actorUserId: string; plate: string; make?: string | null; model?: string | null; owner?: string | null }
  | {
      type: 'operation_logged';
      actorUserId: string;
      name: string;
      kind: string;
      location?: string | null;
      occurredAt: string;
      crew: string[];
      loot: { itemTypeName: string; quantity: string; unit: string }[];
      factionCutPercent: string;
    }
  | { type: 'operation_reverted'; actorUserId: string; name: string; occurredAt: string };

/** What each operation kind is called in a message, spelled for a reader. */
const OPERATION_KIND_LABEL: Record<string, string> = {
  bank: 'Bank job',
  jewelry: 'Jewellery store',
  store: 'Store robbery',
  house: 'House robbery',
  convoy: 'Convoy',
  contract: 'Contract',
  territory: 'Territory',
  other: 'Job',
};

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
 * The glyph in front of the title.
 *
 * The left colour bar already says in/out/trouble, but only once your eye is
 * on the embed. Scrolling a busy channel, the emoji is what separates a haul
 * from a payout from a strike at a glance — and it is the one piece of
 * decoration Discord renders identically on every client.
 */
const EMOJI: Record<DiscordEvent['type'], string> = {
  entry_logged: '\u{1F4E5}',           // inbox tray
  payout_requested: '\u{1F64B}',       // raised hand
  payout_approved: '\u{2705}',         // check
  payout_rejected: '\u{26D4}',         // no entry
  payout_completed: '\u{1F4B8}',       // money with wings
  expense_recorded: '\u{1F9FE}',       // receipt
  strike_issued: '\u{26A0}\u{FE0F}',   // warning
  announcement_posted: '\u{1F4E2}',    // loudspeaker
  member_joined: '\u{1F91D}',          // handshake
  member_left: '\u{1F44B}',            // waving hand
  laundering_completed: '\u{1F9FC}',   // soap
  craft_completed: '\u{1F528}',        // hammer
  craft_reverted: '\u{21A9}\u{FE0F}',  // arrow curving back
  entry_deleted: '\u{1F5D1}\u{FE0F}',  // wastebasket
  payout_deleted: '\u{1F5D1}\u{FE0F}',
  expense_deleted: '\u{1F5D1}\u{FE0F}',
  strike_revoked: '\u{1F54A}\u{FE0F}', // dove
  announcement_removed: '\u{1F5D1}\u{FE0F}',
  vehicle_added: '\u{1F697}',          // car
  vehicle_removed: '\u{1F5D1}\u{FE0F}',
  operation_logged: '\u{1F3AF}',       // direct hit
  operation_reverted: '\u{1F5D1}\u{FE0F}',
};

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

/**
 * The amount as the item itself writes it: `$1,250,000.00` for money,
 * `30 pcs` for things you can count.
 *
 * Same convention the interface uses, deliberately — somebody who reads a
 * figure in the channel and then goes looking for it in the app should not
 * have to translate it on the way.
 */
function formatQuantity(amount: string, item: ItemRef | null): string {
  if (!item) return formatAmount(amount);

  if (item.isCurrency) {
    const [whole = '0', fraction = ''] = amount.split('.');
    const sign = whole.startsWith('-') ? '-' : '';
    const digits = (sign ? whole.slice(1) : whole).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
    const cents = `${fraction}00`.slice(0, 2);
    return `${sign}${item.unit || '$'}${digits}.${cents}`;
  }

  const n = formatAmount(amount);
  // The default unit is a dollar sign, which on a countable item means the
  // faction never set one rather than "these are dollars".
  return item.unit && item.unit !== '$' ? `${n} ${item.unit}` : n;
}

interface ActorRef {
  name: string;
  avatarUrl: string | null;
}

interface ItemRef {
  name: string;
  icon: string | null;
  imageUrl: string | null;
  unit: string;
  isCurrency: boolean;
  category: string;
}

/**
 * A glyph for an item type that has none of its own.
 *
 * `image_url` is for factions with real artwork and most will never set it;
 * `icon` is the cheap version and plenty of item types will not have that
 * either. Falling back on the category means every amount in the channel gets
 * a glyph, which matters more than the glyph being exactly right: an embed
 * where some lines have a picture and some do not looks broken, where one
 * whose pictures are merely generic just looks plain.
 */
const CATEGORY_ICON: Record<string, string> = {
  cash: '\u{1F4B5}',        // banknotes
  goods: '\u{1F4E6}',       // package
  contraband: '\u{2697}\u{FE0F}', // alembic
  other: '\u{1F3F7}\u{FE0F}',     // label
};

/** The item's own emoji, or the one its category lends it. */
function itemGlyph(item: ItemRef): string {
  if (item.icon) return item.icon;
  // `category` defaults to 'other' and plenty of factions will never touch it,
  // so money would end up under a generic label. `isCurrency` is the flag they
  // do set, because it changes how the app formats every amount — which makes
  // it the more reliable signal of the two.
  if (item.isCurrency) return CATEGORY_ICON.cash!;
  return CATEGORY_ICON[item.category] || CATEGORY_ICON.other!;
}

interface FactionRef {
  name: string;
  brandColor: string | null;
}

/** Names of the people and item types an event mentions, in one round trip each. */
async function resolveNames(userIds: string[], itemTypeIds: string[]) {
  const wantedUsers = [...new Set(userIds.filter(Boolean))];
  const wantedItems = [...new Set(itemTypeIds.filter(Boolean))];

  const [userRows, itemRows] = await Promise.all([
    wantedUsers.length
      ? db
          .select({
            id: users.id,
            username: users.username,
            inGameName: users.inGameName,
            avatarUrl: users.avatarUrl,
            isSystem: users.isSystem,
          })
          .from(users)
          .where(inArray(users.id, wantedUsers))
      : Promise.resolve([]),
    wantedItems.length
      ? db
          .select({
            id: itemTypes.id,
            name: itemTypes.name,
            icon: itemTypes.icon,
            imageUrl: itemTypes.imageUrl,
            unit: itemTypes.unit,
            isCurrency: itemTypes.isCurrency,
            category: itemTypes.category,
          })
          .from(itemTypes)
          .where(inArray(itemTypes.id, wantedItems))
      : Promise.resolve([]),
  ]);

  const actors = new Map<string, ActorRef>();
  for (const u of userRows) {
    // The shared placeholder is not a person, and naming it in a public
    // channel would read as an accusation against whoever it is called. It
    // gets no avatar either — an empty face is better than a wrong one.
    actors.set(u.id, {
      name: u.isSystem ? 'the faction' : (u.inGameName ?? u.username),
      avatarUrl: u.isSystem ? null : u.avatarUrl,
    });
  }

  const items = new Map<string, ItemRef>();
  for (const i of itemRows) {
    items.set(i.id, {
      name: i.name,
      icon: i.icon,
      imageUrl: i.imageUrl,
      unit: i.unit,
      isCurrency: i.isCurrency,
      category: i.category,
    });
  }

  return {
    user: (id: string) => actors.get(id)?.name ?? 'someone',
    actor: (id: string): ActorRef => actors.get(id) ?? { name: 'someone', avatarUrl: null },
    item: (id: string) => items.get(id)?.name ?? 'an item',
    itemRef: (id: string): ItemRef | null => items.get(id) ?? null,
  };
}

type Names = Awaited<ReturnType<typeof resolveNames>>;

/**
 * A faction's brand colour as Discord wants it, or null if it has none or the
 * stored value is not a hex triple.
 */
function brandInt(faction: FactionRef): number | null {
  const hex = faction.brandColor?.trim();
  if (!hex || !/^#[0-9a-fA-F]{6}$/.test(hex)) return null;
  return parseInt(hex.slice(1), 16);
}

/**
 * The headline, big.
 *
 * Discord renders `###` inside an embed description as a real heading, which
 * is the only size control an embed has. The amount is what everyone in the
 * channel is actually reading for, so it gets the heading and the item name
 * sits under it — rather than all of it being one bolded sentence at body size
 * that you have to parse word by word.
 */
function headline(sign: '+' | '-' | '', amount: string, item: ItemRef | null): string {
  const figure = `${sign}${formatQuantity(amount, item)}`;
  if (!item) return `### ${figure}`;
  // The glyph goes *in* the heading rather than beside the name below it.
  // Emoji scale with the heading, so this is the one way to get something
  // picture-sized into an embed that has no artwork — which, since almost no
  // faction sets an image URL, is nearly every embed.
  return `### ${itemGlyph(item)}  ${figure}\n${item.name}`;
}

/**
 * One line of a craft: its glyph, its amount and its name.
 *
 * A craft names several item types at once, so each line has to carry its own
 * identity — unlike every other event here, where the single item can sit on a
 * line of its own beneath the figure.
 */
function glyphAmount(line: { itemTypeId: string; amount: string }, names: Names): string {
  const item = names.itemRef(line.itemTypeId);
  const figure = formatQuantity(line.amount, item);
  return item ? `${itemGlyph(item)} ${figure} ${item.name}` : figure;
}

/** What the switch below decides; the chrome around it is applied once, in `render`. */
interface Spec {
  title: string;
  description: string;
  color: number;
  fields?: { name: string; value: string; inline?: boolean }[];
  /** The person the message is *about* — shown with their avatar at the top. */
  subject?: ActorRef;
  /** Who acted, when that is somebody other than the subject. */
  byline?: string;
  /** Drawn in the corner when the item type has artwork. */
  item?: ItemRef | null;
}

/**
 * The message itself.
 *
 * English only for now, and deliberately: a Discord message has no viewer —
 * it is one text read by everybody in the channel — so it cannot follow each
 * member's chosen language the way the interface does. `discord_integrations`
 * carries a `locale` column and the settings screen shows a (disabled) picker,
 * so the faction can choose one later without a migration.
 */
function describe(event: DiscordEvent, names: Names, faction: FactionRef): Spec {
  const brand = brandInt(faction);
  // Neutral events take the faction's own colour where it has one. Direction
  // and trouble keep their fixed meanings: a faction whose brand colour is red
  // must not have its approvals look like rejections.
  const info = brand ?? COLOR.info;

  switch (event.type) {
    case 'entry_logged': {
      const item = names.itemRef(event.itemTypeId);
      return {
        title: 'Entry logged',
        description: headline('+', event.amount, item),
        color: COLOR.in,
        subject: event.anonymous ? { name: 'Anonymous', avatarUrl: null } : names.actor(event.actorUserId),
        item,
        ...(event.description ? { fields: [{ name: 'Note', value: event.description }] } : {}),
      };
    }

    case 'payout_requested': {
      const item = names.itemRef(event.itemTypeId);
      return {
        title: 'Withdrawal requested',
        description: headline('', event.amount, item),
        color: info,
        subject: names.actor(event.recipientUserId),
        item,
        ...(event.description ? { fields: [{ name: 'Note', value: event.description }] } : {}),
      };
    }

    case 'payout_approved': {
      const item = names.itemRef(event.itemTypeId);
      return {
        title: 'Withdrawal approved',
        description: headline('', event.amount, item),
        color: COLOR.in,
        subject: names.actor(event.recipientUserId),
        byline: `Approved by ${names.user(event.actorUserId)}`,
        item,
      };
    }

    case 'payout_rejected': {
      const item = names.itemRef(event.itemTypeId);
      return {
        title: 'Withdrawal rejected',
        description: headline('', event.amount, item),
        color: COLOR.trouble,
        subject: names.actor(event.recipientUserId),
        byline: `Rejected by ${names.user(event.actorUserId)}`,
        item,
        ...(event.reason ? { fields: [{ name: 'Reason', value: event.reason }] } : {}),
      };
    }

    case 'payout_completed': {
      const item = names.itemRef(event.itemTypeId);
      return {
        title: 'Withdrawal paid out',
        description: headline('-', event.amount, item),
        color: COLOR.out,
        subject: names.actor(event.recipientUserId),
        byline: `Paid by ${names.user(event.actorUserId)}`,
        item,
      };
    }

    case 'expense_recorded': {
      const item = names.itemRef(event.itemTypeId);
      return {
        title: 'Expense recorded',
        description: headline('-', event.amount, item),
        color: COLOR.out,
        subject: names.actor(event.actorUserId),
        item,
        fields: [
          { name: 'Category', value: event.category, inline: true },
          ...(event.description ? [{ name: 'Note', value: event.description, inline: true }] : []),
        ],
      };
    }

    case 'strike_issued':
      return {
        title: 'Strike issued',
        description: `### ${event.severity}`,
        color: COLOR.trouble,
        subject: names.actor(event.targetUserId),
        byline: `Issued by ${names.user(event.actorUserId)}`,
        fields: [{ name: 'Reason', value: event.reason }],
      };

    case 'announcement_posted':
      return {
        title: event.priority === 'urgent' ? 'Announcement — urgent' : 'Announcement',
        // Long titles stay at body size: Discord styles only the first line of
        // a heading, so a title that wraps would change size halfway through.
        description: event.title.length <= 80 ? `### ${event.title}` : `**${event.title}**`,
        color: event.priority === 'urgent' ? COLOR.trouble : info,
        subject: names.actor(event.actorUserId),
      };

    case 'member_joined':
      return {
        title: 'Member joined',
        description: `**${names.user(event.targetUserId)}** joined the faction`,
        color: COLOR.in,
        subject: names.actor(event.targetUserId),
      };

    case 'member_left':
      return {
        title: 'Member left',
        description: `**${names.user(event.targetUserId)}** left the faction`,
        color: COLOR.trouble,
        subject: names.actor(event.targetUserId),
      };

    case 'laundering_completed': {
      const from = names.itemRef(event.fromItemTypeId);
      const to = names.itemRef(event.toItemTypeId);
      return {
        title: 'Laundering completed',
        description: `### ${formatQuantity(event.fromAmount, from)} → ${formatQuantity(event.toAmount, to)}`,
        color: info,
        subject: names.actor(event.actorUserId),
        item: to,
        fields: [
          { name: 'In', value: from ? `${itemGlyph(from)} ${from.name}` : names.item(event.fromItemTypeId), inline: true },
          { name: 'Out', value: to ? `${itemGlyph(to)} ${to.name}` : names.item(event.toItemTypeId), inline: true },
        ],
      };
    }

    case 'craft_completed': {
      // The output is the headline — it is what the faction now has. Inputs go
      // in a field, because "what it cost" is the second question every time
      // and never the first.
      const made = event.outputs
        .map((o) => `${glyphAmount(o, names)}`)
        .join('\n');
      const used = event.inputs
        .map((i) => `${glyphAmount(i, names)}`)
        .join('\n');
      return {
        title: event.quantity > 1 ? `Crafted ${event.quantity} × ${event.recipeName}` : `Crafted ${event.recipeName}`,
        description: `### ${made}`,
        color: COLOR.in,
        subject: names.actor(event.actorUserId),
        item: names.itemRef(event.outputs[0]?.itemTypeId ?? ''),
        ...(used ? { fields: [{ name: 'Materials used', value: used }] } : {}),
      };
    }

    case 'craft_reverted':
      return {
        title: 'Craft reverted',
        description: `### ${event.quantity > 1 ? `${event.quantity} × ` : ''}${event.recipeName}`,
        color: COLOR.removed,
        subject: names.actor(event.crafterUserId),
        byline: `Reverted by ${names.user(event.actorUserId)}`,
      };

    case 'entry_deleted': {
      const item = names.itemRef(event.itemTypeId);
      return {
        title: 'Entry removed',
        description: headline('-', event.amount, item),
        color: COLOR.removed,
        subject: names.actor(event.ownerUserId),
        // The 5-minute self-undo and a leader striking a row out are different
        // acts and the channel should not blur them.
        byline: event.selfUndone
          ? 'Undone by the member within 5 minutes'
          : `Removed by ${names.user(event.actorUserId)}`,
        item,
      };
    }

    case 'payout_deleted': {
      const item = names.itemRef(event.itemTypeId);
      return {
        title: event.selfCancelled ? 'Withdrawal request cancelled' : 'Withdrawal removed',
        description: headline('', event.amount, item),
        color: COLOR.removed,
        subject: names.actor(event.recipientUserId),
        byline: event.selfCancelled
          ? 'Cancelled by the requester'
          : `Removed by ${names.user(event.actorUserId)}`,
        item,
        fields: [{ name: 'Was', value: event.status, inline: true }],
      };
    }

    case 'expense_deleted': {
      const item = names.itemRef(event.itemTypeId);
      return {
        title: 'Expense removed',
        description: headline('', event.amount, item),
        color: COLOR.removed,
        subject: names.actor(event.actorUserId),
        byline: `Removed by ${names.user(event.actorUserId)}`,
        item,
        fields: [{ name: 'Category', value: event.category, inline: true }],
      };
    }

    case 'strike_revoked':
      return {
        title: 'Strike revoked',
        description: `**${names.user(event.targetUserId)}** — ${event.severity} no longer counts against them`,
        color: COLOR.removed,
        subject: names.actor(event.targetUserId),
        byline: `Revoked by ${names.user(event.actorUserId)}`,
      };

    case 'announcement_removed':
      return {
        title: 'Announcement removed',
        description: `**${event.title}**`,
        color: COLOR.removed,
        subject: names.actor(event.actorUserId),
        byline: `Removed by ${names.user(event.actorUserId)}`,
      };

    // The plate is the headline, because it is the one thing somebody reading
    // the channel can match against a car in front of them. Everything else is
    // a field, and a field with nothing in it is left out rather than printed
    // empty — most registry rows know the plate and little else.
    case 'vehicle_added': {
      const describe = [event.make, event.model].filter(Boolean).join(' ');
      return {
        title: 'Vehicle added',
        description: `### \u{1F697}  ${event.plate}${describe ? `\n${describe}` : ''}`,
        color: COLOR.info,
        subject: names.actor(event.actorUserId),
        byline: `Added by ${names.user(event.actorUserId)}`,
        fields: [
          ...(event.color ? [{ name: 'Colour', value: event.color, inline: true }] : []),
          ...(event.owner ? [{ name: 'Owner', value: event.owner, inline: true }] : []),
          { name: 'Status', value: event.status, inline: true },
        ],
      };
    }

    case 'vehicle_removed': {
      const describe = [event.make, event.model].filter(Boolean).join(' ');
      return {
        title: 'Vehicle removed',
        description: `### \u{1F697}  ${event.plate}${describe ? `\n${describe}` : ''}`,
        color: COLOR.removed,
        subject: names.actor(event.actorUserId),
        byline: `Removed by ${names.user(event.actorUserId)}`,
        fields: event.owner ? [{ name: 'Owner', value: event.owner, inline: true }] : [],
      };
    }

    // The crew and the haul, and nothing about who got what.
    //
    // A split has one line per person per item, which is a dozen rows for a
    // four-man bank job — unreadable in a chat message, and half of it is
    // somebody else's business anyway. What the channel wants is that the job
    // happened, who was on it and what came back. The exact shares are on the
    // screen that can lay them out in a table.
    case 'operation_logged': {
      const where = event.location ? ` \u{2022} ${event.location}` : '';
      const haul = event.loot
        .map((l) => `${formatAmount(l.quantity)} ${l.unit} ${l.itemTypeName}`)
        .join('\n');
      return {
        title: 'Operation logged',
        description: `### \u{1F3AF}  ${event.name}\n${OPERATION_KIND_LABEL[event.kind] ?? 'Job'}${where}`,
        color: COLOR.in,
        subject: names.actor(event.actorUserId),
        byline: `Logged by ${names.user(event.actorUserId)}`,
        fields: [
          { name: `Crew (${event.crew.length})`, value: event.crew.join(', ') || '\u{2014}' },
          { name: 'Haul', value: haul || '\u{2014}' },
          ...(Number(event.factionCutPercent) > 0
            ? [{ name: 'Faction cut', value: `${event.factionCutPercent}%`, inline: true }]
            : []),
        ],
      };
    }

    case 'operation_reverted':
      return {
        title: 'Operation reverted',
        description: `**${event.name}**\nEvery share it credited has been taken back out.`,
        color: COLOR.removed,
        subject: names.actor(event.actorUserId),
        byline: `Reverted by ${names.user(event.actorUserId)}`,
      };
  }
}

/**
 * The same chrome on every message: who it is about at the top with their
 * face, which faction it came from at the bottom, the item's artwork in the
 * corner, and the time Discord renders in each reader's own timezone.
 *
 * Doing it in one place is what makes a channel look like a feed rather than
 * sixteen messages that were each written separately — which is exactly what
 * the earlier version was.
 */
function render(event: DiscordEvent, names: Names, faction: FactionRef): DiscordEmbed {
  const spec = describe(event, names, faction);

  return {
    ...(spec.subject
      ? {
          author: {
            name: spec.subject.name,
            ...(spec.subject.avatarUrl ? { icon_url: spec.subject.avatarUrl } : {}),
          },
        }
      : {}),
    // Two spaces: Discord collapses the gap after an emoji otherwise, and the
    // title ends up touching the glyph.
    title: `${EMOJI[event.type]}  ${spec.title}`,
    description: spec.description,
    color: spec.color,
    ...(spec.fields?.length ? { fields: spec.fields } : {}),
    ...(spec.item?.imageUrl ? { thumbnail: { url: spec.item.imageUrl } } : {}),
    footer: { text: spec.byline ? `${faction.name} • ${spec.byline}` : faction.name },
    timestamp: new Date().toISOString(),
  };
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
  if ('crafterUserId' in event) userIds.push(event.crafterUserId);
  if ('inputs' in event) {
    for (const line of event.inputs) itemTypeIds.push(line.itemTypeId);
    for (const line of event.outputs) itemTypeIds.push(line.itemTypeId);
  }

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
    // to the integration means a route left behind by some future bug cannot
    // send anything once the integration is gone; the join to the faction
    // costs nothing extra and is what puts a name and a colour on the embed.
    const [target] = await db
      .select({
        channelId: discordChannelRoutes.channelId,
        isEnabled: discordChannelRoutes.isEnabled,
        factionName: factions.name,
        brandColor: factions.brandColor,
      })
      .from(discordChannelRoutes)
      .innerJoin(
        discordIntegrations,
        eq(discordChannelRoutes.factionId, discordIntegrations.factionId),
      )
      .innerJoin(factions, eq(discordChannelRoutes.factionId, factions.id))
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
    const faction: FactionRef = { name: target.factionName, brandColor: target.brandColor };
    const result = await postToChannel(target.channelId, { embeds: [render(event, names, faction)] });
    await recordDeliveryOutcome(factionId, result);
  } catch (err) {
    // Reached only if the lookup itself fails; postToChannel does not throw.
    console.error('[DISCORD DISPATCH ERROR]', event.type, err);
  }
}
