import { Request, Response, NextFunction } from 'express';
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
 * Uses a composite key of userId (if authenticated) or IP address.
 */
export function rateLimit(opts: RateLimitOptions = {}) {
  const windowMs = opts.windowMs ?? 60_000;
  const maxRequests = opts.maxRequests ?? 60;
  const message = opts.message ?? 'Too many requests. Please slow down.';

  return (req: Request, res: Response, next: NextFunction): void => {
    // Use userId if authenticated, otherwise fall back to IP. If neither is
    // available (no trust proxy + no auth) reject — the 'unknown' fallback
    // would let a single bad client collapse everyone into one bucket.
    const key = req.user?.id ?? req.ip;
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
      // On 429, remaining is 0 (this request itself is rejected).
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
