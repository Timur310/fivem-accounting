import { describe, it, expect, beforeEach } from 'vitest';
import { api, resetDatabase, seedBasicWorld, MISSING_UUID, type BasicWorld } from './helpers.js';

let w: BasicWorld;
const base = () => `/api/v1/factions/${w.faction.id}/item-types`;

beforeEach(async () => {
  await resetDatabase();
  w = await seedBasicWorld();
});

describe('POST /item-types', () => {
  it('creates a type, defaulting isCurrency to false', async () => {
    const res = await api()
      .post(base())
      .set('Cookie', w.admin.cookie)
      .send({ name: 'Lock Picks', unit: 'pcs' });
    expect(res.status).toBe(201);
    expect(res.body.data.name).toBe('Lock Picks');
    expect(res.body.data.isCurrency).toBe(false);
  });

  it('accepts isCurrency when given', async () => {
    const res = await api()
      .post(base())
      .set('Cookie', w.admin.cookie)
      .send({ name: 'Clean Money', unit: '$', isCurrency: true });
    expect(res.status).toBe(201);
    expect(res.body.data.isCurrency).toBe(true);
  });

  it('defaults the unit to $', async () => {
    const res = await api().post(base()).set('Cookie', w.admin.cookie).send({ name: 'Chips' });
    expect(res.status).toBe(201);
    expect(res.body.data.unit).toBe('$');
  });

  it('rejects a missing name', async () => {
    const res = await api().post(base()).set('Cookie', w.admin.cookie).send({ unit: 'pcs' });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('rejects a non-boolean isCurrency', async () => {
    const res = await api()
      .post(base())
      .set('Cookie', w.admin.cookie)
      .send({ name: 'X', isCurrency: 'yes' });
    expect(res.status).toBe(400);
  });

  it('forbids a plain member', async () => {
    const res = await api().post(base()).set('Cookie', w.member.cookie).send({ name: 'X' });
    expect(res.status).toBe(403);
  });

  it('requires authentication', async () => {
    const res = await api().post(base()).send({ name: 'X' });
    expect(res.status).toBe(401);
  });
});

describe('GET /item-types', () => {
  it('lists types for any faction member', async () => {
    const res = await api().get(base()).set('Cookie', w.member.cookie);
    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(1);
    expect(res.body.data[0]).toHaveProperty('isCurrency');
    expect(res.body.data[0]).toHaveProperty('unit');
  });

  it('forbids a non-member', async () => {
    const res = await api().get(base()).set('Cookie', w.outsider.cookie);
    expect(res.status).toBe(403);
  });
});

describe('PATCH /item-types/:typeId', () => {
  it('updates name, unit and isCurrency', async () => {
    const res = await api()
      .patch(`${base()}/${w.itemTypeId}`)
      .set('Cookie', w.admin.cookie)
      .send({ name: 'Renamed', unit: 'kg', isCurrency: false });
    expect(res.status).toBe(200);
    expect(res.body.data.name).toBe('Renamed');
    expect(res.body.data.unit).toBe('kg');
    expect(res.body.data.isCurrency).toBe(false);
  });

  it('can toggle isCurrency on its own', async () => {
    const res = await api()
      .patch(`${base()}/${w.itemTypeId}`)
      .set('Cookie', w.admin.cookie)
      .send({ isCurrency: false });
    expect(res.status).toBe(200);
    expect(res.body.data.isCurrency).toBe(false);
  });

  it('404s for an unknown type', async () => {
    const res = await api()
      .patch(`${base()}/${MISSING_UUID}`)
      .set('Cookie', w.admin.cookie)
      .send({ name: 'X' });
    expect(res.status).toBe(404);
  });

  it('forbids a plain member', async () => {
    const res = await api()
      .patch(`${base()}/${w.itemTypeId}`)
      .set('Cookie', w.member.cookie)
      .send({ name: 'X' });
    expect(res.status).toBe(403);
  });
});

describe('DELETE /item-types/:typeId', () => {
  it('soft-deletes by deactivating, keeping the row', async () => {
    const res = await api().delete(`${base()}/${w.itemTypeId}`).set('Cookie', w.admin.cookie);
    expect(res.status).toBe(200);

    const list = await api().get(base()).set('Cookie', w.admin.cookie);
    expect(list.body.data).toHaveLength(1);
    expect(list.body.data[0].isActive).toBe(false);
  });

  it('404s for an unknown type', async () => {
    const res = await api().delete(`${base()}/${MISSING_UUID}`).set('Cookie', w.admin.cookie);
    expect(res.status).toBe(404);
  });

  it('forbids a plain member', async () => {
    const res = await api().delete(`${base()}/${w.itemTypeId}`).set('Cookie', w.member.cookie);
    expect(res.status).toBe(403);
  });
});
