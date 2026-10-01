import { describe, it, expect, beforeEach } from 'vitest';
import { eq } from 'drizzle-orm';
import {
  api, resetDatabase, seedBasicWorld, createItemType, createEntry, createPayout, createFaction, createUser,
  type BasicWorld,
} from './helpers.js';
import { db } from '../src/db/index.js';
import {
  craftingRecipeItems, craftingRecipes, crafts, entries, expenses, itemTypes, payouts, productPrices,
  shifts, storageRooms,
} from '../src/db/schema.js';

describe('resetting a treasury', () => {
  let w: BasicWorld;
  let pistol: string;
  let recipeId: string;
  const reset = (body: unknown, cookie = () => w.superadmin.cookie, factionId = () => w.faction.id) =>
    api().post(`/api/v1/factions/${factionId()}/reset-treasury`).set('Cookie', cookie()).send(body);
  const balance = async () =>
    (await api().get(`/api/v1/factions/${w.faction.id}/treasury`).set('Cookie', w.admin.cookie)).body.data;

  beforeEach(async () => {
    await resetDatabase();
    w = await seedBasicWorld();
    pistol = await createItemType(w.faction.id, 'Pistol', { isCurrency: false, unit: 'x' });

    // Money in and out, an expense, a craft run, a price and a shift.
    await createEntry(w.faction.id, w.member.id, w.itemTypeId, '5000.00');
    const payoutId = await createPayout(w.faction.id, w.member.id, w.admin.id, w.itemTypeId, '1000.00');
    await db.insert(expenses).values({ factionId: w.faction.id, createdBy: w.admin.id, itemTypeId: w.itemTypeId, amount: '200.00' });
    const [recipe] = await db.insert(craftingRecipes).values({ factionId: w.faction.id, name: 'Pistol kit', createdBy: w.admin.id }).returning();
    recipeId = recipe!.id;
    await db.insert(craftingRecipeItems).values({ recipeId, itemTypeId: pistol, role: 'output', quantity: '1' });
    await db.insert(crafts).values({ factionId: w.faction.id, recipeId, recipeName: 'Pistol kit', craftedBy: w.admin.id, craftDate: '2026-10-01' });
    await db.insert(productPrices).values({
      factionId: w.faction.id, itemTypeId: pistol, unitPrice: '1500.00', currencyItemTypeId: w.itemTypeId, updatedBy: w.admin.id,
    });
    await db.insert(shifts).values({
      factionId: w.faction.id, userId: w.member.id, startedAt: new Date(Date.now() - 7_200_000), endedAt: new Date(), payoutId,
    });
    await db.insert(storageRooms).values({ factionId: w.faction.id, name: 'Depot', width: 8, height: 8, createdBy: w.admin.id });
  });

  it('is superadmin only', async () => {
    const res = await reset({ confirmName: 'Test Faction' }, () => w.admin.cookie);
    expect(res.status).toBe(403);
  });

  it('refuses unless the faction name is typed exactly', async () => {
    const res = await reset({ confirmName: 'test faction' });
    expect(res.status).toBe(400);
    expect(await db.select().from(entries).where(eq(entries.factionId, w.faction.id))).toHaveLength(1);
  });

  it('empties the treasury and the history that moved it', async () => {
    const res = await reset({ confirmName: 'Test Faction' });
    expect(res.status).toBe(200);
    expect(res.body.data.removed).toMatchObject({ entries: 1, payouts: 1, expenses: 1, crafts: 1 });

    const f = w.faction.id;
    expect(await db.select().from(entries).where(eq(entries.factionId, f))).toHaveLength(0);
    expect(await db.select().from(payouts).where(eq(payouts.factionId, f))).toHaveLength(0);
    expect(await db.select().from(expenses).where(eq(expenses.factionId, f))).toHaveLength(0);
    expect(await db.select().from(crafts).where(eq(crafts.factionId, f))).toHaveLength(0);
    const treasury = await balance();
    expect(JSON.stringify(treasury)).not.toMatch(/"balance":[1-9]/);
  });

  // The faction asked for an empty vault, not a new faction.
  it('keeps item types, recipes, prices, shifts and storage', async () => {
    await reset({ confirmName: 'Test Faction' });
    const f = w.faction.id;
    expect(await db.select().from(itemTypes).where(eq(itemTypes.factionId, f))).toHaveLength(2);
    expect(await db.select().from(craftingRecipes).where(eq(craftingRecipes.id, recipeId))).toHaveLength(1);
    expect(await db.select().from(craftingRecipeItems).where(eq(craftingRecipeItems.recipeId, recipeId))).toHaveLength(1);
    expect(await db.select().from(productPrices).where(eq(productPrices.factionId, f))).toHaveLength(1);
    const [shift] = await db.select().from(shifts).where(eq(shifts.factionId, f));
    expect(shift).toBeTruthy();
    // Its wage payout is gone, so the shift is simply unpaid again.
    expect(shift!.payoutId).toBeNull();
    expect(await db.select().from(storageRooms).where(eq(storageRooms.factionId, f))).toHaveLength(1);
  });

  it('touches no other faction', async () => {
    const other = await createFaction('Other Faction', (await createUser('other_boss')).id);
    const cash = await createItemType(other.id, 'Cash');
    await createEntry(other.id, w.member.id, cash, '10.00');
    await reset({ confirmName: 'Test Faction' });
    expect(await db.select().from(entries).where(eq(entries.factionId, other.id))).toHaveLength(1);
  });

  it('records the reset in the audit log', async () => {
    await reset({ confirmName: 'Test Faction' });
    const log = await api().get(`/api/v1/factions/${w.faction.id}/audit-logs`).set('Cookie', w.admin.cookie);
    expect(JSON.stringify(log.body)).toContain('treasury_reset');
  });
});
