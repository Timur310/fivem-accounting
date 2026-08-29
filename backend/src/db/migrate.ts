import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { db } from './index.js';

/**
 * Bring the database schema up to date on startup.
 *
 * Uses the migrator shipped inside drizzle-orm rather than the drizzle-kit
 * CLI, so the runtime image needs no dev dependencies and no `npx` call.
 *
 * Migrations are the generated SQL files in `drizzle/`, applied in order and
 * recorded in drizzle's own bookkeeping table, so re-running is a no-op. This
 * is deliberately not `drizzle-kit push`: push diffs the live database against
 * the schema and will happily drop columns to make them match, which is not
 * something that should happen unattended on a production boot.
 */
export async function runMigrations(migrationsFolder: string): Promise<void> {
  await migrate(db, { migrationsFolder });
}
