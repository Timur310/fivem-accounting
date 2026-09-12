import { describe, it, expect, beforeEach } from 'vitest';
import { api, resetDatabase, seedBasicWorld, createUser, addMember, MISSING_UUID, type BasicWorld } from './helpers.js';

let w: BasicWorld;
const f = () => `/api/v1/factions/${w.faction.id}`;
const base = () => `${f()}/announcements`;

beforeEach(async () => {
  await resetDatabase();
  w = await seedBasicWorld();
});

/** Define a rank with the given permissions and put the plain member on it. */
async function giveMemberRank(permissions: string[], name = 'Capo') {
  const ranks = await api().patch(`${f()}/settings`).set('Cookie', w.admin.cookie)
    .send({ ranks: [{ name, level: 1, permissions }] });
  expect(ranks.status).toBe(200);
  const assigned = await api().patch(`${f()}/members/${w.member.id}`)
    .set('Cookie', w.admin.cookie).send({ rank: name });
  expect(assigned.status).toBe(200);
}

async function post(cookie: string, over: Record<string, unknown> = {}) {
  return api().post(base()).set('Cookie', cookie).send({
    title: 'Quota deadline Friday',
    body: 'Everyone needs **50k** in by Friday night.',
    ...over,
  });
}

describe('POST /announcements', () => {
  it('lets someone who speaks for the faction post one', async () => {
    const res = await post(w.admin.cookie);
    expect(res.status).toBe(201);
    expect(res.body.data.priority).toBe('normal');
    expect(res.body.data.isPinned).toBe(false);
  });

  it('refuses a plain member', async () => {
    const res = await post(w.member.cookie);
    expect(res.status).toBe(403);
  });

  it('lets a rank holding manage_settings post', async () => {
    await giveMemberRank(['manage_settings']);
    expect((await post(w.member.cookie)).status).toBe(201);
  });

  it('refuses an unknown priority', async () => {
    expect((await post(w.admin.cookie, { priority: 'screaming' })).status).toBe(400);
  });

  it('refuses an empty body', async () => {
    expect((await post(w.admin.cookie, { body: '   ' })).status).toBe(400);
  });
});

describe('GET /announcements', () => {
  it('is readable by every member — an announcement nobody sees is not one', async () => {
    await post(w.admin.cookie);
    const res = await api().get(base()).set('Cookie', w.member.cookie);
    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(1);
    expect(res.body.data[0].authorUsername).toBe(w.admin.username);
  });

  // A pinned notice that has aged down the list is exactly the one somebody
  // pinned so it would not.
  it('puts pinned announcements first regardless of age', async () => {
    const pinned = await post(w.admin.cookie, { title: 'Old but pinned', isPinned: true });
    await post(w.admin.cookie, { title: 'Newer, unpinned' });

    const res = await api().get(base()).set('Cookie', w.member.cookie);
    expect(res.body.data[0].id).toBe(pinned.body.data.id);
  });

  it('hides an expired announcement but never deletes it', async () => {
    const past = new Date(Date.now() - 60_000).toISOString();
    await post(w.admin.cookie, { title: 'Yesterday news', expiresAt: past });

    const normal = await api().get(base()).set('Cookie', w.member.cookie);
    expect(normal.body.data).toHaveLength(0);

    const withExpired = await api().get(`${base()}?include_expired=true`).set('Cookie', w.member.cookie);
    expect(withExpired.body.data).toHaveLength(1);
  });

  it('keeps one whose expiry is still ahead', async () => {
    const future = new Date(Date.now() + 3_600_000).toISOString();
    await post(w.admin.cookie, { expiresAt: future });
    const res = await api().get(base()).set('Cookie', w.member.cookie);
    expect(res.body.data).toHaveLength(1);
  });

  it('does not leak another faction\'s board', async () => {
    await post(w.admin.cookie);
    const other = await createUser('other_admin', 'faction_admin');
    const res = await api().get(base()).set('Cookie', other.cookie);
    expect(res.status).toBe(403);
  });
});

describe('read tracking', () => {
  it('reports read state per caller and a count for everyone', async () => {
    const created = await post(w.admin.cookie);

    const before = await api().get(base()).set('Cookie', w.member.cookie);
    expect(before.body.data[0].isReadByMe).toBe(false);
    expect(before.body.data[0].readCount).toBe(0);

    await api().post(`${base()}/${created.body.data.id}/read`).set('Cookie', w.member.cookie);

    const after = await api().get(base()).set('Cookie', w.member.cookie);
    expect(after.body.data[0].isReadByMe).toBe(true);
    expect(after.body.data[0].readCount).toBe(1);

    // ...and it is the caller's own state, not a global flag.
    const asAdmin = await api().get(base()).set('Cookie', w.admin.cookie);
    expect(asAdmin.body.data[0].isReadByMe).toBe(false);
    expect(asAdmin.body.data[0].readCount).toBe(1);
  });

  // "When did they first see this" is the question it answers.
  it('does not move the timestamp when read twice', async () => {
    const created = await post(w.admin.cookie);
    const id = created.body.data.id;

    await api().post(`${base()}/${id}/read`).set('Cookie', w.member.cookie);
    const reads1 = await api().get(`${base()}/${id}/reads`).set('Cookie', w.admin.cookie);
    const first = reads1.body.data.find((r: { userId: string }) => r.userId === w.member.id).readAt;

    const second = await api().post(`${base()}/${id}/read`).set('Cookie', w.member.cookie);
    expect(second.status).toBe(200);

    const reads2 = await api().get(`${base()}/${id}/reads`).set('Cookie', w.admin.cookie);
    expect(reads2.body.data.find((r: { userId: string }) => r.userId === w.member.id).readAt).toBe(first);
  });

  // The useful question is who has NOT read it.
  it('returns the whole roster, unread members included', async () => {
    const created = await post(w.admin.cookie);
    await api().post(`${base()}/${created.body.data.id}/read`).set('Cookie', w.member.cookie);

    const res = await api().get(`${base()}/${created.body.data.id}/reads`).set('Cookie', w.admin.cookie);
    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(2);
    const unread = res.body.data.filter((r: { readAt: string | null }) => r.readAt === null);
    expect(unread).toHaveLength(1);
    expect(unread[0].userId).toBe(w.admin.id);
  });

  it('keeps the read list to people who speak for the faction', async () => {
    const created = await post(w.admin.cookie);
    const res = await api().get(`${base()}/${created.body.data.id}/reads`).set('Cookie', w.member.cookie);
    expect(res.status).toBe(403);
  });
});

describe('editing and removing', () => {
  it('lets the author edit their own', async () => {
    const created = await post(w.admin.cookie);
    const res = await api().patch(`${base()}/${created.body.data.id}`)
      .set('Cookie', w.admin.cookie).send({ title: 'Moved to Saturday' });
    expect(res.status).toBe(200);
    expect(res.body.data.title).toBe('Moved to Saturday');
  });

  // Rewriting someone's words under their name is not moderation.
  it('refuses an edit by anyone but the author, permission or not', async () => {
    const created = await post(w.admin.cookie);
    await giveMemberRank(['manage_settings']);

    const res = await api().patch(`${base()}/${created.body.data.id}`)
      .set('Cookie', w.member.cookie).send({ title: 'Not my words' });
    expect(res.status).toBe(403);
  });

  // Taking a notice down, by contrast, is moderation.
  it('lets someone with manage_settings remove another author\'s announcement', async () => {
    const other = await createUser('second_admin');
    await addMember(w.faction.id, other.id, 'admin');
    const created = await post(other.cookie);

    const res = await api().delete(`${base()}/${created.body.data.id}`).set('Cookie', w.admin.cookie);
    expect(res.status).toBe(200);

    const list = await api().get(base()).set('Cookie', w.member.cookie);
    expect(list.body.data).toHaveLength(0);
  });

  it('refuses a plain member removing somebody else\'s', async () => {
    const created = await post(w.admin.cookie);
    const res = await api().delete(`${base()}/${created.body.data.id}`).set('Cookie', w.member.cookie);
    expect(res.status).toBe(403);
  });

  it('404s on one that does not exist', async () => {
    const res = await api().patch(`${base()}/${MISSING_UUID}`)
      .set('Cookie', w.admin.cookie).send({ title: 'Nothing' });
    expect(res.status).toBe(404);
  });
});

describe('posting reaches the roster', () => {
  it('notifies every member except the author', async () => {
    await post(w.admin.cookie, { title: 'Meeting Saturday', priority: 'high' });

    const mine = await api().get('/api/v1/notifications').set('Cookie', w.member.cookie);
    expect(mine.body.data).toHaveLength(1);
    expect(mine.body.data[0].type).toBe('announcement_posted');
    expect(mine.body.data[0].data).toMatchObject({ title: 'Meeting Saturday', priority: 'high' });
    expect(mine.body.data[0].linkView).toBe('announcements');

    const authors = await api().get('/api/v1/notifications').set('Cookie', w.admin.cookie);
    expect(authors.body.data).toHaveLength(0);
  });
});
