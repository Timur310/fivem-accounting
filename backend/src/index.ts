import 'dotenv/config';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { db, pool } from './db/index.js';
import app from './app.js';
import { sql } from 'drizzle-orm';
import { env } from './lib/env.js';
import { runMigrations } from './db/migrate.js';

const PORT = env.PORT;

// The compiled entrypoint lives in dist/, while drizzle/ sits next to it at the
// project root — so the folder is one level up from this file in both the tsx
// (src/) and the built (dist/) layouts.
const MIGRATIONS_FOLDER = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'drizzle');

import { startReminderRunner, stopReminderRunner } from './lib/reminderRunner.js';

// ── Graceful shutdown ─────────────────────────────────
// Dedupe SIGTERM/SIGINT (e.g. when docker sends both). Once we begin
// shutting down, refuse new connections and let in-flight ones finish.
let shuttingDown = false;
let server: ReturnType<typeof app.listen> | undefined;

function shutdown(signal: string) {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`[SERVER] Received ${signal}, shutting down gracefully...`);

  // Hard-exit safety net: if graceful shutdown stalls past 15s, force it.
  const forceExit = setTimeout(() => {
    console.error('[SERVER] Graceful shutdown timed out, forcing exit');
    process.exit(1);
  }, 15_000);
  forceExit.unref();

  if (!server) {
    void pool.end().then(() => process.exit(0));
    return;
  }

  // Stop picking up new reminders. Anything already claimed finishes; anything
  // still queued is in the table and will be picked up after the restart.
  stopReminderRunner();

  server.close((err) => {
    if (err) {
      console.error('[SERVER] Error closing HTTP server:', err.message);
    }
    void pool.end().then(() => process.exit(0));
  });
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

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

  server = app.listen(PORT, () => {
    console.log(`[SERVER] Backend running on port ${PORT}`);
    console.log(`[SERVER] Environment: ${env.NODE_ENV}`);
  });

  // Started here rather than in app.ts: every test imports the app, and none
  // of them should get a timer that outlives the suite. No-ops when no Discord
  // bot is configured.
  startReminderRunner();
}

bootstrap().catch((err) => {
  console.error('[BOOTSTRAP] Failed to start:', err);
  process.exit(1);
});
