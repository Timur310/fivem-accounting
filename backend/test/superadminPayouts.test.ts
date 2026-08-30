import { describe, it, expect, beforeEach } from 'vitest';
import {
  api,
  resetDatabase,
  seedBasicWorld,
  createPayout,
  addMember,
  type BasicWorld,
} from './helpers.js';

let w: BasicWorld;
const f = () => `/api/v1/factions/${w.faction.id}`;

const makePayout = (status: 'pending' | 'completed' | 'rejected' = 'completed') =>
  createPayout(w.faction.id, w.member.id, w.admin.id, w.itemTypeId, '100', status);

beforeEach(async () => {
  await resetDatabase();
  w = await seedBasicWorld();
});

/**
 * A superadmin is the escape hatch for a faction: the person who can take out
 * a payout that should never have been recorded. Joining that faction — as a
 * plain member, to log entries like anyone else — used to strip them of every
 * faction permission, so the one faction they belonged to was the one they
 * could not administer.
 */
describe('a superadmin and payouts', () => {
  it('can delete one in a faction they do not belong to', async () => {
    const id = await makePayout();

    const res = await api().delete(`${f()}/payouts/${id}`).set('Cookie', w.superadmin.cookie);
    expect(res.status).toBe(200);
  });

  it('can still delete one after joining that faction as a plain member', async () => {
    await addMember(w.faction.id, w.superadmin.id, 'member');
    const id = await makePayout();

    const res = await api().delete(`${f()}/payouts/${id}`).set('Cookie', w.superadmin.cookie);
    expect(res.status).toBe(200);
  });

  it('can read the payout list as a plain member of that faction', async () => {
    await addMember(w.faction.id, w.superadmin.id, 'member');

    const res = await api().get(`${f()}/payouts`).set('Cookie', w.superadmin.cookie);
    expect(res.status).toBe(200);
  });

  it('can delete a settled payout, not just a pending one', async () => {
    for (const status of ['pending', 'completed', 'rejected'] as const) {
      const id = await makePayout(status);
      const res = await api().delete(`${f()}/payouts/${id}`).set('Cookie', w.superadmin.cookie);
      expect(res.status, `deleting a ${status} payout`).toBe(200);
    }
  });

  it('takes a deleted payout back out of the treasury', async () => {
    const id = await makePayout('completed');
    const before = await api().get(`${f()}/treasury`).set('Cookie', w.admin.cookie);
    expect(before.body.data.balances[0].outflow).toBe(100);

    await api().delete(`${f()}/payouts/${id}`).set('Cookie', w.superadmin.cookie);

    const after = await api().get(`${f()}/treasury`).set('Cookie', w.admin.cookie);
    expect(after.body.data.balances[0].outflow).toBe(0);
  });

  it('does not hand the same power to a plain member', async () => {
    const id = await makePayout();

    const res = await api().delete(`${f()}/payouts/${id}`).set('Cookie', w.member.cookie);
    expect(res.status).toBe(403);
  });
});

describe('a superadmin who is a plain member keeps every faction permission', () => {
  beforeEach(async () => {
    await addMember(w.faction.id, w.superadmin.id, 'member');
  });

  it('reports them all on /auth/me, so the menus match', async () => {
    const res = await api().get('/api/v1/auth/me').set('Cookie', w.superadmin.cookie);
    const membership = res.body.data.factions.find(
      (m: { factionId: string }) => m.factionId === w.faction.id,
    );

    expect(membership.role).toBe('member');
    expect(membership.permissions).toContain('manage_payouts');
    expect(membership.permissions).toContain('view_audit_logs');
    expect(membership.permissions).toContain('manage_settings');
  });

  it('and the API agrees with what it reported', async () => {
    const audit = await api().get(`${f()}/audit-logs`).set('Cookie', w.superadmin.cookie);
    expect(audit.status).toBe(200);
  });

  it('while still being able to log entries, which browsing superadmins cannot', async () => {
    const res = await api()
      .post(`${f()}/entries`)
      .set('Cookie', w.superadmin.cookie)
      .send({ itemTypeId: w.itemTypeId, amount: '50' });

    expect(res.status).toBe(201);
  });
});
