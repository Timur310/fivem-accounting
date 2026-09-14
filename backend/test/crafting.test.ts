import { describe, it, expect, beforeEach } from 'vitest';
import {
  api, createFaction, createItemType, resetDatabase, seedBasicWorld, type BasicWorld,
} from './helpers.js';

let w: BasicWorld;
const f = () => `/api/v1/factions/${w.faction.id}`;
const crafting = () => `${f()}/crafting`;

/** Two materials and a product, so a recipe has something to be about. */
let steelId: string;
let powderId: string;
let pistolId: string;

/** Define a rank with the given permissions and put the plain member on it. */
async function giveMemberRank(permissions: string[], name = 'Smith') {
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
  return Number(row?.balance ?? 0);
}

/** The standard recipe: 10 steel + 2 powder makes 1 pistol. */
async function createRecipe(over: Record<string, unknown> = {}) {
  const res = await api().post(`${crafting()}/recipes`).set('Cookie', w.admin.cookie)
    .send({
      name: 'Pistol',
      inputs: [
        { itemTypeId: steelId, quantity: '10' },
        { itemTypeId: powderId, quantity: '2' },
      ],
      outputs: [{ itemTypeId: pistolId, quantity: '1' }],
      ...over,
    });
  return res;
}

beforeEach(async () => {
  await resetDatabase();
  w = await seedBasicWorld();
  steelId = await createItemType(w.faction.id, 'Steel', { unit: 'pcs', isCurrency: false });
  powderId = await createItemType(w.faction.id, 'Powder', { unit: 'g', isCurrency: false });
  pistolId = await createItemType(w.faction.id, 'Pistol', { unit: 'pcs', isCurrency: false });
});

describe('recipes', () => {
  it('needs manage_crafting to write one — being able to craft is not enough', async () => {
    await giveMemberRank(['craft']);

    const res = await api().post(`${crafting()}/recipes`).set('Cookie', w.member.cookie)
      .send({
        name: 'Pistol',
        inputs: [{ itemTypeId: steelId, quantity: '10' }],
        outputs: [{ itemTypeId: pistolId, quantity: '1' }],
      });

    expect(res.status).toBe(403);
  });

  it('saves inputs and outputs', async () => {
    const res = await createRecipe();
    expect(res.status).toBe(201);
    expect(res.body.data.recipe.inputs).toHaveLength(2);
    expect(res.body.data.recipe.outputs).toHaveLength(1);
    // Nobody, by default: a craft converts what the faction already owns, so
    // it should not move anybody's leaderboard position unless asked to.
    expect(res.body.data.recipe.creditOutputTo).toBe('nobody');
  });

  it('refuses a recipe with no inputs or no outputs', async () => {
    const noInput = await api().post(`${crafting()}/recipes`).set('Cookie', w.admin.cookie)
      .send({ name: 'Free lunch', inputs: [], outputs: [{ itemTypeId: pistolId, quantity: '1' }] });
    expect(noInput.status).toBe(400);

    const noOutput = await api().post(`${crafting()}/recipes`).set('Cookie', w.admin.cookie)
      .send({ name: 'Bonfire', inputs: [{ itemTypeId: steelId, quantity: '1' }], outputs: [] });
    expect(noOutput.status).toBe(400);
  });

  it('refuses the same item type twice on one side', async () => {
    const res = await api().post(`${crafting()}/recipes`).set('Cookie', w.admin.cookie)
      .send({
        name: 'Double steel',
        inputs: [
          { itemTypeId: steelId, quantity: '10' },
          { itemTypeId: steelId, quantity: '5' },
        ],
        outputs: [{ itemTypeId: pistolId, quantity: '1' }],
      });
    expect(res.status).toBe(400);
  });

  // Burning 10 crates to make 6 better ones is a real thing and nothing here
  // needs to forbid it.
  it('allows an item type to be both an input and an output', async () => {
    const res = await api().post(`${crafting()}/recipes`).set('Cookie', w.admin.cookie)
      .send({
        name: 'Refine steel',
        inputs: [{ itemTypeId: steelId, quantity: '10' }],
        outputs: [{ itemTypeId: steelId, quantity: '6' }],
      });
    expect(res.status).toBe(201);
  });

  it('refuses an item type from another faction', async () => {
    const rival = await createFaction('Rival Faction', w.admin.id);
    const theirs = await createItemType(rival.id, 'Their Cash');

    const res = await api().post(`${crafting()}/recipes`).set('Cookie', w.admin.cookie)
      .send({
        name: 'Smuggled',
        inputs: [{ itemTypeId: theirs, quantity: '1' }],
        outputs: [{ itemTypeId: pistolId, quantity: '1' }],
      });
    expect(res.status).toBe(400);
  });

  it('refuses two recipes with the same name', async () => {
    expect((await createRecipe()).status).toBe(201);
    const again = await createRecipe();
    expect(again.status).toBe(400);
  });

  it('says how many the vault can currently make', async () => {
    await createRecipe();
    await fundTreasury(steelId, '35');
    await fundTreasury(powderId, '100');

    const res = await api().get(`${crafting()}/recipes`).set('Cookie', w.member.cookie);
    expect(res.status).toBe(200);
    // Steel is the binding constraint: 35 / 10 = 3, not 100 / 2 = 50.
    expect(res.body.data.recipes[0].maxCraftable).toBe(3);
  });

  // A PATCH that renames a recipe must not silently empty its lines.
  it('leaves untouched sides alone on a partial update', async () => {
    const created = await createRecipe();
    const id = created.body.data.recipe.id;

    const res = await api().patch(`${crafting()}/recipes/${id}`).set('Cookie', w.admin.cookie)
      .send({ name: 'Heavy Pistol' });

    expect(res.status).toBe(200);
    expect(res.body.data.recipe.name).toBe('Heavy Pistol');
    expect(res.body.data.recipe.inputs).toHaveLength(2);
    expect(res.body.data.recipe.outputs).toHaveLength(1);
  });

  it('replaces a side wholesale when one is sent', async () => {
    const created = await createRecipe();
    const id = created.body.data.recipe.id;

    const res = await api().patch(`${crafting()}/recipes/${id}`).set('Cookie', w.admin.cookie)
      .send({ inputs: [{ itemTypeId: steelId, quantity: '4' }] });

    expect(res.status).toBe(200);
    expect(res.body.data.recipe.inputs).toHaveLength(1);
    expect(res.body.data.recipe.inputs[0].quantity).toBe('4.00');
  });
});

describe('crafting', () => {
  let recipeId: string;

  beforeEach(async () => {
    const created = await createRecipe();
    recipeId = created.body.data.recipe.id;
  });

  it('needs the craft permission', async () => {
    await giveMemberRank(['manage_entries', 'manage_payouts']);
    await fundTreasury(steelId, '100');
    await fundTreasury(powderId, '100');

    const res = await api().post(`${crafting()}/crafts`).set('Cookie', w.member.cookie)
      .send({ recipeId, quantity: 1 });

    expect(res.status).toBe(403);
  });

  it('moves the treasury: materials out, product in', async () => {
    await fundTreasury(steelId, '100');
    await fundTreasury(powderId, '100');

    const res = await api().post(`${crafting()}/crafts`).set('Cookie', w.admin.cookie)
      .send({ recipeId, quantity: 1 });

    expect(res.status).toBe(201);
    expect(await balanceOf(steelId)).toBe(90);
    expect(await balanceOf(powderId)).toBe(98);
    expect(await balanceOf(pistolId)).toBe(1);
  });

  it('scales every line by the batch size', async () => {
    await fundTreasury(steelId, '100');
    await fundTreasury(powderId, '100');

    const res = await api().post(`${crafting()}/crafts`).set('Cookie', w.admin.cookie)
      .send({ recipeId, quantity: 5 });

    expect(res.status).toBe(201);
    expect(await balanceOf(steelId)).toBe(50);
    expect(await balanceOf(powderId)).toBe(90);
    expect(await balanceOf(pistolId)).toBe(5);
  });

  it('refuses when the vault is short, and says which material', async () => {
    await fundTreasury(steelId, '100');
    await fundTreasury(powderId, '1');

    const res = await api().post(`${crafting()}/crafts`).set('Cookie', w.admin.cookie)
      .send({ recipeId, quantity: 1 });

    expect(res.status).toBe(400);
    expect(res.body.error.message).toContain('Powder');
  });

  it('refuses a batch the vault can nearly afford', async () => {
    await fundTreasury(steelId, '29');
    await fundTreasury(powderId, '100');

    const res = await api().post(`${crafting()}/crafts`).set('Cookie', w.admin.cookie)
      .send({ recipeId, quantity: 3 });

    expect(res.status).toBe(400);
    expect(await balanceOf(steelId)).toBe(29);
    // Nothing partial: a craft that cannot complete must leave no movements.
    expect(await balanceOf(pistolId)).toBe(0);
  });

  // The default recipe credits nobody, exactly as laundering does, so a craft
  // cannot inflate a contribution score.
  it('credits nobody by default', async () => {
    await fundTreasury(steelId, '100');
    await fundTreasury(powderId, '100');

    const before = await api().get(`${f()}/leaderboard`).set('Cookie', w.admin.cookie);
    const adminBefore = before.body.data.entries?.find(
      (e: { userId: string }) => e.userId === w.admin.id,
    );

    await api().post(`${crafting()}/crafts`).set('Cookie', w.admin.cookie)
      .send({ recipeId, quantity: 1 });

    const after = await api().get(`${f()}/leaderboard`).set('Cookie', w.admin.cookie);
    const adminAfter = after.body.data.entries?.find(
      (e: { userId: string }) => e.userId === w.admin.id,
    );

    expect(adminAfter?.totalEntries ?? 0).toBe(adminBefore?.totalEntries ?? 0);
  });

  it('credits the crafter when the recipe says to', async () => {
    await api().patch(`${crafting()}/recipes/${recipeId}`).set('Cookie', w.admin.cookie)
      .send({ creditOutputTo: 'crafter' });
    await fundTreasury(steelId, '100');
    await fundTreasury(powderId, '100');

    await api().post(`${crafting()}/crafts`).set('Cookie', w.admin.cookie)
      .send({ recipeId, quantity: 1 });

    const entries = await api().get(`${f()}/entries?user_id=${w.admin.id}`)
      .set('Cookie', w.admin.cookie);
    expect(entries.status).toBe(200);
    expect(
      entries.body.data.some((e: { itemTypeName: string }) => e.itemTypeName === 'Pistol'),
    ).toBe(true);
  });

  it('refuses a retired recipe', async () => {
    await api().patch(`${crafting()}/recipes/${recipeId}`).set('Cookie', w.admin.cookie)
      .send({ isActive: false });
    await fundTreasury(steelId, '100');
    await fundTreasury(powderId, '100');

    const res = await api().post(`${crafting()}/crafts`).set('Cookie', w.admin.cookie)
      .send({ recipeId, quantity: 1 });

    expect(res.status).toBe(400);
  });

  it('records the craft in its own history', async () => {
    await fundTreasury(steelId, '100');
    await fundTreasury(powderId, '100');
    await api().post(`${crafting()}/crafts`).set('Cookie', w.admin.cookie)
      .send({ recipeId, quantity: 2 });

    const res = await api().get(`${crafting()}/crafts`).set('Cookie', w.member.cookie);
    expect(res.status).toBe(200);
    expect(res.body.data.crafts).toHaveLength(1);
    expect(res.body.data.crafts[0].recipeName).toBe('Pistol');
    expect(res.body.data.crafts[0].quantity).toBe(2);
    expect(res.body.data.crafts[0].inputs).toHaveLength(2);
    expect(res.body.data.crafts[0].outputs).toHaveLength(1);
  });
});

describe('reverting a craft', () => {
  let recipeId: string;
  let craftId: string;

  beforeEach(async () => {
    const created = await createRecipe();
    recipeId = created.body.data.recipe.id;
    await fundTreasury(steelId, '100');
    await fundTreasury(powderId, '100');
    const craft = await api().post(`${crafting()}/crafts`).set('Cookie', w.admin.cookie)
      .send({ recipeId, quantity: 2 });
    expect(craft.status).toBe(201);
    craftId = craft.body.data.craft.id;
  });

  it('puts the materials back and takes the product away', async () => {
    const res = await api().post(`${crafting()}/crafts/${craftId}/revert`)
      .set('Cookie', w.admin.cookie);

    expect(res.status).toBe(200);
    expect(await balanceOf(steelId)).toBe(100);
    expect(await balanceOf(powderId)).toBe(100);
    expect(await balanceOf(pistolId)).toBe(0);
  });

  it('cannot be done twice', async () => {
    await api().post(`${crafting()}/crafts/${craftId}/revert`).set('Cookie', w.admin.cookie);
    const again = await api().post(`${crafting()}/crafts/${craftId}/revert`)
      .set('Cookie', w.admin.cookie);

    expect(again.status).toBe(400);
    // And the balances did not move a second time.
    expect(await balanceOf(steelId)).toBe(100);
  });

  // A revert takes the product back out of the vault. If it has already been
  // spent, that would drive the balance negative — a real state the app
  // allows, but never one to enter by accident on a correction.
  it('refuses when the product has already been spent', async () => {
    // Spent as an expense rather than a payout, which also pins down that the
    // balance crafting reads subtracts expenses — the laundering desk's
    // hand-rolled copy of this query does not.
    const spent = await api().post(`${f()}/expenses`).set('Cookie', w.admin.cookie)
      .send({ itemTypeId: pistolId, amount: '2', category: 'other' });
    expect(spent.status).toBe(201);

    const res = await api().post(`${crafting()}/crafts/${craftId}/revert`)
      .set('Cookie', w.admin.cookie);

    expect(res.status).toBe(400);
    expect(res.body.error.message).toContain('Pistol');
  });

  it('needs manage_crafting — being able to craft is not enough', async () => {
    await giveMemberRank(['craft']);
    const res = await api().post(`${crafting()}/crafts/${craftId}/revert`)
      .set('Cookie', w.member.cookie);
    expect(res.status).toBe(403);
  });

  it('keeps the craft in history, marked as reverted', async () => {
    await api().post(`${crafting()}/crafts/${craftId}/revert`).set('Cookie', w.admin.cookie);

    const res = await api().get(`${crafting()}/crafts`).set('Cookie', w.admin.cookie);
    expect(res.body.data.crafts).toHaveLength(1);
    expect(res.body.data.crafts[0].revertedAt).not.toBeNull();
  });
});

/**
 * A craft's movements are ordinary entries and completed payouts, which is
 * what lets the rest of the app count them without knowing crafting exists —
 * and is also what left them deletable one at a time. Each of these is a way
 * to get materials or product for free.
 */
describe('a craft cannot be picked apart', () => {
  let recipeId: string;
  let craftId: string;

  beforeEach(async () => {
    const created = await createRecipe();
    recipeId = created.body.data.recipe.id;
    await fundTreasury(steelId, '100');
    await fundTreasury(powderId, '100');
    const craft = await api().post(`${crafting()}/crafts`).set('Cookie', w.admin.cookie)
      .send({ recipeId, quantity: 2 });
    expect(craft.status).toBe(201);
    craftId = craft.body.data.craft.id;
  });

  /** The payout rows a craft wrote for its materials. */
  async function inputPayoutIds(): Promise<string[]> {
    const res = await api().get(`${f()}/payouts?page_size=100`).set('Cookie', w.admin.cookie);
    expect(res.status).toBe(200);
    return res.body.data
      .filter((p: { description: string | null }) => p.description?.includes('Pistol'))
      .map((p: { id: string }) => p.id);
  }

  /** The entry row a craft wrote for its product. */
  async function outputEntryId(): Promise<string> {
    const res = await api().get(`${f()}/entries?page_size=100`).set('Cookie', w.admin.cookie);
    expect(res.status).toBe(200);
    const row = res.body.data.find((e: { itemTypeName: string }) => e.itemTypeName === 'Pistol');
    expect(row).toBeDefined();
    return row.id;
  }

  // Free crafting: the materials come back and the product stays.
  it('refuses to delete the payout that took the materials', async () => {
    const [payoutId] = await inputPayoutIds();
    const res = await api().delete(`${f()}/payouts/${payoutId}`).set('Cookie', w.admin.cookie);

    expect(res.status).toBe(400);
    expect(res.body.error.message).toContain('Pistol');
    expect(await balanceOf(steelId)).toBe(80);
  });

  // Materials consumed, product destroyed.
  it('refuses to delete the entry that made the product', async () => {
    const entryId = await outputEntryId();
    const res = await api().delete(`${f()}/entries/${entryId}`).set('Cookie', w.admin.cookie);

    expect(res.status).toBe(400);
    expect(await balanceOf(pistolId)).toBe(2);
  });

  it('refuses to edit the amount of either side', async () => {
    const entryId = await outputEntryId();
    const entry = await api().patch(`${f()}/entries/${entryId}`).set('Cookie', w.admin.cookie)
      .send({ amount: '99' });
    expect(entry.status).toBe(400);

    const [payoutId] = await inputPayoutIds();
    const payout = await api().patch(`${f()}/payouts/${payoutId}`).set('Cookie', w.admin.cookie)
      .send({ amount: '1' });
    expect(payout.status).toBe(400);
  });

  it('refuses a bulk delete that includes a craft entry', async () => {
    const entryId = await outputEntryId();
    const res = await api().post(`${f()}/bulk/entries/bulk-delete`).set('Cookie', w.admin.cookie)
      .send({ entryIds: [entryId] });

    expect(res.status).toBe(400);
    expect(await balanceOf(pistolId)).toBe(2);
  });

  // Once the craft is reverted its rows are already soft-deleted, so nothing
  // is holding anything and the guard stops applying.
  it('stops holding the rows once the craft is reverted', async () => {
    const before = await outputEntryId();
    await api().post(`${crafting()}/crafts/${craftId}/revert`).set('Cookie', w.admin.cookie);

    const res = await api().delete(`${f()}/entries/${before}`).set('Cookie', w.admin.cookie);
    // Already soft-deleted, so it is simply not found — not refused.
    expect(res.status).toBe(404);
  });
});
