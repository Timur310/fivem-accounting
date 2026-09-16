import { Request, Response } from 'express';
import { asyncRouter } from '../lib/asyncRouter.js';
import { z } from 'zod';
import { db, type TransactionLike } from '../db/index.js';
import { entries, payouts, itemTypes } from '../db/schema.js';
import { eq, and, sql } from 'drizzle-orm';
import { success, error } from '../lib/response.js';
import { requireAuth } from '../middleware/auth.js';
import { requireFactionMember, requirePermission } from '../middleware/factionAccess.js';
import { requireModule } from '../lib/modules.js';
import { createAuditLog } from '../lib/audit.js';
import { dispatchDiscord } from '../lib/discordDispatch.js';
import { resolveAnonymousUserId } from '../lib/anonymous.js';
import { balancesFor, computeTreasuryBalances, lockItemTypes } from '../lib/treasury.js';
import { compareQuantity } from '../lib/crafting.js';
import { todayDateString } from '../lib/date.js';

/**
 * The laundering desk: one currency leaves the treasury, another comes back.
 *
 * It is deliberately not a new kind of record. A conversion is written as the
 * two movements the treasury already understands — a completed payout of the
 * dirty currency and an entry of the clean one — both against the anonymous
 * placeholder, so the balances move without crediting or charging a member.
 * The rate is whatever the two amounts say it is: the launderer's cut is not
 * the app's business, and it changes with who is doing the washing.
 */
const router = asyncRouter({ mergeParams: true });

router.use(requireAuth, requireFactionMember, requireModule('laundering'), requirePermission('manage_laundering'));

const amountField = z
  .string()
  .regex(/^\d{1,13}(\.\d{1,2})?$/, 'Amount must be a positive number with up to 2 decimal places')
  .refine((v) => Number(v) > 0, 'Amount must be greater than zero');

const launderSchema = z.object({
  fromItemTypeId: z.string().uuid(),
  amountIn: amountField,
  toItemTypeId: z.string().uuid(),
  amountOut: amountField,
  description: z.string().max(500).optional(),
  date: z.string().date().optional(),
});

// ── GET / — what there is to wash ────────────────────
//
// The screen needs the faction's currencies and what the vault holds of each,
// and its permission does not imply the treasury's or the payout list's.
router.get('/', async (req: Request, res: Response) => {
  const factionId = req.params.id as string;

  const balances = await computeTreasuryBalances(factionId);
  const active = await db
    .select({ id: itemTypes.id })
    .from(itemTypes)
    .where(and(eq(itemTypes.factionId, factionId), eq(itemTypes.isActive, true)));
  const activeIds = new Set(active.map((t) => t.id));

  success(res, {
    currencies: balances
      .filter((b) => b.isCurrency && activeIds.has(b.itemTypeId))
      .map((b) => ({
        itemTypeId: b.itemTypeId,
        itemTypeName: b.itemTypeName,
        unit: b.unit,
        balance: b.balance,
      })),
  });
});

// ── POST / — wash one currency into another ──────────
router.post('/', async (req: Request, res: Response) => {
  const factionId = req.params.id as string;

  const parsed = launderSchema.safeParse(req.body);
  if (!parsed.success) {
    error(res, 'VALIDATION_ERROR', parsed.error.issues[0]!.message);
    return;
  }

  const { fromItemTypeId, amountIn, toItemTypeId, amountOut, description, date } = parsed.data;

  if (fromItemTypeId === toItemTypeId) {
    error(res, 'VALIDATION_ERROR', 'Pick two different currencies to convert between');
    return;
  }

  const types = await db
    .select({
      id: itemTypes.id,
      name: itemTypes.name,
      unit: itemTypes.unit,
      isCurrency: itemTypes.isCurrency,
      isActive: itemTypes.isActive,
    })
    .from(itemTypes)
    .where(eq(itemTypes.factionId, factionId));

  const from = types.find((t) => t.id === fromItemTypeId);
  const to = types.find((t) => t.id === toItemTypeId);
  if (!from || !to) {
    error(res, 'NOT_FOUND', 'Item type not found in this faction', 404);
    return;
  }
  if (!from.isActive || !to.isActive) {
    error(res, 'VALIDATION_ERROR', 'Both item types must be active');
    return;
  }
  // Goods are counted, not converted: washing 30 crates into 40 crates would
  // be an inventory correction wearing a laundering costume.
  if (!from.isCurrency || !to.isCurrency) {
    error(res, 'VALIDATION_ERROR', 'Only currency item types can be laundered');
    return;
  }

  const launderDate = date ?? todayDateString();
  const note = description?.trim()
    || `Laundered ${amountIn} ${from.name} into ${amountOut} ${to.name}`;

  let result;
  try {
    result = await db.transaction(async (tx: TransactionLike) => {
      const anonymousUserId = await resolveAnonymousUserId(tx);

      // The vault has to hold what is being washed. Locked and read inside
      // the transaction so two conversions cannot both spend the same balance.
      //
      // This used to be a hand-rolled copy of the balance query that left
      // **expenses** out, so the desk would green-light a wash the treasury
      // screen said the faction could not afford. It is the shared query now,
      // which is the same one the treasury screen and crafting use.
      await lockItemTypes(tx, [fromItemTypeId, toItemTypeId]);
      const balances = await balancesFor(factionId, [fromItemTypeId], tx);
      const available = balances.get(fromItemTypeId) ?? '0';
      if (compareQuantity(available, amountIn) < 0) {
        throw new InsufficientBalanceError(available);
      }

      // Out of the vault: a completed payout, because the currency is gone the
      // moment it is handed over. Approval settings do not apply — there is no
      // member on the receiving end to four-eyes.
      const [payout] = await tx
        .insert(payouts)
        .values({
          factionId,
          recipientUserId: anonymousUserId,
          createdBy: req.user!.id,
          itemTypeId: fromItemTypeId,
          amount: amountIn,
          description: note,
          payoutDate: launderDate,
          status: 'completed',
        })
        .returning();

      // And back in: an entry the anonymous placeholder owns, so the clean
      // money counts for the treasury but for nobody's contribution score.
      const [entry] = await tx
        .insert(entries)
        .values({
          factionId,
          userId: anonymousUserId,
          itemTypeId: toItemTypeId,
          amount: amountOut,
          description: note,
          entryDate: launderDate,
        })
        .returning();

      if (!payout || !entry) throw new Error('Failed to record the conversion');

      await createAuditLog({
        userId: req.user!.id,
        factionId,
        action: 'create',
        entityType: 'laundering',
        entityId: payout.id,
        details: {
          fromItemTypeId,
          fromItemTypeName: from.name,
          amountIn,
          toItemTypeId,
          toItemTypeName: to.name,
          amountOut,
          payoutId: payout.id,
          entryId: entry.id,
        },
        req,
        tx,
      });

      return { payout, entry };
    });
  } catch (err) {
    if (err instanceof InsufficientBalanceError) {
      error(
        res,
        'BAD_REQUEST',
        `The treasury holds ${err.available} ${from.name} — not enough to launder ${amountIn}`,
      );
      return;
    }
    console.error('[LAUNDERING ERROR]', err);
    error(res, 'INTERNAL_ERROR', 'Failed to record the conversion', 500);
    return;
  }

  void dispatchDiscord(factionId, {
    type: 'laundering_completed',
    actorUserId: req.user!.id,
    fromItemTypeId: from.id,
    fromAmount: String(amountIn),
    toItemTypeId: to.id,
    toAmount: String(amountOut),
  });

  success(
    res,
    {
      from: { itemTypeId: from.id, itemTypeName: from.name, unit: from.unit, amount: amountIn },
      to: { itemTypeId: to.id, itemTypeName: to.name, unit: to.unit, amount: amountOut },
      date: launderDate,
      payoutId: result.payout.id,
      entryId: result.entry.id,
    },
    201,
  );
});

/** Thrown inside the transaction so the catch can answer 400, not 500. */
class InsufficientBalanceError extends Error {
  constructor(public available: string) {
    super('Insufficient treasury balance');
  }
}

export default router;
