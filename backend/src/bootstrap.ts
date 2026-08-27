import 'dotenv/config';
import { db } from './db/index.js';
import { users } from './db/schema.js';
import { eq } from 'drizzle-orm';
import { env } from './lib/env.js';

/**
 * Bootstrap script: promote a user to superadmin by Discord ID.
 * Usage: npx tsx src/bootstrap.ts <discord_id>
 */
async function bootstrap() {
  const discordId = process.argv[2];

  if (!discordId) {
    console.error('Usage: npx tsx src/bootstrap.ts <discord_id>');
    console.error('Example: npx tsx src/bootstrap.ts 123456789012345678');
    process.exit(1);
  }

  console.log(`[BOOTSTRAP] Looking up user with Discord ID: ${discordId}`);

  const [user] = await db
    .select()
    .from(users)
    .where(eq(users.discordId, discordId))
    .limit(1);

  if (!user) {
    console.error(`[BOOTSTRAP] No user found with Discord ID: ${discordId}`);
    console.error('[BOOTSTRAP] The user must log in via Discord OAuth at least once before being promoted.');
    process.exit(1);
  }

  if (user.role === 'superadmin') {
    console.log(`[BOOTSTRAP] User ${user.username} (${discordId}) is already a superadmin.`);
    return;
  }

  const oldRole = user.role;
  await db
    .update(users)
    .set({ role: 'superadmin' })
    .where(eq(users.id, user.id));

  console.log(`[BOOTSTRAP] Done! User "${user.username}" (${discordId}) promoted from "${oldRole}" to "superadmin".`);
}

bootstrap().catch((err) => {
  console.error('[BOOTSTRAP] Error:', err);
  process.exit(1);
});
