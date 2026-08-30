import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import { env } from '../lib/env.js';
import * as schema from './schema.js';

const pool = new Pool({
  connectionString: env.DATABASE_URL,
  max: env.DB_POOL_MAX,
  idleTimeoutMillis: 30_000,
});

// A dying backend connection must not become a silent process crash.
// Log and let the pool rebuild the connection on the next checkout.
pool.on('error', (err) => {
  console.error('[DB] Idle pool error:', err.message);
});

export const db = drizzle(pool, { schema });
export type Database = typeof db;

/**
 * The type of the transaction callback parameter — what you get inside
 * `db.transaction(async (tx) => ...)`. Exposed so audit logging and other
 * helpers can join the caller's transaction without redefining this type.
 */
export type TransactionLike = Parameters<Parameters<typeof db.transaction>[0]>[0];

export { pool };
