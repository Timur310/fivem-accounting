import { str, num, bool, cleanEnv } from 'envalid';

export const env = cleanEnv(process.env, {
  DISCORD_CLIENT_ID:     str({ desc: 'Discord OAuth2 Client ID' }),
  DISCORD_CLIENT_SECRET: str({ desc: 'Discord OAuth2 Client Secret' }),
  DISCORD_REDIRECT_URI:  str({ desc: 'Discord OAuth redirect URI' }),
  JWT_SECRET:            str({ desc: 'JWT signing secret' }),
  JWT_EXPIRATION_DAYS:   num({ default: 7, desc: 'JWT expiration in days' }),
  DATABASE_URL:          str({ default: 'postgresql://postgres:password@localhost:5432/faction_accountant' }),
  PORT:                  num({ default: 8000, desc: 'Backend port' }),
  NODE_ENV:              str({ choices: ['development', 'production', 'test'], default: 'development' }),
  CORS_ORIGINS:          str({ default: 'http://localhost:3000', desc: 'Comma-separated allowed origins' }),
  LOG_LEVEL:             str({ choices: ['debug', 'info', 'warn', 'error'], default: 'info' }),
});