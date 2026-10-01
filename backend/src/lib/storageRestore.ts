import { and, eq, sql } from 'drizzle-orm';
import { type TransactionLike } from '../db/index.js';
import { storageContainers, storageContents, storageMovements } from '../db/schema.js';
import { fromCents, toCents } from './treasury.js';

/**
 * A storage withdrawal was deleted (or rejected): put the items back.
 *
 * Taking something out of a linked container wrote a payout. Removing that
 * payout says the items never left the treasury, so they go back to the
 * container they came out of — merged into the same item's line if it is
 * still listed there, or as a new line if it was removed since. Limits are not
 * checked: this is the count the container had before, not something new
 * being put away.
 *
 * If the container itself has been deleted there is nowhere to put them; the
 * items are simply back in the treasury and not in storage, which is what
 * the books already say.
 *
 * The movement's link to the payout is cleared, so the same withdrawal can
 * never be put back twice, and the return is written to the history.
 */
export async function restoreStorageWithdrawal(tx: TransactionLike, payoutId: string, userId: string): Promise<void> {
  const takes = await tx.select().from(storageMovements).where(eq(storageMovements.payoutId, payoutId));

  for (const take of takes) {
    await tx.update(storageMovements).set({ payoutId: null }).where(eq(storageMovements.id, take.id));
    if (!take.containerId) continue;

    // Serialise with everything else that changes this container's counts.
    await tx.execute(sql`SELECT id FROM storage_containers WHERE id = ${take.containerId} FOR UPDATE`);
    const [container] = await tx.select({ id: storageContainers.id, name: storageContainers.name })
      .from(storageContainers).where(eq(storageContainers.id, take.containerId));
    if (!container) continue;

    const [line] = take.itemTypeId
      ? await tx.select().from(storageContents)
        .where(and(eq(storageContents.containerId, container.id), eq(storageContents.itemTypeId, take.itemTypeId)))
      : [];

    if (line) {
      await tx.update(storageContents)
        .set({ quantity: fromCents(toCents(line.quantity) + toCents(take.amount)), updatedAt: new Date() })
        .where(eq(storageContents.id, line.id));
    } else {
      await tx.insert(storageContents).values({
        factionId: take.factionId, containerId: container.id, itemTypeId: take.itemTypeId,
        label: take.label, quantity: take.amount,
      });
    }

    await tx.insert(storageMovements).values({
      factionId: take.factionId,
      containerId: container.id,
      containerName: container.name,
      itemTypeId: take.itemTypeId,
      label: take.label,
      kind: 'return',
      amount: take.amount,
      userId,
    });
  }
}
