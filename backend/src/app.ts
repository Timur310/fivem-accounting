import express from 'express';
import cookieParser from 'cookie-parser';
import cors from 'cors';
import { env } from './lib/env.js';
import { errorHandler } from './middleware/errorHandler.js';
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

const app = express();

// ── Global middleware ─────────────────────────────────

app.use(express.json({ limit: '1mb' }));
app.use(cookieParser());

const allowedOrigins = env.CORS_ORIGINS.split(',').map(s => s.trim());
app.use(cors({
  origin: allowedOrigins,
  credentials: true,
  methods: ['GET', 'POST', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
}));

// Request logging
app.use((req, _res, next) => {
  if (env.LOG_LEVEL === 'debug') {
    console.log(`[${req.method}] ${req.path} ${req.ip ?? ''}`);
  }
  next();
});

// Trust proxy for correct IP behind Caddy
app.set('trust proxy', 1);

// ── Health check ──────────────────────────────────────

app.get('/api/v1/health', (_req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// ── Routes ────────────────────────────────────────────

app.use('/api/v1/auth', authRoutes);
app.use('/api/v1/factions', factionRoutes);

// Faction-scoped routes (nested under /factions/:id/...)
app.use('/api/v1/factions/:id/members', memberRoutes);
app.use('/api/v1/factions/:id/item-types', itemTypeRoutes);
app.use('/api/v1/factions/:id/entries', entryRoutes);
app.use('/api/v1/factions/:id/dashboard', dashboardRoutes);
app.use('/api/v1/factions/:id/audit-logs', auditLogRoutes);
app.use('/api/v1/factions/:id/quotas', quotaRoutes);
app.use('/api/v1/factions/:id/charts', chartRoutes);
app.use('/api/v1/factions/:id/export', exportRoutes);

// ── 404 handler ───────────────────────────────────────

app.use('/api/v1', (_req, res) => {
  res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Endpoint not found' } });
});

// ── Error handler (must be last) ──────────────────────

app.use(errorHandler);

export default app;
