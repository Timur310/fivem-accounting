import type { Request } from 'express';
import { and, eq } from 'drizzle-orm';
import { db } from '../db/index.js';
import { factionMembers, factions } from '../db/schema.js';

/** Every rank a faction could define; holding none is lower than all of them. */
export const NO_RANK_LEVEL = 1000;

/**
 * How senior this viewer is in this faction, as a rank level.
 *
 * **Lower means higher** — level 1 is the boss — so a thing restricted to
 * level 2 is open to 1 and 2 and hidden below. Faction admins and superadmins
 * answer 0: above every rank a faction can define, the same rule every other
 * permission in the app follows.
 *
 * Two features ask this question — which map layers open, and whether margins
 * are visible — and asking it twice in two files is how the two answers start
 * to differ.
 */
export async function viewerRankLevel(factionId: string, req: Request): Promise<number> {
  if (req.factionRole === 'admin' || req.factionRole === 'superadmin') return 0;

  const [membership] = await db
    .select({ rank: factionMembers.rank })
    .from(factionMembers)
    .where(and(eq(factionMembers.factionId, factionId), eq(factionMembers.userId, req.user!.id)))
    .limit(1);

  if (!membership?.rank) return NO_RANK_LEVEL;

  const [faction] = await db
    .select({ ranks: factions.ranks })
    .from(factions)
    .where(eq(factions.id, factionId))
    .limit(1);

  const rank = (faction?.ranks ?? []).find((r) => r.name === membership.rank);
  // A rank the faction has since deleted leaves the member holding a name
  // nothing defines. Treating that as "no rank" is the safe read: it can only
  // ever hide something, never reveal it.
  return rank?.level ?? NO_RANK_LEVEL;
}
