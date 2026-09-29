import { and, eq, gte, isNull, lte, or, sql } from 'drizzle-orm';
import { db } from '../db/index.js';
import { entries, itemTypes, quotas } from '../db/schema.js';
import { getPeriodRange } from './period.js';
import { todayDateString } from './date.js';
import { notify } from './notify.js';

/**
 * Tell a member when the entry they just logged took them over a quota.
 *
 * Only at the moment of crossing — below the target before this entry, at or
 * above it after — so a member who is already past their number is not told
 * again with every entry, which is how a notification turns into noise.
 *
 * Only the quotas measured against the member themselves: an everyone-each
 * target, or one set on them by name. A faction-wide total is everybody's, and
 * whoever happened to log the entry that tipped it did not reach it alone.
 *
 * Never throws, like `notify` itself: the entry is already logged, and a
 * failed courtesy must not turn that into an error.
 */
export async function notifyQuotaCrossings(params: {
  factionId: string;
  userId: string;
  itemTypeId: string;
  /** The amount just logged, as the ledger stores it. */
  amount: string;
  /** The day it was logged against. */
  entryDate: string;
}): Promise<void> {
  const { factionId, userId, itemTypeId, amount, entryDate } = params;
  const added = Number(amount);
  if (!(added > 0)) return;

  try {
    const today = todayDateString();
    const relevant = await db
      .select({
        id: quotas.id,
        targetAmount: quotas.targetAmount,
        periodType: quotas.periodType,
        periodStart: quotas.periodStart,
        itemTypeName: itemTypes.name,
      })
      .from(quotas)
      .innerJoin(itemTypes, eq(quotas.itemTypeId, itemTypes.id))
      .where(and(
        eq(quotas.factionId, factionId),
        eq(quotas.itemTypeId, itemTypeId),
        eq(quotas.isActive, true),
        lte(quotas.periodStart, today),
        or(
          and(eq(quotas.scope, 'everyone'), isNull(quotas.targetUserId)),
          and(eq(quotas.scope, 'member'), eq(quotas.targetUserId, userId)),
        ),
      ));

    for (const quota of relevant) {
      const range = getPeriodRange(quota.periodType, new Date());
      // An entry back-dated into an earlier period does not change this one.
      if (entryDate < range.start || entryDate > range.end) continue;

      const [row] = await db
        .select({ total: sql<string>`COALESCE(SUM(CAST(${entries.amount} AS NUMERIC)), 0)` })
        .from(entries)
        .where(and(
          eq(entries.factionId, factionId),
          eq(entries.itemTypeId, itemTypeId),
          eq(entries.userId, userId),
          eq(entries.isDeleted, false),
          gte(entries.entryDate, range.start),
          lte(entries.entryDate, range.end),
        ));

      const after = Number(row?.total ?? 0);
      const before = after - added;
      const target = Number(quota.targetAmount);
      if (target > 0 && before < target && after >= target) {
        await notify({
          userId,
          type: 'quota_reached',
          factionId,
          linkView: 'my-day',
          data: { itemTypeName: quota.itemTypeName, period: quota.periodType },
        });
      }
    }
  } catch (err) {
    console.error('[QUOTA REACHED ERROR]', err);
  }
}
