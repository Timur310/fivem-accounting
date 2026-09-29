import { describe, it, expect, beforeEach } from 'vitest';
import { and, eq } from 'drizzle-orm';
import { api, resetDatabase, seedBasicWorld, type BasicWorld } from './helpers.js';
import { db } from '../src/db/index.js';
import { factionMembers, notifications } from '../src/db/schema.js';

/**
 * The notifications for things that happen *to* a member — each one a thing
 * they could previously only find out by going and looking.
 */
let w: BasicWorld;
const f = () => `/api/v1/factions/${w.faction.id}`;

beforeEach(async () => {
  await resetDatabase();
  w = await seedBasicWorld();
});

async function inbox(userId: string, type: string) {
  return db.select().from(notifications)
    .where(and(eq(notifications.userId, userId), eq(notifications.type, type)));
}

const hoursAgo = (hours: number) => new Date(Date.now() - hours * 3_600_000).toISOString();

describe('a complaint answered', () => {
  async function filed() {
    const res = await api().post(`${f()}/complaints`).set('Cookie', w.member.cookie)
      .send({ subject: 'Rota', body: 'Same people every weekend.' });
    expect(res.status).toBe(201);
    return res.body.data.id as string;
  }

  it('tells the author once it is settled', async () => {
    const id = await filed();
    await api().patch(`${f()}/complaints/${id}`).set('Cookie', w.admin.cookie)
      .send({ status: 'resolved', resolutionNote: 'Rota changed.' });

    const rows = await inbox(w.member.id, 'complaint_answered');
    expect(rows).toHaveLength(1);
    expect(rows[0]!.data).toMatchObject({ subject: 'Rota', status: 'resolved' });
    expect(rows[0]!.linkView).toBe('complaints');
  });

  // "Looking into it" is not an answer yet.
  it('says nothing while it is only being looked at', async () => {
    const id = await filed();
    await api().patch(`${f()}/complaints/${id}`).set('Cookie', w.admin.cookie)
      .send({ status: 'in_review' });
    expect(await inbox(w.member.id, 'complaint_answered')).toHaveLength(0);
  });

  it('does not tell anybody about an anonymous one', async () => {
    const res = await api().post(`${f()}/complaints`).set('Cookie', w.member.cookie)
      .send({ subject: 'x', body: 'y', isAnonymous: true });
    await api().patch(`${f()}/complaints/${res.body.data.id}`).set('Cookie', w.admin.cookie)
      .send({ status: 'dismissed' });
    const all = await db.select().from(notifications).where(eq(notifications.type, 'complaint_answered'));
    expect(all).toHaveLength(0);
  });

  it('only tells them once, however often the note is edited', async () => {
    const id = await filed();
    await api().patch(`${f()}/complaints/${id}`).set('Cookie', w.admin.cookie).send({ status: 'resolved' });
    await api().patch(`${f()}/complaints/${id}`).set('Cookie', w.admin.cookie)
      .send({ resolutionNote: 'Added detail.' });
    expect(await inbox(w.member.id, 'complaint_answered')).toHaveLength(1);
  });
});

describe('a shift changed by somebody else', () => {
  async function memberCanClock() {
    await db.update(factionMembers).set({ role: 'admin' })
      .where(and(eq(factionMembers.factionId, w.faction.id), eq(factionMembers.userId, w.member.id)));
  }

  async function membersShift() {
    await memberCanClock();
    const res = await api().post(`${f()}/shifts`).set('Cookie', w.member.cookie)
      .send({ startedAt: hoursAgo(4), endedAt: hoursAgo(2) });
    expect(res.status).toBe(201);
    return res.body.data.id as string;
  }

  it('tells the owner when a manager corrects it', async () => {
    const id = await membersShift();
    await api().patch(`${f()}/shifts/${id}`).set('Cookie', w.admin.cookie).send({ breakMinutes: 15 });
    const rows = await inbox(w.member.id, 'shift_corrected');
    expect(rows).toHaveLength(1);
    expect(typeof (rows[0]!.data as { date?: string }).date).toBe('string');
  });

  it('says nothing when the owner fixes their own', async () => {
    const id = await membersShift();
    await api().patch(`${f()}/shifts/${id}`).set('Cookie', w.member.cookie).send({ breakMinutes: 15 });
    expect(await inbox(w.member.id, 'shift_corrected')).toHaveLength(0);
  });

  it('tells them when a manager adds one for them', async () => {
    await api().post(`${f()}/shifts`).set('Cookie', w.admin.cookie)
      .send({ userId: w.member.id, startedAt: hoursAgo(4), endedAt: hoursAgo(2) });
    expect(await inbox(w.member.id, 'shift_corrected')).toHaveLength(1);
  });

  it('tells them when a manager removes one', async () => {
    const id = await membersShift();
    await api().delete(`${f()}/shifts/${id}`).set('Cookie', w.admin.cookie);
    expect(await inbox(w.member.id, 'shift_removed')).toHaveLength(1);
  });
});

describe('being put on an operation', () => {
  it('tells each crew member, and says how they were rated', async () => {
    const res = await api().post(`${f()}/operations`).set('Cookie', w.admin.cookie).send({
      name: 'Fleeca',
      participants: [{ userId: w.admin.id }, { userId: w.member.id, rating: 4 }],
      loot: [],
    });
    expect(res.status).toBe(201);

    const rated = await inbox(w.member.id, 'operation_rated');
    expect(rated).toHaveLength(1);
    expect(rated[0]!.data).toMatchObject({ name: 'Fleeca', rating: 4 });
    expect(await inbox(w.member.id, 'operation_credited')).toHaveLength(0);
  });

  it('says "you were on it" when nobody rated them', async () => {
    await api().post(`${f()}/operations`).set('Cookie', w.admin.cookie).send({
      name: 'Vangelico', participants: [{ userId: w.member.id }], loot: [],
    });
    expect(await inbox(w.member.id, 'operation_credited')).toHaveLength(1);
  });

  // Telling somebody about the thing they just did is noise.
  it('leaves the logger out', async () => {
    await api().post(`${f()}/operations`).set('Cookie', w.admin.cookie).send({
      name: 'Solo', participants: [{ userId: w.admin.id }], loot: [],
    });
    const all = await db.select().from(notifications).where(eq(notifications.userId, w.admin.id));
    expect(all.filter((n) => n.type.startsWith('operation_'))).toHaveLength(0);
  });
});

describe('a quota reached', () => {
  async function everyoneQuota(target: string) {
    const res = await api().post(`${f()}/quotas`).set('Cookie', w.admin.cookie).send({
      itemTypeId: w.itemTypeId, targetAmount: target, periodType: 'weekly', scope: 'everyone',
      periodStart: '2026-01-01',
    });
    expect(res.status).toBe(201);
  }

  const log = (amount: string) => api().post(`${f()}/entries`).set('Cookie', w.member.cookie)
    .send({ itemTypeId: w.itemTypeId, amount });

  it('tells the member at the moment they cross it', async () => {
    await everyoneQuota('1000');
    await log('600');
    expect(await inbox(w.member.id, 'quota_reached')).toHaveLength(0);
    await log('500');
    await expect.poll(async () => (await inbox(w.member.id, 'quota_reached')).length).toBe(1);
  });

  // Once past it, more entries are not news.
  it('does not tell them again for entries after the target', async () => {
    await everyoneQuota('100');
    await log('150');
    await log('50');
    await log('50');
    await expect.poll(async () => (await inbox(w.member.id, 'quota_reached')).length).toBe(1);
    // Give any stray late write a moment to land before counting for good.
    await new Promise((r) => setTimeout(r, 100));
    expect(await inbox(w.member.id, 'quota_reached')).toHaveLength(1);
  });
});
