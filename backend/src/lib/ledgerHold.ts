import { db, type TransactionLike } from '../db/index.js';
import { craftHolding, craftHoldingMessage } from './crafting.js';
import { saleHolding, saleHoldingMessage } from './sales.js';

/**
 * Whether an entry or payout belongs to something bigger that owns it.
 *
 * Two features now write ordinary ledger rows as part of a single act — a
 * craft and a sale — and both break if one of their rows is edited or deleted
 * on its own. Every place that edits or deletes an entry or a payout has to
 * ask about both, and asking in two steps is how one of them eventually gets
 * forgotten at a seventh call site.
 *
 * Returns the message to show, or null when the rows are free.
 */
export async function ledgerHoldMessage(
  rows: { entryIds?: string[]; payoutIds?: string[] },
  handle: TransactionLike | typeof db = db,
): Promise<string | null> {
  const craft = await craftHolding(rows, handle);
  if (craft) return craftHoldingMessage(craft);

  const sale = await saleHolding(rows, handle);
  if (sale) return saleHoldingMessage(sale);

  return null;
}
