import { str, num, url, bool, cleanEnv } from 'envalid';

export const env = cleanEnv(process.env, {
  DISCORD_CLIENT_ID:     str({ desc: 'Discord OAuth2 Client ID' }),
  DISCORD_CLIENT_SECRET: str({ desc: 'Discord OAuth2 Client Secret' }),
  DISCORD_REDIRECT_URI:  url({ desc: 'Discord OAuth redirect URI' }),
  // The bot living on the same Discord application as the login above. Empty
  // by default and empty is a supported state: without it the Discord
  // integration reports itself unavailable and every other feature carries on
  // untouched. A deployment that wants it adds a Bot to the existing
  // application and pastes the token here.
  DISCORD_BOT_TOKEN:     str({ default: '', desc: 'Discord bot token (blank disables the Discord integration)' }),
  // Where Discord returns the leader after they pick a server for the bot.
  // Separate from DISCORD_REDIRECT_URI because Discord matches redirect URIs
  // exactly and this one lands on a different handler.
  DISCORD_BOT_REDIRECT_URI: str({ default: '', desc: 'Discord bot-invite callback URL (defaults to the login redirect with /bot-callback)' }),
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
  // Where pg_dump and pg_restore should connect. Blank means DATABASE_URL.
  //
  // It exists because DATABASE_URL points at pgbouncer in transaction pooling
  // mode, and pg_dump cannot work through it: a dump needs one session held
  // open across many statements with a single consistent snapshot, and
  // transaction pooling hands the connection to somebody else between them.
  // Point this straight at Postgres.
  BACKUP_DATABASE_URL:   str({ default: '', desc: 'Direct (non-pooled) PostgreSQL URL for pg_dump/pg_restore; blank uses DATABASE_URL' }),
  // Directory holding pg_dump/pg_restore, for machines where they are not on
  // PATH — a Windows dev box with Postgres installed under Program Files, say.
  PG_BIN_DIR:            str({ default: '', desc: 'Directory containing pg_dump/pg_restore (blank means PATH)' }),
  BACKUP_MAX_UPLOAD_MB:  num({ default: 512, desc: 'Largest backup file accepted by the restore endpoint' }),
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
if (env.BACKUP_MAX_UPLOAD_MB < 1 || env.BACKUP_MAX_UPLOAD_MB > 10_000) {
  throw new Error('BACKUP_MAX_UPLOAD_MB must be between 1 and 10000');
}
