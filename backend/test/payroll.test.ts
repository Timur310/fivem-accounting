import { describe, it, expect, beforeEach } from 'vitest';
import { eq } from 'drizzle-orm';
import { api, resetDatabase, seedBasicWorld, createItemType, type BasicWorld } from './helpers.js';
import { db } from '../src/db/index.js';
import { payouts, shifts } from '../src/db/schema.js';
import { computePayroll, payFor, rateFor } from '../src/lib/payroll.js';

describe('the arithmetic', () => {
  const rates = [
    { position: 'Cook', itemTypeId: 'cash', hourlyRate: '150.00' },
    { position: null, itemTypeId: 'cash', hourlyRate: '100.00' },
  ];

  it('matches a position ignoring case and spaces', () => {
    expect(rateFor(' cook ', rates)?.hourlyRate).toBe('150.00');
    expect(rateFor('COOK', rates)?.hourlyRate).toBe('150.00');
  });

  it('falls back to the default rate', () => {
    expect(rateFor('Waiter', rates)?.hourlyRate).toBe('100.00');
    expect(rateFor(null, rates)?.hourlyRate).toBe('100.00');
  });

  it('has nothing to offer without a default', () => {
    expect(rateFor('Waiter', [rates[0]!])).toBeNull();
  });

  it('prices minutes exactly, rounding half a cent up', () => {
    expect(payFor(60, '150.00')).toBe(15000n);
    expect(payFor(90, '100.00')).toBe(15000n);
    // 1 minute at 1.00/hour is 1.666… cents: 2 cents.
    expect(payFor(1, '1.00')).toBe(2n);
  });

  // Two positions at two rates are each paid at their own.
  it('prices each shift on its own and adds the cents', () => {
    const payroll = computePayroll([
      { id: 'a', userId: 'u', position: 'Cook', workedMinutes: 60 },
      { id: 'b', userId: 'u', position: 'Waiter', workedMinutes: 60 },
    ], rates);
    expect(payroll.lines).toHaveLength(1);
    expect(payroll.lines[0]!.amount).toBe('250.00');
    expect(payroll.lines[0]!.minutes).toBe(120);
    expect(payroll.lines[0]!.shiftIds).toEqual(['a', 'b']);
  });

  it('keeps unrated work visible rather than dropping it', () => {
    const payroll = computePayroll([{ id: 'a', userId: 'u', position: 'Driver', workedMinutes: 45 }], [rates[0]!]);
    expect(payroll.lines).toHaveLength(0);
    expect(payroll.unrated).toEqual([{ userId: 'u', minutes: 45, shiftIds: ['a'] }]);
  });
});

describe('payroll through the API', () => {
  let w: BasicWorld;
  let cash: string;
  const f = () => `/api/v1/factions/${w.faction.id}`;
  const base = () => `${f()}/shifts`;
  const hoursAgo = (h: number) => new Date(Date.now() - h * 3_600_000).toISOString();
  const window = () => ({ from: hoursAgo(48), to: new Date(Date.now() + 60_000).toISOString() });

  beforeEach(async () => {
    await resetDatabase();
    w = await seedBasicWorld();
    cash = await createItemType(w.faction.id, 'Dollars', { unit: '$', isCurrency: true });
  });

  async function shiftFor(userId: string, hours: number, position = 'Cook', kind = 'faction') {
    const res = await api().post(base()).set('Cookie', w.admin.cookie).send({
      userId, position, kind, startedAt: hoursAgo(hours + 1), endedAt: hoursAgo(1),
    });
    expect(res.status).toBe(201);
    return res.body.data.id as string;
  }

  async function setRates(rates: unknown[]) {
    return api().put(`${base()}/rates`).set('Cookie', w.admin.cookie).send({ rates });
  }

  it('saves and reads back a rate table', async () => {
    expect((await setRates([
      { position: 'Cook', itemTypeId: cash, hourlyRate: '150' },
      { position: null, itemTypeId: cash, hourlyRate: '100' },
    ])).status).toBe(200);
    const res = await api().get(`${base()}/rates`).set('Cookie', w.admin.cookie);
    expect(res.body.data.rates).toHaveLength(2);
  });

  it('refuses two rates for one position, told apart only by case', async () => {
    const res = await setRates([
      { position: 'Cook', itemTypeId: cash, hourlyRate: '150' },
      { position: 'cook', itemTypeId: cash, hourlyRate: '120' },
    ]);
    expect(res.status).toBe(400);
  });

  it('refuses wages paid in something that is not money', async () => {
    const gold = await createItemType(w.faction.id, 'Gold bar', { unit: 'x', isCurrency: false });
    const res = await setRates([{ position: null, itemTypeId: gold, hourlyRate: '10' }]);
    expect(res.status).toBe(400);
    expect(res.body.error.message).toMatch(/currencies/);
  });

  it('works out what is owed, per member', async () => {
    await setRates([{ position: 'Cook', itemTypeId: cash, hourlyRate: '150' }]);
    await shiftFor(w.member.id, 2);
    await shiftFor(w.member.id, 1, 'Driver');

    const { from, to } = window();
    const res = await api().get(`${base()}/payroll?from=${from}&to=${to}`).set('Cookie', w.admin.cookie);
    expect(res.status).toBe(200);
    expect(res.body.data.lines).toHaveLength(1);
    expect(res.body.data.lines[0].amount).toBe('300.00');
    // The Driver hour has no rate and no default: shown, not paid.
    expect(res.body.data.unrated[0].minutes).toBe(60);
  });

  it('never pays a side job', async () => {
    await setRates([{ position: null, itemTypeId: cash, hourlyRate: '100' }]);
    await shiftFor(w.member.id, 2, 'Taxi', 'side');
    const { from, to } = window();
    const res = await api().get(`${base()}/payroll?from=${from}&to=${to}`).set('Cookie', w.admin.cookie);
    expect(res.body.data.lines).toHaveLength(0);
  });

  it('pays once, and marks the shifts paid', async () => {
    await setRates([{ position: null, itemTypeId: cash, hourlyRate: '100' }]);
    const id = await shiftFor(w.member.id, 3);

    const first = await api().post(`${base()}/payroll`).set('Cookie', w.admin.cookie).send(window());
    expect(first.status).toBe(201);
    expect(first.body.data.created).toBe(1);
    // An admin may settle payouts, so this one is paid rather than requested.
    expect(first.body.data.status).toBe('completed');
    expect(first.body.data.payouts[0].amount).toBe('300.00');

    const [row] = await db.select().from(shifts).where(eq(shifts.id, id));
    expect(row!.payoutId).toBe(first.body.data.payouts[0].id);

    const again = await api().post(`${base()}/payroll`).set('Cookie', w.admin.cookie).send(window());
    expect(again.body.data.created).toBe(0);
  });

  // The times on a paid shift are what it was paid for.
  it('refuses to change or remove a paid shift', async () => {
    await setRates([{ position: null, itemTypeId: cash, hourlyRate: '100' }]);
    const id = await shiftFor(w.member.id, 3);
    await api().post(`${base()}/payroll`).set('Cookie', w.admin.cookie).send(window());

    const patched = await api().patch(`${base()}/${id}`).set('Cookie', w.admin.cookie).send({ breakMinutes: 30 });
    expect(patched.status).toBe(409);
    const removed = await api().delete(`${base()}/${id}`).set('Cookie', w.admin.cookie);
    expect(removed.status).toBe(409);
    // A note is not pay, and can still be added.
    const noted = await api().patch(`${base()}/${id}`).set('Cookie', w.admin.cookie).send({ notes: 'Covered for Sam' });
    expect(noted.status).toBe(200);
  });

  // A deleted wage payout paid for nothing; the next payroll must find the
  // shift again rather than lose it.
  it('frees the shifts when the payout is deleted', async () => {
    await setRates([{ position: null, itemTypeId: cash, hourlyRate: '100' }]);
    const id = await shiftFor(w.member.id, 2);
    const paid = await api().post(`${base()}/payroll`).set('Cookie', w.admin.cookie).send(window());
    const payoutId = paid.body.data.payouts[0].id as string;

    const deleted = await api().delete(`${f()}/payouts/${payoutId}`).set('Cookie', w.admin.cookie);
    expect(deleted.status).toBe(200);

    const [row] = await db.select().from(shifts).where(eq(shifts.id, id));
    expect(row!.payoutId).toBeNull();
    const again = await api().post(`${base()}/payroll`).set('Cookie', w.admin.cookie).send(window());
    expect(again.body.data.created).toBe(1);
  });

  it('needs manage_shifts', async () => {
    const res = await api().get(`${base()}/rates`).set('Cookie', w.member.cookie);
    expect(res.status).toBe(403);
  });

  it('writes the payout the payouts screen already knows how to show', async () => {
    await setRates([{ position: null, itemTypeId: cash, hourlyRate: '100' }]);
    await shiftFor(w.member.id, 2);
    await api().post(`${base()}/payroll`).set('Cookie', w.admin.cookie).send(window());
    const [payout] = await db.select().from(payouts);
    expect(payout!.recipientUserId).toBe(w.member.id);
    expect(payout!.description).toMatch(/Wages: 2h 0m over 1 shift/);
  });
});
