import { describe, it, expect, beforeEach } from 'vitest';
import {
  api, resetDatabase, seedBasicWorld, createUser, createEntry,
  MISSING_UUID, type BasicWorld,
} from './helpers.js';

let w: BasicWorld;
const base = () => `/api/v1/factions/${w.faction.id}/members`;
const settings = () => `/api/v1/factions/${w.faction.id}/settings`;

const RANKS = [
  { name: 'Boss', level: 1, permissions: [] },
  { name: 'Capo', level: 3, permissions: [] },
];

beforeEach(async () => {
  await resetDatabase();
  w = await seedBasicWorld();
});

describe('POST /members', () => {
  it('adds an existing user by discord id', async () => {
    const newcomer = await createUser('newcomer');
    const res = await api().post(base()).set('Cookie', w.admin.cookie)
      .send({ discordId: newcomer.discordId });
    expect(res.status).toBe(201);
    expect(res.body.data.role).toBe('member');
  });

  it('404s for a discord id that never logged in', async () => {
    const res = await api().post(base()).set('Cookie', w.admin.cookie)
      .send({ discordId: '123456789012345678' });
    expect(res.status).toBe(400);
    expect(res.body.error.message).toMatch(/must log in/i);
  });

  it('409s when the user is already a member', async () => {
    const res = await api().post(base()).set('Cookie', w.admin.cookie)
      .send({ discordId: w.member.discordId });
    expect(res.status).toBe(409);
  });

  it('forbids a plain member', async () => {
    const newcomer = await createUser('newcomer2');
    const res = await api().post(base()).set('Cookie', w.member.cookie)
      .send({ discordId: newcomer.discordId });
    expect(res.status).toBe(403);
  });
});

describe('GET /members', () => {
  it('lists members with rank and inactivity', async () => {
    const res = await api().get(base()).set('Cookie', w.member.cookie);
    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(2);
    expect(res.body.data[0]).toHaveProperty('rank');
    expect(res.body.data[0]).toHaveProperty('daysInactive');
  });

  it('includes strike counts for admins only', async () => {
    const asAdmin = await api().get(base()).set('Cookie', w.admin.cookie);
    expect(asAdmin.body.data[0]).toHaveProperty('activeStrikeCount');

    const asMember = await api().get(base()).set('Cookie', w.member.cookie);
    expect(asMember.body.data[0]).not.toHaveProperty('activeStrikeCount');
  });

  it('reports daysInactive as null for someone who never logged', async () => {
    const res = await api().get(base()).set('Cookie', w.admin.cookie);
    const row = res.body.data.find((m: { username: string }) => m.username === 'member_user');
    expect(row.daysInactive).toBeNull();
  });
});

describe('PATCH /members/:userId — role and rank', () => {
  it('promotes a member to admin', async () => {
    const res = await api().patch(`${base()}/${w.member.id}`).set('Cookie', w.admin.cookie)
      .send({ role: 'admin' });
    expect(res.status).toBe(200);
    expect(res.body.data.role).toBe('admin');
  });

  it('assigns a defined rank', async () => {
    await api().patch(settings()).set('Cookie', w.admin.cookie).send({ ranks: RANKS });
    const res = await api().patch(`${base()}/${w.member.id}`).set('Cookie', w.admin.cookie)
      .send({ rank: 'Capo' });
    expect(res.status).toBe(200);
    expect(res.body.data.rank).toBe('Capo');
  });

  it('rejects a rank the faction has not defined', async () => {
    await api().patch(settings()).set('Cookie', w.admin.cookie).send({ ranks: RANKS });
    const res = await api().patch(`${base()}/${w.member.id}`).set('Cookie', w.admin.cookie)
      .send({ rank: 'Kingpin' });
    expect(res.status).toBe(400);
    expect(res.body.error.message).toMatch(/Boss, Capo/);
  });

  it('explains when no ranks exist at all', async () => {
    const res = await api().patch(`${base()}/${w.member.id}`).set('Cookie', w.admin.cookie)
      .send({ rank: 'Capo' });
    expect(res.status).toBe(400);
    expect(res.body.error.message).toMatch(/no ranks defined/i);
  });

  it('clears a rank with null', async () => {
    await api().patch(settings()).set('Cookie', w.admin.cookie).send({ ranks: RANKS });
    await api().patch(`${base()}/${w.member.id}`).set('Cookie', w.admin.cookie).send({ rank: 'Capo' });
    const res = await api().patch(`${base()}/${w.member.id}`).set('Cookie', w.admin.cookie)
      .send({ rank: null });
    expect(res.body.data.rank).toBeNull();
  });

  it('requires at least one field', async () => {
    const res = await api().patch(`${base()}/${w.member.id}`).set('Cookie', w.admin.cookie).send({});
    expect(res.status).toBe(400);
  });

  it('404s for a non-member', async () => {
    const res = await api().patch(`${base()}/${w.outsider.id}`).set('Cookie', w.admin.cookie)
      .send({ role: 'admin' });
    expect(res.status).toBe(404);
  });
});

describe('DELETE /members/:userId', () => {
  it('removes a member', async () => {
    const res = await api().delete(`${base()}/${w.member.id}`).set('Cookie', w.admin.cookie);
    expect(res.status).toBe(200);
    const list = await api().get(base()).set('Cookie', w.admin.cookie);
    expect(list.body.data).toHaveLength(1);
  });

  it('refuses to remove the last admin', async () => {
    const res = await api().delete(`${base()}/${w.admin.id}`).set('Cookie', w.admin.cookie);
    expect(res.status).toBe(400);
  });

  it('forbids a plain member', async () => {
    const res = await api().delete(`${base()}/${w.admin.id}`).set('Cookie', w.member.cookie);
    expect(res.status).toBe(403);
  });
});

describe('GET /members/:userId — profile', () => {
  it('returns split contribution figures and a streak', async () => {
    await createEntry(w.faction.id, w.member.id, w.itemTypeId, '1000');
    const res = await api().get(`${base()}/${w.member.id}`).set('Cookie', w.admin.cookie);
    expect(res.status).toBe(200);
    expect(res.body.data.contribution.currencyContributed).toBe(1000);
    expect(res.body.data.contribution.itemContributed).toBe(0);
    expect(res.body.data.streak.current).toBe(1);
    expect(res.body.data.performance.score).toBeGreaterThan(0);
  });

  it('flags note visibility by role', async () => {
    const asAdmin = await api().get(`${base()}/${w.member.id}`).set('Cookie', w.admin.cookie);
    expect(asAdmin.body.data.canViewNotes).toBe(true);
    const asMember = await api().get(`${base()}/${w.member.id}`).set('Cookie', w.member.cookie);
    expect(asMember.body.data.canViewNotes).toBe(false);
  });

  it('404s for a non-member', async () => {
    const res = await api().get(`${base()}/${w.outsider.id}`).set('Cookie', w.admin.cookie);
    expect(res.status).toBe(404);
  });
});

describe('GET /members/:userId/heatmap', () => {
  it('returns every day of the year, gap-filled', async () => {
    await createEntry(w.faction.id, w.member.id, w.itemTypeId, '1000');
    const res = await api().get(`${base()}/${w.member.id}/heatmap`).set('Cookie', w.member.cookie);
    expect(res.status).toBe(200);
    expect(res.body.data.data.length).toBeGreaterThanOrEqual(365);
    const active = res.body.data.data.filter((d: { count: number }) => d.count > 0);
    expect(active).toHaveLength(1);
    expect(active[0].currencyTotal).toBe(1000);
  });

  it('rejects an out-of-range year', async () => {
    const res = await api().get(`${base()}/${w.member.id}/heatmap?year=1800`).set('Cookie', w.member.cookie);
    expect(res.status).toBe(400);
  });
});

describe('GET /members/:userId/history', () => {
  it('returns member lifecycle events from the audit log', async () => {
    await api().patch(`${base()}/${w.member.id}`).set('Cookie', w.admin.cookie).send({ role: 'admin' });
    const res = await api().get(`${base()}/${w.member.id}/history`).set('Cookie', w.admin.cookie);
    expect(res.status).toBe(200);
    expect(res.body.data.length).toBeGreaterThan(0);
    expect(res.body.data[0].action).toBe('update');
  });

  it('forbids a plain member', async () => {
    const res = await api().get(`${base()}/${w.member.id}/history`).set('Cookie', w.member.cookie);
    expect(res.status).toBe(403);
  });
});

describe('faction settings', () => {
  it('lets a faction admin define ranks', async () => {
    const res = await api().patch(settings()).set('Cookie', w.admin.cookie).send({ ranks: RANKS });
    expect(res.status).toBe(200);
    expect(res.body.data.ranks).toHaveLength(2);
  });

  it('rejects duplicate rank names and levels', async () => {
    const dupNames = await api().patch(settings()).set('Cookie', w.admin.cookie)
      .send({ ranks: [{ name: 'A', level: 1, permissions: [] }, { name: 'A', level: 2, permissions: [] }] });
    expect(dupNames.status).toBe(400);

    const dupLevels = await api().patch(settings()).set('Cookie', w.admin.cookie)
      .send({ ranks: [{ name: 'A', level: 1, permissions: [] }, { name: 'B', level: 1, permissions: [] }] });
    expect(dupLevels.status).toBe(400);
  });

  it('clears a removed rank from members holding it', async () => {
    await api().patch(settings()).set('Cookie', w.admin.cookie).send({ ranks: RANKS });
    await api().patch(`${base()}/${w.member.id}`).set('Cookie', w.admin.cookie).send({ rank: 'Capo' });

    const res = await api().patch(settings()).set('Cookie', w.admin.cookie)
      .send({ ranks: [RANKS[0]] });
    expect(res.body.data.clearedFromMembers).toEqual(['Capo']);

    const list = await api().get(base()).set('Cookie', w.admin.cookie);
    const row = list.body.data.find((m: { username: string }) => m.username === 'member_user');
    expect(row.rank).toBeNull();
  });

  it('returns effective strike expiry defaults when unset', async () => {
    const res = await api().get(settings()).set('Cookie', w.member.cookie);
    expect(res.status).toBe(200);
    expect(res.body.data.strikeExpiryDays).toEqual({ warning: 30, minor: 90, major: null });
    expect(res.body.data.inactivityThresholdDays).toBe(7);
  });

  it('forbids a plain member from writing settings', async () => {
    const res = await api().patch(settings()).set('Cookie', w.member.cookie)
      .send({ inactivityThresholdDays: 30 });
    expect(res.status).toBe(403);
  });

  it('requires at least one setting', async () => {
    const res = await api().patch(settings()).set('Cookie', w.admin.cookie).send({});
    expect(res.status).toBe(400);
  });
});
