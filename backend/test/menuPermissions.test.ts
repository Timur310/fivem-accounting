import { describe, it, expect, beforeEach } from 'vitest';
import { api, resetDatabase, seedBasicWorld, type BasicWorld } from './helpers.js';

let w: BasicWorld;
const f = () => `/api/v1/factions/${w.faction.id}`;

async function giveMemberRank(permissions: string[], name = 'Capo') {
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

async function permissionsFor(cookie: string) {
  const res = await api().get('/api/v1/auth/me').set('Cookie', cookie);
  expect(res.status).toBe(200);
  const membership = res.body.data.factions.find(
    (m: { factionId: string }) => m.factionId === w.faction.id,
  );
  return membership?.permissions as string[] | undefined;
}

beforeEach(async () => {
  await resetDatabase();
  w = await seedBasicWorld();
});

/**
 * The client hides menus by this list, so it has to answer exactly what the
 * server-side guard would decide. A menu the API then refuses is worse than no
 * menu, and a hidden menu the API would have allowed is a feature quietly lost.
 */
describe('per-faction permissions on /auth/me', () => {
  it('gives a member with no rank nothing', async () => {
    expect(await permissionsFor(w.member.cookie)).toEqual([]);
  });

  it('gives a faction admin everything', async () => {
    const perms = await permissionsFor(w.admin.cookie);
    expect(perms).toContain('manage_settings');
    expect(perms).toContain('view_audit_logs');
    expect(perms).toContain('view_reports');
    expect(perms).toContain('manage_payouts');
  });

  it('gives a ranked member exactly what the rank grants', async () => {
    await giveMemberRank(['view_reports', 'view_audit_logs']);

    const perms = await permissionsFor(w.member.cookie);
    expect(perms).toEqual(expect.arrayContaining(['view_reports', 'view_audit_logs']));
    expect(perms).not.toContain('manage_settings');
    expect(perms).not.toContain('manage_payouts');
  });

  it('matches what the API actually allows', async () => {
    await giveMemberRank(['view_reports']);

    const perms = await permissionsFor(w.member.cookie);
    expect(perms).toContain('view_reports');
    expect(perms).not.toContain('view_audit_logs');

    // The menu list and the guard have to agree in both directions.
    const reports = await api().get(`${f()}/reports/growth`).set('Cookie', w.member.cookie);
    expect(reports.status).toBe(200);
    const audit = await api().get(`${f()}/audit-logs`).set('Cookie', w.member.cookie);
    expect(audit.status).toBe(403);
  });

  it('drops a permission the system no longer knows about', async () => {
    await giveMemberRank(['view_reports']);
    // Simulate a rank that still carries a retired permission name.
    await api()
      .patch(`${f()}/settings`)
      .set('Cookie', w.admin.cookie)
      .send({ ranks: [{ name: 'Capo', level: 1, permissions: ['view_reports'] }] });

    const perms = await permissionsFor(w.member.cookie);
    expect(perms).toEqual(['view_reports']);
  });

  it('loses the permissions when the rank is taken away', async () => {
    await giveMemberRank(['view_reports']);
    await api()
      .patch(`${f()}/members/${w.member.id}`)
      .set('Cookie', w.admin.cookie)
      .send({ rank: null });

    expect(await permissionsFor(w.member.cookie)).toEqual([]);
  });

  it('reports no membership at all for a superadmin who only browses', async () => {
    // The superadmin is not a member of the seeded faction, so it appears on
    // browseableFactions instead — the client treats that as full access, and
    // hides the audit log there because it is not their own faction.
    const res = await api().get('/api/v1/auth/me').set('Cookie', w.superadmin.cookie);
    const membership = res.body.data.factions.find(
      (m: { factionId: string }) => m.factionId === w.faction.id,
    );
    expect(membership).toBeUndefined();
    expect(
      res.body.data.browseableFactions.some((b: { id: string }) => b.id === w.faction.id),
    ).toBe(true);
  });
});
