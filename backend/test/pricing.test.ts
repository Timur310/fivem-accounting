import { describe, it, expect, beforeEach } from 'vitest';
import {
  api, resetDatabase, seedBasicWorld, createFaction, createItemType,
  type BasicWorld,
} from './helpers.js';

let w: BasicWorld;
/** A second currency, for the mixed-currency refusal. */
let dirtyId: string;
let pistolId: string;
let ammoId: string;

const f = () => `/api/v1/factions/${w.faction.id}`;
const base = () => `${f()}/pricing`;

beforeEach(async () => {
  await resetDatabase();
  w = await seedBasicWorld();
  dirtyId = await createItemType(w.faction.id, 'Dirty money', { isCurrency: true });
  pistolId = await createItemType(w.faction.id, 'Pistol', { unit: 'pcs' });
  ammoId = await createItemType(w.faction.id, 'Ammo', { unit: 'box' });
});

/** Give the plain member a rank carrying `manage_prices`. */
async function grantPricesToMember() {
  const ranks = await api().patch(`${f()}/settings`).set('Cookie', w.admin.cookie).send({
    ranks: [
      { name: 'Boss', level: 1, permissions: ['manage_prices'] },
      { name: 'Seller', level: 3, permissions: ['manage_prices'] },
    ],
  });
  expect(ranks.status).toBe(200);
  const assign = await api()
    .patch(`${f()}/members/${w.member.id}`)
    .set('Cookie', w.admin.cookie)
    .send({ rank: 'Seller' });
  expect(assign.status).toBe(200);
}

async function price(
  itemTypeId: string,
  unitPrice: string,
  extra: Record<string, unknown> = {},
  cookie = w.admin.cookie,
) {
  const res = await api().post(`${base()}/prices`).set('Cookie', cookie).send({
    itemTypeId,
    unitPrice,
    currencyItemTypeId: w.itemTypeId,
    ...extra,
  });
  return res;
}

async function quote(
  lines: { itemTypeId: string; quantity: string; addonIds?: string[] }[],
  counterpartyId?: string,
  cookie = w.member.cookie,
) {
  return api()
    .post(`${base()}/quote`)
    .set('Cookie', cookie)
    .send({ lines, ...(counterpartyId ? { counterpartyId } : {}) });
}

async function party(name: string, discountPercent: string) {
  const res = await api()
    .post(`${base()}/counterparties`)
    .set('Cookie', w.admin.cookie)
    .send({ name, discountPercent });
  expect(res.status).toBe(201);
  return res.body.data.id as string;
}

async function rung(minQuantity: string, discountPercent: string, itemTypeId: string | null = null) {
  const res = await api()
    .post(`${base()}/breaks`)
    .set('Cookie', w.admin.cookie)
    .send({ minQuantity, discountPercent, itemTypeId });
  expect(res.status).toBe(201);
  return res.body.data.id as string;
}

/**
 * Who may read the list and who may write it.
 *
 * The split is the point: the people standing at the counter hold the fewest
 * permissions, and a price list they cannot read is a price list they cannot
 * sell from.
 */
describe('pricing authorization', () => {
  it('lets any member read the book', async () => {
    const res = await api().get(base()).set('Cookie', w.member.cookie);
    expect(res.status).toBe(200);
    expect(res.body.data).toHaveProperty('prices');
    expect(res.body.data).toHaveProperty('parties');
    expect(res.body.data).toHaveProperty('breaks');
  });

  it('lets any member build a quote', async () => {
    expect((await price(pistolId, '1000.00')).status).toBe(201);
    const res = await quote([{ itemTypeId: pistolId, quantity: '1' }]);
    expect(res.status).toBe(200);
  });

  it('refuses a price change without manage_prices', async () => {
    const res = await price(pistolId, '1000.00', {}, w.member.cookie);
    expect(res.status).toBe(403);
  });

  it('allows it once the rank carries manage_prices', async () => {
    await grantPricesToMember();
    const res = await price(pistolId, '1000.00', {}, w.member.cookie);
    expect(res.status).toBe(201);
  });

  it('shuts an outsider out entirely', async () => {
    const res = await api().get(base()).set('Cookie', w.outsider.cookie);
    expect(res.status).toBe(403);
  });
});

describe('the price list', () => {
  it('refuses a second price for the same item', async () => {
    expect((await price(pistolId, '1000.00')).status).toBe(201);
    const again = await price(pistolId, '900.00');
    expect(again.status).toBe(409);
  });

  // Without this check a faction could price an item it cannot see, and the
  // list would name something nobody in it can sell.
  it('refuses an item type from another faction', async () => {
    const other = await createFaction('Other Faction', w.superadmin.id);
    const theirs = await createItemType(other.id, 'Their thing');
    const res = await price(theirs, '10.00');
    expect(res.status).toBe(404);
  });

  it('keeps the old figure in the audit log when a price changes', async () => {
    const created = await price(pistolId, '1000.00');
    const patched = await api()
      .patch(`${base()}/prices/${created.body.data.id}`)
      .set('Cookie', w.admin.cookie)
      .send({ unitPrice: '750.00' });
    expect(patched.status).toBe(200);

    const log = await api().get(`${f()}/audit-logs`).set('Cookie', w.admin.cookie);
    const row = (log.body.data.logs ?? log.body.data).find(
      (l: { entityType: string; action: string }) =>
        l.entityType === 'product_price' && l.action === 'update',
    );
    expect(row.details).toMatchObject({ from: '1000.00', to: '750.00' });
  });
});

/**
 * The arithmetic. Every figure here is checked against a number worked out by
 * hand, because "it returns a number" is not the assertion that matters — a
 * calculator that is confidently wrong is worse than no calculator.
 */
describe('quoting', () => {
  it('multiplies price by quantity', async () => {
    await price(pistolId, '1000.00');
    const res = await quote([{ itemTypeId: pistolId, quantity: '2' }]);
    expect(res.status).toBe(200);
    expect(res.body.data.total).toBe('2000.00');
    expect(res.body.data.subtotal).toBe('2000.00');
    expect(res.body.data.discountTotal).toBe('0.00');
  });

  it('adds the add-ons to the unit price', async () => {
    const created = await price(pistolId, '1000.00');
    const addon = await api()
      .post(`${base()}/prices/${created.body.data.id}/addons`)
      .set('Cookie', w.admin.cookie)
      .send({ name: 'Suppressor', price: '250.00' });
    expect(addon.status).toBe(201);

    const res = await quote([
      { itemTypeId: pistolId, quantity: '2', addonIds: [addon.body.data.id] },
    ]);
    expect(res.body.data.lines[0].unitTotal).toBe('1250.00');
    expect(res.body.data.total).toBe('2500.00');
  });

  it('refuses an add-on belonging to a different product', async () => {
    const pistol = await price(pistolId, '1000.00');
    await price(ammoId, '50.00');
    const addon = await api()
      .post(`${base()}/prices/${pistol.body.data.id}/addons`)
      .set('Cookie', w.admin.cookie)
      .send({ name: 'Suppressor', price: '250.00' });

    const res = await quote([
      { itemTypeId: ammoId, quantity: '1', addonIds: [addon.body.data.id] },
    ]);
    expect(res.status).toBe(400);
  });

  // The reporter asked for one "alliance mode". This is what it became: the
  // discount is the buyer's, and picking the buyer applies it everywhere.
  it('applies the buyer discount', async () => {
    await price(pistolId, '1000.00');
    const vagos = await party('Vagos', '15.00');

    const res = await quote([{ itemTypeId: pistolId, quantity: '1' }], vagos);
    expect(res.body.data.counterparty.name).toBe('Vagos');
    expect(res.body.data.discountTotal).toBe('150.00');
    expect(res.body.data.total).toBe('850.00');
  });

  it('adds the bulk discount to the buyer discount rather than compounding it', async () => {
    await price(pistolId, '100.00');
    const vagos = await party('Vagos', '15.00');
    await rung('5', '10.00');

    const res = await quote([{ itemTypeId: pistolId, quantity: '5' }], vagos);
    const line = res.body.data.lines[0];
    expect(line.counterpartyPercent).toBe('15.00');
    expect(line.quantityBreakPercent).toBe('10.00');
    expect(line.discountPercent).toBe('25.00');
    // 500 gross, 25% off. Compounding would have given 382.50.
    expect(res.body.data.discountTotal).toBe('125.00');
    expect(res.body.data.total).toBe('375.00');
  });

  it('caps the combined discount at 100%, never below zero', async () => {
    await price(pistolId, '100.00');
    const generous = await party('Family', '60.00');
    await rung('1', '50.00');

    const res = await quote([{ itemTypeId: pistolId, quantity: '1' }], generous);
    expect(res.body.data.lines[0].discountPercent).toBe('100.00');
    expect(res.body.data.total).toBe('0.00');
  });

  // An item with rungs of its own ignores the faction-wide ladder. Merging
  // them would produce a price nobody could derive from the screen.
  it('lets an item ladder replace the faction ladder rather than stack with it', async () => {
    await price(pistolId, '100.00');
    await rung('2', '50.00');            // faction-wide
    await rung('10', '5.00', pistolId);  // this item only

    const res = await quote([{ itemTypeId: pistolId, quantity: '2' }]);
    // The faction rung would have taken 50% off. The item has its own ladder,
    // and two is not enough to reach its first rung.
    expect(res.body.data.lines[0].quantityBreakPercent).toBe('0.00');
    expect(res.body.data.total).toBe('200.00');
  });

  it('rounds halves up, once per line', async () => {
    await price(pistolId, '33.33');
    const p = await party('Ally', '15.00');

    const res = await quote([{ itemTypeId: pistolId, quantity: '3' }], p);
    const line = res.body.data.lines[0];
    // 99.99 gross; 15% of it is 14.9985, which rounds to 15.00 rather than
    // truncating to 14.99 in the faction's favour.
    expect(line.gross).toBe('99.99');
    expect(line.discount).toBe('15.00');
    expect(line.total).toBe('84.99');
  });

  it('keeps subtotal minus discount equal to the total', async () => {
    await price(pistolId, '33.33');
    await price(ammoId, '7.77');
    const p = await party('Ally', '17.50');

    const res = await quote([
      { itemTypeId: pistolId, quantity: '3' },
      { itemTypeId: ammoId, quantity: '11' },
    ], p);

    const d = res.body.data;
    const cents = (v: string) => Math.round(Number(v) * 100);
    expect(cents(d.subtotal) - cents(d.discountTotal)).toBe(cents(d.total));
    expect(d.lines.reduce((sum: number, l: { total: string }) => sum + cents(l.total), 0))
      .toBe(cents(d.total));
  });

  it('prices a fractional quantity', async () => {
    await price(ammoId, '10.00');
    const res = await quote([{ itemTypeId: ammoId, quantity: '2.5' }]);
    expect(res.body.data.total).toBe('25.00');
  });

  it('flags a line that falls below its floor', async () => {
    await price(pistolId, '100.00', { floorPrice: '90.00' });
    const p = await party('Ally', '15.00');

    const res = await quote([{ itemTypeId: pistolId, quantity: '1' }], p);
    expect(res.body.data.lines[0].belowFloor).toBe(true);
    expect(res.body.data.belowFloor).toBe(true);
  });

  it('does not flag a line that stays above its floor', async () => {
    await price(pistolId, '100.00', { floorPrice: '80.00' });
    const p = await party('Ally', '15.00');

    const res = await quote([{ itemTypeId: pistolId, quantity: '1' }], p);
    expect(res.body.data.belowFloor).toBe(false);
  });

  // A made-up exchange rate is worse than a refusal the seller can act on.
  it('refuses to mix currencies in one quote', async () => {
    await price(pistolId, '1000.00');
    await price(ammoId, '50.00', { currencyItemTypeId: dirtyId });

    const res = await quote([
      { itemTypeId: pistolId, quantity: '1' },
      { itemTypeId: ammoId, quantity: '1' },
    ]);
    expect(res.status).toBe(400);
    expect(res.body.error.message).toMatch(/different currencies/i);
  });

  it('refuses an item with no price', async () => {
    const res = await quote([{ itemTypeId: pistolId, quantity: '1' }]);
    expect(res.status).toBe(404);
  });

  it('refuses an item whose price is retired', async () => {
    await price(pistolId, '1000.00', { isActive: false });
    const res = await quote([{ itemTypeId: pistolId, quantity: '1' }]);
    expect(res.status).toBe(404);
  });

  it('refuses a quantity of zero', async () => {
    await price(pistolId, '1000.00');
    const res = await quote([{ itemTypeId: pistolId, quantity: '0' }]);
    expect(res.status).toBe(400);
  });

  it('ignores a deactivated buyer rather than applying their discount', async () => {
    await price(pistolId, '1000.00');
    const p = await party('Vagos', '15.00');
    await api()
      .patch(`${base()}/counterparties/${p}`)
      .set('Cookie', w.admin.cookie)
      .send({ isActive: false });

    const res = await quote([{ itemTypeId: pistolId, quantity: '1' }], p);
    expect(res.body.data.counterparty).toBeNull();
    expect(res.body.data.total).toBe('1000.00');
  });
});

/**
 * Postgres treats NULLs as distinct, so one unique index over the nullable
 * item column would have accepted two faction-wide rungs at the same
 * quantity — two different answers to the same question.
 */
describe('quantity break rungs', () => {
  it('refuses a second faction-wide rung at the same quantity', async () => {
    await rung('5', '10.00');
    const again = await api()
      .post(`${base()}/breaks`)
      .set('Cookie', w.admin.cookie)
      .send({ minQuantity: '5', discountPercent: '20.00', itemTypeId: null });
    expect(again.status).toBe(409);
  });

  it('allows the same quantity on a different item', async () => {
    await rung('5', '10.00');
    const own = await api()
      .post(`${base()}/breaks`)
      .set('Cookie', w.admin.cookie)
      .send({ minQuantity: '5', discountPercent: '20.00', itemTypeId: pistolId });
    expect(own.status).toBe(201);
  });
});
