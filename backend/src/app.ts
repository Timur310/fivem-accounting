import express from 'express';
import cookieParser from 'cookie-parser';
import cors from 'cors';
import crypto from 'node:crypto';
import helmet from 'helmet';
import { env } from './lib/env.js';
import { errorHandler } from './middleware/errorHandler.js';
import { readRateLimit, mutationRateLimit, authRateLimit } from './middleware/rateLimit.js';
import { db } from './db/index.js';
import { sql } from 'drizzle-orm';
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
import provisionalUserRoutes from './routes/provisionalUsers.js';
import adminUserRoutes from './routes/adminUsers.js';
import bulkRoutes from './routes/bulk.js';
import reportRoutes from './routes/reports.js';
import payoutRoutes from './routes/payouts.js';
import treasuryRoutes from './routes/treasury.js';
import launderingRoutes from './routes/laundering.js';
import craftingRoutes from './routes/crafting.js';
import mapRoutes from './routes/map.js';
import memberNoteRoutes from './routes/memberNotes.js';
import memberStrikeRoutes from './routes/memberStrikes.js';
import factionStrikeRoutes from './routes/factionStrikes.js';
import factionSettingsRoutes from './routes/factionSettings.js';
import leaderboardRoutes from './routes/leaderboard.js';
import globalLeaderboardRoutes from './routes/globalLeaderboard.js';
import supportRoutes from './routes/support.js';
import notificationRoutes from './routes/notifications.js';
import announcementRoutes from './routes/announcements.js';
import feedRoutes from './routes/feed.js';
import expenseRoutes from './routes/expenses.js';
import discordRoutes from './routes/discord.js';
import discordReminderRoutes from './routes/discordReminders.js';
import configIoRoutes from './routes/configIo.js';
import backupRoutes from './routes/backup.js';
import pricingRoutes from './routes/pricing.js';
import operationRoutes from './routes/operations.js';
import shiftRoutes from './routes/shifts.js';
import vehicleRoutes from './routes/vehicles.js';

const app = express();

// Trust proxy for correct IP behind Caddy. Must be set BEFORE any middleware
// that reads req.ip — rate limiting and audit logging both do.
app.set('trust proxy', 1);

// ── Security headers ──────────────────────────────────
app.use(
  helmet({
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
  }),
);

// ── Global middleware ─────────────────────────────────

app.use(express.json({ limit: '1mb' }));
app.use(cookieParser());

const allowedOrigins = env.CORS_ORIGINS.split(',').map(s => s.trim());
app.use(cors({
  origin: allowedOrigins,
  credentials: true,
  methods: ['GET', 'POST', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Request-Id'],
  exposedHeaders: ['X-Request-Id', 'X-RateLimit-Limit', 'X-RateLimit-Remaining', 'X-RateLimit-Reset'],
}));

// Attach a request id to every request, so logs and audit trails can be
// correlated end-to-end. Honors an incoming header if present (e.g. one
// minted by a reverse proxy), mints one otherwise.
app.use((req: express.Request, res: express.Response, next: express.NextFunction) => {
  const incoming = req.header('x-request-id');
  const id = incoming && /^[A-Za-z0-9_-]{8,64}$/.test(incoming)
    ? incoming
    : crypto.randomUUID();
  req.headers['x-request-id'] = id;
  res.setHeader('X-Request-Id', id);
  next();
});

// Request logging
app.use((req, _res, next) => {
  if (env.LOG_LEVEL === 'debug') {
    console.log(`[${req.method}] ${req.path} ${req.ip ?? ''}`);
  }
  next();
});

// ── Rate limiting ────────────────────────────────────
// OAuth callback is expensive (network calls to Discord) and a common attack
// vector, so it gets its own strict bucket ahead of the general limiter.
app.use('/api/v1/auth/callback', authRateLimit);

// Read vs mutation: GET/OPTIONS/HEAD share the read bucket; everything else
// (POST/PATCH/DELETE) goes through the stricter mutation bucket.
app.use('/api/v1', (req, res, next) => {
  const method = req.method.toUpperCase();
  if (method === 'GET' || method === 'OPTIONS' || method === 'HEAD') {
    readRateLimit(req, res, next);
  } else {
    mutationRateLimit(req, res, next);
  }
});

// ── Health checks ───────────────────────────────────

app.get('/api/v1/health', (_req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Readiness probe: confirms the database is reachable. Distinct from /health,
// which only confirms the process is up — a 200 here means we can serve.
app.get('/api/v1/health/ready', async (_req, res) => {
  try {
    await db.execute(sql`SELECT 1`);
    res.json({ status: 'ready', timestamp: new Date().toISOString() });
  } catch (err) {
    console.error('[HEALTH] DB check failed:', err);
    res.status(503).json({ status: 'unavailable' });
  }
});

// ── Routes ────────────────────────────────────────────

app.use('/api/v1/auth', authRoutes);
app.use('/api/v1/factions', factionRoutes);
app.use('/api/v1/admin/analytics', adminAnalyticsRoutes);
app.use('/api/v1/admin/provisional-users', provisionalUserRoutes);
app.use('/api/v1/admin/users', adminUserRoutes);
app.use('/api/v1/admin/backup', backupRoutes);
// Cross-faction ranking (superadmin) — not scoped to a faction.
app.use('/api/v1/leaderboard', globalLeaderboardRoutes);
// Bug reports and feature requests. Not faction-scoped: anyone signed in may
// send one, and only the superadmin reads the rest.
app.use('/api/v1/support', supportRoutes);
// The bell. Scoped to the caller, never to a faction.
app.use('/api/v1/notifications', notificationRoutes);

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
app.use('/api/v1/factions/:id/laundering', launderingRoutes);
app.use('/api/v1/factions/:id/crafting', craftingRoutes);
app.use('/api/v1/factions/:id/pricing', pricingRoutes);
app.use('/api/v1/factions/:id/operations', operationRoutes);
app.use('/api/v1/factions/:id/shifts', shiftRoutes);
app.use('/api/v1/factions/:id/vehicles', vehicleRoutes);
app.use('/api/v1/factions/:id/map', mapRoutes);
app.use('/api/v1/factions/:id/announcements', announcementRoutes);
app.use('/api/v1/factions/:id/feed', feedRoutes);
app.use('/api/v1/factions/:id/expenses', expenseRoutes);
app.use('/api/v1/factions/:id/discord/reminders', discordReminderRoutes);
app.use('/api/v1/factions/:id/discord', discordRoutes);
app.use('/api/v1/factions/:id/config', configIoRoutes);

// ── 404 handler ───────────────────────────────────────

app.use('/api/v1', (_req, res) => {
  res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Endpoint not found' } });
});

// ── Error handler (must be last) ──────────────────────

app.use(errorHandler);

export default app;
