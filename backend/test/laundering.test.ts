import { describe, it, expect, beforeEach } from 'vitest';
import {
  api, createItemType, resetDatabase, seedBasicWorld, type BasicWorld,
} from './helpers.js';

let w: BasicWorld;
const f = () => `/api/v1/factions/${w.faction.id}`;
const laundering = () => `${f()}/laundering`;

/** Dirty in, clean out. The seeded item type is the clean side. */
let dirtyId: string;
let cleanId: string;

/** Define a rank with the given permissions and put the plain member on it. */
async function giveMemberRank(permissions: string[], name = 'Washer') {
  const ranks = await api()
    .patch(`${f()}/settings`)
    .set('Cookie', w.admin.cookie)
    .send({ ranks: [{ name, level: 1, permissions }] });
  expect(ranks.status).toBe(200);

  const assigned = await api()
    .patch(`${f()}/members/${w.member.id}`)
    .set('Cookie', w.admin.cookie)
    .send({ rank: name });
  expect(assigned.status).toBe(200);
}

/** Put `amount` of an item type into the vault as a normal member entry. */
async function fundTreasury(itemTypeId: string, amount: string) {
  const res = await api().post(`${f()}/entries`).set('Cookie', w.member.cookie)
    .send({ itemTypeId, amount });
  expect(res.status).toBe(201);
}

async function balanceOf(itemTypeId: string): Promise<number> {
  const res = await api().get(`${f()}/treasury`).set('Cookie', w.admin.cookie);
  expect(res.status).toBe(200);
  const row = res.body.data.balances.find(
    (b: { itemTypeId: string }) => b.itemTypeId === itemTypeId,
  );
  return row?.balance ?? 0;
}

beforeEach(async () => {
  await resetDatabase();
  w = await seedBasicWorld();
  cleanId = w.itemTypeId;
  dirtyId = await createItemType(w.faction.id, 'Dirty Money', { unit: '$', isCurrency: true });
});

describe('laundering', () => {
  it('needs its own permission — the payout one is not enough', async () => {
    await giveMemberRank(['manage_payouts', 'manage_entries']);

    const res = await api().post(laundering()).set('Cookie', w.member.cookie)
      .send({ fromItemTypeId: dirtyId, amountIn: '100', toItemTypeId: cleanId, amountOut: '70' });

    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('FORBIDDEN');
  });

  it('opens to a rank granted manage_laundering', async () => {
    await fundTreasury(dirtyId, '1000');
    await giveMemberRank(['manage_laundering']);

    const res = await api().post(laundering()).set('Cookie', w.member.cookie)
      .send({ fromItemTypeId: dirtyId, amountIn: '1000', toItemTypeId: cleanId, amountOut: '700' });

    expect(res.status).toBe(201);
  });

  it('moves both balances and credits nobody', async () => {
    await fundTreasury(dirtyId, '10000');
    const cleanBefore = await balanceOf(cleanId);

    const res = await api().post(laundering()).set('Cookie', w.admin.cookie)
      .send({ fromItemTypeId: dirtyId, amountIn: '10000', toItemTypeId: cleanId, amountOut: '7500' });
    expect(res.status).toBe(201);

    expect(await balanceOf(dirtyId)).toBe(0);
    expect(await balanceOf(cleanId)).toBe(cleanBefore + 7500);

    // The two movements are a completed payout and an entry, both owned by the
    // anonymous placeholder rather than a member.
    const payouts = await api().get(`${f()}/payouts`).set('Cookie', w.admin.cookie);
    const payout = payouts.body.data.find((p: { id: string }) => p.id === res.body.data.payoutId);
    expect(payout.status).toBe('completed');
    expect(payout.recipientUsername).toBe('Anonymous');

    const entries = await api().get(`${f()}/entries`).set('Cookie', w.admin.cookie);
    const entry = entries.body.data.find((e: { id: string }) => e.id === res.body.data.entryId);
    expect(entry.username).toBe('Anonymous');
    expect(Number(entry.amount)).toBe(7500);

    // And the placeholder stays out of the member rankings.
    const leaderboard = await api().get(`${f()}/leaderboard`).set('Cookie', w.admin.cookie);
    const names = leaderboard.body.data.rankings.map((r: { username: string }) => r.username);
    expect(names).not.toContain('Anonymous');
  });

  it('refuses to wash more than the vault holds', async () => {
    await fundTreasury(dirtyId, '500');

    const res = await api().post(laundering()).set('Cookie', w.admin.cookie)
      .send({ fromItemTypeId: dirtyId, amountIn: '900', toItemTypeId: cleanId, amountOut: '600' });

    expect(res.status).toBe(400);
    expect(res.body.error.message).toMatch(/not enough/i);
    // Nothing was written on either side.
    expect(await balanceOf(dirtyId)).toBe(500);
  });

  // The desk used to run its own copy of the balance query, and that copy
  // left expenses out — so money already spent on rent still looked washable.
  it('counts expenses against what is washable', async () => {
    await fundTreasury(dirtyId, '500');
    const spent = await api().post(`${f()}/expenses`).set('Cookie', w.admin.cookie)
      .send({ itemTypeId: dirtyId, amount: '400', category: 'other' });
    expect(spent.status).toBe(201);

    const res = await api().post(laundering()).set('Cookie', w.admin.cookie)
      .send({ fromItemTypeId: dirtyId, amountIn: '300', toItemTypeId: cleanId, amountOut: '200' });

    expect(res.status).toBe(400);
    expect(res.body.error.message).toMatch(/not enough/i);
    expect(await balanceOf(dirtyId)).toBe(100);
  });

  it('refuses a conversion into the same currency', async () => {
    await fundTreasury(dirtyId, '500');
    const res = await api().post(laundering()).set('Cookie', w.admin.cookie)
      .send({ fromItemTypeId: dirtyId, amountIn: '100', toItemTypeId: dirtyId, amountOut: '90' });
    expect(res.status).toBe(400);
    expect(res.body.error.message).toMatch(/different currencies/i);
  });

  it('refuses goods on either side', async () => {
    const goodsId = await createItemType(w.faction.id, 'Ammunition', { unit: 'pcs', isCurrency: false });
    await fundTreasury(goodsId, '50');

    const res = await api().post(laundering()).set('Cookie', w.admin.cookie)
      .send({ fromItemTypeId: goodsId, amountIn: '50', toItemTypeId: cleanId, amountOut: '500' });

    expect(res.status).toBe(400);
    expect(res.body.error.message).toMatch(/currency/i);
  });

  it('rejects a zero or negative amount on either side', async () => {
    await fundTreasury(dirtyId, '500');
    for (const body of [
      { fromItemTypeId: dirtyId, amountIn: '0', toItemTypeId: cleanId, amountOut: '100' },
      { fromItemTypeId: dirtyId, amountIn: '100', toItemTypeId: cleanId, amountOut: '-5' },
    ]) {
      const res = await api().post(laundering()).set('Cookie', w.admin.cookie).send(body);
      expect(res.status).toBe(400);
    }
  });

  it('lists the currencies with what the vault holds of each', async () => {
    await fundTreasury(dirtyId, '2500');
    await createItemType(w.faction.id, 'Ammunition', { unit: 'pcs', isCurrency: false });

    const res = await api().get(laundering()).set('Cookie', w.admin.cookie);

    expect(res.status).toBe(200);
    const names = res.body.data.currencies.map((c: { itemTypeName: string }) => c.itemTypeName);
    expect(names).toContain('Dirty Money');
    expect(names).not.toContain('Ammunition');
    const dirty = res.body.data.currencies.find(
      (c: { itemTypeId: string }) => c.itemTypeId === dirtyId,
    );
    expect(dirty.balance).toBe(2500);
  });

  it('records the conversion in the audit log', async () => {
    await fundTreasury(dirtyId, '1000');
    await api().post(laundering()).set('Cookie', w.admin.cookie)
      .send({ fromItemTypeId: dirtyId, amountIn: '1000', toItemTypeId: cleanId, amountOut: '650' });

    const logs = await api()
      .get(`${f()}/audit-logs?entity_type=laundering`)
      .set('Cookie', w.admin.cookie);

    expect(logs.status).toBe(200);
    expect(logs.body.data).toHaveLength(1);
    expect(logs.body.data[0].details).toMatchObject({ amountIn: '1000', amountOut: '650' });
  });
});
