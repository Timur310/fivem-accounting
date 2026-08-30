import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { error } from '../lib/response.js';
import { env } from '../lib/env.js';
import { COOKIE_NAME } from '../auth/index.js';

// ── In-memory sliding window rate limiter ──────────────
// No Redis required — suitable for single-instance deployments.
// Entries are cleaned up periodically to prevent memory leaks.

interface RateLimitEntry {
  timestamps: number[];
}

const store = new Map<string, RateLimitEntry>();

// Cleanup old entries every 60 seconds in the background.
// `.unref()` so the timer never keeps the process alive on shutdown.
const CLEANUP_INTERVAL = 60_000;
setInterval(() => {
  const now = Date.now();
  for (const [key, entry] of store) {
    // Remove timestamps older than the max window (60s)
    entry.timestamps = entry.timestamps.filter((ts) => now - ts < 60_000);
    if (entry.timestamps.length === 0) {
      store.delete(key);
    }
  }
}, CLEANUP_INTERVAL).unref();

/**
 * Best-effort decode of the user id from the session cookie.
 *
 * The cookie is set by `requireAuth`, but the rate limiter runs *before*
 * `requireAuth` (it sits at the top of the app middleware chain) so the JWT
 * has not been verified yet. We decode it here only to extract the user id
 * for the rate-limit key — an unsigned or expired token simply falls back
 * to the IP address, which is the public, less generous bucket.
 */
function userIdFromCookie(req: Request): string | null {
  const cookie = req.cookies?.[COOKIE_NAME];
  if (!cookie || typeof cookie !== 'string') return null;
  try {
    const payload = jwt.verify(cookie, env.JWT_SECRET) as { userId?: unknown };
    return typeof payload.userId === 'string' ? payload.userId : null;
  } catch {
    return null;
  }
}

export interface RateLimitOptions {
  /** Time window in milliseconds (default 60000 = 1 min) */
  windowMs?: number;
  /** Max requests per window (default 60) */
  maxRequests?: number;
  /** Error message */
  message?: string;
}

/**
 * Rate limiting middleware factory.
 *
 * Keys on userId (decoded from the JWT cookie) when present, falling back to
 * the IP address. A request with neither — anonymous and no IP — is rejected
 * outright: there is no fair way to rate-limit it.
 */
export function rateLimit(opts: RateLimitOptions = {}) {
  const windowMs = opts.windowMs ?? 60_000;
  const maxRequests = opts.maxRequests ?? 60;
  const message = opts.message ?? 'Too many requests. Please slow down.';

  return (req: Request, res: Response, next: NextFunction): void => {
    // Test mode bypasses rate limiting entirely. The suite issues hundreds of
    // requests inside a minute; the per-user buckets would never recover.
    if (env.NODE_ENV === 'test') {
      next();
      return;
    }

    const userId = userIdFromCookie(req);
    const key = userId ?? req.ip;
    if (!key) {
      error(res, 'VALIDATION_ERROR', 'Could not identify client for rate limiting', 400);
      return;
    }

    const now = Date.now();

    let entry = store.get(key);
    if (!entry) {
      entry = { timestamps: [] };
      store.set(key, entry);
    }

    // Filter out timestamps outside the window
    entry.timestamps = entry.timestamps.filter((ts) => now - ts < windowMs);

    if (entry.timestamps.length >= maxRequests) {
      const retryAfter = Math.ceil(
        ((entry.timestamps[0] ?? now) + windowMs - now) / 1000,
      );
      res.setHeader('Retry-After', String(retryAfter));
      res.setHeader('X-RateLimit-Limit', String(maxRequests));
      res.setHeader('X-RateLimit-Remaining', '0');
      res.setHeader('X-RateLimit-Reset', String(Math.ceil((now + windowMs) / 1000)));
      error(res, 'RATE_LIMITED', message, 429);
      return;
    }

    entry.timestamps.push(now);

    res.setHeader('X-RateLimit-Limit', String(maxRequests));
    res.setHeader('X-RateLimit-Remaining', String(Math.max(0, maxRequests - entry.timestamps.length)));
    res.setHeader('X-RateLimit-Reset', String(Math.ceil((now + windowMs) / 1000)));

    next();
  };
}

/**
 * Rate limit for mutation endpoints (POST/PATCH/DELETE).
 * 120 requests per minute per user/IP — 2/s, which no human hits but a script
 * hammering the API does. The earlier 30/min was tight enough to bite real
 * work: adding a batch of item types or ranks, or a CSV import, spends
 * mutations in bursts.
 */
export const mutationRateLimit = rateLimit({
  windowMs: 60_000,
  maxRequests: 120,
  message: 'Too many actions. Please wait a moment.',
});

/**
 * Rate limit for read endpoints.
 * 600 requests per minute per user/IP. Reads arrive in bursts by design: a
 * single view mounts several queries at once, and React Query refetches all of
 * them on every window focus, so the old 120/min could be spent just by
 * alt-tabbing back and forth on a busy page.
 */
export const readRateLimit = rateLimit({
  windowMs: 60_000,
  maxRequests: 600,
  message: 'Too many requests. Please slow down.',
});

/**
 * Strict rate limit for the OAuth callback — a small, expensive endpoint
 * that exchanges an authorization code for a token. Abuse here is the most
 * common bot attack against OAuth flows, so this stays far tighter than the
 * rest: 20/min per IP leaves room for a few retries after a failed login
 * without opening the door to code-guessing.
 */
export const authRateLimit = rateLimit({
  windowMs: 60_000,
  maxRequests: 20,
  message: 'Too many authentication attempts. Please wait a moment.',
});
