import type { FactionModule } from '@/lib/api-types';
import type { TranslationKey } from '@/lib/i18n';

/**
 * Starting points for a faction: which tools it uses, and what shape its ranks
 * take.
 *
 * A new faction used to open onto every module at once — twenty screens for a
 * burger bar that wants a till, a rota and a price list. A preset switches on
 * the handful a kind of faction actually uses, and suggests the rank template
 * that fits. Like a rank template, it only fills in the settings form: the
 * admin sees exactly what changed and presses Save, or does not.
 *
 * Deliberately short lists. Anything left off is one checkbox away, and a
 * preset that switched everything on would be the problem it exists to solve.
 */
export interface FactionPreset {
  key: string;
  label: TranslationKey;
  hint: TranslationKey;
  icon: string;
  modules: FactionModule[];
  /** Which rank template suits it, by the server's template key. */
  rankTemplate: 'crew' | 'organisation' | 'business';
}

/** Everything a faction of any kind leans on. */
const COMMON: FactionModule[] = ['announcements', 'feed', 'complaints'];

export const FACTION_PRESETS: FactionPreset[] = [
  {
    key: 'restaurant',
    label: 'preset.restaurant',
    hint: 'preset.restaurantHint',
    icon: '🍔',
    modules: [...COMMON, 'entries', 'treasury', 'expenses', 'pricing', 'shifts', 'payouts', 'reports'],
    rankTemplate: 'business',
  },
  {
    key: 'garage',
    label: 'preset.garage',
    hint: 'preset.garageHint',
    icon: '🔧',
    modules: [...COMMON, 'entries', 'treasury', 'expenses', 'pricing', 'shifts', 'vehicles', 'payouts', 'wages', 'reports'],
    rankTemplate: 'business',
  },
  {
    key: 'gang',
    label: 'preset.gang',
    hint: 'preset.gangHint',
    icon: '🔫',
    modules: [...COMMON, 'entries', 'treasury', 'payouts', 'laundering', 'crafting', 'operations', 'map', 'vehicles', 'leaderboard', 'strikes', 'quotas', 'wages'],
    rankTemplate: 'crew',
  },
  {
    key: 'organisation',
    label: 'preset.organisation',
    hint: 'preset.organisationHint',
    icon: '🎩',
    modules: [...COMMON, 'entries', 'treasury', 'expenses', 'payouts', 'laundering', 'crafting', 'pricing', 'operations', 'map', 'vehicles', 'leaderboard', 'strikes', 'quotas', 'wages', 'reports'],
    rankTemplate: 'organisation',
  },
  {
    key: 'service',
    label: 'preset.service',
    hint: 'preset.serviceHint',
    icon: '🚓',
    modules: [...COMMON, 'shifts', 'strikes', 'vehicles', 'map', 'operations', 'reports'],
    rankTemplate: 'organisation',
  },
];
