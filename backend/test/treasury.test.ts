import { describe, it, expect, beforeEach } from 'vitest';
import {
  api, resetDatabase, seedBasicWorld, createItemType, createEntry, createPayout,
  type BasicWorld,
} from './helpers.js';

let w: BasicWorld;
const treasury = () => `/api/v1/factions/${w.faction.id}/treasury`;
const laundering = () => `/api/v1/factions/${w.faction.id}/laundering`;

async function balances(cookie = w.admin.cookie) {
  const res = await api().get(treasury()).set('Cookie', cookie);
  expect(res.status).toBe(200);
  return res.body.data.balances as { itemTypeId: string; inflow: number; outflow: number }[];
}

beforeEach(async () => {
  await resetDatabase();
  w = await seedBasicWorld();
});

/**
 * The treasury page reports what the vault has done, not what it could hold.
 * A faction that defined a dozen item types and used two should see two cards,
 * not ten rows of zeroes.
 */
describe('GET /treasury — which item types are listed', () => {
  it('omits an item type with no entries and no payouts', async () => {
    const unused = await createItemType(w.faction.id, 'Never Used');

    const rows = await balances();
    expect(rows.map((b) => b.itemTypeId)).not.toContain(unused);
  });

  it('lists one as soon as it has an entry', async () => {
    const used = await createItemType(w.faction.id, 'Used');
    await createEntry(w.faction.id, w.member.id, used, '250');

    const rows = await balances();
    const row = rows.find((b) => b.itemTypeId === used);
    expect(row).toBeDefined();
    expect(row!.inflow).toBe(250);
  });

  it('lists one whose only movement is a completed payout', async () => {
    const paidOut = await createItemType(w.faction.id, 'Paid Out');
    await createPayout(w.faction.id, w.member.id, w.admin.id, paidOut, '75', 'completed');

    const rows = await balances();
    const row = rows.find((b) => b.itemTypeId === paidOut);
    expect(row).toBeDefined();
    expect(row!.outflow).toBe(75);
  });

  // Pending and approved payouts have not left the vault, so they contribute
  // nothing to the numbers — a card for one would be a row of zeroes. They are
  // already reported on their own, in `pending`.
  it('still omits one whose only payout is pending', async () => {
    const queued = await createItemType(w.faction.id, 'Queued');
    await createPayout(w.faction.id, w.member.id, w.admin.id, queued, '75', 'pending');

    const rows = await balances();
    expect(rows.map((b) => b.itemTypeId)).not.toContain(queued);
    const res = await api().get(treasury()).set('Cookie', w.admin.cookie);
    expect(res.body.data.pending.count).toBe(1);
  });

  it('drops one again when its only entry is deleted', async () => {
    const used = await createItemType(w.faction.id, 'Undone');
    const entryId = await createEntry(w.faction.id, w.member.id, used, '250');
    await api()
      .delete(`/api/v1/factions/${w.faction.id}/entries/${entryId}`)
      .set('Cookie', w.admin.cookie);

    const rows = await balances();
    expect(rows.map((b) => b.itemTypeId)).not.toContain(used);
  });

  // The totals note on screen reads "across N currency types"; N has to count
  // the cards actually shown, or it describes a set the reader cannot see.
  it('counts only the listed types in the totals note', async () => {
    await createItemType(w.faction.id, 'Never Used');
    await createEntry(w.faction.id, w.member.id, w.itemTypeId, '100');

    const res = await api().get(treasury()).set('Cookie', w.admin.cookie);
    const { totals, balances: rows } = res.body.data;
    expect(totals.currencyTypeCount + totals.nonCurrencyTypeCount).toBe(rows.length);
  });
});

/**
 * The laundering screen reads the same balances, and needs the opposite: you
 * wash *into* a currency the vault has never held, so a type with no history
 * still has to be offered.
 */
describe('GET /laundering — unused currencies stay available', () => {
  it('offers a currency the vault has never held', async () => {
    const fresh = await createItemType(w.faction.id, 'Clean Money', { isCurrency: true });

    const res = await api().get(laundering()).set('Cookie', w.admin.cookie);
    expect(res.status).toBe(200);
    const ids = res.body.data.currencies.map((c: { itemTypeId: string }) => c.itemTypeId);
    expect(ids).toContain(fresh);
  });
});
