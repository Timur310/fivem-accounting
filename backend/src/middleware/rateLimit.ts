import { Request, Response, NextFunction } from 'express';
import { error } from '../lib/response.js';

// ── In-memory sliding window rate limiter ──────────────
// No Redis required — suitable for single-instance deployments.
// Entries are cleaned up periodically to prevent memory leaks.

interface RateLimitEntry {
  timestamps: number[];
}

const store = new Map<string, RateLimitEntry>();

// Cleanup old entries every 60 seconds
let lastCleanup = Date.now();
const CLEANUP_INTERVAL = 60_000;

function cleanup() {
  const now = Date.now();
  if (now - lastCleanup < CLEANUP_INTERVAL) return;
  lastCleanup = now;

  for (const [key, entry] of store) {
    // Remove timestamps older than the max window (60s)
    entry.timestamps = entry.timestamps.filter((ts) => now - ts < 60_000);
    if (entry.timestamps.length === 0) {
      store.delete(key);
    }
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
 * Uses a composite key of userId (if authenticated) or IP address.
 */
export function rateLimit(opts: RateLimitOptions = {}) {
  const windowMs = opts.windowMs ?? 60_000;
  const maxRequests = opts.maxRequests ?? 60;
  const message = opts.message ?? 'Too many requests. Please slow down.';

  return (req: Request, res: Response, next: NextFunction): void => {
    cleanup();

    // Use userId if authenticated, otherwise fall back to IP
    const key = req.user?.id || req.ip || 'unknown';
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
      error(res, 'RATE_LIMITED', message, 429);
      return;
    }

    entry.timestamps.push(now);
    next();
  };
}

/**
 * Stricter rate limit for mutation endpoints (POST/PATCH/DELETE).
 * 20 requests per minute per user/IP.
 */
export const mutationRateLimit = rateLimit({
  windowMs: 60_000,
  maxRequests: 20,
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
