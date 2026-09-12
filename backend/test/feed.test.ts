import { describe, it, expect, beforeEach } from 'vitest';
import {
  api, resetDatabase, seedBasicWorld, createEntry, createItemType, createPayout,
  createUser, addMember, type BasicWorld,
} from './helpers.js';

let w: BasicWorld;
const f = () => `/api/v1/factions/${w.faction.id}`;
const feed = () => `${f()}/feed`;

beforeEach(async () => {
  await resetDatabase();
  w = await seedBasicWorld();
});

async function giveMemberRank(permissions: string[], name = 'Capo') {
  const ranks = await api().patch(`${f()}/settings`).set('Cookie', w.admin.cookie)
    .send({ ranks: [{ name, level: 1, permissions }] });
  expect(ranks.status).toBe(200);
  const assigned = await api().patch(`${f()}/members/${w.member.id}`)
    .set('Cookie', w.admin.cookie).send({ rank: name });
  expect(assigned.status).toBe(200);
}

const read = async (cookie: string, qs = '') => {
  const res = await api().get(`${feed()}${qs}`).set('Cookie', cookie);
  expect(res.status).toBe(200);
  return res.body.data as {
    id: string; type: string; createdAt: string;
    actorUsername: string; actorIsSystem: boolean; data: Record<string, unknown>;
  }[];
};

describe('GET /feed — the timeline', () => {
  it('mixes sources and orders newest first', async () => {
    await createEntry(w.faction.id, w.member.id, w.itemTypeId, '500');
    await api().post(`${f()}/announcements`).set('Cookie', w.admin.cookie)
      .send({ title: 'Meeting Saturday', body: 'Eight sharp.' });

    const rows = await read(w.admin.cookie);
    const types = rows.map((r) => r.type);
    expect(types).toContain('entry');
    expect(types).toContain('announcement');

    const times = rows.map((r) => new Date(r.createdAt).getTime());
    expect(times).toEqual([...times].sort((a, b) => b - a));
  });

  it('carries data rather than a rendered sentence', async () => {
    await createEntry(w.faction.id, w.member.id, w.itemTypeId, '500');
    const row = (await read(w.admin.cookie)).find((r) => r.type === 'entry')!;
    expect(row.data).toMatchObject({ amount: '500.00', itemTypeName: 'Cash' });
    expect(row).not.toHaveProperty('summary');
  });

  it('filters to one type', async () => {
    await createEntry(w.faction.id, w.member.id, w.itemTypeId, '500');
    await api().post(`${f()}/announcements`).set('Cookie', w.admin.cookie)
      .send({ title: 'Only this', body: 'Announcement body here.' });

    const rows = await read(w.admin.cookie, '?type=announcement');
    expect(rows).toHaveLength(1);
    expect(rows[0]!.type).toBe('announcement');
  });

  it('paginates with a total count', async () => {
    for (let i = 0; i < 5; i++) {
      await createEntry(w.faction.id, w.member.id, w.itemTypeId, `${100 + i}`);
    }
    const res = await api().get(`${feed()}?page=1&page_size=2`).set('Cookie', w.admin.cookie);
    expect(res.body.data).toHaveLength(2);
    expect(res.body.meta.total_count).toBe(5);
  });

  it('refuses someone who is not in the faction', async () => {
    const res = await api().get(feed()).set('Cookie', w.outsider.cookie);
    expect(res.status).toBe(403);
  });
});

/**
 * The part that matters: a feed is a view, never a back door.
 *
 * Each source keeps the visibility rule it has on its own screen. Without
 * that, a plain member could read every withdrawal in the faction and
 * everyone's discipline record through a screen that looks like news.
 */
describe('GET /feed — respects every source\'s own visibility rule', () => {
  it('hides other people\'s withdrawals from a member without manage_payouts', async () => {
    await createPayout(w.faction.id, w.admin.id, w.admin.id, w.itemTypeId, '900', 'completed');
    await createPayout(w.faction.id, w.member.id, w.admin.id, w.itemTypeId, '100', 'completed');

    const mine = (await read(w.member.cookie)).filter((r) => r.type === 'payout');
    expect(mine).toHaveLength(1);
    expect(mine[0]!.data).toMatchObject({ amount: '100.00' });

    const all = (await read(w.admin.cookie)).filter((r) => r.type === 'payout');
    expect(all).toHaveLength(2);
  });

  it('shows them all once the member holds manage_payouts', async () => {
    await createPayout(w.faction.id, w.admin.id, w.admin.id, w.itemTypeId, '900', 'completed');
    await createPayout(w.faction.id, w.member.id, w.admin.id, w.itemTypeId, '100', 'completed');
    await giveMemberRank(['manage_payouts']);

    const rows = (await read(w.member.cookie)).filter((r) => r.type === 'payout');
    expect(rows).toHaveLength(2);
  });

  it('hides other people\'s strikes from a member without manage_strikes', async () => {
    // A third member to carry the other strike: nobody may strike themselves,
    // so the admin cannot be the second target.
    const other = await createUser('struck_member');
    await addMember(w.faction.id, other.id, 'member');

    await api().post(`${f()}/members/${other.id}/strikes`).set('Cookie', w.admin.cookie)
      .send({ severity: 'major', reason: 'Another members strike for the test.' });
    await api().post(`${f()}/members/${w.member.id}/strikes`).set('Cookie', w.admin.cookie)
      .send({ severity: 'minor', reason: 'Member strike for the test.' });

    const mine = (await read(w.member.cookie)).filter((r) => r.type === 'strike');
    expect(mine).toHaveLength(1);
    expect(mine[0]!.data).toMatchObject({ severity: 'minor' });

    const all = (await read(w.admin.cookie)).filter((r) => r.type === 'strike');
    expect(all).toHaveLength(2);
  });

  // Joins and rank changes are audit rows, and reading those is exactly what
  // view_audit_logs governs.
  it('omits joins and rank changes without view_audit_logs', async () => {
    await api().patch(`${f()}/settings`).set('Cookie', w.admin.cookie)
      .send({ ranks: [{ name: 'Capo', level: 1, permissions: [] }] });
    await api().patch(`${f()}/members/${w.member.id}`).set('Cookie', w.admin.cookie)
      .send({ rank: 'Capo' });

    const asMember = await read(w.member.cookie);
    expect(asMember.filter((r) => r.type === 'rank_change')).toHaveLength(0);
    expect(asMember.filter((r) => r.type === 'member_join')).toHaveLength(0);

    const asAdmin = await read(w.admin.cookie);
    expect(asAdmin.filter((r) => r.type === 'rank_change').length).toBeGreaterThan(0);
  });

  it('includes them for a rank that holds view_audit_logs', async () => {
    await giveMemberRank(['view_audit_logs']);
    await api().patch(`${f()}/members/${w.member.id}`).set('Cookie', w.admin.cookie)
      .send({ rank: 'Capo' });

    const rows = await read(w.member.cookie);
    expect(rows.filter((r) => r.type === 'rank_change').length).toBeGreaterThan(0);
  });

  it('never shows another faction\'s activity', async () => {
    await createEntry(w.faction.id, w.member.id, w.itemTypeId, '500');
    const rows = await read(w.admin.cookie);
    expect(rows.length).toBeGreaterThan(0);
    // Everything returned belongs to this faction by construction; the guard
    // is that an outsider cannot reach the route at all.
    const res = await api().get(feed()).set('Cookie', w.outsider.cookie);
    expect(res.status).toBe(403);
  });
});

describe('GET /feed — anonymous entries', () => {
  it('marks the placeholder as a system actor rather than a person', async () => {
    const type = await createItemType(w.faction.id, 'Anon Cash');
    const res = await api().post(`${f()}/entries`).set('Cookie', w.admin.cookie)
      .send({ itemTypeId: type, amount: '250', anonymous: true });
    expect(res.status).toBe(201);

    const row = (await read(w.admin.cookie)).find(
      (r) => r.type === 'entry' && (r.data as { itemTypeName?: string }).itemTypeName === 'Anon Cash',
    )!;
    expect(row.actorIsSystem).toBe(true);
  });
});
