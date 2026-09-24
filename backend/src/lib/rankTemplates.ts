import { FACTION_PERMISSIONS, type FactionPermission } from '../db/schema.js';
import { isModuleEnabled, PERMISSION_MODULE, type FactionModule } from './modules.js';

/**
 * Starting points for a faction's rank list.
 *
 * A new faction opens Settings to a blank rank list and twenty-one permission
 * chips, and has to invent a hierarchy and decide what each level may do
 * before anybody can be given anything. That is the worst hour this app asks
 * of anyone, and almost every faction ends up at roughly the same answer:
 * somebody who runs it, somebody who helps run it, people who do the work.
 *
 * So the app offers that answer and lets them edit it. A template is applied
 * into the editor, not saved behind their back — they see the ranks and the
 * permissions, change what they disagree with, and press Save like any other
 * edit.
 */

/**
 * How much authority a permission carries.
 *
 * Three tiers rather than a hand-written permission list per rank per
 * template: with twenty-one permissions and three templates that would be
 * sixty-odd entries to keep correct, and every new permission would have to be
 * added to all of them or quietly go missing. Classifying the permission once,
 * where it is easy to be right, is the same decision with a tenth of the
 * surface.
 *
 * - `crew` — doing the faction's work. Running a recipe, working the counter,
 *   logging a job, keeping the registry and the map. Handing these out is what
 *   a rank is usually for.
 * - `officer` — watching over that work: editing somebody else's entry,
 *   approving a payout, reading the reports.
 * - `leadership` — deciding what the faction is. Members, settings, prices,
 *   recipes, discipline, the audit log.
 */
export const PERMISSION_TIER: Record<FactionPermission, 'crew' | 'officer' | 'leadership'> = {
  craft: 'crew',
  sell: 'crew',
  log_operations: 'crew',
  log_shifts: 'crew',
  manage_vehicles: 'crew',
  manage_map: 'crew',

  manage_entries: 'officer',
  manage_payouts: 'officer',
  view_reports: 'officer',
  manage_operations: 'officer',
  // Reading the rota and correcting it are both watching over the work rather
  // than doing it, and a shop-floor rank clocks itself in without either.
  view_shifts: 'officer',
  manage_shifts: 'officer',
  manage_expenses: 'officer',

  manage_members: 'leadership',
  manage_settings: 'leadership',
  manage_customization: 'leadership',
  manage_item_types: 'leadership',
  manage_quotas: 'leadership',
  manage_strikes: 'leadership',
  manage_complaints: 'leadership',
  manage_crafting: 'leadership',
  manage_prices: 'leadership',
  manage_laundering: 'leadership',
  manage_discord: 'leadership',
  view_audit_logs: 'leadership',
};

/** What a rank at each tier holds. Each one contains the tier below it. */
const TIER_CONTENTS = {
  none: [] as const,
  crew: ['crew'] as const,
  officer: ['crew', 'officer'] as const,
  leadership: ['crew', 'officer', 'leadership'] as const,
};
export type RankTier = keyof typeof TIER_CONTENTS;

interface TemplateRank {
  /** A translation key, so the suggested names arrive in the right language. */
  nameKey: string;
  level: number;
  tier: RankTier;
}

interface RankTemplate {
  key: string;
  ranks: TemplateRank[];
}

/**
 * Three shapes, because a fourth would be a variation on one of these.
 *
 * Every one of them ends in a rank with no permissions at all, which is the
 * one most factions actually need: reading is open to members throughout this
 * app, so a new recruit with nothing ticked can already see the registry, the
 * map, the board and the leaderboard on the day they join.
 */
export const RANK_TEMPLATES: RankTemplate[] = [
  {
    key: 'crew',
    ranks: [
      { nameKey: 'boss', level: 1, tier: 'leadership' },
      { nameKey: 'rightHand', level: 2, tier: 'officer' },
      { nameKey: 'member', level: 3, tier: 'crew' },
      { nameKey: 'recruit', level: 4, tier: 'none' },
    ],
  },
  {
    key: 'organisation',
    ranks: [
      { nameKey: 'boss', level: 1, tier: 'leadership' },
      { nameKey: 'underboss', level: 2, tier: 'leadership' },
      { nameKey: 'lieutenant', level: 3, tier: 'officer' },
      { nameKey: 'soldier', level: 4, tier: 'crew' },
      { nameKey: 'associate', level: 5, tier: 'none' },
    ],
  },
  {
    key: 'business',
    ranks: [
      { nameKey: 'owner', level: 1, tier: 'leadership' },
      { nameKey: 'manager', level: 2, tier: 'officer' },
      { nameKey: 'staff', level: 3, tier: 'crew' },
      { nameKey: 'trainee', level: 4, tier: 'none' },
    ],
  },
];

/**
 * The templates, carrying only permissions this faction can actually use.
 *
 * A faction that turned the ledger off should not be handed a Boss rank whose
 * chips are mostly about entries and payouts — that is the wall the modules
 * setting exists to pull down, and a template is the one place that would put
 * it straight back up.
 */
export function templatesFor(enabledModules: string[] | null) {
  const allowed = (tier: RankTier) => {
    const tiers = TIER_CONTENTS[tier] as readonly string[];
    return FACTION_PERMISSIONS.filter((permission) => {
      if (!tiers.includes(PERMISSION_TIER[permission])) return false;
      const module = PERMISSION_MODULE[permission] as FactionModule | undefined;
      return !module || isModuleEnabled(enabledModules, module);
    });
  };

  return RANK_TEMPLATES.map((template) => ({
    key: template.key,
    ranks: template.ranks.map((rank) => ({
      nameKey: rank.nameKey,
      level: rank.level,
      tier: rank.tier,
      permissions: allowed(rank.tier),
    })),
  }));
}
