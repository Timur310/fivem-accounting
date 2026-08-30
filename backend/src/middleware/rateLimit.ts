import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { env } from '../lib/env.js';
import { COOKIE_NAME } from '../auth/index.js';
import { error } from '../lib/response.js';

// ── In-memory sliding window rate limiter ──────────────
// No Redis required — suitable for single-instance deployments.
// Entries are cleaned up by a background timer (setInterval), so request
// handlers don't pay the cleanup cost on the hot path.

interface RateLimitEntry {
  timestamps: number[];
}

const store = new Map<string, RateLimitEntry>();

const MAX_WINDOW_MS = 60_000;

// Background cleanup — runs every 60s, unref'd so it can't keep the event
// loop alive on its own (important for graceful shutdown).
setInterval(() => {
  const now = Date.now();
  for (const [key, entry] of store) {
    entry.timestamps = entry.timestamps.filter((ts) => now - ts < MAX_WINDOW_MS);
    if (entry.timestamps.length === 0) {
      store.delete(key);
    }
  }
}, 60_000).unref();

/**
 * Extract the userId from the JWT cookie WITHOUT requiring the full
 * `requireAuth` middleware (which does a DB lookup per request).
 *
 * This runs at the app level, before route-level `requireAuth`. If we used
 * `req.user?.id` here it would always be undefined — the rate limiter would
 * fall back to IP-only, collapsing every test (all share 127.0.0.1) and every
 * admin behind a shared NAT into one bucket. By decoding the JWT here we get
 * per-user limiting even at the app level.
 *
 * If the cookie is missing or the JWT is invalid/expired, we return null and
 * the limiter falls back to IP — which is correct for unauthenticated
 * endpoints like /auth/callback.
 */
function userIdFromCookie(req: Request): string | null {
  const token = req.cookies?.[COOKIE_NAME];
  if (!token) return null;
  try {
    // jwt.verify throws on invalid/expired — we deliberately swallow that
    // here because an invalid token just means "treat as anonymous".
    const payload = jwt.verify(token, env.JWT_SECRET) as { userId?: unknown };
    if (typeof payload.userId === 'string') return payload.userId;
    return null;
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
 * Uses a composite key of userId (decoded from JWT cookie, or req.user if
 * already set by requireAuth) falling back to IP address.
 *
 * In test mode (`NODE_ENV === 'test'`) the limiter is bypassed entirely —
 * the test suite makes hundreds of requests within a single 60s window and
 * would otherwise exhaust the per-user budget mid-suite.
 */
export function rateLimit(opts: RateLimitOptions = {}) {
  const windowMs = opts.windowMs ?? 60_000;
  const maxRequests = opts.maxRequests ?? 60;
  const message = opts.message ?? 'Too many requests. Please slow down.';

  return (req: Request, res: Response, next: NextFunction): void => {
    // Skip rate limiting in test mode — the test suite needs to make many
    // requests quickly and would otherwise hit the limit mid-suite.
    if (env.NODE_ENV === 'test') {
      next();
      return;
    }

    // Prefer the authenticated user id (set by requireAuth if it ran first),
    // then try to decode it from the JWT cookie ourselves (app-level limiter
    // runs before route-level requireAuth), then fall back to IP.
    const key = req.user?.id ?? userIdFromCookie(req) ?? req.ip;
    if (!key) {
      error(res, 'BAD_REQUEST', 'Could not determine client identity for rate limiting', 400);
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

    const limit = maxRequests;
    const remaining = Math.max(0, limit - entry.timestamps.length);
    const firstTimestamp = entry.timestamps[0];
    const resetTimestamp = firstTimestamp !== undefined
      ? firstTimestamp + windowMs
      : now + windowMs;

    res.setHeader('X-RateLimit-Limit', String(limit));
    res.setHeader('X-RateLimit-Remaining', String(Math.max(0, remaining - 1)));
    res.setHeader('X-RateLimit-Reset', String(Math.ceil(resetTimestamp / 1000)));

    if (entry.timestamps.length >= maxRequests) {
      const retryAfter = Math.ceil(
        ((entry.timestamps[0] ?? now) + windowMs - now) / 1000,
      );
      res.setHeader('Retry-After', String(retryAfter));
      res.setHeader('X-RateLimit-Remaining', '0');
      error(res, 'RATE_LIMITED', message, 429);
      return;
    }

    entry.timestamps.push(now);
    next();
  };
}

/**
 * Stricter rate limit for mutation endpoints (POST/PATCH/DELETE).
 * 30 requests per minute per user/IP.
 */
export const mutationRateLimit = rateLimit({
  windowMs: 60_000,
  maxRequests: 30,
  message: 'Too many actions. Please wait a moment.',
});

/**
 * Standard rate limit for read endpoints.
 * 120 requests per minute per user/IP.
 */
export const readRateLimit = rateLimit({
  windowMs: 60_000,
  maxRequests: 120,
  message: 'Too many requests. Please slow down.',
});

/**
 * Strictest rate limit — applied to the OAuth callback to prevent
 * brute-force / replay style abuse of the code-exchange endpoint.
 * 10 requests per minute per IP.
 */
export const authRateLimit = rateLimit({
  windowMs: 60_000,
  maxRequests: 10,
  message: 'Too many authentication attempts. Please wait a moment.',
});

