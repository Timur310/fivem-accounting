import { describe, it, expect, beforeEach } from 'vitest';
import { db } from '../src/db/index.js';
import { entries, payouts, users } from '../src/db/schema.js';
import { eq } from 'drizzle-orm';
import {
  api, createItemType, resetDatabase, seedBasicWorld, type BasicWorld,
} from './helpers.js';

let w: BasicWorld;
let pistolId: string;
let ammoId: string;

const f = () => `/api/v1/factions/${w.faction.id}`;
const base = () => `${f()}/pricing`;

beforeEach(async () => {
  await resetDatabase();
  w = await seedBasicWorld();
  pistolId = await createItemType(w.faction.id, 'Pistol', { unit: 'pcs' });
  ammoId = await createItemType(w.faction.id, 'Ammo', { unit: 'box' });
});

/** Define a rank with these permissions and put the plain member on it. */
async function giveMemberRank(permissions: string[], name = 'Seller') {
  const ranks = await api().patch(`${f()}/settings`).set('Cookie', w.admin.cookie)
    .send({ ranks: [{ name, level: 1, permissions }] });
  expect(ranks.status).toBe(200);
  const assigned = await api().patch(`${f()}/members/${w.member.id}`)
    .set('Cookie', w.admin.cookie).send({ rank: name });
  expect(assigned.status).toBe(200);
}

async function balanceOf(itemTypeId: string): Promise<number> {
  const res = await api().get(`${f()}/treasury`).set('Cookie', w.admin.cookie);
  expect(res.status).toBe(200);
  const row = res.body.data.balances.find(
    (b: { itemTypeId: string }) => b.itemTypeId === itemTypeId,
  );
  return Number(row?.balance ?? 0);
}

/** Put stock or money into the vault the ordinary way. */
async function fund(itemTypeId: string, amount: string) {
  const res = await api().post(`${f()}/entries`).set('Cookie', w.member.cookie)
    .send({ itemTypeId, amount });
  expect(res.status).toBe(201);
}

async function priceIt(itemTypeId: string, unitPrice: string, extra: Record<string, unknown> = {}) {
  const res = await api().post(`${base()}/prices`).set('Cookie', w.admin.cookie).send({
    itemTypeId, unitPrice, currencyItemTypeId: w.itemTypeId, ...extra,
  });
  expect(res.status).toBe(201);
  return res.body.data.id as string;
}

async function sell(
  lines: { itemTypeId: string; quantity: string; addonIds?: string[] }[],
  extra: Record<string, unknown> = {},
  cookie = w.admin.cookie,
) {
  return api().post(`${base()}/sales`).set('Cookie', cookie).send({ lines, ...extra });
}

async function movementsOf(saleId: string) {
  const res = await api().get(`${base()}/sales`).set('Cookie', w.admin.cookie);
  expect(res.status).toBe(200);
  return res.body.data.sales.find((s: { id: string }) => s.id === saleId);
}

/**
 * Booking a sale.
 *
 * A sale writes ordinary ledger rows — the payment as an entry, each item as a
 * completed payout — so every balance, report and export in the app counts it
 * without knowing sales exist.
 */
describe('POST /pricing/sales', () => {
  beforeEach(async () => {
    await priceIt(pistolId, '1000.00');
    await fund(pistolId, '10');
  });

  it('moves the treasury: money in, goods out', async () => {
    const res = await sell([{ itemTypeId: pistolId, quantity: '2' }]);
    expect(res.status).toBe(201);
    expect(res.body.data.quote.total).toBe('2000.00');

    expect(await balanceOf(pistolId)).toBe(8);
    expect(await balanceOf(w.itemTypeId)).toBe(2000);
  });

  it('applies the partner discount to what is actually booked', async () => {
    const partner = await api().post(`${base()}/counterparties`).set('Cookie', w.admin.cookie)
      .send({ name: 'Vagos', discountPercent: '15.00' });
    expect(partner.status).toBe(201);

    const res = await sell(
      [{ itemTypeId: pistolId, quantity: '1' }],
      { counterpartyId: partner.body.data.id },
    );
    expect(res.status).toBe(201);
    expect(await balanceOf(w.itemTypeId)).toBe(850);
  });

  // The browser may display a total. It may not decide one, or a seller with
  // devtools could book any figure they liked.
  it('ignores a total sent by the client and recomputes from the list', async () => {
    const res = await sell([{ itemTypeId: pistolId, quantity: '1' }], {
      total: '1.00', subtotal: '1.00', discountTotal: '0.00',
    });
    expect(res.status).toBe(201);
    expect(await balanceOf(w.itemTypeId)).toBe(1000);
  });

  it('books the payment against nobody by default', async () => {
    const res = await sell([{ itemTypeId: pistolId, quantity: '1' }]);
    const [entry] = await db.select().from(entries)
      .where(eq(entries.amount, '1000.00')).limit(1);
    const [owner] = await db.select().from(users).where(eq(users.id, entry!.userId)).limit(1);
    expect(owner!.isSystem).toBe(true);
    expect(res.status).toBe(201);
  });

  it('credits the seller when the sale says so', async () => {
    await sell([{ itemTypeId: pistolId, quantity: '1' }], { creditSaleTo: 'seller' });
    const [entry] = await db.select().from(entries)
      .where(eq(entries.amount, '1000.00')).limit(1);
    expect(entry!.userId).toBe(w.admin.id);
  });

  it('hands over a stocked add-on as well as the product', async () => {
    const priceId = await priceIt(ammoId, '50.00');
    // The add-on is itself stock: selling a pistol with it takes both out.
    const withAmmo = await api().post(`${base()}/prices/${priceId}/addons`)
      .set('Cookie', w.admin.cookie)
      .send({ name: 'Extra box', price: '50.00', itemTypeId: ammoId });
    expect(withAmmo.status).toBe(201);
    await fund(ammoId, '5');

    const res = await sell([
      { itemTypeId: ammoId, quantity: '1', addonIds: [withAmmo.body.data.id] },
    ]);
    expect(res.status).toBe(201);
    // One box sold, one box handed over as the add-on.
    expect(await balanceOf(ammoId)).toBe(3);
    expect(await balanceOf(w.itemTypeId)).toBe(100);
  });

  // Selling from a personal stash before the treasury catches up is ordinary,
  // and a till that refuses in front of the buyer is worse than one that says
  // the books are behind.
  it('records a sale the vault cannot cover, and says the books are behind', async () => {
    const res = await sell([{ itemTypeId: pistolId, quantity: '25' }]);
    expect(res.status).toBe(201);
    expect(res.body.data.shortfalls).toHaveLength(1);
    expect(res.body.data.shortfalls[0].itemTypeName).toBe('Pistol');
    expect(await balanceOf(pistolId)).toBe(-15);
  });

  it('books no entry for a sale given away entirely', async () => {
    const free = await api().post(`${base()}/counterparties`).set('Cookie', w.admin.cookie)
      .send({ name: 'Family', discountPercent: '100.00' });

    const res = await sell(
      [{ itemTypeId: pistolId, quantity: '1' }],
      { counterpartyId: free.body.data.id },
    );
    expect(res.status).toBe(201);
    expect(res.body.data.quote.total).toBe('0.00');
    // The goods still left; a zero-amount entry would read as a mistake.
    expect(await balanceOf(pistolId)).toBe(9);
    expect(await balanceOf(w.itemTypeId)).toBe(0);
  });

  it('keeps what was charged after the price list moves', async () => {
    const res = await sell([{ itemTypeId: pistolId, quantity: '1' }]);
    const saleId = res.body.data.sale.id;

    const priceRow = await api().get(base()).set('Cookie', w.admin.cookie);
    const id = priceRow.body.data.prices.find(
      (p: { itemTypeId: string }) => p.itemTypeId === pistolId,
    ).id;
    await api().patch(`${base()}/prices/${id}`).set('Cookie', w.admin.cookie)
      .send({ unitPrice: '99.00' });

    const sale = await movementsOf(saleId);
    expect(sale.total).toBe('1000.00');
    expect(sale.lines[0].unitPrice).toBe('1000.00');
  });
});

describe('sale permissions', () => {
  beforeEach(async () => {
    await priceIt(pistolId, '1000.00');
    await fund(pistolId, '10');
  });

  it('refuses to book a sale without `sell`', async () => {
    await giveMemberRank(['manage_prices']);
    const res = await sell([{ itemTypeId: pistolId, quantity: '1' }], {}, w.member.cookie);
    expect(res.status).toBe(403);
  });

  it('books one with `sell`', async () => {
    await giveMemberRank(['sell']);
    const res = await sell([{ itemTypeId: pistolId, quantity: '1' }], {}, w.member.cookie);
    expect(res.status).toBe(201);
  });

  // The till books, leadership unbooks: a revert moves money back out, which
  // is not the same authority as taking money in.
  it('refuses a revert to someone who may only sell', async () => {
    await giveMemberRank(['sell']);
    const sold = await sell([{ itemTypeId: pistolId, quantity: '1' }], {}, w.member.cookie);

    const res = await api()
      .post(`${base()}/sales/${sold.body.data.sale.id}/revert`)
      .set('Cookie', w.member.cookie);
    expect(res.status).toBe(403);
  });
});

/**
 * A sale is one act. Unpicking half of it would leave the books describing a
 * trade that never happened — money received for goods never handed over, or
 * the reverse.
 */
describe('a booked sale holds its ledger rows', () => {
  let entryId: string;
  let payoutId: string;

  beforeEach(async () => {
    await priceIt(pistolId, '1000.00');
    await fund(pistolId, '10');
    await sell([{ itemTypeId: pistolId, quantity: '1' }]);

    const [entry] = await db.select().from(entries)
      .where(eq(entries.amount, '1000.00')).limit(1);
    entryId = entry!.id;
    const [payout] = await db.select().from(payouts)
      .where(eq(payouts.itemTypeId, pistolId)).limit(1);
    payoutId = payout!.id;
  });

  it('refuses to edit the payment on its own', async () => {
    const res = await api().patch(`${f()}/entries/${entryId}`)
      .set('Cookie', w.admin.cookie).send({ amount: '5.00' });
    expect(res.status).toBe(400);
    expect(res.body.error.message).toMatch(/sale/i);
  });

  it('refuses to delete the payment on its own', async () => {
    const res = await api().delete(`${f()}/entries/${entryId}`).set('Cookie', w.admin.cookie);
    expect(res.status).toBe(400);
  });

  it('refuses to edit the goods handed over', async () => {
    const res = await api().patch(`${f()}/payouts/${payoutId}`)
      .set('Cookie', w.admin.cookie).send({ amount: '5.00' });
    expect(res.status).toBe(400);
    expect(res.body.error.message).toMatch(/sale/i);
  });

  it('refuses a bulk delete that includes one of its entries', async () => {
    const res = await api().post(`${f()}/bulk/entries/bulk-delete`)
      .set('Cookie', w.admin.cookie).send({ ids: [entryId] });
    expect(res.status).toBe(400);
  });
});

describe('POST /pricing/sales/:id/revert', () => {
  let saleId: string;

  beforeEach(async () => {
    await priceIt(pistolId, '1000.00');
    await fund(pistolId, '10');
    const res = await sell([{ itemTypeId: pistolId, quantity: '2' }]);
    saleId = res.body.data.sale.id;
  });

  it('puts the goods back and takes the payment out', async () => {
    const res = await api().post(`${base()}/sales/${saleId}/revert`).set('Cookie', w.admin.cookie);
    expect(res.status).toBe(200);
    expect(await balanceOf(pistolId)).toBe(10);
    expect(await balanceOf(w.itemTypeId)).toBe(0);
  });

  it('refuses to revert twice', async () => {
    await api().post(`${base()}/sales/${saleId}/revert`).set('Cookie', w.admin.cookie);
    const again = await api().post(`${base()}/sales/${saleId}/revert`).set('Cookie', w.admin.cookie);
    expect(again.status).toBe(400);
  });

  // Undoing a sale whose money is already spent would drive the balance below
  // zero — a real state, but never one to enter by accident on a correction.
  it('refuses when the money has already been spent', async () => {
    const spend = await api().post(`${f()}/expenses`).set('Cookie', w.admin.cookie)
      .send({ itemTypeId: w.itemTypeId, amount: '1500.00', category: 'other', description: 'rent' });
    expect(spend.status).toBe(201);

    const res = await api().post(`${base()}/sales/${saleId}/revert`).set('Cookie', w.admin.cookie);
    expect(res.status).toBe(400);
    expect(res.body.error.message).toMatch(/treasury holds/i);
  });

  it('releases the ledger rows it was holding', async () => {
    await api().post(`${base()}/sales/${saleId}/revert`).set('Cookie', w.admin.cookie);
    const sale = await movementsOf(saleId);
    expect(sale.revertedAt).not.toBeNull();
  });

  it('404s on a sale from another faction', async () => {
    const res = await api()
      .post(`/api/v1/factions/${w.faction.id}/pricing/sales/${'0'.repeat(8)}-0000-0000-0000-000000000000/revert`)
      .set('Cookie', w.admin.cookie);
    expect(res.status).toBe(404);
  });
});
