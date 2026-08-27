import 'dotenv/config';
import { db } from './db/index.js';
import app from './app.js';
import { sql } from 'drizzle-orm';
import { env } from './lib/env.js';

const PORT = env.PORT;

async function bootstrap() {
  // Verify database connection
  try {
    await db.execute(sql`SELECT 1`);
    console.log('[DB] Database connection established');
  } catch (err) {
    console.error('[DB] Failed to connect to database:', err);
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
