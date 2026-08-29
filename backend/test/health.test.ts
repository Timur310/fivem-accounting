import { describe, it, expect, beforeEach } from 'vitest';
import { api, resetDatabase, seedBasicWorld, EXPIRED_COOKIE, cookieForUnknownUser } from './helpers.js';

describe('infrastructure', () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  it('serves the health check without authentication', async () => {
    const res = await api().get('/api/v1/health');
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('ok');
  });

  it('returns a structured 404 for unknown api paths', async () => {
    const res = await api().get('/api/v1/does-not-exist');
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('NOT_FOUND');
  });

  it('seeds a working faction world', async () => {
    const world = await seedBasicWorld();
    const res = await api()
      .get(`/api/v1/factions/${world.faction.id}/item-types`)
      .set('Cookie', world.admin.cookie);
    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(1);
  });
});

describe('authentication guard', () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  it('rejects a request with no cookie', async () => {
    const world = await seedBasicWorld();
    const res = await api().get(`/api/v1/factions/${world.faction.id}/dashboard`);
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('UNAUTHENTICATED');
  });

  it('rejects a malformed token', async () => {
    const world = await seedBasicWorld();
    const res = await api()
      .get(`/api/v1/factions/${world.faction.id}/dashboard`)
      .set('Cookie', EXPIRED_COOKIE);
    expect(res.status).toBe(401);
  });

  it('rejects a valid token for a user that no longer exists', async () => {
    const world = await seedBasicWorld();
    const res = await api()
      .get(`/api/v1/factions/${world.faction.id}/dashboard`)
      .set('Cookie', cookieForUnknownUser());
    expect(res.status).toBe(401);
  });

  it('rejects a member of a different faction', async () => {
    const world = await seedBasicWorld();
    const res = await api()
      .get(`/api/v1/factions/${world.faction.id}/dashboard`)
      .set('Cookie', world.outsider.cookie);
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('FORBIDDEN');
  });
});
