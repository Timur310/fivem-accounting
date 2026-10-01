import { describe, it, expect, beforeEach } from 'vitest';
import { and, eq } from 'drizzle-orm';
import { api, resetDatabase, seedBasicWorld, createUser, addMember, type BasicWorld, type TestUser } from './helpers.js';
import { db } from '../src/db/index.js';
import { notifications } from '../src/db/schema.js';

describe('mentoring', () => {
  let w: BasicWorld;
  let newbie: TestUser;
  let other: TestUser;
  const base = () => `/api/v1/factions/${w.faction.id}/mentoring`;

  beforeEach(async () => {
    await resetDatabase();
    w = await seedBasicWorld();
    newbie = await createUser('newbie');
    other = await createUser('other_member');
    await addMember(w.faction.id, newbie.id);
    await addMember(w.faction.id, other.id);
  });

  // The member from seedBasicWorld mentors the newbie.
  async function pair() {
    const res = await api().post(base()).set('Cookie', w.admin.cookie)
      .send({ menteeUserId: newbie.id, mentorUserId: w.member.id, goal: 'Learn the radio codes' });
    expect(res.status).toBe(201);
    return res.body.data.id as string;
  }

  const note = (id: string, body: Record<string, unknown>, cookie = w.member.cookie) =>
    api().post(`${base()}/${id}/notes`).set('Cookie', cookie).send(body);

  it('pairs a mentor with a mentee and tells the mentor', async () => {
    await pair();
    const [n] = await db.select().from(notifications)
      .where(and(eq(notifications.userId, w.member.id), eq(notifications.type, 'mentor_assigned')));
    expect(n).toBeTruthy();
  });

  it('gives a newcomer one mentor at a time, and nobody themselves', async () => {
    await pair();
    const twice = await api().post(base()).set('Cookie', w.admin.cookie)
      .send({ menteeUserId: newbie.id, mentorUserId: other.id });
    expect(twice.status).toBe(409);
    const self = await api().post(base()).set('Cookie', w.admin.cookie)
      .send({ menteeUserId: other.id, mentorUserId: other.id });
    expect(self.status).toBe(400);
    const outsider = await api().post(base()).set('Cookie', w.admin.cookie)
      .send({ menteeUserId: w.outsider.id, mentorUserId: other.id });
    expect(outsider.status).toBe(400);
  });

  it('needs manage_mentoring to pair people', async () => {
    const res = await api().post(base()).set('Cookie', w.member.cookie)
      .send({ menteeUserId: newbie.id, mentorUserId: other.id });
    expect(res.status).toBe(403);
  });

  it('lets the mentor write, and adds up mistake points only', async () => {
    const id = await pair();
    expect((await note(id, { kind: 'strength', body: 'Calm on the radio', points: 4 })).body.data.points).toBe(0);
    expect((await note(id, { kind: 'mistake', body: 'Shot first', points: 3 })).body.data.points).toBe(3);
    expect((await note(id, { kind: 'mistake', body: 'Late again' })).body.data.points).toBe(1);

    const list = await api().get(base()).set('Cookie', w.member.cookie);
    expect(list.body.data.mentorships).toHaveLength(1);
    expect(list.body.data.mentorships[0]).toMatchObject({ points: 4, counts: { strength: 1, mistake: 2 } });
  });

  // The whole point: the mentor can be honest because the mentee cannot read it.
  it('shows the mentee who mentors them, and nothing that was written', async () => {
    const id = await pair();
    await note(id, { kind: 'weakness', body: 'Talks over people' });

    const list = await api().get(base()).set('Cookie', newbie.cookie);
    expect(list.body.data.mentorships).toHaveLength(0);
    expect(list.body.data.asMentee).toMatchObject({ id, goal: 'Learn the radio codes' });
    expect(JSON.stringify(list.body)).not.toContain('Talks over people');

    expect((await api().get(`${base()}/${id}`).set('Cookie', newbie.cookie)).status).toBe(404);
    expect((await note(id, { kind: 'strength', body: 'I am great' }, newbie.cookie)).status).toBe(404);
  });

  it('keeps other members out of somebody else\'s mentorship', async () => {
    const id = await pair();
    expect((await api().get(`${base()}/${id}`).set('Cookie', other.cookie)).status).toBe(404);
    expect((await note(id, { kind: 'note', body: 'Hi' }, other.cookie)).status).toBe(404);
    expect((await api().get(base()).set('Cookie', other.cookie)).body.data.mentorships).toHaveLength(0);
  });

  it('moves access with the mentor when reassigned', async () => {
    const id = await pair();
    const moved = await api().patch(`${base()}/${id}`).set('Cookie', w.admin.cookie).send({ mentorUserId: other.id });
    expect(moved.status).toBe(200);
    expect((await api().get(`${base()}/${id}`).set('Cookie', other.cookie)).status).toBe(200);
    expect((await api().get(`${base()}/${id}`).set('Cookie', w.member.cookie)).status).toBe(404);
  });

  it('closes with an outcome and scores, and freezes the notes', async () => {
    const id = await pair();
    const written = await note(id, { kind: 'note', body: 'First week done' });
    const closed = await api().post(`${base()}/${id}/close`).set('Cookie', w.admin.cookie)
      .send({ outcome: 'passed', summary: 'Ready', scores: { roleplay: 5, rules: 4 } });
    expect(closed.status).toBe(200);
    expect(closed.body.data.status).toBe('passed');

    expect((await note(id, { kind: 'note', body: 'Too late' })).status).toBe(409);
    expect((await api().patch(`${base()}/notes/${written.body.data.id}`).set('Cookie', w.member.cookie).send({ body: 'x' })).status).toBe(409);

    const finished = await api().get(`${base()}?status=finished`).set('Cookie', w.admin.cookie);
    expect(finished.body.data.mentorships[0]).toMatchObject({ status: 'passed', scores: { roleplay: 5, rules: 4 } });
    // A finished one frees the newcomer for a new mentor.
    const again = await api().post(base()).set('Cookie', w.admin.cookie).send({ menteeUserId: newbie.id, mentorUserId: other.id });
    expect(again.status).toBe(201);
  });

  it('lets only the author or leadership change a note', async () => {
    const id = await pair();
    const written = await note(id, { kind: 'note', body: 'Mine' });
    const byAdmin = await api().patch(`${base()}/notes/${written.body.data.id}`).set('Cookie', w.admin.cookie)
      .send({ kind: 'mistake', points: 2 });
    expect(byAdmin.body.data.points).toBe(2);
    const byOther = await api().delete(`${base()}/notes/${written.body.data.id}`).set('Cookie', other.cookie);
    expect(byOther.status).toBe(404);
    const byAuthor = await api().delete(`${base()}/notes/${written.body.data.id}`).set('Cookie', w.member.cookie);
    expect(byAuthor.status).toBe(200);
  });

  it('stores a point limit and shows a member\'s history to leadership only', async () => {
    await pair();
    const set = await api().patch(`${base()}/settings/limit`).set('Cookie', w.admin.cookie).send({ pointLimit: 5 });
    expect(set.status).toBe(200);
    expect((await api().get(base()).set('Cookie', w.member.cookie)).body.data.pointLimit).toBe(5);

    expect((await api().get(`${base()}/member/${newbie.id}`).set('Cookie', w.admin.cookie)).body.data.mentorships).toHaveLength(1);
    expect((await api().get(`${base()}/member/${newbie.id}`).set('Cookie', w.member.cookie)).status).toBe(403);
  });
});
