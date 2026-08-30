import { describe, it, expect, beforeEach } from 'vitest';
import { db } from '../src/db/index.js';
import { auditLogs } from '../src/db/schema.js';
import { eq } from 'drizzle-orm';
import { api, resetDatabase, seedBasicWorld, type BasicWorld } from './helpers.js';

let w: BasicWorld;
const f = () => `/api/v1/factions/${w.faction.id}`;

async function defineRanks(...names: string[]) {
  const res = await api()
    .patch(`${f()}/settings`)
    .set('Cookie', w.admin.cookie)
    .send({ ranks: names.map((name, i) => ({ name, level: i + 1, permissions: [] })) });
  expect(res.status).toBe(200);
}

async function setRank(rank: string | null) {
  const res = await api()
    .patch(`${f()}/members/${w.member.id}`)
    .set('Cookie', w.admin.cookie)
    .send({ rank });
  expect(res.status).toBe(200);
}

async function profile() {
  const res = await api().get(`${f()}/members/${w.member.id}`).set('Cookie', w.admin.cookie);
  expect(res.status).toBe(200);
  return res.body.data.member;
}

/** Backdate the newest member audit row, to stand in for time passing. */
async function backdateLatestMemberLog(days: number) {
  const rows = await db
    .select({ id: auditLogs.id })
    .from(auditLogs)
    .where(eq(auditLogs.entityType, 'member'));
  const newest = rows[rows.length - 1]!;
  const when = new Date(Date.now() - days * 86_400_000);
  await db.update(auditLogs).set({ createdAt: when }).where(eq(auditLogs.id, newest.id));
}

beforeEach(async () => {
  await resetDatabase();
  w = await seedBasicWorld();
});

describe('how long a member has held their rank', () => {
  it('reports nothing for a member with no rank', async () => {
    const member = await profile();
    expect(member.rank).toBeNull();
    expect(member.rankSince).toBeNull();
    expect(member.daysInRank).toBeNull();
  });

  it('starts counting from the moment the rank was given', async () => {
    await defineRanks('Capo');
    await setRank('Capo');

    const member = await profile();
    expect(member.rank).toBe('Capo');
    expect(member.rankSince).not.toBeNull();
    expect(member.daysInRank).toBe(0);
  });

  it('counts whole days since the promotion', async () => {
    await defineRanks('Capo');
    await setRank('Capo');
    await backdateLatestMemberLog(12);

    const member = await profile();
    expect(member.daysInRank).toBe(12);
  });

  it('restarts the count on a rank change, ignoring the older one', async () => {
    await defineRanks('Capo', 'Underboss');
    await setRank('Capo');
    await backdateLatestMemberLog(30);
    await setRank('Underboss');
    await backdateLatestMemberLog(3);

    const member = await profile();
    expect(member.rank).toBe('Underboss');
    // The 30-day-old Capo promotion must not leak into the answer.
    expect(member.daysInRank).toBe(3);
  });

  it('measures the latest spell when a member returns to an earlier rank', async () => {
    await defineRanks('Capo', 'Underboss');
    await setRank('Capo');
    await backdateLatestMemberLog(60);
    await setRank('Underboss');
    await backdateLatestMemberLog(40);
    await setRank('Capo');
    await backdateLatestMemberLog(5);

    const member = await profile();
    expect(member.rank).toBe('Capo');
    expect(member.daysInRank).toBe(5);
  });

  it('is not restarted by an unrelated change to the member', async () => {
    await defineRanks('Capo');
    await setRank('Capo');
    await backdateLatestMemberLog(20);

    // A role change writes an audit row whose before/after rank are identical,
    // so it must not count as entering the rank.
    const promoted = await api()
      .patch(`${f()}/members/${w.member.id}`)
      .set('Cookie', w.admin.cookie)
      .send({ role: 'admin' });
    expect(promoted.status).toBe(200);

    const member = await profile();
    expect(member.daysInRank).toBe(20);
  });

  it('goes back to nothing once the rank is cleared', async () => {
    await defineRanks('Capo');
    await setRank('Capo');
    await setRank(null);

    const member = await profile();
    expect(member.rank).toBeNull();
    expect(member.daysInRank).toBeNull();
  });
});
