import { Router, Request, Response } from 'express';
import { db } from '../db/index.js';
import { entries, itemTypes, users, factionMembers, factions } from '../db/schema.js';
import { eq, and, sql, desc, sum } from 'drizzle-orm';
import { success, error } from '../lib/response.js';
import { requireAuth } from '../middleware/auth.js';
import { requireFactionMember } from '../middleware/factionAccess.js';
import { computeTreasuryBalances } from '../lib/treasury.js';
import { countActiveStrikes } from '../lib/strikes.js';
import { daysSince, toDateString } from '../lib/date.js';

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
      isCurrency: itemTypes.isCurrency,
      imageUrl: itemTypes.imageUrl,
      total: sum(entries.amount).mapWith(Number),
    })
    .from(entries)
    .innerJoin(itemTypes, eq(entries.itemTypeId, itemTypes.id))
    .where(and(eq(entries.factionId, factionId), eq(entries.isDeleted, false)))
    .groupBy(entries.itemTypeId, itemTypes.name, itemTypes.unit, itemTypes.isCurrency, itemTypes.imageUrl);

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
      inGameName: users.inGameName,
      avatarUrl: users.avatarUrl,
      totalContributed: sum(entries.amount).mapWith(Number),
      entryCount: sql`COUNT(*)::int`,
    })
    .from(entries)
    .innerJoin(users, eq(entries.userId, users.id))
    // Anonymous entries belong to the faction, not to a person.
    .where(and(
      eq(entries.factionId, factionId),
      eq(entries.isDeleted, false),
      eq(users.isSystem, false),
    ))
    .groupBy(users.id, users.username, users.inGameName, users.avatarUrl)
    .orderBy(sql`SUM(entries.amount) DESC`)
    .limit(10);

  // Recent 10 entries (activity feed)
  const recentEntries = await db
    .select({
      id: entries.id,
      userId: entries.userId,
      amount: entries.amount,
      description: entries.description,
      entryDate: entries.entryDate,
      createdAt: entries.createdAt,
      username: users.username,
      inGameName: users.inGameName,
      avatarUrl: users.avatarUrl,
      itemTypeName: itemTypes.name,
      itemUnit: itemTypes.unit,
      itemIsCurrency: itemTypes.isCurrency,
      itemImageUrl: itemTypes.imageUrl,
    })
    .from(entries)
    .innerJoin(users, eq(entries.userId, users.id))
    .innerJoin(itemTypes, eq(entries.itemTypeId, itemTypes.id))
    .where(and(eq(entries.factionId, factionId), eq(entries.isDeleted, false)))
    .orderBy(desc(entries.createdAt))
    .limit(10);

  // The caller's own last few item types, for the quick-log chips.
  //
  // These used to be derived on the client by filtering `recentEntries` for the
  // caller's rows. That list is the faction's last ten entries overall, so in
  // any faction busier than a handful of people a member is simply not in it —
  // their chips and their prefill silently disappeared. Asking for the member's
  // own rows is the only way the feature works at every roster size.
  //
  // DISTINCT ON keeps the newest row per item type, so three chips means three
  // different items rather than the same one logged three times. Inactive and
  // deleted types are left out: a chip that cannot be logged is worse than no
  // chip.
  const myLatestPerType = db
    .selectDistinctOn([entries.itemTypeId], {
      itemTypeId: entries.itemTypeId,
      amount: entries.amount,
      createdAt: entries.createdAt,
    })
    .from(entries)
    .where(
      and(
        eq(entries.factionId, factionId),
        eq(entries.userId, req.user!.id),
        eq(entries.isDeleted, false),
      ),
    )
    .orderBy(entries.itemTypeId, desc(entries.createdAt))
    .as('my_latest_per_type');

  const myRecentItems = await db
    .select({
      itemTypeId: myLatestPerType.itemTypeId,
      itemTypeName: itemTypes.name,
      itemUnit: itemTypes.unit,
      itemIsCurrency: itemTypes.isCurrency,
      itemImageUrl: itemTypes.imageUrl,
      amount: myLatestPerType.amount,
    })
    .from(myLatestPerType)
    .innerJoin(itemTypes, eq(myLatestPerType.itemTypeId, itemTypes.id))
    .where(eq(itemTypes.isActive, true))
    .orderBy(desc(myLatestPerType.createdAt))
    .limit(3);

  // Grand total
  const [grandTotal] = await db
    .select({ total: sum(entries.amount).mapWith(Number) })
    .from(entries)
    .where(and(eq(entries.factionId, factionId), eq(entries.isDeleted, false)));

  // Treasury balances (inflow minus completed payouts) per item type
  // Same rule as the treasury page: a type nothing has ever passed through has
  // no balance to report, and a card of zeroes is noise on the one screen
  // people read at a glance. `totalsByType` below is a GROUP BY over entries,
  // so the fallback list it feeds is already scoped this way.
  const treasuryBalances = await computeTreasuryBalances(factionId, { onlyWithActivity: true });
  // Currency types only — see the note in routes/treasury.ts. Goods stay
  // visible per item type in treasuryBalances.
  const currencyBalances = treasuryBalances.filter((b) => b.isCurrency);
  const netBalance = currencyBalances.reduce((acc, b) => acc + b.balance, 0);

  // Inactive members — admin-only, since it is a management signal.
  const isAdmin = req.factionRole === 'admin' || req.factionRole === 'superadmin';
  let inactiveMembers: {
    userId: string;
    username: string;
    inGameName: string | null;
    avatarUrl: string | null;
    lastEntryDate: string | null;
    daysInactive: number | null;
  }[] = [];
  let inactivityThresholdDays = faction.inactivityThresholdDays;

  if (isAdmin) {
    const roster = await db
      .select({
        userId: factionMembers.userId,
        joinedAt: factionMembers.joinedAt,
        username: users.username,
        inGameName: users.inGameName,
        avatarUrl: users.avatarUrl,
        isProvisional: users.isProvisional,
        lastEntryDate: sql<string | null>`(SELECT MAX(entry_date) FROM entries WHERE user_id = ${factionMembers.userId} AND faction_id = ${factionId} AND is_deleted = false)`,
      })
      .from(factionMembers)
      .innerJoin(users, eq(factionMembers.userId, users.id))
      .where(eq(factionMembers.factionId, factionId));

    const strikeCounts = await countActiveStrikes(factionId);
    const threshold = inactivityThresholdDays;

    inactiveMembers = roster
      .filter((m) => {
        // Nobody is behind a provisional registration yet, so there is nobody
        // to chase: their clock starts when they first sign in.
        if (m.isProvisional) return false;
        // Someone who joined more recently than the threshold has not had the
        // chance to go quiet for that long yet.
        const memberDays = daysSince(toDateString(m.joinedAt));
        if (memberDays !== null && memberDays < threshold) return false;
        // Members already under a strike are handled through discipline, so
        // they would only duplicate the signal here.
        if ((strikeCounts.get(m.userId) ?? 0) > 0) return false;

        const idle = daysSince(m.lastEntryDate);
        return idle === null || idle >= threshold;
      })
      .map((m) => ({
        userId: m.userId,
        username: m.username,
        inGameName: m.inGameName,
        avatarUrl: m.avatarUrl,
        lastEntryDate: m.lastEntryDate,
        daysInactive: daysSince(m.lastEntryDate),
      }))
      // Never-active first, then longest idle.
      .sort((a, b) => (b.daysInactive ?? Infinity) - (a.daysInactive ?? Infinity));
  }

  success(res, {
    faction: {
      id: faction.id,
      name: faction.name,
      description: faction.description,
    },
    totalsByType,
    grandTotal: grandTotal?.total ?? 0,
    treasuryBalances,
    netBalance,
    memberCount: memberStats?.totalMembers ?? 0,
    adminCount: memberStats?.adminCount ?? 0,
    totalEntries: entryStats?.count ?? 0,
    topContributors,
    recentEntries,
    myRecentItems,
    ...(isAdmin ? { inactiveMembers, inactivityThresholdDays } : {}),
  });
});

export default router;
