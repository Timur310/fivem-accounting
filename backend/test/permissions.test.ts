import { describe, it, expect, beforeEach } from 'vitest';
import { api, resetDatabase, seedBasicWorld, type BasicWorld } from './helpers.js';

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
 * reading it is as much a management action as creating one. It has to sit
 * behind the same permission as the mutations, not behind bare membership.
 */
describe('payout list is permission-gated', () => {
  it('forbids a member with no rank', async () => {
    const res = await api().get(`${f()}/payouts`).set('Cookie', w.member.cookie);
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('FORBIDDEN');
  });

  it('forbids a member whose rank grants something else', async () => {
    await giveMemberRank(['manage_entries']);

    const res = await api().get(`${f()}/payouts`).set('Cookie', w.member.cookie);
    expect(res.status).toBe(403);
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
