import { users, ANONYMOUS_DISCORD_ID, ANONYMOUS_USERNAME } from '../db/schema.js';
import { eq } from 'drizzle-orm';
import type { TransactionLike } from '../db/index.js';

/**
 * The user rows carry entries and payouts, so money that belongs to nobody in
 * particular still needs one to hang off. This is that row: a single shared
 * placeholder, created the first time it is needed rather than seeded by a
 * migration.
 *
 * It is deliberately not a faction member, so it never turns up on a roster,
 * and `isSystem` keeps it out of per-member rankings.
 *
 * Two callers need it: an anonymous entry, and the laundering desk, where the
 * placeholder stands on both sides of the conversion.
 */
export async function resolveAnonymousUserId(tx: TransactionLike): Promise<string> {
  const [existing] = await tx
    .select({ id: users.id })
    .from(users)
    .where(eq(users.discordId, ANONYMOUS_DISCORD_ID))
    .limit(1);
  if (existing) return existing.id;

  const [created] = await tx
    .insert(users)
    .values({
      discordId: ANONYMOUS_DISCORD_ID,
      username: ANONYMOUS_USERNAME,
      role: 'member',
      isSystem: true,
    })
    .returning({ id: users.id });
  if (!created) throw new Error('Failed to create the anonymous user');
  return created.id;
}
