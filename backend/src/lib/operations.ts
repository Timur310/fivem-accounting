import { and, eq, inArray, isNull } from 'drizzle-orm';
import { db, type TransactionLike } from '../db/index.js';
import { operationMovements, operations } from '../db/schema.js';
import { fromCents, toCents } from './treasury.js';

/**
 * Dividing a haul, and the guard that keeps a divided one intact.
 *
 * The writing side — the transaction that books the split into the ledger —
 * lives in `routes/operations.ts` next to the request that triggers it, the
 * way crafting and sales are arranged.
 */

export interface SplitParticipant {
  userId: string;
  /** A weight, not a percentage. Three people on 1 each split evenly. */
  share: number;
}

export interface SplitShare {
  userId: string;
  quantity: string;
}

export interface SplitLine {
  itemTypeId: string;
  /** Everything that came back of this item, before anything is taken off. */
  quantity: string;
  /** The part taken off the top for the faction. `'0.00'` when there is none. */
  factionCut: string;
  /** What each participant is credited with. Sums, with the cut, to `quantity`. */
  shares: SplitShare[];
}

/**
 * Divide one quantity between a cut off the top and a weighted crew.
 *
 * Works in integer hundredths throughout, like every other money path in the
 * app, and hands out every last hundredth: the cut plus the shares equals the
 * haul exactly, always. That is the whole point of the feature — a split that
 * loses a hundredth to rounding is a split somebody has to fix by hand, which
 * is what people were already doing before this existed.
 *
 * The remainder goes to the largest weights first, and ties go to whoever was
 * listed first. Arbitrary, but deliberate rather than accidental: the same
 * crew and the same haul always divide the same way, so re-logging a job that
 * was entered wrong produces the same numbers rather than new ones.
 */
export function splitQuantity(
  quantity: string,
  participants: SplitParticipant[],
  factionCutPercent = '0',
): { factionCut: string; shares: SplitShare[] } {
  const total = toCents(quantity);
  const cutBasisPoints = toCents(factionCutPercent); // 12.50% → 1250

  // Rounded down, so the crew is never short to pay a cut nobody promised
  // them. A faction taking its own share can afford the hundredth.
  const cut = total > 0n ? (total * cutBasisPoints) / 10_000n : 0n;
  const rest = total - cut;

  const weights = participants.map((p) => BigInt(Math.max(1, Math.trunc(p.share))));
  const totalWeight = weights.reduce((a, b) => a + b, 0n);

  // No crew, or weights that cancel to nothing: the whole haul is the
  // faction's. Refusing here instead would mean losing the record of a job
  // that did happen.
  if (participants.length === 0 || totalWeight === 0n) {
    return { factionCut: fromCents(total), shares: [] };
  }

  const base = weights.map((w) => (rest * w) / totalWeight);
  const remainders = weights.map((w) => (rest * w) % totalWeight);

  let left = rest - base.reduce((a, b) => a + b, 0n);
  const order = participants
    .map((_, i) => i)
    .sort((a, b) => {
      if (remainders[a]! !== remainders[b]!) return remainders[b]! > remainders[a]! ? 1 : -1;
      return a - b;
    });

  for (const i of order) {
    if (left <= 0n) break;
    base[i] = base[i]! + 1n;
    left -= 1n;
  }

  return {
    factionCut: fromCents(cut),
    shares: participants.map((p, i) => ({ userId: p.userId, quantity: fromCents(base[i]!) })),
  };
}

/** Every loot line divided the same way. */
export function splitHaul(
  loot: { itemTypeId: string; quantity: string }[],
  participants: SplitParticipant[],
  factionCutPercent = '0',
): SplitLine[] {
  return loot.map((line) => ({
    itemTypeId: line.itemTypeId,
    quantity: line.quantity,
    ...splitQuantity(line.quantity, participants, factionCutPercent),
  }));
}

/** How an operation is named in a message: what it was, and when. */
export function operationLabel(row: { name: string; occurredAt: Date | string }): string {
  const when = row.occurredAt instanceof Date ? row.occurredAt : new Date(row.occurredAt);
  return `${row.name} on ${when.toISOString().slice(0, 10)}`;
}

/**
 * Is one of these entries part of an operation that still stands?
 *
 * A split is one act. Editing one member's share on its own leaves the crew's
 * entries no longer adding up to what was taken — which is the exact state
 * this feature exists to prevent — so the rows a split created refuse to be
 * touched individually, and the way to change one is to revert the operation
 * and log it again.
 */
export async function operationHolding(
  rows: { entryIds?: string[] },
  handle: TransactionLike | typeof db = db,
): Promise<string | null> {
  const entryIds = rows.entryIds?.filter(Boolean) ?? [];
  if (entryIds.length === 0) return null;

  const [held] = await handle
    .select({ name: operations.name, occurredAt: operations.occurredAt })
    .from(operationMovements)
    .innerJoin(operations, eq(operationMovements.operationId, operations.id))
    .where(and(isNull(operations.revertedAt), inArray(operationMovements.entryId, entryIds)))
    .limit(1);

  return held ? operationLabel(held) : null;
}

export function operationHoldingMessage(label: string): string {
  return `This is one crew member's share of ${label}. Revert that operation instead — it takes the whole split back out together, and you can log it again with the right numbers.`;
}
