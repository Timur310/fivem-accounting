import { describe, it, expect, beforeEach } from 'vitest';
import {
  api, resetDatabase, seedBasicWorld, createEntry, createItemType,
  createUser, createFaction, MISSING_UUID, type BasicWorld,
} from './helpers.js';
import { todayDateString } from '../src/lib/date.js';

let w: BasicWorld;
const base = () => `/api/v1/factions/${w.faction.id}/quotas`;

beforeEach(async () => {
  await resetDatabase();
  w = await seedBasicWorld();
});

describe('POST /quotas', () => {
  it('creates a monthly quota', async () => {
    const res = await api().post(base()).set('Cookie', w.admin.cookie)
      .send({ itemTypeId: w.itemTypeId, targetAmount: '10000', periodType: 'monthly', periodStart: todayDateString() });
    expect(res.status).toBe(201);
    expect(res.body.data.periodType).toBe('monthly');
  });

  it('refuses a second active quota for the same type and period', async () => {
    const body = { itemTypeId: w.itemTypeId, targetAmount: '10000', periodType: 'monthly', periodStart: todayDateString() };
    await api().post(base()).set('Cookie', w.admin.cookie).send(body);
    const res = await api().post(base()).set('Cookie', w.admin.cookie).send(body);
    expect(res.status).toBe(400);
    expect(res.body.error.message).toMatch(/already exists/i);
  });

  it('allows weekly and monthly quotas side by side', async () => {
    await api().post(base()).set('Cookie', w.admin.cookie)
      .send({ itemTypeId: w.itemTypeId, targetAmount: '1000', periodType: 'weekly', periodStart: todayDateString() });
    const res = await api().post(base()).set('Cookie', w.admin.cookie)
      .send({ itemTypeId: w.itemTypeId, targetAmount: '10000', periodType: 'monthly', periodStart: todayDateString() });
    expect(res.status).toBe(201);
  });

  it('rejects an unknown period type', async () => {
    const res = await api().post(base()).set('Cookie', w.admin.cookie)
      .send({ itemTypeId: w.itemTypeId, targetAmount: '10', periodType: 'daily', periodStart: todayDateString() });
    expect(res.status).toBe(400);
  });

  it('rejects a malformed date', async () => {
    const res = await api().post(base()).set('Cookie', w.admin.cookie)
      .send({ itemTypeId: w.itemTypeId, targetAmount: '10', periodType: 'monthly', periodStart: '01/01/2026' });
    expect(res.status).toBe(400);
  });

  it('404s for an item type from another faction', async () => {
    const other = await createUser('q_other');
    const otherFaction = await createFaction('Q Other', other.id);
    const foreign = await createItemType(otherFaction.id);
    const res = await api().post(base()).set('Cookie', w.admin.cookie)
      .send({ itemTypeId: foreign, targetAmount: '10', periodType: 'monthly', periodStart: todayDateString() });
    expect(res.status).toBe(404);
  });

  it('forbids a plain member', async () => {
    const res = await api().post(base()).set('Cookie', w.member.cookie)
      .send({ itemTypeId: w.itemTypeId, targetAmount: '10', periodType: 'monthly', periodStart: todayDateString() });
    expect(res.status).toBe(403);
  });
});

describe('GET /quotas', () => {
  it('computes progress from entries in the current period', async () => {
    await api().post(base()).set('Cookie', w.admin.cookie)
      .send({ itemTypeId: w.itemTypeId, targetAmount: '10000', periodType: 'monthly', periodStart: todayDateString() });
    await createEntry(w.faction.id, w.member.id, w.itemTypeId, '2500');

    const res = await api().get(base()).set('Cookie', w.member.cookie);
    expect(res.status).toBe(200);
    expect(res.body.data[0].currentAmount).toBe(2500);
    expect(res.body.data[0].percentage).toBe(25);
    expect(res.body.data[0].periodActive).toBe(true);
  });

  it('caps the percentage at 100', async () => {
    await api().post(base()).set('Cookie', w.admin.cookie)
      .send({ itemTypeId: w.itemTypeId, targetAmount: '100', periodType: 'monthly', periodStart: todayDateString() });
    await createEntry(w.faction.id, w.member.id, w.itemTypeId, '500');
    const res = await api().get(base()).set('Cookie', w.member.cookie);
    expect(res.body.data[0].percentage).toBe(100);
  });

  it('ignores entries outside the period', async () => {
    await api().post(base()).set('Cookie', w.admin.cookie)
      .send({ itemTypeId: w.itemTypeId, targetAmount: '10000', periodType: 'monthly', periodStart: todayDateString() });
    await createEntry(w.faction.id, w.member.id, w.itemTypeId, '9999', '2020-03-15');
    const res = await api().get(base()).set('Cookie', w.member.cookie);
    expect(res.body.data[0].currentAmount).toBe(0);
  });

  it('ignores soft-deleted entries', async () => {
    await api().post(base()).set('Cookie', w.admin.cookie)
      .send({ itemTypeId: w.itemTypeId, targetAmount: '10000', periodType: 'monthly', periodStart: todayDateString() });
    const entryId = await createEntry(w.faction.id, w.member.id, w.itemTypeId, '1000');
    await api().delete(`/api/v1/factions/${w.faction.id}/entries/${entryId}`).set('Cookie', w.admin.cookie);

    const res = await api().get(base()).set('Cookie', w.member.cookie);
    expect(res.body.data[0].currentAmount).toBe(0);
  });

  it('reports a future quota as not started', async () => {
    await api().post(base()).set('Cookie', w.admin.cookie)
      .send({ itemTypeId: w.itemTypeId, targetAmount: '100', periodType: 'monthly', periodStart: '2099-01-01' });
    const res = await api().get(base()).set('Cookie', w.member.cookie);
    expect(res.body.data[0].periodActive).toBe(false);
  });
});

describe('PATCH and DELETE /quotas/:quotaId', () => {
  async function makeQuota(): Promise<string> {
    const res = await api().post(base()).set('Cookie', w.admin.cookie)
      .send({ itemTypeId: w.itemTypeId, targetAmount: '10000', periodType: 'monthly', periodStart: todayDateString() });
    return res.body.data.id;
  }

  it('updates the target and active flag', async () => {
    const id = await makeQuota();
    const res = await api().patch(`${base()}/${id}`).set('Cookie', w.admin.cookie)
      .send({ targetAmount: '20000', isActive: false });
    expect(res.status).toBe(200);
    expect(res.body.data.targetAmount).toBe('20000.00');
    expect(res.body.data.isActive).toBe(false);
  });

  it('reports an inactive quota with zero progress', async () => {
    const id = await makeQuota();
    await createEntry(w.faction.id, w.member.id, w.itemTypeId, '5000');
    await api().patch(`${base()}/${id}`).set('Cookie', w.admin.cookie).send({ isActive: false });

    const res = await api().get(base()).set('Cookie', w.member.cookie);
    expect(res.body.data[0].currentAmount).toBe(0);
    expect(res.body.data[0].periodActive).toBe(false);
  });

  it('deletes a quota outright', async () => {
    const id = await makeQuota();
    const res = await api().delete(`${base()}/${id}`).set('Cookie', w.admin.cookie);
    expect(res.status).toBe(200);
    const list = await api().get(base()).set('Cookie', w.member.cookie);
    expect(list.body.data).toHaveLength(0);
  });

  it('404s for an unknown quota', async () => {
    const res = await api().delete(`${base()}/${MISSING_UUID}`).set('Cookie', w.admin.cookie);
    expect(res.status).toBe(404);
  });

  it('forbids a plain member', async () => {
    const id = await makeQuota();
    const res = await api().delete(`${base()}/${id}`).set('Cookie', w.member.cookie);
    expect(res.status).toBe(403);
  });
});
