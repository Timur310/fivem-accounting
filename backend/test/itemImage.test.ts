import { describe, it, expect, beforeEach } from 'vitest';
import { db } from '../src/db/index.js';
import { itemTypes } from '../src/db/schema.js';
import { eq } from 'drizzle-orm';
import {
  api,
  resetDatabase,
  seedBasicWorld,
  createEntry,
  createPayout,
  createQuota,
  type BasicWorld,
} from './helpers.js';

let w: BasicWorld;
const f = () => `/api/v1/factions/${w.faction.id}`;
const base = () => `${f()}/item-types`;

const IMAGE = 'https://cdn.example.com/items/cash.png';

beforeEach(async () => {
  await resetDatabase();
  w = await seedBasicWorld();
});

describe('item type image', () => {
  it('creates a type with an image and returns it in the list', async () => {
    const created = await api()
      .post(base())
      .set('Cookie', w.admin.cookie)
      .send({ name: 'Lock Picks', unit: 'pcs', imageUrl: IMAGE });

    expect(created.status).toBe(201);
    expect(created.body.data.imageUrl).toBe(IMAGE);

    const list = await api().get(base()).set('Cookie', w.member.cookie);
    const type = list.body.data.find((t: { id: string }) => t.id === created.body.data.id);
    expect(type.imageUrl).toBe(IMAGE);
  });

  it('leaves the image null when none is given', async () => {
    const res = await api()
      .post(base())
      .set('Cookie', w.admin.cookie)
      .send({ name: 'Chips' });

    expect(res.status).toBe(201);
    expect(res.body.data.imageUrl).toBeNull();
  });

  it('sets an image on an existing type', async () => {
    const res = await api()
      .patch(`${base()}/${w.itemTypeId}`)
      .set('Cookie', w.admin.cookie)
      .send({ imageUrl: IMAGE });

    expect(res.status).toBe(200);
    expect(res.body.data.imageUrl).toBe(IMAGE);
  });

  it('clears the image with an explicit null', async () => {
    await api()
      .patch(`${base()}/${w.itemTypeId}`)
      .set('Cookie', w.admin.cookie)
      .send({ imageUrl: IMAGE });

    const res = await api()
      .patch(`${base()}/${w.itemTypeId}`)
      .set('Cookie', w.admin.cookie)
      .send({ imageUrl: null });

    expect(res.status).toBe(200);
    expect(res.body.data.imageUrl).toBeNull();
  });

  it('leaves the image alone when the key is omitted', async () => {
    await api()
      .patch(`${base()}/${w.itemTypeId}`)
      .set('Cookie', w.admin.cookie)
      .send({ imageUrl: IMAGE });

    const res = await api()
      .patch(`${base()}/${w.itemTypeId}`)
      .set('Cookie', w.admin.cookie)
      .send({ name: 'Renamed' });

    expect(res.status).toBe(200);
    expect(res.body.data.name).toBe('Renamed');
    expect(res.body.data.imageUrl).toBe(IMAGE);
  });

  it('rejects anything that is not an http(s) URL', async () => {
    for (const bad of [
      'not-a-url',
      'javascript:alert(1)',
      'data:image/png;base64,iVBORw0KGgo=',
      'ftp://example.com/cash.png',
    ]) {
      const res = await api()
        .post(base())
        .set('Cookie', w.admin.cookie)
        .send({ name: `Bad ${bad}`, imageUrl: bad });
      expect(res.status, `expected ${bad} to be rejected`).toBe(400);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
    }
  });

  it('rejects a URL longer than the cap', async () => {
    const res = await api()
      .post(base())
      .set('Cookie', w.admin.cookie)
      .send({ name: 'Long', imageUrl: `https://example.com/${'x'.repeat(2100)}.png` });

    expect(res.status).toBe(400);
  });

  it('is admin-only, like every other item type change', async () => {
    const res = await api()
      .patch(`${base()}/${w.itemTypeId}`)
      .set('Cookie', w.member.cookie)
      .send({ imageUrl: IMAGE });

    expect(res.status).toBe(403);
  });

  it('records the image in the audit log', async () => {
    await api()
      .post(base())
      .set('Cookie', w.admin.cookie)
      .send({ name: 'Logged', imageUrl: IMAGE });

    const res = await api()
      .get(`${f()}/audit-logs?entity_type=item_type&action=create`)
      .set('Cookie', w.admin.cookie);
    expect(res.body.data[0].details.imageUrl).toBe(IMAGE);
  });
});

/**
 * The image travels with the other presentation fields (name, unit,
 * isCurrency) so a client never has to fetch the item type list separately to
 * draw an icon. Nothing is replaced, so existing readers are unaffected.
 */
describe('item type image across the API', () => {
  beforeEach(async () => {
    await db
      .update(itemTypes)
      .set({ imageUrl: IMAGE })
      .where(eq(itemTypes.id, w.itemTypeId));
  });

  it('travels with the entry list and the dashboard', async () => {
    await createEntry(w.faction.id, w.member.id, w.itemTypeId, '1000');

    const entries = await api().get(`${f()}/entries`).set('Cookie', w.admin.cookie);
    expect(entries.status).toBe(200);
    expect(entries.body.data[0].itemTypeName).toBe('Cash');
    expect(entries.body.data[0].itemImageUrl).toBe(IMAGE);

    const dashboard = await api().get(`${f()}/dashboard`).set('Cookie', w.admin.cookie);
    expect(dashboard.status).toBe(200);
    expect(dashboard.body.data.recentEntries[0].itemImageUrl).toBe(IMAGE);
    expect(dashboard.body.data.totalsByType[0].imageUrl).toBe(IMAGE);
  });

  it('travels with the charts without splitting the aggregates', async () => {
    await createEntry(w.faction.id, w.member.id, w.itemTypeId, '1000');
    await createEntry(w.faction.id, w.member.id, w.itemTypeId, '500');

    const res = await api().get(`${f()}/charts`).set('Cookie', w.admin.cookie);
    expect(res.status).toBe(200);
    // Two entries of one type still collapse into a single grouped row.
    expect(res.body.data.itemDistribution).toHaveLength(1);
    expect(res.body.data.itemDistribution[0].total).toBe(1500);
    expect(res.body.data.itemDistribution[0].imageUrl).toBe(IMAGE);
    expect(res.body.data.memberItemBreakdown[0].imageUrl).toBe(IMAGE);
  });

  it('travels with the report breakdown without splitting the aggregates', async () => {
    await createEntry(w.faction.id, w.member.id, w.itemTypeId, '1000');
    await createEntry(w.faction.id, w.member.id, w.itemTypeId, '2000');

    const res = await api().get(`${f()}/reports/summary`).set('Cookie', w.admin.cookie);
    expect(res.status).toBe(200);
    expect(res.body.data.byType).toHaveLength(1);
    expect(res.body.data.byType[0].total).toBe(3000);
    expect(res.body.data.byType[0].imageUrl).toBe(IMAGE);
  });

  it('travels with payouts and the treasury', async () => {
    await createPayout(w.faction.id, w.member.id, w.admin.id, w.itemTypeId, '500', 'completed');

    const payouts = await api().get(`${f()}/payouts`).set('Cookie', w.admin.cookie);
    expect(payouts.status).toBe(200);
    expect(payouts.body.data[0].itemImageUrl).toBe(IMAGE);

    const treasury = await api().get(`${f()}/treasury`).set('Cookie', w.admin.cookie);
    expect(treasury.status).toBe(200);
    expect(treasury.body.data.balances[0].imageUrl).toBe(IMAGE);
    expect(treasury.body.data.recentPayouts[0].itemImageUrl).toBe(IMAGE);
  });

  it('travels with the quota list', async () => {
    await createQuota(w.faction.id, w.itemTypeId);

    const res = await api().get(`${f()}/quotas`).set('Cookie', w.admin.cookie);
    expect(res.status).toBe(200);
    expect(res.body.data[0].itemImageUrl).toBe(IMAGE);
  });

  it('travels with the member profile', async () => {
    await createEntry(w.faction.id, w.member.id, w.itemTypeId, '1000');
    await createPayout(w.faction.id, w.member.id, w.admin.id, w.itemTypeId, '200', 'completed');
    await createQuota(w.faction.id, w.itemTypeId);

    const res = await api()
      .get(`${f()}/members/${w.member.id}`)
      .set('Cookie', w.admin.cookie);
    expect(res.status).toBe(200);
    expect(res.body.data.contribution.byItemType[0].imageUrl).toBe(IMAGE);
    expect(res.body.data.recentEntries[0].itemImageUrl).toBe(IMAGE);
    expect(res.body.data.recentPayouts[0].itemImageUrl).toBe(IMAGE);
    expect(res.body.data.quotaProgress[0].imageUrl).toBe(IMAGE);
  });

  it('stays null on a type that has no image', async () => {
    const goods = await api()
      .post(base())
      .set('Cookie', w.admin.cookie)
      .send({ name: 'Ammo', unit: 'pcs' });
    await createEntry(w.faction.id, w.member.id, goods.body.data.id, '50');

    const res = await api().get(`${f()}/entries`).set('Cookie', w.admin.cookie);
    const row = res.body.data.find((e: { itemTypeName: string }) => e.itemTypeName === 'Ammo');
    expect(row.itemImageUrl).toBeNull();
  });
});
