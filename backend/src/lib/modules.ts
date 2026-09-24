import { Request, Response, NextFunction } from 'express';
import { eq } from 'drizzle-orm';
import { db } from '../db/index.js';
import { factions } from '../db/schema.js';
import { error } from '../lib/response.js';

/**
 * Which parts of the app a faction actually uses.
 *
 * This app grew into a set of tools rather than one program: a ledger, a price
 * book, a vehicle registry, a map, a crew log. Most factions want some of
 * them. A faction running plates and a map should not be handed a navigation
 * list of twenty-three screens and a rank editor with twenty-one permissions,
 * nineteen of which are about an accounting system they never open.
 *
 * So each faction says which modules it uses, and everything that enumerates
 * features — the navigation, the rank editor, the Discord routing list —
 * filters through that.
 *
 * **Off hides the tool; it never touches the data.** A disabled module refuses
 * writes and keeps answering reads, so an old export still works, and turning
 * a module back on finds everything exactly as it was left. Nothing here
 * deletes anything, and no faction can lose a ledger to a checkbox.
 *
 * **There are no dependencies between modules, deliberately.** Booking a sale
 * writes entries, and it goes on doing that with the entries screen switched
 * off, because those entries are still counted by the treasury and the
 * leaderboard — the module hid a screen, not a number. Modelling which module
 * needs which other one would be a rule engine standing between a faction and
 * a checkbox, and it would be wrong the first time somebody used two features
 * in a combination nobody predicted.
 */
export const FACTION_MODULES = [
  'entries',
  'payouts',
  'treasury',
  'expenses',
  'quotas',
  'strikes',
  'laundering',
  'crafting',
  'pricing',
  'operations',
  'shifts',
  'complaints',
  'vehicles',
  'map',
  'leaderboard',
  'announcements',
  'feed',
  'reports',
] as const;
export type FactionModule = (typeof FACTION_MODULES)[number];

/**
 * Screens with no module, because a faction cannot be run without them: the
 * dashboard, the roster, settings, the audit log, Discord, support and the
 * guide. They are not in the list above and cannot be switched off.
 */

/** Which module each faction permission belongs to, for the rank editor. */
export const PERMISSION_MODULE: Partial<Record<string, FactionModule>> = {
  manage_entries: 'entries',
  manage_payouts: 'payouts',
  manage_quotas: 'quotas',
  manage_strikes: 'strikes',
  manage_expenses: 'expenses',
  manage_laundering: 'laundering',
  manage_crafting: 'crafting',
  craft: 'crafting',
  manage_prices: 'pricing',
  sell: 'pricing',
  log_operations: 'operations',
  manage_operations: 'operations',
  manage_complaints: 'complaints',
  log_shifts: 'shifts',
  view_shifts: 'shifts',
  manage_shifts: 'shifts',
  manage_vehicles: 'vehicles',
  manage_map: 'map',
  view_reports: 'reports',
};

/** Which module each Discord event belongs to, for the routing list. */
export const EVENT_MODULE: Partial<Record<string, FactionModule>> = {
  entry_logged: 'entries',
  entry_deleted: 'entries',
  payout_requested: 'payouts',
  payout_approved: 'payouts',
  payout_rejected: 'payouts',
  payout_completed: 'payouts',
  payout_deleted: 'payouts',
  expense_recorded: 'expenses',
  expense_deleted: 'expenses',
  strike_issued: 'strikes',
  strike_revoked: 'strikes',
  laundering_completed: 'laundering',
  craft_completed: 'crafting',
  craft_reverted: 'crafting',
  announcement_posted: 'announcements',
  announcement_removed: 'announcements',
  vehicle_added: 'vehicles',
  vehicle_removed: 'vehicles',
  operation_logged: 'operations',
  operation_reverted: 'operations',
  shift_started: 'shifts',
  shift_ended: 'shifts',
  complaint_filed: 'complaints',
};

/**
 * Is this module on for this faction?
 *
 * `null` means every module, and it is what every existing faction has: the
 * column was added without a backfill on purpose, so nobody's app changed the
 * day it shipped. It also means a module added later is on by default rather
 * than silently missing from factions that were configured before it existed.
 */
export function isModuleEnabled(enabled: string[] | null, module: FactionModule): boolean {
  return enabled === null || enabled.includes(module);
}

/** The faction's list, or null for all of them. */
export async function factionModules(factionId: string): Promise<string[] | null> {
  const [faction] = await db
    .select({ enabledModules: factions.enabledModules })
    .from(factions)
    .where(eq(factions.id, factionId))
    .limit(1);
  return faction?.enabledModules ?? null;
}

/**
 * Refuse to change anything in a module this faction has switched off.
 *
 * Reads pass through. A module is turned off because nobody wants to look at
 * it, not because the history behind it stopped being true, and a report or an
 * export that covers last year should not start failing halfway through. What
 * must not happen is new data arriving in a tool the faction believes is off —
 * that is how somebody logs into a screen they thought was gone.
 *
 * Mounted inside each module's router, after `requireFactionMember`, so the
 * answer to "are you allowed here at all" comes first and this never tells an
 * outsider which modules a faction runs.
 */
export function requireModule(module: FactionModule) {
  return async function checkModule(req: Request, res: Response, next: NextFunction): Promise<void> {
    if (req.method === 'GET' || req.method === 'HEAD' || req.method === 'OPTIONS') {
      next();
      return;
    }

    const enabled = await factionModules(req.params.id as string);
    if (isModuleEnabled(enabled, module)) {
      next();
      return;
    }

    error(res, 'FORBIDDEN',
      'This faction has turned that feature off. A faction admin can switch it back on in Settings.',
      403);
  };
}
