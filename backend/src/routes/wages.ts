import { Request, Response } from 'express';
import { asyncRouter } from '../lib/asyncRouter.js';
import { z } from 'zod';
import { and, asc, eq, gte, inArray, isNull, lte, sql } from 'drizzle-orm';
import { db, type TransactionLike } from '../db/index.js';
import { commissionRates, entries, factionMembers, factions, itemTypes, payouts, users, wagePayIn } from '../db/schema.js';
import { basisPoints, computeTakings, convertShare, rateUnits, shareOf, type CommissionRate } from '../lib/commission.js';
import { fromCents, toCents } from '../lib/treasury.js';
import { success, error } from '../lib/response.js';
import { requireAuth } from '../middleware/auth.js';
import { requireFactionMember, requirePermission } from '../middleware/factionAccess.js';
import { requireModule } from '../lib/modules.js';
import { createAuditLog } from '../lib/audit.js';
import { dispatchDiscord } from '../lib/discordDispatch.js';

/**
 * Wages from takings: what each member brought in over a week or a month, the
 * cut they keep of it, and paying that cut.
 *
 * For the factions that pay by the job rather than by the hour: a gang whose
 * members keep a share of the dirty money they bring back, a garage that pays
 * mechanics a percentage of what they bill. The hourly kind lives with the
 * timesheet (routes/shifts.ts); this is the other kind.
 *
 * Everything here is `manage_wages`. The screen lays every member's takings
 * side by side, and a percentage is a decision about the faction's money.
 *
 * **Paid entries are marked.** Paying a line sets each of its entries'
 * `commissionPayoutId`, so the next calculation does not count them again,
 * and they refuse to be edited or deleted while that payout stands — the
 * payout was worked out from them. Rejecting or deleting the payout frees
 * them (routes/payouts.ts).
 */
const router = asyncRouter({ mergeParams: true });

router.use(requireAuth, requireFactionMember, requireModule('wages'), requirePermission('manage_wages'));

const factionId = (req: Request) => req.params.id as string;

const memberName = sql<string>`COALESCE(${users.inGameName}, ${users.username})`;

function holds(req: Request, permission: string): boolean {
  if (req.factionRole === 'admin' || req.factionRole === 'superadmin') return true;
  return (req.factionPermissions ?? []).includes(permission);
}

const percentField = z
  .string()
  .trim()
  .regex(/^\d{1,3}(\.\d{1,2})?$/, 'A percentage looks like 30 or 12.5')
  .refine((v) => basisPoints(v) <= 10_000n, 'A percentage is at most 100');

const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'A date looks like 2026-09-28');

const rateSchema = z.object({
  rank: z.string().trim().max(100).nullable(),
  itemTypeId: z.string().uuid(),
  percent: percentField,
});

const ratesSchema = z.object({ rates: z.array(rateSchema).max(200) });

const windowSchema = z.object({
  from: day,
  to: day,
  /** Comma-separated item ids; every item when left out. */
  items: z.string().optional(),
});

/** How much of the paying item one unit of the brought item is worth. */
const rateField = z
  .string()
  .trim()
  .regex(/^\d{1,9}(\.\d{1,4})?$/, 'An exchange value looks like 1 or 0.75')
  .refine((v) => rateUnits(v) > 0n, 'An exchange value has to be more than zero');

const payInSchema = z.object({
  payItemTypeId: z.string().uuid(),
  rate: rateField,
});

const paySchema = z.object({
  from: day,
  to: day,
  lines: z.array(z.object({
    userId: z.string().uuid(),
    itemTypeId: z.string().uuid(),
    percent: percentField,
    /** What the screen showed as brought in, so nothing is paid on numbers nobody saw. */
    brought: z.string().regex(/^\d{1,13}(\.\d{1,2})?$/),
    /** Paid in another item than the one brought in, at this value each. */
    payItemTypeId: z.string().uuid().optional(),
    rate: rateField.optional(),
  })).min(1).max(500),
});

// ── Rates ─────────────────────────────────────────────

async function loadRates(id: string, handle: TransactionLike | typeof db = db): Promise<CommissionRate[]> {
  return handle
    .select({ rank: commissionRates.rank, itemTypeId: commissionRates.itemTypeId, percent: commissionRates.percent })
    .from(commissionRates)
    .where(eq(commissionRates.factionId, id));
}

router.get('/rates', async (req: Request, res: Response) => {
  const rows = await db
    .select({
      id: commissionRates.id,
      rank: commissionRates.rank,
      itemTypeId: commissionRates.itemTypeId,
      itemTypeName: itemTypes.name,
      percent: commissionRates.percent,
    })
    .from(commissionRates)
    .innerJoin(itemTypes, eq(commissionRates.itemTypeId, itemTypes.id))
    .where(eq(commissionRates.factionId, factionId(req)))
    .orderBy(asc(itemTypes.name), asc(commissionRates.rank));
  success(res, { rates: rows });
});

// The whole table at once, like the hourly rates: saving it row by row would
// leave it half-changed if one row were refused.
router.put('/rates', async (req: Request, res: Response) => {
  const id = factionId(req);
  const parsed = ratesSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    error(res, 'VALIDATION_ERROR', parsed.error.issues[0]!.message);
    return;
  }

  const [faction] = await db.select({ ranks: factions.ranks }).from(factions).where(eq(factions.id, id));
  const rankNames = new Map((faction?.ranks ?? []).map((r) => [r.name.trim().toLowerCase(), r.name]));

  // A rank has to be one this faction has, stored the way the faction spells
  // it: a typo would be a rate that silently never applies to anybody.
  const rates: CommissionRate[] = [];
  for (const rate of parsed.data.rates) {
    const typed = rate.rank && rate.rank.length > 0 ? rate.rank : null;
    const rank = typed === null ? null : rankNames.get(typed.toLowerCase());
    if (rank === undefined) {
      error(res, 'VALIDATION_ERROR', `"${typed}" is not one of this faction's ranks`);
      return;
    }
    rates.push({ ...rate, rank });
  }

  // One rate per rank per item, and one "everyone else" per item.
  const seen = new Set<string>();
  for (const rate of rates) {
    const key = `${(rate.rank ?? '').toLowerCase()}|${rate.itemTypeId}`;
    if (seen.has(key)) {
      error(res, 'VALIDATION_ERROR', rate.rank
        ? `"${rate.rank}" has two rates for the same item`
        : 'An item can only have one rate for everyone else');
      return;
    }
    seen.add(key);
  }

  const ids = [...new Set(rates.map((r) => r.itemTypeId))];
  if (ids.length > 0) {
    const owned = await db
      .select({ id: itemTypes.id })
      .from(itemTypes)
      .where(and(eq(itemTypes.factionId, id), inArray(itemTypes.id, ids)));
    if (owned.length !== ids.length) {
      error(res, 'VALIDATION_ERROR', 'Every rate has to be for one of this faction\'s items');
      return;
    }
  }

  await db.transaction(async (tx: TransactionLike) => {
    await tx.delete(commissionRates).where(eq(commissionRates.factionId, id));
    if (rates.length > 0) {
      await tx.insert(commissionRates).values(rates.map((r) => ({
        factionId: id,
        rank: r.rank,
        itemTypeId: r.itemTypeId,
        percent: r.percent,
      })));
    }
    await createAuditLog({
      userId: req.user!.id,
      factionId: id,
      action: 'update',
      entityType: 'commission_rates',
      entityId: id,
      details: { count: rates.length },
      req,
      tx,
    });
  });

  success(res, { saved: rates.length });
});

// ── What a cut is paid in ─────────────────────────────
//
// One default per brought item, set from the wages screen. Paying an item in
// itself at 1 each is the default, so saving exactly that removes the row
// rather than storing it.

router.put('/pay-in/:itemTypeId', async (req: Request, res: Response) => {
  const id = factionId(req);
  const itemTypeId = req.params.itemTypeId as string;
  const parsed = payInSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    error(res, 'VALIDATION_ERROR', parsed.error.issues[0]!.message);
    return;
  }
  if (!z.string().uuid().safeParse(itemTypeId).success) {
    error(res, 'VALIDATION_ERROR', 'Unknown item');
    return;
  }
  const { payItemTypeId, rate } = parsed.data;
  const ids = [...new Set([itemTypeId, payItemTypeId])];
  const owned = await db.select({ id: itemTypes.id }).from(itemTypes)
    .where(and(eq(itemTypes.factionId, id), inArray(itemTypes.id, ids)));
  if (owned.length !== ids.length) {
    error(res, 'VALIDATION_ERROR', "Both items have to be this faction's own");
    return;
  }

  await db.transaction(async (tx: TransactionLike) => {
    await tx.delete(wagePayIn).where(and(eq(wagePayIn.factionId, id), eq(wagePayIn.itemTypeId, itemTypeId)));
    const plain = payItemTypeId === itemTypeId && rateUnits(rate) === 10_000n;
    if (!plain) {
      await tx.insert(wagePayIn).values({ factionId: id, itemTypeId, payItemTypeId, rate });
    }
    await createAuditLog({
      userId: req.user!.id,
      factionId: id,
      action: 'update',
      entityType: 'wage_pay_in',
      entityId: itemTypeId,
      details: { payItemTypeId, rate },
      req,
      tx,
    });
  });

  success(res, { itemTypeId, payItemTypeId, rate });
});

// ── Takings ───────────────────────────────────────────

/**
 * Every unpaid entry in the window, per member per item, with the rate that
 * applies — current members only, since a departed member or the anonymous
 * placeholder has nobody here to pay.
 *
 * By entry date, both ends included: the same days the leaderboard counts,
 * so the two screens never disagree about what somebody brought in.
 */
async function takings(
  id: string,
  from: string,
  to: string,
  itemIds: string[] | null,
  handle: TransactionLike | typeof db = db,
) {
  const [rows, members, rates] = await Promise.all([
    handle
      .select({ id: entries.id, userId: entries.userId, itemTypeId: entries.itemTypeId, amount: entries.amount })
      .from(entries)
      .where(and(
        eq(entries.factionId, id),
        eq(entries.isDeleted, false),
        isNull(entries.commissionPayoutId),
        gte(entries.entryDate, from),
        lte(entries.entryDate, to),
        itemIds ? inArray(entries.itemTypeId, itemIds) : undefined,
      )),
    handle
      .select({ userId: factionMembers.userId, rank: factionMembers.rank })
      .from(factionMembers)
      .where(eq(factionMembers.factionId, id)),
    loadRates(id, handle),
  ]);
  const rankOf = new Map(members.map((m) => [m.userId, m.rank]));
  return { lines: computeTakings(rows, rankOf, rates), rankOf, hasRates: rates.length > 0 };
}

const parseItems = (raw: string | undefined) => {
  const ids = (raw ?? '').split(',').map((s) => s.trim()).filter(Boolean);
  return ids.length > 0 ? ids : null;
};

router.get('/', async (req: Request, res: Response) => {
  const id = factionId(req);
  const parsed = windowSchema.safeParse(req.query);
  if (!parsed.success) {
    error(res, 'VALIDATION_ERROR', parsed.error.issues[0]!.message);
    return;
  }
  const itemIds = parseItems(parsed.data.items);
  if (itemIds?.some((i) => !z.string().uuid().safeParse(i).success)) {
    error(res, 'VALIDATION_ERROR', 'Unknown item');
    return;
  }

  const { lines, rankOf, hasRates } = await takings(id, parsed.data.from, parsed.data.to, itemIds);

  const userIds = [...new Set(lines.map((l) => l.userId))];
  const people = userIds.length
    ? await db.select({ id: users.id, name: memberName, avatarUrl: users.avatarUrl })
      .from(users).where(inArray(users.id, userIds))
    : [];
  const person = new Map(people.map((p) => [p.id, p]));

  const payIn = await db
    .select({ itemTypeId: wagePayIn.itemTypeId, payItemTypeId: wagePayIn.payItemTypeId, rate: wagePayIn.rate })
    .from(wagePayIn)
    .where(eq(wagePayIn.factionId, id));

  success(res, {
    hasRates,
    payIn,
    lines: lines
      .map((l) => ({
        userId: l.userId,
        userName: person.get(l.userId)?.name ?? '',
        avatarUrl: person.get(l.userId)?.avatarUrl ?? null,
        rank: rankOf.get(l.userId) ?? null,
        itemTypeId: l.itemTypeId,
        brought: l.brought,
        ratePercent: l.ratePercent,
        entryCount: l.entryIds.length,
      }))
      .sort((a, b) => a.userName.localeCompare(b.userName)),
  });
});

// ── POST /pay — pay the lines as shown ────────────────
//
// The screen sends the lines it showed, with the percentage it showed for
// each, and what each came to. The server works the takings out again under a
// lock and refuses if any of them no longer match — an entry logged or
// deleted between looking and paying — rather than paying on numbers nobody
// saw. A line whose share rounds to nothing is left unpaid, entries and all.
//
// Status follows the payouts rule, as with hourly payroll: someone who may
// settle payouts pays; someone who may not is asking.

router.post('/pay', async (req: Request, res: Response) => {
  const id = factionId(req);
  const parsed = paySchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    error(res, 'VALIDATION_ERROR', parsed.error.issues[0]!.message);
    return;
  }
  const { from, to } = parsed.data;
  const wanted = new Map(parsed.data.lines.map((l) => [`${l.userId}:${l.itemTypeId}`, l]));
  if (wanted.size !== parsed.data.lines.length) {
    error(res, 'VALIDATION_ERROR', 'The same member and item appear twice');
    return;
  }
  const itemIds = [...new Set(parsed.data.lines.map((l) => l.itemTypeId))];
  const payItemIds = [...new Set(parsed.data.lines.map((l) => l.payItemTypeId ?? l.itemTypeId))];
  const status = holds(req, 'manage_payouts') ? 'completed' : 'pending';

  const result = await db.transaction(async (tx: TransactionLike) => {
    await tx.execute(sql`
      SELECT id FROM entries
      WHERE faction_id = ${id} AND is_deleted = false AND commission_payout_id IS NULL
        AND entry_date >= ${from} AND entry_date <= ${to}
      FOR UPDATE`);

    const { lines } = await takings(id, from, to, itemIds, tx);
    const current = new Map(lines.map((l) => [`${l.userId}:${l.itemTypeId}`, l]));

    for (const [key, line] of wanted) {
      const now = current.get(key);
      if (!now || toCents(now.brought) !== toCents(line.brought)) return { stale: true as const, badItem: false, created: [] };
    }

    const items = await tx
      .select({ id: itemTypes.id, name: itemTypes.name, isCurrency: itemTypes.isCurrency })
      .from(itemTypes)
      .where(and(eq(itemTypes.factionId, id), inArray(itemTypes.id, [...new Set([...itemIds, ...payItemIds])])));
    const item = new Map(items.map((i) => [i.id, i]));
    if (payItemIds.some((p) => !item.has(p))) return { stale: false as const, badItem: true, created: [] };

    const today = new Date().toISOString().slice(0, 10);
    const created = [];
    for (const [key, line] of wanted) {
      const now = current.get(key)!;
      const info = item.get(line.itemTypeId);
      if (!info) continue;
      const share = shareOf(now.brought, line.percent, info.isCurrency);
      const payItem = item.get(line.payItemTypeId ?? line.itemTypeId)!;
      const rate = line.rate ?? '1';
      const converted = payItem.id !== info.id || rateUnits(rate) !== 10_000n;
      const paid = converted ? convertShare(share, rate, payItem.isCurrency) : share;
      if (paid <= 0n) continue;
      const span = `${from} – ${to}, ${now.entryIds.length} ${now.entryIds.length === 1 ? 'entry' : 'entries'}`;

      const [payout] = await tx.insert(payouts).values({
        factionId: id,
        recipientUserId: line.userId,
        createdBy: req.user!.id,
        itemTypeId: payItem.id,
        amount: fromCents(paid),
        description: converted
          ? `Wages: ${line.percent}% of ${now.brought} ${info.name} = ${fromCents(share)}, paid as ${payItem.name} at ${rate} each (${span})`
          : `Wages: ${line.percent}% of ${now.brought} ${info.name} (${span})`,
        payoutDate: today,
        status,
      }).returning();

      await tx.update(entries)
        .set({ commissionPayoutId: payout!.id })
        .where(inArray(entries.id, now.entryIds));

      await createAuditLog({
        userId: req.user!.id,
        factionId: id,
        action: 'create',
        entityType: 'payout',
        entityId: payout!.id,
        details: {
          recipientUserId: line.userId,
          itemTypeId: payItem.id,
          amount: payout!.amount,
          status,
          wages: {
            percent: line.percent,
            brought: now.brought,
            broughtItemTypeId: info.id,
            ...(converted ? { share: fromCents(share), rate } : {}),
            entries: now.entryIds.length,
            from,
            to,
          },
        },
        req,
        tx,
      });
      created.push(payout!);
    }
    return { stale: false as const, badItem: false, created };
  });

  if (result.badItem) {
    error(res, 'VALIDATION_ERROR', "Wages can only be paid in one of this faction's items");
    return;
  }

  if (result.stale) {
    error(res, 'VALIDATION_ERROR', 'The takings changed since this was worked out — refresh and check the numbers again.', 409);
    return;
  }

  for (const payout of result.created) {
    void dispatchDiscord(id, {
      type: status === 'completed' ? 'payout_completed' : 'payout_requested',
      actorUserId: req.user!.id,
      recipientUserId: payout.recipientUserId,
      itemTypeId: payout.itemTypeId,
      amount: payout.amount,
      description: payout.description,
    });
  }

  success(res, { created: result.created.length, status, payouts: result.created }, 201);
});

export default router;
