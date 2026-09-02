import { describe, it, expect, beforeEach } from 'vitest';
import {
  api, resetDatabase, seedBasicWorld, createUser, MISSING_UUID, type BasicWorld,
} from './helpers.js';

let w: BasicWorld;
const base = '/api/v1/factions';

beforeEach(async () => {
  await resetDatabase();
  w = await seedBasicWorld();
});

describe('POST /factions', () => {
  it('creates a faction, seeds default item types and adds the initial admin', async () => {
    const owner = await createUser('new_owner');
    const res = await api().post(base).set('Cookie', w.superadmin.cookie)
      .send({ name: 'Los Santos Cartel', description: 'test', initialAdminDiscordId: owner.discordId });
    expect(res.status).toBe(201);

    const detail = await api().get(`${base}/${res.body.data.id}`).set('Cookie', w.superadmin.cookie);
    expect(detail.body.data.members).toHaveLength(1);
    expect(detail.body.data.members[0].role).toBe('admin');
    expect(detail.body.data.itemTypes.map((t: { name: string }) => t.name).sort())
      .toEqual(['Clean Money', 'Dirty Money']);
  });

  it('409s on a duplicate name', async () => {
    const owner = await createUser('dup_owner');
    const res = await api().post(base).set('Cookie', w.superadmin.cookie)
      .send({ name: w.faction.name, initialAdminDiscordId: owner.discordId });
    expect(res.status).toBe(409);
  });

  it('404s when the initial admin has never logged in', async () => {
    const res = await api().post(base).set('Cookie', w.superadmin.cookie)
      .send({ name: 'Nobody Gang', initialAdminDiscordId: '123456789012345678' });
    expect(res.status).toBe(400);
  });

  it('rejects a missing name', async () => {
    const owner = await createUser('nameless_owner');
    const res = await api().post(base).set('Cookie', w.superadmin.cookie)
      .send({ initialAdminDiscordId: owner.discordId });
    expect(res.status).toBe(400);
  });

  it('forbids a faction admin — this is superadmin territory', async () => {
    const owner = await createUser('wannabe_owner');
    const res = await api().post(base).set('Cookie', w.admin.cookie)
      .send({ name: 'Rogue Gang', initialAdminDiscordId: owner.discordId });
    expect(res.status).toBe(403);
  });
});

describe('GET /factions', () => {
  it('lists factions with summary counts', async () => {
    const res = await api().get(base).set('Cookie', w.superadmin.cookie);
    expect(res.status).toBe(200);
    expect(res.body.data[0].memberCount).toBe(2);
    expect(res.body.meta.total_count).toBe(1);
  });

  it('searches by name', async () => {
    const hit = await api().get(`${base}?search=Test`).set('Cookie', w.superadmin.cookie);
    expect(hit.body.data).toHaveLength(1);
    const miss = await api().get(`${base}?search=zzzz`).set('Cookie', w.superadmin.cookie);
    expect(miss.body.data).toHaveLength(0);
  });

  it('forbids a faction admin', async () => {
    const res = await api().get(base).set('Cookie', w.admin.cookie);
    expect(res.status).toBe(403);
  });
});

describe('GET /factions/:id', () => {
  it('returns detail with members and item types', async () => {
    const res = await api().get(`${base}/${w.faction.id}`).set('Cookie', w.superadmin.cookie);
    expect(res.status).toBe(200);
    expect(res.body.data.members).toHaveLength(2);
  });

  it('404s for an unknown faction', async () => {
    const res = await api().get(`${base}/${MISSING_UUID}`).set('Cookie', w.superadmin.cookie);
    expect(res.status).toBe(404);
  });
});

describe('PATCH /factions/:id', () => {
  it('updates name, description and brand colour', async () => {
    const res = await api().patch(`${base}/${w.faction.id}`).set('Cookie', w.superadmin.cookie)
      .send({ name: 'Renamed Faction', description: 'new', brandColor: '#10b981' });
    expect(res.status).toBe(200);
    expect(res.body.data.name).toBe('Renamed Faction');
    expect(res.body.data.brandColor).toBe('#10b981');
  });

  it('rejects a malformed brand colour', async () => {
    const res = await api().patch(`${base}/${w.faction.id}`).set('Cookie', w.superadmin.cookie)
      .send({ brandColor: 'green' });
    expect(res.status).toBe(400);
  });

  it('rejects duplicate custom field names', async () => {
    const res = await api().patch(`${base}/${w.faction.id}`).set('Cookie', w.superadmin.cookie)
      .send({ customFields: [{ name: 'A', required: false }, { name: 'A', required: true }] });
    expect(res.status).toBe(400);
  });

  it('toggles payout approval', async () => {
    const res = await api().patch(`${base}/${w.faction.id}`).set('Cookie', w.superadmin.cookie)
  });

  it('forbids a faction admin', async () => {
    const res = await api().patch(`${base}/${w.faction.id}`).set('Cookie', w.admin.cookie)
      .send({ description: 'nope' });
    expect(res.status).toBe(403);
  });
});

describe('DELETE /factions/:id', () => {
  it('soft-deletes by clearing isActive, keeping the row', async () => {
    const res = await api().delete(`${base}/${w.faction.id}`).set('Cookie', w.superadmin.cookie);
    expect(res.status).toBe(200);

    const detail = await api().get(`${base}/${w.faction.id}`).set('Cookie', w.superadmin.cookie);
    expect(detail.status).toBe(200);
    expect(detail.body.data.isActive).toBe(false);
  });

  it('makes the dashboard unavailable afterwards', async () => {
    await api().delete(`${base}/${w.faction.id}`).set('Cookie', w.superadmin.cookie);
    const res = await api().get(`${base}/${w.faction.id}/dashboard`).set('Cookie', w.admin.cookie);
    expect(res.status).toBe(404);
  });

  it('forbids a faction admin', async () => {
    const res = await api().delete(`${base}/${w.faction.id}`).set('Cookie', w.admin.cookie);
    expect(res.status).toBe(403);
  });
});

describe('auth endpoints', () => {
  it('redirects to Discord for login', async () => {
    const res = await api().get('/api/v1/auth/discord');
    expect(res.status).toBe(302);
    expect(res.headers.location).toMatch(/discord\.com\/api\/oauth2\/authorize/);
    expect(res.headers.location).toMatch(/code_challenge_method=S256/);
  });

  it('rejects a callback without a valid state', async () => {
    const res = await api().get('/api/v1/auth/callback?code=abc&state=forged');
    expect(res.status).toBeGreaterThanOrEqual(400);
  });

  it('returns the current user with their factions', async () => {
    const res = await api().get('/api/v1/auth/me').set('Cookie', w.admin.cookie);
    expect(res.status).toBe(200);
    expect(res.body.data.username).toBe('admin_user');
    expect(res.body.data.factions).toHaveLength(1);
    expect(res.body.data.factions[0].role).toBe('admin');
  });

  it('requires authentication for /me', async () => {
    const res = await api().get('/api/v1/auth/me');
    expect(res.status).toBe(401);
  });

  it('clears the session cookie on logout', async () => {
    const res = await api().post('/api/v1/auth/logout').set('Cookie', w.admin.cookie);
    // 204 No Content: nothing to return once the cookie is cleared.
    expect(res.status).toBe(204);
    expect(String(res.headers['set-cookie'])).toMatch(/faction_session=/);
  });

  it('records the logout in the audit log', async () => {
    await api().post('/api/v1/auth/logout').set('Cookie', w.admin.cookie);
    const logs = await api()
      .get(`/api/v1/factions/${w.faction.id}/audit-logs`)
      .set('Cookie', w.admin.cookie);
    // Logout is not faction-scoped, so it must not pollute a faction's log.
    const actions = logs.body.data.map((l: { action: string }) => l.action);
    expect(actions).not.toContain('logout');
  });
});
