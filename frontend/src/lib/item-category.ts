import type { ItemCategory } from './api-types';
import type { TranslationKey } from './i18n';

/**
 * Colour per item category, for the icon tile only.
 *
 * This does not break the §9.3 rule that colour on a *figure* means one thing
 * or nothing. Nothing here touches a number: the tint sits behind the icon so
 * a mixed table can be scanned by kind — cash from goods from contraband — at
 * a glance. Amounts, balances and quota bars stay exactly as neutral as they
 * were, and the faction accent is still reserved for chrome.
 *
 * Green is not "good" and red is not "bad" here; they are the colours these
 * things already wear in the game people are playing.
 */
export const CATEGORY_TILE: Record<ItemCategory, string> = {
  cash: 'bg-emerald-500/10 text-emerald-300/90',
  goods: 'bg-sky-500/10 text-sky-300/90',
  contraband: 'bg-red-500/10 text-red-300/90',
  other: 'bg-white/[0.05] text-zinc-400',
};

/** A thin left rule, for list rows that want the hint without a full tile. */
export const CATEGORY_RULE: Record<ItemCategory, string> = {
  cash: 'border-l-emerald-500/40',
  goods: 'border-l-sky-500/40',
  contraband: 'border-l-red-500/40',
  other: 'border-l-white/[0.08]',
};

export const CATEGORY_LABELS: Record<ItemCategory, TranslationKey> = {
  cash: 'itemTypes.categoryCash',
  goods: 'itemTypes.categoryGoods',
  contraband: 'itemTypes.categoryContraband',
  other: 'itemTypes.categoryOther',
};

/**
 * The emoji offered by the picker.
 *
 * A curated set rather than a full emoji-picker dependency: this is a ledger
 * for a crime roleplay server, and the forty glyphs its factions actually need
 * fit on one panel. Anything outside the list can still be pasted into the
 * field by hand, so the set is a shortcut rather than a restriction.
 */
export const ICON_CHOICES: { group: TranslationKey; icons: string[] }[] = [
  {
    group: 'itemTypes.categoryCash',
    icons: ['💵', '💰', '💸', '🪙', '💳', '🏦', '💎', '📦'],
  },
  {
    group: 'itemTypes.iconGroupContraband',
    icons: ['🌿', '💊', '🧪', '💉', '🚬', '🍾', '🧨', '☠️'],
  },
  {
    group: 'itemTypes.iconGroupWeapons',
    icons: ['🔫', '🔪', '🧰', '🛡️', '🎯', '💣', '🔗', '🧿'],
  },
  {
    group: 'itemTypes.iconGroupGear',
    icons: ['🚗', '🏍️', '🚁', '⛽', '🔧', '🔩', '📱', '🗝️'],
  },
  {
    group: 'itemTypes.iconGroupOther',
    icons: ['📄', '🎲', '🃏', '🕶️', '👕', '🍔', '⚡', '⭐'],
  },
];
