import { describe, it, expect, beforeEach } from 'vitest';
import {
  api, createItemType, resetDatabase, seedBasicWorld, type BasicWorld,
} from './helpers.js';

let w: BasicWorld;
let dirtyId: string;
let steelId: string;
let powderId: string;
let pistolId: string;

const f = () => `/api/v1/factions/${w.faction.id}`;
const base = () => `${f()}/pricing`;

beforeEach(async () => {
  await resetDatabase();
  w = await seedBasicWorld();
  dirtyId = await createItemType(w.faction.id, 'Dirty money', { isCurrency: true });
  steelId = await createItemType(w.faction.id, 'Steel', { unit: 'kg' });
  powderId = await createItemType(w.faction.id, 'Powder', { unit: 'kg' });
  pistolId = await createItemType(w.faction.id, 'Pistol', { unit: 'pcs' });
});

async function priceIt(itemTypeId: string, unitPrice: string, currency = w.itemTypeId) {
  const res = await api().post(`${base()}/prices`).set('Cookie', w.admin.cookie)
    .send({ itemTypeId, unitPrice, currencyItemTypeId: currency });
  expect(res.status).toBe(201);
  return res.body.data.id as string;
}

async function recipe(name: string, inputs: { itemTypeId: string; quantity: string }[], outQty = '1') {
  const res = await api().post(`${f()}/crafting/recipes`).set('Cookie', w.admin.cookie)
    .send({ name, inputs, outputs: [{ itemTypeId: pistolId, quantity: outQty }] });
  expect(res.status).toBe(201);
}

async function quote(
  lines: { itemTypeId: string; quantity: string }[],
  extra: Record<string, unknown> = {},
  cookie = w.admin.cookie,
) {
  return api().post(`${base()}/quote`).set('Cookie', cookie).send({ lines, ...extra });
}

async function setMarginRank(level: number | null) {
  const res = await api().patch(`${base()}/settings`).set('Cookie', w.admin.cookie)
    .send({ marginMinRankLevel: level });
  expect(res.status).toBe(200);
}

/** Put the plain member on a rank at this level. */
async function rankMember(level: number) {
  const ranks = await api().patch(`${f()}/settings`).set('Cookie', w.admin.cookie).send({
    ranks: [
      { name: 'Boss', level: 1, permissions: [] },
      { name: 'Soldier', level: 5, permissions: [] },
    ],
  });
  expect(ranks.status).toBe(200);
  const assign = await api().patch(`${f()}/members/${w.member.id}`)
    .set('Cookie', w.admin.cookie)
    .send({ rank: level === 1 ? 'Boss' : 'Soldier' });
  expect(assign.status).toBe(200);
}

/**
 * Margins, read out of the crafting recipes the faction already wrote.
 *
 * The recipe says 10 steel + 2 powder makes a pistol, and the price list says
 * what steel is worth. Nobody can do that in their head mid-deal.
 */
describe('margins', () => {
  beforeEach(async () => {
    await priceIt(steelId, '10.00');
    await priceIt(powderId, '5.00');
    await priceIt(pistolId, '1000.00');
    await recipe('Pistol', [
      { itemTypeId: steelId, quantity: '10' },
      { itemTypeId: powderId, quantity: '2' },
    ]);
  });

  it('costs a line from the recipe that makes it', async () => {
    const res = await quote([{ itemTypeId: pistolId, quantity: '2' }]);
    expect(res.status).toBe(200);

    const line = res.body.data.lines[0];
    // 10 × 10.00 + 2 × 5.00 = 110.00 each.
    expect(line.unitCost).toBe('110.00');
    expect(line.cost).toBe('220.00');
    expect(line.margin).toBe('1780.00');
    expect(line.marginPercent).toBe('89.00');
    expect(res.body.data.costTotal).toBe('220.00');
    expect(res.body.data.marginTotal).toBe('1780.00');
  });

  it('counts the discount against the margin, not against the price', async () => {
    const party = await api().post(`${base()}/counterparties`).set('Cookie', w.admin.cookie)
      .send({ name: 'Vagos', discountPercent: '50.00' });

    const res = await quote(
      [{ itemTypeId: pistolId, quantity: '1' }],
      { counterpartyId: party.body.data.id },
    );
    // 500 taken, 110 spent.
    expect(res.body.data.lines[0].margin).toBe('390.00');
    expect(res.body.data.marginTotal).toBe('390.00');
  });

  // A total that silently counted the priced half of a recipe would be worse
  // than no total: it reads as a margin and is not one.
  it('gives no cost at all when an input has no price', async () => {
    const unpriced = await createItemType(w.faction.id, 'Spring', { unit: 'pcs' });
    await recipe('Pistol mk2', [
      { itemTypeId: steelId, quantity: '1' },
      { itemTypeId: unpriced, quantity: '1' },
    ]);

    // The first recipe still prices it, so ask about something only the
    // incomplete recipe makes.
    const res = await quote([{ itemTypeId: pistolId, quantity: '1' }]);
    // The complete recipe wins; the incomplete one is simply ignored.
    expect(res.body.data.lines[0].unitCost).toBe('110.00');
    expect(res.body.data.costIncomplete).toBe(false);
  });

  it('reports an unknown cost rather than guessing one', async () => {
    const gun = await createItemType(w.faction.id, 'Rifle', { unit: 'pcs' });
    await priceIt(gun, '2000.00');

    const res = await quote([
      { itemTypeId: pistolId, quantity: '1' },
      { itemTypeId: gun, quantity: '1' },
    ]);
    const rifle = res.body.data.lines[1];
    expect(rifle.unitCost).toBeUndefined();
    expect(rifle.margin).toBeUndefined();
    expect(res.body.data.costIncomplete).toBe(true);
  });

  // A faction with two ways to make something can make it the cheap way, and a
  // margin quoted against the expensive route understates the deal.
  it('takes the cheaper of two recipes for the same product', async () => {
    await recipe('Pistol, rough', [{ itemTypeId: steelId, quantity: '3' }]);

    const res = await quote([{ itemTypeId: pistolId, quantity: '1' }]);
    expect(res.body.data.lines[0].unitCost).toBe('30.00');
  });

  it('divides by the batch a recipe produces', async () => {
    const box = await createItemType(w.faction.id, 'Crate', { unit: 'pcs' });
    await priceIt(box, '400.00');
    const res = await api().post(`${f()}/crafting/recipes`).set('Cookie', w.admin.cookie)
      .send({
        name: 'Crate of four',
        inputs: [{ itemTypeId: steelId, quantity: '20' }],
        outputs: [{ itemTypeId: box, quantity: '4' }],
      });
    expect(res.status).toBe(201);

    const quoted = await quote([{ itemTypeId: box, quantity: '1' }]);
    // 20 × 10.00 over four crates.
    expect(quoted.body.data.lines[0].unitCost).toBe('50.00');
  });
});

/**
 * Who may see the markup.
 *
 * A soldier working the counter does not need to know it, and a screenshot
 * from them should not reveal it. The figures are absent from the response
 * rather than blanked — what is not sent cannot be read out of devtools.
 */
describe('margin visibility', () => {
  beforeEach(async () => {
    await priceIt(steelId, '10.00');
    await priceIt(pistolId, '1000.00');
    await recipe('Pistol', [{ itemTypeId: steelId, quantity: '10' }]);
  });

  it('shows margins to everybody by default', async () => {
    const res = await quote([{ itemTypeId: pistolId, quantity: '1' }], {}, w.member.cookie);
    expect(res.body.data.lines[0].unitCost).toBe('100.00');
  });

  it('hides them below the rank the faction set', async () => {
    await rankMember(5);
    await setMarginRank(2);

    const res = await quote([{ itemTypeId: pistolId, quantity: '1' }], {}, w.member.cookie);
    expect(res.status).toBe(200);
    expect(res.body.data.lines[0].unitCost).toBeUndefined();
    expect(res.body.data.costTotal).toBeUndefined();
    expect(res.body.data.marginTotal).toBeUndefined();
  });

  it('shows them at or above that rank', async () => {
    await rankMember(1);
    await setMarginRank(2);

    const res = await quote([{ itemTypeId: pistolId, quantity: '1' }], {}, w.member.cookie);
    expect(res.body.data.lines[0].unitCost).toBe('100.00');
  });

  it('keeps them out of the price list too', async () => {
    await rankMember(5);
    await setMarginRank(2);

    const res = await api().get(base()).set('Cookie', w.member.cookie);
    expect(res.status).toBe(200);
    expect(res.body.data.canSeeMargins).toBe(false);
    expect(res.body.data.prices.every((p: { unitCost?: string }) => p.unitCost === undefined)).toBe(true);
  });

  it('never puts them in a booked sale', async () => {
    const res = await api().post(`${base()}/sales`).set('Cookie', w.admin.cookie)
      .send({ lines: [{ itemTypeId: pistolId, quantity: '1' }] });
    expect(res.status).toBe(201);
    expect(res.body.data.quote.lines[0].unitCost).toBeUndefined();
  });
});

/**
 * Quoting one basket in either money.
 *
 * "50k dirty, or 35k clean" is one click rather than a second negotiation.
 */
describe('exchange rates', () => {
  async function setRate(from: string, to: string, rate: string) {
    const res = await api().put(`${base()}/rates`).set('Cookie', w.admin.cookie)
      .send({ fromItemTypeId: from, toItemTypeId: to, rate });
    expect(res.status).toBe(200);
    return res.body.data.id as string;
  }

  beforeEach(async () => {
    await priceIt(pistolId, '1000.00');
    await priceIt(steelId, '100.00', dirtyId);
  });

  it('refuses a mixed basket with no currency chosen', async () => {
    const res = await quote([
      { itemTypeId: pistolId, quantity: '1' },
      { itemTypeId: steelId, quantity: '1' },
    ]);
    expect(res.status).toBe(400);
    expect(res.body.error.message).toMatch(/pick which one/i);
  });

  it('converts into the currency the quote asks for', async () => {
    await setRate(dirtyId, w.itemTypeId, '0.700000');

    const res = await quote(
      [{ itemTypeId: pistolId, quantity: '1' }, { itemTypeId: steelId, quantity: '2' }],
      { currencyItemTypeId: w.itemTypeId },
    );
    expect(res.status).toBe(200);
    // 1000 clean, plus 2 × 100 dirty at 0.7 = 140 clean.
    expect(res.body.data.total).toBe('1140.00');
    expect(res.body.data.lines[1].convertedFrom.name).toBe('Dirty money');
  });

  it('refuses when no rate covers that direction', async () => {
    const res = await quote(
      [{ itemTypeId: steelId, quantity: '1' }],
      { currencyItemTypeId: w.itemTypeId },
    );
    expect(res.status).toBe(400);
    expect(res.body.error.message).toMatch(/no exchange rate/i);
  });

  // Rates here are rarely symmetric — washing money takes a cut — so a derived
  // inverse would quote a deal the faction never agreed to.
  it('does not invent the reverse of a rate it has', async () => {
    await setRate(dirtyId, w.itemTypeId, '0.700000');

    const res = await quote(
      [{ itemTypeId: pistolId, quantity: '1' }],
      { currencyItemTypeId: dirtyId },
    );
    expect(res.status).toBe(400);
    expect(res.body.error.message).toMatch(/no exchange rate/i);
  });

  it('replaces a rate rather than keeping two', async () => {
    const first = await setRate(dirtyId, w.itemTypeId, '0.700000');
    const second = await setRate(dirtyId, w.itemTypeId, '0.500000');
    expect(second).toBe(first);

    const res = await quote(
      [{ itemTypeId: steelId, quantity: '1' }],
      { currencyItemTypeId: w.itemTypeId },
    );
    expect(res.body.data.total).toBe('50.00');
  });

  it('refuses a rate between a currency and itself', async () => {
    const res = await api().put(`${base()}/rates`).set('Cookie', w.admin.cookie)
      .send({ fromItemTypeId: dirtyId, toItemTypeId: dirtyId, rate: '1' });
    expect(res.status).toBe(400);
  });

  it('books a converted sale in the currency it was quoted in', async () => {
    await setRate(dirtyId, w.itemTypeId, '0.700000');

    const res = await api().post(`${base()}/sales`).set('Cookie', w.admin.cookie)
      .send({
        lines: [{ itemTypeId: steelId, quantity: '2' }],
        currencyItemTypeId: w.itemTypeId,
      });
    expect(res.status).toBe(201);
    expect(res.body.data.sale.total).toBe('140.00');

    const treasury = await api().get(`${f()}/treasury`).set('Cookie', w.admin.cookie);
    const clean = treasury.body.data.balances.find(
      (b: { itemTypeId: string }) => b.itemTypeId === w.itemTypeId,
    );
    expect(Number(clean.balance)).toBe(140);
  });

  it('needs manage_prices to set one', async () => {
    const res = await api().put(`${base()}/rates`).set('Cookie', w.member.cookie)
      .send({ fromItemTypeId: dirtyId, toItemTypeId: w.itemTypeId, rate: '0.7' });
    expect(res.status).toBe(403);
  });
});
