import { describe, it, expect, beforeEach } from 'vitest';
import { db } from '../src/db/index.js';
import { users } from '../src/db/schema.js';
import { eq } from 'drizzle-orm';
import {
  api, resetDatabase, seedBasicWorld, createUser, createEntry, addMember,
  type BasicWorld,
} from './helpers.js';

let w: BasicWorld;
const base = () => '/api/v1/admin/users';

async function list(cookie = w.superadmin.cookie) {
  const res = await api().get(base()).set('Cookie', cookie);
  expect(res.status).toBe(200);
  return res.body.data as {
    id: string; username: string; role: string; isProvisional: boolean;
    lastLogin: string | null; factionCount: number; entryCount: number;
  }[];
}

/** Register someone by Discord ID, the way the panel does. */
async function register(username: string) {
  const res = await api()
    .post('/api/v1/admin/provisional-users')
    .set('Cookie', w.superadmin.cookie)
    .send({ discordId: '9'.repeat(18), username });
  expect(res.status).toBe(201);
  return res.body.data.id as string;
}

beforeEach(async () => {
  await resetDatabase();
  w = await seedBasicWorld();
});

/**
 * The superadmin's roster: everyone who has signed in, plus the registrations
 * still waiting for their person, in one list rather than two.
 */
describe('GET /admin/users', () => {
  it('lists everyone who has signed in', async () => {
    const names = (await list()).map((u) => u.username);
    for (const u of [w.admin, w.member, w.outsider, w.superadmin]) {
      expect(names).toContain(u.username);
    }
  });

  it('includes registrations that have never signed in', async () => {
    const id = await register('waiting_user');

    const row = (await list()).find((u) => u.id === id);
    expect(row).toBeDefined();
    expect(row!.isProvisional).toBe(true);
    expect(row!.lastLogin).toBeNull();
  });

  // They are the rows still needing something done about them, and the only
  // ones a superadmin may still rename — so they do not get lost mid-list.
  it('pins registrations to the top, ahead of everyone else', async () => {
    await register('waiting_user');
    // Someone who has signed in very recently would otherwise sort first.
    await db.update(users).set({ lastLogin: new Date() }).where(eq(users.id, w.member.id));

    const rows = await list();
    expect(rows[0]!.isProvisional).toBe(true);
    expect(rows.slice(1).every((u) => !u.isProvisional)).toBe(true);
  });

  // It owns anonymous entries but is not a person; a row for it in the roster
  // would look like a player nobody can find.
  it('leaves the anonymous placeholder out', async () => {
    const [placeholder] = await db
      .insert(users)
      .values({ discordId: 'system:anonymous', username: 'Anonymous', isSystem: true })
      .returning();

    const ids = (await list()).map((u) => u.id);
    expect(ids).not.toContain(placeholder!.id);
  });

  it('reports what each row is carrying', async () => {
    await createEntry(w.faction.id, w.member.id, w.itemTypeId, '100');

    const row = (await list()).find((u) => u.id === w.member.id);
    expect(row!.entryCount).toBe(1);
    expect(row!.factionCount).toBe(1);
    expect(row!.role).toBe('member');
  });

  it('counts every faction someone belongs to', async () => {
    const second = await createUser('second_faction_member');
    await addMember(w.faction.id, second.id, 'member');

    const row = (await list()).find((u) => u.id === second.id);
    expect(row!.factionCount).toBe(1);
  });

  it('refuses anyone who is not a superadmin', async () => {
    for (const who of [w.admin, w.member]) {
      const res = await api().get(base()).set('Cookie', who.cookie);
      expect(res.status, `as ${who.username}`).toBe(403);
    }
  });
});
