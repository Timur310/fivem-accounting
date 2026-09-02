import { str, num, url, bool, cleanEnv } from 'envalid';

export const env = cleanEnv(process.env, {
  DISCORD_CLIENT_ID:     str({ desc: 'Discord OAuth2 Client ID' }),
  DISCORD_CLIENT_SECRET: str({ desc: 'Discord OAuth2 Client Secret' }),
  DISCORD_REDIRECT_URI:  url({ desc: 'Discord OAuth redirect URI' }),
  JWT_SECRET:            str({ desc: 'JWT signing secret' }),
  JWT_EXPIRATION_DAYS:   num({ default: 7, desc: 'JWT expiration in days' }),
  // Session cookie Secure flag. Default false so plain-http dev setups keep
  // working; every TLS deployment should set this to true — the browser then
  // refuses to send the session over an unencrypted hop.
  COOKIE_SECURE:         bool({ default: false, desc: 'Set Secure on the session cookie (enable on HTTPS deployments)' }),
  // No default: forcing every deployment to set this explicitly avoids the
  // "works on my laptop, drops the prod database" footgun.
  DATABASE_URL:          str({ desc: 'PostgreSQL connection string' }),
  PORT:                  num({ default: 8000, desc: 'Backend port' }),
  NODE_ENV:              str({ choices: ['development', 'production', 'test'], default: 'development' }),
  CORS_ORIGINS:          str({ default: 'http://localhost:3000', desc: 'Comma-separated allowed origins' }),
  FRONTEND_URL:          url({ default: 'http://localhost:3000', desc: 'Frontend URL for OAuth redirects' }),
  DB_POOL_MAX:           num({ default: 10, desc: 'Maximum PostgreSQL pool connections' }),
  LOG_LEVEL:             str({ choices: ['debug', 'info', 'warn', 'error'], default: 'info' }),
});

// ── Post-load validation ──────────────────────────────
// envalid only checks types; these have to hold for the app to be secure, so
// they are validated at boot rather than at first use.
if (env.JWT_SECRET.length < 32) {
  throw new Error('JWT_SECRET must be at least 32 characters long');
}
if (env.JWT_EXPIRATION_DAYS < 1 || env.JWT_EXPIRATION_DAYS > 30) {
  throw new Error('JWT_EXPIRATION_DAYS must be between 1 and 30');
}
if (env.DB_POOL_MAX < 1 || env.DB_POOL_MAX > 100) {
  throw new Error('DB_POOL_MAX must be between 1 and 100');
}
