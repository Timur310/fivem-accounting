import { execSync } from 'node:child_process';
import pg from 'pg';

/**
 * Creates a dedicated test database and runs the migrations into it once,
 * before any suite starts.
 *
 * Tests run against real Postgres rather than a mocked layer on purpose: most
 * of this codebase's logic lives in SQL (FILTER aggregates, GROUP BY, cascade
 * deletes), and the bugs that actually shipped here — a missing GROUP BY
 * column, a broken CSV expression — were invisible to the type checker and
 * would be invisible to a mock too.
 */
const ADMIN_URL =
  process.env.TEST_ADMIN_DATABASE_URL ??
  'postgresql://postgres:1313@localhost:5432/postgres';

export const TEST_DB_NAME = process.env.TEST_DB_NAME ?? 'faction_accountant_test';

export function testDatabaseUrl(): string {
  return ADMIN_URL.replace(/\/[^/]+$/, `/${TEST_DB_NAME}`);
}

export default async function globalSetup() {
  const admin = new pg.Client({ connectionString: ADMIN_URL });
  await admin.connect();

  // Drop and recreate so a previous crashed run cannot leak state.
  await admin.query(`DROP DATABASE IF EXISTS ${TEST_DB_NAME} WITH (FORCE)`);
  await admin.query(`CREATE DATABASE ${TEST_DB_NAME}`);
  await admin.end();

  // Build the schema the same way production does — from the committed
  // migrations, not from drizzle-kit push. If a migration is broken, the test
  // run fails here rather than silently testing a hand-made schema.
  execSync('npx drizzle-kit migrate', {
    stdio: 'pipe',
    env: { ...process.env, DATABASE_URL: testDatabaseUrl() },
  });

  return async () => {
    const cleanup = new pg.Client({ connectionString: ADMIN_URL });
    await cleanup.connect();
    await cleanup.query(`DROP DATABASE IF EXISTS ${TEST_DB_NAME} WITH (FORCE)`);
    await cleanup.end();
  };
}
