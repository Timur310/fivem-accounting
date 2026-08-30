import { db } from '../db/index.js';
import { strikes, factions, DEFAULT_STRIKE_EXPIRY_DAYS } from '../db/schema.js';
import type { StrikeSeverity } from '../db/schema.js';
import { eq, and, sql, type SQL } from 'drizzle-orm';

/**
 * Compute the expiry timestamp for a new strike.
 *
 * Faction settings override the defaults per severity; `null` means the strike
 * never expires (the default for 'major').
 */
export async function resolveStrikeExpiry(
  factionId: string,
  severity: StrikeSeverity,
): Promise<Date | null> {
  const [faction] = await db
    .select({ strikeExpiryDays: factions.strikeExpiryDays })
    .from(factions)
    .where(eq(factions.id, factionId))
    .limit(1);

  const configured = faction?.strikeExpiryDays?.[severity];
  const days = configured === undefined ? DEFAULT_STRIKE_EXPIRY_DAYS[severity] : configured;
  if (days === null) return null;

  const expires = new Date();
  expires.setDate(expires.getDate() + days);
  return expires;
}

/**
 * SQL predicate for a strike that currently counts against a member.
 *
 * Expiry is evaluated at read time rather than flipped by a scheduled job:
 * with no scheduler in the stack, a stored 'expired' status would silently go
 * stale, and the timestamp is the source of truth anyway.
 */
export function isActiveStrike(): SQL {
  return sql`${strikes.status} = 'active' AND (${strikes.expiresAt} IS NULL OR ${strikes.expiresAt} > NOW())`;
}

/**
 * The status to show for a strike, folding in expiry that has passed.
 * Stored status wins for the terminal state ('revoked'). 'appealed' strikes
 * that have aged past their expiry are also flipped to 'expired' — otherwise
 * an appealed-but-unanswered strike would block the member indefinitely.
 */
export function effectiveStatus(strike: {
  status: string;
  expiresAt: Date | null;
}): string {
  const hasExpired = strike.expiresAt !== null && strike.expiresAt <= new Date();
  if (hasExpired && (strike.status === 'active' || strike.status === 'appealed')) {
    return 'expired';
  }
  return strike.status;
}

/** Count strikes that currently count against each of the given members. */
export async function countActiveStrikes(factionId: string): Promise<Map<string, number>> {
  const rows = await db
    .select({
      userId: strikes.targetUserId,
      count: sql<number>`COUNT(*)::int`,
    })
    .from(strikes)
    .where(and(eq(strikes.factionId, factionId), isActiveStrike()))
    .groupBy(strikes.targetUserId);

  return new Map(rows.map((r) => [r.userId, r.count]));
}
