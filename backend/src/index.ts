import 'dotenv/config';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { db } from './db/index.js';
import app from './app.js';
import { sql } from 'drizzle-orm';
import { env } from './lib/env.js';
import { runMigrations } from './db/migrate.js';

const PORT = env.PORT;

// The compiled entrypoint lives in dist/, while drizzle/ sits next to it at the
// project root — so the folder is one level up from this file in both the tsx
// (src/) and the built (dist/) layouts.
const MIGRATIONS_FOLDER = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'drizzle');

async function bootstrap() {
  // Verify database connection
  try {
    await db.execute(sql`SELECT 1`);
    console.log('[DB] Database connection established');
  } catch (err) {
    console.error('[DB] Failed to connect to database:', err);
    process.exit(1);
  }

  // Apply pending migrations before serving traffic. A failure here is fatal:
  // starting with a schema the code does not expect is worse than not starting.
  try {
    await runMigrations(MIGRATIONS_FOLDER);
    console.log('[DB] Migrations up to date');
  } catch (err) {
    console.error('[DB] Migration failed:', err);
    process.exit(1);
  }

  app.listen(PORT, () => {
    console.log(`[SERVER] Backend running on port ${PORT}`);
    console.log(`[SERVER] Environment: ${env.NODE_ENV}`);
  });
}

bootstrap().catch((err) => {
  console.error('[BOOTSTRAP] Failed to start:', err);
  process.exit(1);
});
