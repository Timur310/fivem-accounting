import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import * as schema from './schema.js';
import { env } from '../lib/env.js';

const pool = new Pool({
  connectionString: env.DATABASE_URL,
  max: env.DB_POOL_MAX,
  idleTimeoutMillis: 30_000,
});

pool.on('error', (err) => console.error('[DB] Idle client error:', err.message));

export const db = drizzle(pool, { schema });
export type Database = typeof db;
export type TransactionLike = Parameters<Parameters<typeof db.transaction>[0]>[0];
export { pool };
