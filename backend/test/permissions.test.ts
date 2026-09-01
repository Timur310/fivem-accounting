import { describe, it, expect, beforeEach } from 'vitest';
import { addMember, api, createUser, resetDatabase, seedBasicWorld, type BasicWorld } from './helpers.js';

let w: BasicWorld;
const f = () => `/api/v1/factions/${w.faction.id}`;

/** Define a rank with the given permissions and put the plain member on it. */
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

beforeEach(async () => {
  await resetDatabase();
  w = await seedBasicWorld();
});

/**
 * A payout list names every recipient and every amount in the faction, so
 * seeing all of it is a management action. Seeing your own requests is not:
 * the permission decides reach, not access.
 */
describe('payout list is permission-gated', () => {
  it('shows a member with no rank only their own', async () => {
    await api().post(`${f()}/payouts`).set('Cookie', w.admin.cookie)
      .send({ recipientUserId: w.admin.id, itemTypeId: w.itemTypeId, amount: '900' });

    const res = await api().get(`${f()}/payouts`).set('Cookie', w.member.cookie);
    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(0);
  });

  it('shows a member whose rank grants something else only their own', async () => {
    await giveMemberRank(['manage_entries']);
    await api().post(`${f()}/payouts`).set('Cookie', w.admin.cookie)
      .send({ recipientUserId: w.admin.id, itemTypeId: w.itemTypeId, amount: '900' });

    const res = await api().get(`${f()}/payouts`).set('Cookie', w.member.cookie);
    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(0);
  });

  it('allows a member whose rank grants manage_payouts', async () => {
    await giveMemberRank(['manage_payouts']);

    const res = await api().get(`${f()}/payouts`).set('Cookie', w.member.cookie);
    expect(res.status).toBe(200);
  });

  it('still allows the faction admin', async () => {
    const res = await api().get(`${f()}/payouts`).set('Cookie', w.admin.cookie);
    expect(res.status).toBe(200);
  });
});

/**
 * Rank permissions are what the whole authorisation model rests on. If holding
 * one delegated permission were enough to rewrite them, that permission would
 * silently be worth all of them.
 */
describe('rank permissions are admin-only', () => {
  const settings = () => `${f()}/settings`;

  it('refuses to let a delegate grant permissions to their own rank', async () => {
    await giveMemberRank(['manage_settings']);

    const res = await api()
      .patch(settings())
      .set('Cookie', w.member.cookie)
      .send({ ranks: [{ name: 'Capo', level: 1, permissions: ['manage_settings', 'manage_payouts'] }] });

    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('FORBIDDEN');

    // And nothing leaked through: the rank still grants only what it had.
    const after = await api().get(settings()).set('Cookie', w.admin.cookie);
    expect(after.body.data.ranks[0].permissions).toEqual(['manage_settings']);
  });

  it('refuses the same through manage_customization, which sounds cosmetic', async () => {
    await giveMemberRank(['manage_customization']);

    const res = await api()
      .patch(settings())
      .set('Cookie', w.member.cookie)
      .send({ ranks: [{ name: 'Capo', level: 1, permissions: ['manage_customization', 'manage_members'] }] });

    expect(res.status).toBe(403);
  });

  it('refuses a brand new rank that arrives with permissions', async () => {
    await giveMemberRank(['manage_settings']);

    const res = await api()
      .patch(settings())
      .set('Cookie', w.member.cookie)
      .send({
        ranks: [
          { name: 'Capo', level: 1, permissions: ['manage_settings'] },
          { name: 'Underboss', level: 2, permissions: ['manage_payouts'] },
        ],
      });

    expect(res.status).toBe(403);
  });

  it('refuses stripping permissions from another rank', async () => {
    const seeded = await api()
      .patch(settings())
      .set('Cookie', w.admin.cookie)
      .send({
        ranks: [
          { name: 'Capo', level: 1, permissions: ['manage_settings'] },
          { name: 'Underboss', level: 2, permissions: ['manage_payouts'] },
        ],
      });
    expect(seeded.status).toBe(200);
    await api()
      .patch(`${f()}/members/${w.member.id}`)
      .set('Cookie', w.admin.cookie)
      .send({ rank: 'Capo' });

    const res = await api()
      .patch(settings())
      .set('Cookie', w.member.cookie)
      .send({
        ranks: [
          { name: 'Capo', level: 1, permissions: ['manage_settings'] },
          { name: 'Underboss', level: 2, permissions: [] },
        ],
      });

    expect(res.status).toBe(403);
  });

  it('still lets a delegate rename and re-level ranks', async () => {
    await giveMemberRank(['manage_settings']);

    const res = await api()
      .patch(settings())
      .set('Cookie', w.member.cookie)
      .send({ ranks: [{ name: 'Capo', level: 5, permissions: ['manage_settings'] }] });

    expect(res.status).toBe(200);
    expect(res.body.data.ranks[0].level).toBe(5);
  });

  it('still lets a delegate change the settings that are theirs to change', async () => {
    await giveMemberRank(['manage_settings']);

    const res = await api()
      .patch(settings())
      .set('Cookie', w.member.cookie)
      .send({ inactivityThresholdDays: 14 });

    expect(res.status).toBe(200);
    expect(res.body.data.inactivityThresholdDays).toBe(14);
  });

  it('lets a superadmin who joined as a plain member change them', async () => {
    // factionRole follows the membership, but the authority does not: the
    // superadmin is still the person who can put a faction back together.
    const joined = await api()
      .post(`${f()}/members`)
      .set('Cookie', w.admin.cookie)
      .send({ discordId: w.superadmin.discordId });
    expect(joined.status).toBe(201);

    const res = await api()
      .patch(settings())
      .set('Cookie', w.superadmin.cookie)
      .send({ ranks: [{ name: 'Capo', level: 1, permissions: ['manage_payouts'] }] });

    expect(res.status).toBe(200);
    expect(res.body.data.ranks[0].permissions).toEqual(['manage_payouts']);
  });

  it('lets a faction admin change rank permissions', async () => {
    const res = await api()
      .patch(settings())
      .set('Cookie', w.admin.cookie)
      .send({ ranks: [{ name: 'Capo', level: 1, permissions: ['manage_payouts'] }] });

    expect(res.status).toBe(200);
    expect(res.body.data.ranks[0].permissions).toEqual(['manage_payouts']);
  });
});

/**
 * `manage_members` is the roster permission: add people, remove them, set
 * their rank. The admin seat is not part of it — an admin implicitly holds
 * every permission, so a delegate who could hand it out (to themselves, most
 * of all) would be holding all of them already.
 */
describe('member roles are admin-only', () => {
  const patchMember = (userId: string) => `${f()}/members/${userId}`;

  it('refuses to let a delegate promote themselves to admin', async () => {
    await giveMemberRank(['manage_members']);

    const res = await api()
      .patch(patchMember(w.member.id))
      .set('Cookie', w.member.cookie)
      .send({ role: 'admin' });

    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('FORBIDDEN');

    // And nothing leaked through: they are still a plain member.
    const roster = await api().get(`${f()}/members`).set('Cookie', w.admin.cookie);
    const row = roster.body.data.find((m: { userId: string }) => m.userId === w.member.id);
    expect(row.role).toBe('member');
  });

  it('refuses to let a delegate demote an admin', async () => {
    // A second admin, so the refusal is about the permission rather than the
    // last-admin guard.
    const other = await createUser('second_admin', 'faction_admin');
    await addMember(w.faction.id, other.id, 'admin');
    await giveMemberRank(['manage_members']);

    const res = await api()
      .patch(patchMember(other.id))
      .set('Cookie', w.member.cookie)
      .send({ role: 'member' });

    expect(res.status).toBe(403);
  });

  it('still lets a delegate set a rank, which is theirs to set', async () => {
    await giveMemberRank(['manage_members']);

    const res = await api()
      .patch(patchMember(w.member.id))
      .set('Cookie', w.member.cookie)
      .send({ rank: 'Capo' });

    expect(res.status).toBe(200);
    expect(res.body.data.rank).toBe('Capo');
  });

  it('lets a role field through when it repeats what the member already holds', async () => {
    await giveMemberRank(['manage_members']);

    const res = await api()
      .patch(patchMember(w.member.id))
      .set('Cookie', w.member.cookie)
      .send({ role: 'member', rank: 'Capo' });

    expect(res.status).toBe(200);
    expect(res.body.data.rank).toBe('Capo');
  });

  it('still lets the faction admin promote a member', async () => {
    const res = await api()
      .patch(patchMember(w.member.id))
      .set('Cookie', w.admin.cookie)
      .send({ role: 'admin' });

    expect(res.status).toBe(200);
    expect(res.body.data.role).toBe('admin');
  });

  it('lets a superadmin who joined as a plain member promote someone', async () => {
    const joined = await api()
      .post(`${f()}/members`)
      .set('Cookie', w.admin.cookie)
      .send({ discordId: w.superadmin.discordId });
    expect(joined.status).toBe(201);

    const res = await api()
      .patch(patchMember(w.member.id))
      .set('Cookie', w.superadmin.cookie)
      .send({ role: 'admin' });

    expect(res.status).toBe(200);
    expect(res.body.data.role).toBe('admin');
  });
});

/**
 * A superadmin holds every faction permission everywhere — the middleware hands
 * them the full set whether or not they belong to the faction. The sidebar
 * relies on exactly that when it shows them every menu, so it is pinned here:
 * a hidden menu would be a lie in one direction, a visible one that 403s in the
 * other.
 */
describe('a superadmin reaches every permission-gated screen', () => {
  const gated = () => [
    ['audit logs', `${f()}/audit-logs`],
    ['laundering', `${f()}/laundering`],
    ['settings', `${f()}/settings`],
    ['reports', `${f()}/reports/summary?period=this_month`],
  ] as const;

  it('while only browsing a faction they never joined', async () => {
    for (const [what, url] of gated()) {
      const res = await api().get(url).set('Cookie', w.superadmin.cookie);
      expect(res.status, `${what} as a non-member superadmin`).toBe(200);
    }
  });

  // The trap: joining as a plain member gives them a membership row, and a rank
  // that grants nothing. Their global role still has to win.
  it('after joining as a plain member on a rank that grants nothing', async () => {
    await addMember(w.faction.id, w.superadmin.id, 'member');
    await giveMemberRank([], 'Soldier');
    const assigned = await api()
      .patch(`${f()}/members/${w.superadmin.id}`)
      .set('Cookie', w.admin.cookie)
      .send({ rank: 'Soldier' });
    expect(assigned.status).toBe(200);

    for (const [what, url] of gated()) {
      const res = await api().get(url).set('Cookie', w.superadmin.cookie);
      expect(res.status, `${what} as a rank-less member superadmin`).toBe(200);
    }
  });
});
