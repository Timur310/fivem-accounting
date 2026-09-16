import { db, type TransactionLike } from '../db/index.js';
import { craftHolding, craftHoldingMessage } from './crafting.js';
import { saleHolding, saleHoldingMessage } from './sales.js';
import { operationHolding, operationHoldingMessage } from './operations.js';

/**
 * Whether an entry or payout belongs to something bigger that owns it.
 *
 * Three features now write ordinary ledger rows as part of a single act — a
 * craft, a sale and a crew's split — and each breaks if one of its rows is
 * edited or deleted on its own. Every place that edits or deletes an entry or
 * a payout has to ask about all of them, and asking separately is how one of
 * them eventually gets forgotten at a seventh call site. This function is the
 * one question, and a fourth such feature adds a line here and nowhere else.
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

  const operation = await operationHolding(rows, handle);
  if (operation) return operationHoldingMessage(operation);

  return null;
}
