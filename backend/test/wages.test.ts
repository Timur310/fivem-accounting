import { describe, it, expect, beforeEach } from 'vitest';
import { eq } from 'drizzle-orm';
import { api, resetDatabase, seedBasicWorld, createItemType, createEntry, type BasicWorld } from './helpers.js';
import { db } from '../src/db/index.js';
import { entries } from '../src/db/schema.js';
import { basisPoints, computeTakings, percentFor, shareOf } from '../src/lib/commission.js';

describe('the arithmetic', () => {
  const rates = [
    { rank: 'Soldier', itemTypeId: 'dirty', percent: '30.00' },
    { rank: null, itemTypeId: 'dirty', percent: '20.00' },
    { rank: null, itemTypeId: 'cash', percent: '10.00' },
  ];

  it('prefers the member\'s own rank, ignoring case', () => {
    expect(percentFor('soldier ', 'dirty', rates)).toBe('30.00');
  });

  it('falls back to everyone else, then to nothing', () => {
    expect(percentFor('Boss', 'dirty', rates)).toBe('20.00');
    expect(percentFor(null, 'cash', rates)).toBe('10.00');
    expect(percentFor('Soldier', 'guns', rates)).toBeNull();
  });

  it('reads percentages exactly', () => {
    expect(basisPoints('12.5')).toBe(1250n);
    expect(basisPoints('100')).toBe(10000n);
    expect(basisPoints('0.05')).toBe(5n);
  });

  it('rounds money to the cent, half up', () => {
    expect(shareOf('1000.00', '30', true)).toBe(30000n);
    // 0.05 at 10% is half a cent: one cent.
    expect(shareOf('0.05', '10', true)).toBe(1n);
  });

  // Nobody is paid half a pistol.
  it('rounds counted goods down to whole ones', () => {
    expect(shareOf('7', '50', false)).toBe(300n);
  });

  it('adds up per member per item, and leaves out non-members', () => {
    const rankOf = new Map<string, string | null>([['u', 'Soldier']]);
    const lines = computeTakings([
      { id: 'a', userId: 'u', itemTypeId: 'dirty', amount: '100.00' },
      { id: 'b', userId: 'u', itemTypeId: 'dirty', amount: '50.50' },
      { id: 'c', userId: 'gone', itemTypeId: 'dirty', amount: '999.00' },
    ], rankOf, rates);
    expect(lines).toEqual([{
      userId: 'u', itemTypeId: 'dirty', brought: '150.50', ratePercent: '30.00', entryIds: ['a', 'b'],
    }]);
  });
});

describe('wages through the API', () => {
  let w: BasicWorld;
  let dirty: string;
  const f = () => `/api/v1/factions/${w.faction.id}`;
  const base = () => `${f()}/wages`;
  const today = new Date().toISOString().slice(0, 10);
  const window = `from=${today}&to=${today}`;

  beforeEach(async () => {
    await resetDatabase();
    w = await seedBasicWorld();
    dirty = await createItemType(w.faction.id, 'Dirty money', { isCurrency: false, unit: '$' });
    const ranks = await api().patch(`${f()}/settings`).set('Cookie', w.admin.cookie)
      .send({ ranks: [{ name: 'Soldier', level: 2, permissions: [] }, { name: 'Boss', level: 1, permissions: [] }] });
    expect(ranks.status).toBe(200);
    const assigned = await api().patch(`${f()}/members/${w.member.id}`)
      .set('Cookie', w.admin.cookie).send({ rank: 'Soldier' });
    expect(assigned.status).toBe(200);
  });

  const setRates = (rates: unknown[]) =>
    api().put(`${base()}/rates`).set('Cookie', w.admin.cookie).send({ rates });

  const look = () => api().get(`${base()}?${window}`).set('Cookie', w.admin.cookie);

  it('stores a rank the way the faction spells it', async () => {
    expect((await setRates([{ rank: 'soldier', itemTypeId: dirty, percent: '30' }])).status).toBe(200);
    const res = await api().get(`${base()}/rates`).set('Cookie', w.admin.cookie);
    expect(res.body.data.rates[0].rank).toBe('Soldier');
  });

  it('refuses a rank the faction does not have', async () => {
    const res = await setRates([{ rank: 'Soldeir', itemTypeId: dirty, percent: '30' }]);
    expect(res.status).toBe(400);
  });

  it('refuses more than 100%', async () => {
    const res = await setRates([{ rank: null, itemTypeId: dirty, percent: '120' }]);
    expect(res.status).toBe(400);
  });

  it('refuses two rates for one rank and item', async () => {
    const res = await setRates([
      { rank: 'Soldier', itemTypeId: dirty, percent: '30' },
      { rank: 'SOLDIER', itemTypeId: dirty, percent: '40' },
    ]);
    expect(res.status).toBe(400);
  });

  it('shows what each member brought in, with their rate', async () => {
    await setRates([{ rank: 'Soldier', itemTypeId: dirty, percent: '30' }]);
    await createEntry(w.faction.id, w.member.id, dirty, '1000.00');
    await createEntry(w.faction.id, w.member.id, dirty, '500.00');
    await createEntry(w.faction.id, w.admin.id, w.itemTypeId, '200.00');

    const res = await look();
    expect(res.status).toBe(200);
    const mine = res.body.data.lines.find((l: { userId: string }) => l.userId === w.member.id);
    expect(mine).toMatchObject({ brought: '1500.00', ratePercent: '30.00', rank: 'Soldier', entryCount: 2 });
    const boss = res.body.data.lines.find((l: { userId: string }) => l.userId === w.admin.id);
    expect(boss.ratePercent).toBeNull();
  });

  it('pays the lines as shown, once, and holds the entries', async () => {
    const entryId = await createEntry(w.faction.id, w.member.id, dirty, '1000.00');

    const paid = await api().post(`${base()}/pay`).set('Cookie', w.admin.cookie).send({
      from: today, to: today,
      // Changed on the screen to 25%, with no rate saved at all.
      lines: [{ userId: w.member.id, itemTypeId: dirty, percent: '25', brought: '1000.00' }],
    });
    expect(paid.status).toBe(201);
    expect(paid.body.data.status).toBe('completed');
    expect(paid.body.data.payouts[0].amount).toBe('250.00');
    // Paid in what it was brought in as.
    expect(paid.body.data.payouts[0].itemTypeId).toBe(dirty);

    const [row] = await db.select().from(entries).where(eq(entries.id, entryId));
    expect(row!.commissionPayoutId).toBe(paid.body.data.payouts[0].id);
    expect((await look()).body.data.lines).toHaveLength(0);

    const edited = await api().patch(`${f()}/entries/${entryId}`).set('Cookie', w.admin.cookie).send({ amount: '5.00' });
    expect(edited.status).toBe(400);
    expect(edited.body.error.message).toMatch(/paid out as wages/);
  });

  it('refuses to pay on numbers that changed since', async () => {
    await createEntry(w.faction.id, w.member.id, dirty, '1000.00');
    await createEntry(w.faction.id, w.member.id, dirty, '1.00');
    const res = await api().post(`${base()}/pay`).set('Cookie', w.admin.cookie).send({
      from: today, to: today,
      lines: [{ userId: w.member.id, itemTypeId: dirty, percent: '25', brought: '1000.00' }],
    });
    expect(res.status).toBe(409);
  });

  it('frees the entries when the payout is rejected', async () => {
    await createEntry(w.faction.id, w.member.id, dirty, '1000.00');
    const paid = await api().post(`${base()}/pay`).set('Cookie', w.admin.cookie).send({
      from: today, to: today,
      lines: [{ userId: w.member.id, itemTypeId: dirty, percent: '10', brought: '1000.00' }],
    });
    const payoutId = paid.body.data.payouts[0].id as string;
    const deleted = await api().delete(`${f()}/payouts/${payoutId}`).set('Cookie', w.admin.cookie);
    expect(deleted.status).toBe(200);
    expect((await look()).body.data.lines).toHaveLength(1);
  });

  it('leaves a line that comes to nothing unpaid', async () => {
    await createEntry(w.faction.id, w.member.id, dirty, '1000.00');
    const res = await api().post(`${base()}/pay`).set('Cookie', w.admin.cookie).send({
      from: today, to: today,
      lines: [{ userId: w.member.id, itemTypeId: dirty, percent: '0', brought: '1000.00' }],
    });
    expect(res.body.data.created).toBe(0);
    expect((await look()).body.data.lines).toHaveLength(1);
  });

  it('needs manage_wages', async () => {
    const res = await api().get(`${base()}?${window}`).set('Cookie', w.member.cookie);
    expect(res.status).toBe(403);
  });
});
