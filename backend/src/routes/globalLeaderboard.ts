import { Request, Response } from 'express';
import { asyncRouter } from '../lib/asyncRouter.js';
import { z } from 'zod';
import { db } from '../db/index.js';
import { entries, users, factions } from '../db/schema.js';
import { eq, and, sql, gte, lte } from 'drizzle-orm';
import { success, error } from '../lib/response.js';
import { requireAuth, requireSuperadmin } from '../middleware/auth.js';
import { buildWhere } from '../lib/query.js';
import { resolvePeriod } from './leaderboard.js';

const router = asyncRouter();

const querySchema = z.object({
  period: z.enum(['week', 'month', 'all']).default('month'),
  limit: z.string().optional(),
});

// ── GET / — top contributors across every faction ────
// Superadmin only: it deliberately crosses the faction isolation boundary that
// every other endpoint enforces, so it must never be reachable by members.
router.get('/', requireAuth, requireSuperadmin, async (req: Request, res: Response) => {
  const query = querySchema.safeParse(req.query);
  if (!query.success) {
    error(res, 'VALIDATION_ERROR', query.error.issues[0]!.message);
    return;
  }

  const { period } = query.data;
  const limit = Math.min(100, Math.max(1, Number(query.data.limit) || 50));
  const range = resolvePeriod(period);

  const where = buildWhere([
    eq(entries.isDeleted, false),
    eq(factions.isActive, true),
    range.from ? gte(entries.entryDate, range.from) : undefined,
    range.to ? lte(entries.entryDate, range.to) : undefined,
  ]);

  // Ranked per member *per faction*: someone active in two factions appears
  // once for each, which is what a cross-faction comparison should show.
  const rows = await db
    .select({
      userId: users.id,
      username: users.username,
      inGameName: users.inGameName,
      avatarUrl: users.avatarUrl,
      factionId: factions.id,
      factionName: factions.name,
      total: sql<string>`COALESCE(SUM(CAST(${entries.amount} AS NUMERIC)), 0)`,
      entryCount: sql<number>`COUNT(*)::int`,
    })
    .from(entries)
    .innerJoin(users, eq(entries.userId, users.id))
    .innerJoin(factions, eq(entries.factionId, factions.id))
    // Anonymous entries belong to a faction, not to a person.
    .where(and(where, eq(users.isSystem, false)))
    .groupBy(users.id, users.username, users.inGameName, users.avatarUrl, factions.id, factions.name)
    .orderBy(sql`SUM(CAST(${entries.amount} AS NUMERIC)) DESC`)
    .limit(limit);

  let lastTotal: number | null = null;
  let lastRank = 0;
  const rankings = rows.map((row, index) => {
    const total = Number(row.total);
    const rank = total === lastTotal ? lastRank : index + 1;
    lastTotal = total;
    lastRank = rank;
    return {
      rank,
      userId: row.userId,
      username: row.username,
      inGameName: row.inGameName,
      avatarUrl: row.avatarUrl,
      factionId: row.factionId,
      factionName: row.factionName,
      total,
      entryCount: row.entryCount,
    };
  });

  success(res, {
    period: { from: range.from, to: range.to, label: range.label },
    rankings,
  });
});

export default router;
