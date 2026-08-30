import express from 'express';
import helmet from 'helmet';
import crypto from 'node:crypto';
import cookieParser from 'cookie-parser';
import cors from 'cors';
import { sql } from 'drizzle-orm';
import { env } from './lib/env.js';
import { db } from './db/index.js';
import { errorHandler } from './middleware/errorHandler.js';
import { readRateLimit, mutationRateLimit, authRateLimit } from './middleware/rateLimit.js';
import authRoutes from './routes/auth.js';
import factionRoutes from './routes/factions.js';
import memberRoutes from './routes/members.js';
import itemTypeRoutes from './routes/itemTypes.js';
import entryRoutes from './routes/entries.js';
import dashboardRoutes from './routes/dashboard.js';
import auditLogRoutes from './routes/auditLogs.js';
import quotaRoutes from './routes/quotas.js';
import chartRoutes from './routes/charts.js';
import exportRoutes from './routes/export.js';
import adminAnalyticsRoutes from './routes/adminAnalytics.js';
import bulkRoutes from './routes/bulk.js';
import reportRoutes from './routes/reports.js';
import payoutRoutes from './routes/payouts.js';
import treasuryRoutes from './routes/treasury.js';
import memberNoteRoutes from './routes/memberNotes.js';
import memberStrikeRoutes from './routes/memberStrikes.js';
import factionStrikeRoutes from './routes/factionStrikes.js';
import factionSettingsRoutes from './routes/factionSettings.js';
import leaderboardRoutes from './routes/leaderboard.js';
import globalLeaderboardRoutes from './routes/globalLeaderboard.js';

const app = express();

// ── Trust proxy must be set BEFORE any middleware so req.ip / X-Forwarded-For
// handling is consistent across cors, rateLimit, and audit logging.
app.set('trust proxy', 1);

// ── Global middleware ─────────────────────────────────

app.use(express.json({ limit: '1mb' }));
app.use(cookieParser());

app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'"],
      imgSrc: ["'self'", 'data:', 'https://cdn.discordapp.com'],
      frameAncestors: ["'none'"],
      objectSrc: ["'none'"],
    },
  },
  crossOriginResourcePolicy: { policy: 'cross-origin' },
}));

const allowedOrigins = env.CORS_ORIGINS.split(',').map(s => s.trim());
app.use(cors({
  origin: allowedOrigins,
  credentials: true,
  methods: ['GET', 'POST', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Request-Id'],
  exposedHeaders: ['X-Request-Id', 'X-RateLimit-Limit', 'X-RateLimit-Remaining', 'X-RateLimit-Reset'],
}));

// Request ID + structured request log
app.use((req, res, next) => {
  const reqId = (req.headers['x-request-id'] as string | undefined) ?? crypto.randomUUID();
  req.headers['x-request-id'] = reqId;
  res.setHeader('X-Request-Id', reqId);

  if (env.LOG_LEVEL === 'debug' || env.LOG_LEVEL === 'info') {
    console.log(JSON.stringify({
      level: 'info',
      method: req.method,
      path: req.path,
      ip: req.ip ?? null,
      requestId: reqId,
    }));
  }
  next();
});

// ── Rate limiting ─────────────────────────────────────
// Auth callback gets the strictest limit to block brute-force attempts.
app.use('/api/v1/auth/callback', authRateLimit);

// Everything else under /api/v1: reads vs mutations split at the method level.
app.use('/api/v1', (req, res, next) => {
  if (req.method === 'GET' || req.method === 'OPTIONS' || req.method === 'HEAD') {
    return readRateLimit(req, res, next);
  }
  return mutationRateLimit(req, res, next);
});

// ── Health checks ─────────────────────────────────────

app.get('/api/v1/health', (_req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

app.get('/api/v1/health/ready', async (_req, res) => {
  try {
    await db.execute(sql`SELECT 1`);
    res.json({ status: 'ready', timestamp: new Date().toISOString() });
  } catch (err) {
    console.error('[HEALTH] readiness check failed:', err instanceof Error ? err.message : err);
    res.status(503).json({ status: 'unavailable', timestamp: new Date().toISOString() });
  }
});

// ── Routes ────────────────────────────────────────────

app.use('/api/v1/auth', authRoutes);
app.use('/api/v1/factions', factionRoutes);
app.use('/api/v1/admin/analytics', adminAnalyticsRoutes);
// Cross-faction ranking (superadmin) — not scoped to a faction.
app.use('/api/v1/leaderboard', globalLeaderboardRoutes);

// Faction-scoped routes (nested under /factions/:id/...)
// Member sub-resources are mounted before /members so the more specific paths
// are matched by their own routers first.
app.use('/api/v1/factions/:id/members/:userId/notes', memberNoteRoutes);
app.use('/api/v1/factions/:id/members/:userId/strikes', memberStrikeRoutes);
app.use('/api/v1/factions/:id/members', memberRoutes);
app.use('/api/v1/factions/:id/strikes', factionStrikeRoutes);
app.use('/api/v1/factions/:id/settings', factionSettingsRoutes);
app.use('/api/v1/factions/:id/leaderboard', leaderboardRoutes);
app.use('/api/v1/factions/:id/item-types', itemTypeRoutes);
app.use('/api/v1/factions/:id/entries', entryRoutes);
app.use('/api/v1/factions/:id/dashboard', dashboardRoutes);
app.use('/api/v1/factions/:id/audit-logs', auditLogRoutes);
app.use('/api/v1/factions/:id/quotas', quotaRoutes);
app.use('/api/v1/factions/:id/charts', chartRoutes);
app.use('/api/v1/factions/:id/export', exportRoutes);
app.use('/api/v1/factions/:id/reports', reportRoutes);
app.use('/api/v1/factions/:id/bulk', bulkRoutes);
app.use('/api/v1/factions/:id/payouts', payoutRoutes);
app.use('/api/v1/factions/:id/treasury', treasuryRoutes);

// ── 404 handler ───────────────────────────────────────

app.use('/api/v1', (_req, res) => {
  res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Endpoint not found' } });
});

// ── Error handler (must be last) ──────────────────────

app.use(errorHandler);

export default app;
