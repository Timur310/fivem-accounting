import { describe, it, expect, beforeEach } from 'vitest';
import { api, resetDatabase, seedBasicWorld, type BasicWorld } from './helpers.js';
import { db } from '../src/db/index.js';
import { users, factionMembers } from '../src/db/schema.js';
import { eq } from 'drizzle-orm';

let w: BasicWorld;
const provisional = () => '/api/v1/admin/provisional-users';
const f = () => `/api/v1/factions/${w.faction.id}`;

/** Register someone by Discord ID and return the created row. */
async function register(discordId = '123456789012345678', username = 'ghost_player') {
  const res = await api().post(provisional()).set('Cookie', w.superadmin.cookie)
    .send({ discordId, username, inGameName: 'Ghost Player' });
  expect(res.status).toBe(201);
  return res.body.data as { id: string; discordId: string; username: string };
}

beforeEach(async () => {
  await resetDatabase();
  w = await seedBasicWorld();
});

describe('provisional users', () => {
  it('is superadmin-only', async () => {
    for (const cookie of [w.admin.cookie, w.member.cookie]) {
      const res = await api().post(provisional()).set('Cookie', cookie)
        .send({ discordId: '123456789012345678', username: 'ghost' });
      expect(res.status).toBe(403);
    }
  });

  it('registers someone who has never logged in', async () => {
    const created = await register();

    expect(created.username).toBe('ghost_player');
    const [row] = await db.select().from(users).where(eq(users.id, created.id));
    expect(row!.isProvisional).toBe(true);
    expect(row!.inGameName).toBe('Ghost Player');
    expect(row!.lastLogin).toBeNull();
    // Not the anonymous placeholder — this one is a person, and counts as one.
    expect(row!.isSystem).toBe(false);
  });

  it('rejects a Discord ID that is not shaped like one', async () => {
    const res = await api().post(provisional()).set('Cookie', w.superadmin.cookie)
      .send({ discordId: 'not-a-snowflake', username: 'ghost' });
    expect(res.status).toBe(400);
  });

  it('refuses a Discord ID that is already taken', async () => {
    await register();
    const again = await api().post(provisional()).set('Cookie', w.superadmin.cookie)
      .send({ discordId: '123456789012345678', username: 'someone else' });
    expect(again.status).toBe(409);

    // And the same for an account that has really logged in.
    const real = await api().post(provisional()).set('Cookie', w.superadmin.cookie)
      .send({ discordId: w.member.discordId, username: 'impostor' });
    expect(real.status).toBe(409);
    expect(real.body.error.message).toMatch(/already logged in/i);
  });

  it('can be added to a faction and behaves like a member there', async () => {
    const ghost = await register();

    const added = await api().post(`${f()}/members`).set('Cookie', w.admin.cookie)
      .send({ discordId: ghost.discordId });
    expect(added.status).toBe(201);

    const roster = await api().get(`${f()}/members`).set('Cookie', w.admin.cookie);
    const row = roster.body.data.find((m: { userId: string }) => m.userId === ghost.id);
    expect(row.isProvisional).toBe(true);
    expect(row.inGameName).toBe('Ghost Player');
  });

  it('has no inactivity clock until someone signs in', async () => {
    const ghost = await register();
    await api().post(`${f()}/members`).set('Cookie', w.admin.cookie)
      .send({ discordId: ghost.discordId });

    const roster = await api().get(`${f()}/members`).set('Cookie', w.admin.cookie);
    const row = roster.body.data.find((m: { userId: string }) => m.userId === ghost.id);
    expect(row.daysInactive).toBeNull();

    // Backdate both memberships past the threshold: someone who joined today
    // is spared the inactive list regardless, which would hide what this test
    // is about.
    await db.update(factionMembers)
      .set({ joinedAt: new Date(Date.now() - 30 * 86_400_000) })
      .where(eq(factionMembers.factionId, w.faction.id));

    // The dashboard's inactive list leaves the registration out, while the
    // ordinary member who has logged nothing is still on it.
    const dash = await api().get(`${f()}/dashboard`).set('Cookie', w.admin.cookie);
    const flagged = dash.body.data.inactiveMembers.map((m: { userId: string }) => m.userId);
    expect(flagged).not.toContain(ghost.id);
    expect(flagged).toContain(w.member.id);
  });

  it('renames only while nobody has claimed it', async () => {
    const ghost = await register();

    const renamed = await api().patch(`${provisional()}/${ghost.id}`)
      .set('Cookie', w.superadmin.cookie)
      .send({ username: 'ghost_two', inGameName: 'Ghost Two' });
    expect(renamed.status).toBe(200);
    expect(renamed.body.data.inGameName).toBe('Ghost Two');

    // Once the flag is cleared — which is what logging in does — the names are
    // theirs, not ours.
    await db.update(users).set({ isProvisional: false }).where(eq(users.id, ghost.id));
    const late = await api().patch(`${provisional()}/${ghost.id}`)
      .set('Cookie', w.superadmin.cookie)
      .send({ username: 'too_late' });
    expect(late.status).toBe(400);
  });

  it('lists the registrations still waiting', async () => {
    const ghost = await register();
    const res = await api().get(provisional()).set('Cookie', w.superadmin.cookie);

    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(1);
    expect(res.body.data[0].id).toBe(ghost.id);
    expect(res.body.data[0].entryCount).toBe(0);
  });

  // The counts are the whole reason the list is worth reading: they say whether
  // a registration is still empty or already carries history someone would
  // lose. Zero for a row that holds records is worse than no column at all.
  it('reports what a registration is already carrying', async () => {
    const ghost = await register();
    await api().post(`${f()}/members`).set('Cookie', w.admin.cookie)
      .send({ discordId: ghost.discordId });
    await api().post(`${f()}/entries`).set('Cookie', w.admin.cookie)
      .send({ itemTypeId: w.itemTypeId, amount: '250', userId: ghost.id });

    const res = await api().get(provisional()).set('Cookie', w.superadmin.cookie);
    expect(res.body.data[0].factionCount).toBe(1);
    expect(res.body.data[0].entryCount).toBe(1);
  });

  it('deletes an unused registration but not one carrying records', async () => {
    const ghost = await register();
    await api().post(`${f()}/members`).set('Cookie', w.admin.cookie)
      .send({ discordId: ghost.discordId });

    await api().post(`${f()}/entries`).set('Cookie', w.admin.cookie)
      .send({ itemTypeId: w.itemTypeId, amount: '500', userId: ghost.id });

    const refused = await api().delete(`${provisional()}/${ghost.id}`)
      .set('Cookie', w.superadmin.cookie);
    expect(refused.status).toBe(400);
    expect(refused.body.error.message).toMatch(/already carries/i);

    const clean = await register('987654321098765432', 'unused_ghost');
    const gone = await api().delete(`${provisional()}/${clean.id}`)
      .set('Cookie', w.superadmin.cookie);
    expect(gone.status).toBe(200);
  });
});

describe('logging an entry for another member', () => {
  it('credits the named member, not the caller', async () => {
    const ghost = await register();
    await api().post(`${f()}/members`).set('Cookie', w.admin.cookie)
      .send({ discordId: ghost.discordId });

    const res = await api().post(`${f()}/entries`).set('Cookie', w.admin.cookie)
      .send({ itemTypeId: w.itemTypeId, amount: '2500', userId: ghost.id });

    expect(res.status).toBe(201);
    expect(res.body.data.userId).toBe(ghost.id);

    // It counts for them on the leaderboard — the point of the whole exercise.
    const board = await api().get(`${f()}/leaderboard?period=all`).set('Cookie', w.admin.cookie);
    const row = board.body.data.rankings.find((r: { userId: string }) => r.userId === ghost.id);
    expect(Number(row.total)).toBe(2500);
  });

  it('needs manage_entries', async () => {
    const res = await api().post(`${f()}/entries`).set('Cookie', w.member.cookie)
      .send({ itemTypeId: w.itemTypeId, amount: '100', userId: w.admin.id });

    expect(res.status).toBe(403);
    expect(res.body.error.message).toMatch(/manage_entries/);
  });

  it('still lets anyone log their own, named explicitly or not', async () => {
    const res = await api().post(`${f()}/entries`).set('Cookie', w.member.cookie)
      .send({ itemTypeId: w.itemTypeId, amount: '100', userId: w.member.id });

    expect(res.status).toBe(201);
    expect(res.body.data.userId).toBe(w.member.id);
  });

  it('refuses someone outside the faction', async () => {
    const res = await api().post(`${f()}/entries`).set('Cookie', w.admin.cookie)
      .send({ itemTypeId: w.itemTypeId, amount: '100', userId: w.outsider.id });

    expect(res.status).toBe(404);
  });

  it('refuses to be anonymous and credited at once', async () => {
    const res = await api().post(`${f()}/entries`).set('Cookie', w.admin.cookie)
      .send({ itemTypeId: w.itemTypeId, amount: '100', userId: w.member.id, anonymous: true });

    expect(res.status).toBe(400);
  });
});
