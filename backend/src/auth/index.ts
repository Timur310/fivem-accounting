import crypto from 'node:crypto';
import axios from 'axios';
import jwt from 'jsonwebtoken';
import { env } from '../lib/env.js';
import type { JwtPayload } from '../lib/types.js';

// ── PKCE helpers ───────────────────────────────────────

const stateStore = new Map<string, { codeVerifier: string; expiresAt: number }>();
const STATE_TTL_MS = 10 * 60 * 1000; // 10 minutes

// Periodic cleanup of expired states
setInterval(() => {
  const now = Date.now();
  for (const [key, val] of stateStore) {
    if (val.expiresAt < now) stateStore.delete(key);
  }
}, 60_000);

function generateCodeVerifier(): string {
  return crypto.randomBytes(32).toString('base64url');
}

async function generateCodeChallenge(verifier: string): Promise<string> {
  return crypto.createHash('sha256').update(verifier).digest('base64url');
}

// ── Discord OAuth URLs ─────────────────────────────────

export async function buildDiscordAuthUrl(): Promise<{ url: string; state: string }> {
  const state = crypto.randomBytes(16).toString('hex');
  const codeVerifier = generateCodeVerifier();
  const codeChallenge = await generateCodeChallenge(codeVerifier);

  stateStore.set(state, {
    codeVerifier,
    expiresAt: Date.now() + STATE_TTL_MS,
  });

  const params = new URLSearchParams({
    client_id: env.DISCORD_CLIENT_ID,
    redirect_uri: env.DISCORD_REDIRECT_URI,
    response_type: 'code',
    scope: 'identify email',
    state,
    code_challenge_method: 'S256',
    code_challenge: codeChallenge,
  });

  return {
    url: `https://discord.com/api/oauth2/authorize?${params.toString()}`,
    state,
  };
}

// ── Token exchange ─────────────────────────────────────

interface DiscordTokenResponse {
  access_token: string;
  token_type: string;
  expires_in: number;
  refresh_token: string;
  scope: string;
}

interface DiscordUser {
  id: string;
  username: string;
  avatar: string | null;
  discriminator: string;
  email?: string;
}

export async function exchangeCode(code: string, codeVerifier: string): Promise<DiscordTokenResponse> {
  const res = await axios.post<DiscordTokenResponse>(
    'https://discord.com/api/oauth2/token',
    new URLSearchParams({
      client_id: env.DISCORD_CLIENT_ID,
      client_secret: env.DISCORD_CLIENT_SECRET,
      grant_type: 'authorization_code',
      code,
      redirect_uri: env.DISCORD_REDIRECT_URI,
      code_verifier: codeVerifier,
    }),
    { headers: { 'Content-Type': 'application/x-www-form-urlencoded' } },
  );
  return res.data;
}

export async function getDiscordUser(accessToken: string): Promise<DiscordUser> {
  const res = await axios.get<DiscordUser>('https://discord.com/api/users/@me', {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  return res.data;
}

// ── State management ───────────────────────────────────

export function consumeState(state: string): string | null {
  const entry = stateStore.get(state);
  if (!entry) return null;
  if (entry.expiresAt < Date.now()) {
    stateStore.delete(state);
    return null;
  }
  stateStore.delete(state);
  return entry.codeVerifier;
}

// ── JWT ─────────────────────────────────────────────────

export function signJwt(payload: JwtPayload): string {
  return jwt.sign(payload, env.JWT_SECRET, {
    expiresIn: `${env.JWT_EXPIRATION_DAYS}d`,
  });
}

export function verifyJwt(token: string): JwtPayload | null {
  try {
    return jwt.verify(token, env.JWT_SECRET) as JwtPayload;
  } catch {
    return null;
  }
}

export const COOKIE_NAME = 'faction_session';

export const COOKIE_OPTIONS = {
  httpOnly: true,
  // Force secure to false if you don't have HTTPS set up yet, 
  // or use a custom env variable like env.USE_HTTPS === 'true'
  secure: false, 
  // Keep this as 'lax' for now to ensure smooth cross-port routing on your VPS
  sameSite: 'lax' as const, 
  maxAge: env.JWT_EXPIRATION_DAYS * 24 * 60 * 60 * 1000,
  path: '/',
};
