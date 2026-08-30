import { str, num, cleanEnv, url } from 'envalid';

export const env = cleanEnv(process.env, {
  DISCORD_CLIENT_ID:     str({ desc: 'Discord OAuth2 Client ID' }),
  DISCORD_CLIENT_SECRET: str({ desc: 'Discord OAuth2 Client Secret' }),
  DISCORD_REDIRECT_URI:  url({ desc: 'Discord OAuth redirect URI' }),
  JWT_SECRET:            str({ desc: 'JWT signing secret' }),
  JWT_EXPIRATION_DAYS:   num({ default: 7, desc: 'JWT expiration in days' }),
  DATABASE_URL:          str({ desc: 'PostgreSQL connection string' }),
  PORT:                  num({ default: 8000, desc: 'Backend port' }),
  NODE_ENV:              str({ choices: ['development', 'production', 'test'], default: 'development' }),
  CORS_ORIGINS:          str({ default: 'http://localhost:3000', desc: 'Comma-separated allowed origins' }),
  LOG_LEVEL:             str({ choices: ['debug', 'info', 'warn', 'error'], default: 'info' }),
  FRONTEND_URL:          url({ default: 'http://localhost:3000', desc: 'Frontend origin used for OAuth redirects' }),
  DB_POOL_MAX:           num({ default: 10, desc: 'Maximum number of connections in the pg pool' }),
});

// ── Post-load validation ───────────────────────────────
// envalid only checks shape; secrets and bounds need manual checks so a
// misconfigured production deploy fails fast instead of signing weak tokens.
if (env.JWT_SECRET.length < 32) {
  throw new Error('JWT_SECRET must be at least 32 characters long');
}
if (env.JWT_EXPIRATION_DAYS < 1 || env.JWT_EXPIRATION_DAYS > 30) {
  throw new Error('JWT_EXPIRATION_DAYS must be between 1 and 30');
}
if (env.DB_POOL_MAX < 1 || env.DB_POOL_MAX > 100) {
  throw new Error('DB_POOL_MAX must be between 1 and 100');
}
