import { Router, Request, Response } from 'express';
import { db } from '../db/index.js';
import { entries, itemTypes, users, factionMembers, factions } from '../db/schema.js';
import { eq, and, sql, desc, sum } from 'drizzle-orm';
import { success, error } from '../lib/response.js';
import { requireAuth } from '../middleware/auth.js';
import { requireFactionMember } from '../middleware/factionAccess.js';

const router = Router({ mergeParams: true });

router.use(requireAuth, requireFactionMember);

// GET / - faction dashboard
router.get('/', async (req: Request, res: Response) => {
  const factionId = req.params.id as string;

  // Verify faction is active
  const [faction] = await db
    .select()
    .from(factions)
    .where(eq(factions.id, factionId))
    .limit(1);
  if (!faction || !faction.isActive) {
    error(res, 'NOT_FOUND', 'Faction not found or inactive', 404);
    return;
  }

  // Aggregated totals by item type
  const totalsByType = await db
    .select({
      itemTypeId: entries.itemTypeId,
      itemTypeName: itemTypes.name,
      unit: itemTypes.unit,
      total: sum(entries.amount).mapWith(Number),
    })
    .from(entries)
    .innerJoin(itemTypes, eq(entries.itemTypeId, itemTypes.id))
    .where(and(eq(entries.factionId, factionId), eq(entries.isDeleted, false)))
    .groupBy(entries.itemTypeId, itemTypes.name, itemTypes.unit);

  // Member count
  const [memberStats] = await db
    .select({
      totalMembers: sql`COUNT(*)::int`,
      adminCount: sql`COUNT(*) FILTER (WHERE role = 'admin')::int`,
    })
    .from(factionMembers)
    .where(eq(factionMembers.factionId, factionId));

  // Total entries count
  const [entryStats] = await db
    .select({ count: sql`COUNT(*)::int` })
    .from(entries)
    .where(and(eq(entries.factionId, factionId), eq(entries.isDeleted, false)));

  // Top 10 contributors
  const topContributors = await db
    .select({
      userId: users.id,
      username: users.username,
      avatarUrl: users.avatarUrl,
      totalContributed: sum(entries.amount).mapWith(Number),
      entryCount: sql`COUNT(*)::int`,
    })
    .from(entries)
    .innerJoin(users, eq(entries.userId, users.id))
    .where(and(eq(entries.factionId, factionId), eq(entries.isDeleted, false)))
    .groupBy(users.id, users.username, users.avatarUrl)
    .orderBy(sql`SUM(entries.amount) DESC`)
    .limit(10);

  // Recent 10 entries (activity feed)
  const recentEntries = await db
    .select({
      id: entries.id,
      amount: entries.amount,
      description: entries.description,
      entryDate: entries.entryDate,
      createdAt: entries.createdAt,
      username: users.username,
      avatarUrl: users.avatarUrl,
      itemTypeName: itemTypes.name,
      itemUnit: itemTypes.unit,
    })
    .from(entries)
    .innerJoin(users, eq(entries.userId, users.id))
    .innerJoin(itemTypes, eq(entries.itemTypeId, itemTypes.id))
    .where(and(eq(entries.factionId, factionId), eq(entries.isDeleted, false)))
    .orderBy(desc(entries.createdAt))
    .limit(10);

  // Grand total
  const [grandTotal] = await db
    .select({ total: sum(entries.amount).mapWith(Number) })
    .from(entries)
    .where(and(eq(entries.factionId, factionId), eq(entries.isDeleted, false)));

  success(res, {
    faction: {
      id: faction.id,
      name: faction.name,
      description: faction.description,
    },
    totalsByType,
    grandTotal: grandTotal?.total ?? 0,
    memberCount: memberStats?.totalMembers ?? 0,
    adminCount: memberStats?.adminCount ?? 0,
    totalEntries: entryStats?.count ?? 0,
    topContributors,
    recentEntries,
  });
});

export default router;
