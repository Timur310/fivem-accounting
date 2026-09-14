/**
 * Per-worker environment. Runs before any module under test is imported, so
 * `lib/env.ts` (which validates on import and exits on failure) sees a complete
 * configuration and points at the test database rather than the dev one.
 */
const TEST_DB_NAME = process.env.TEST_DB_NAME ?? 'faction_accountant_test';
const ADMIN_URL =
  process.env.TEST_ADMIN_DATABASE_URL ??
  'postgresql://postgres:1313@localhost:5432/postgres';

process.env.NODE_ENV = 'test';
process.env.DATABASE_URL = ADMIN_URL.replace(/\/[^/]+$/, `/${TEST_DB_NAME}`);
process.env.DISCORD_CLIENT_ID = 'test-client-id';
process.env.DISCORD_CLIENT_SECRET = 'test-client-secret';
process.env.DISCORD_REDIRECT_URI = 'http://localhost:8000/api/v1/auth/callback';
// Present so the Discord integration reports itself configured. No test ever
// reaches Discord: the suites exercise permissions, validation and the local
// side of the link, and stop short of the handlers that would open a socket.
process.env.DISCORD_BOT_TOKEN = 'test-bot-token';
process.env.JWT_SECRET = 'test-jwt-secret-not-used-in-production';
process.env.CORS_ORIGINS = 'http://localhost:3000';
process.env.LOG_LEVEL = 'error';
