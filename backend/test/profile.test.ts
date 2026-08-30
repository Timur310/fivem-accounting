import { describe, it, expect, beforeEach } from 'vitest';
import { db } from '../src/db/index.js';
import { auditLogs, factionMembers } from '../src/db/schema.js';
import { eq } from 'drizzle-orm';
import {
  api,
  resetDatabase,
  createUser,
  seedBasicWorld,
  createEntry,
  createPayout,
  EXPIRED_COOKIE,
} from './helpers.js';
import type { BasicWorld } from './helpers.js';

describe('in-game name', () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  it('reports a null in-game name for a freshly created account', async () => {
    const user = await createUser('fresh_user');

    const res = await api().get('/api/v1/auth/me').set('Cookie', user.cookie);

    expect(res.status).toBe(200);
    expect(res.body.data.username).toBe('fresh_user');
    // The frontend keys off this null to decide whether to ask for the name.
    expect(res.body.data.inGameName).toBeNull();
  });

  it('stores the name and returns it on the next /me', async () => {
    const user = await createUser('player');

    const patch = await api()
      .patch('/api/v1/auth/me')
      .set('Cookie', user.cookie)
      .send({ inGameName: 'John Doe' });

    expect(patch.status).toBe(200);
    expect(patch.body.data.inGameName).toBe('John Doe');
    // The Discord identity is untouched by the update.
    expect(patch.body.data.username).toBe('player');

    const me = await api().get('/api/v1/auth/me').set('Cookie', user.cookie);
    expect(me.body.data.inGameName).toBe('John Doe');
  });

  it('trims surrounding whitespace', async () => {
    const user = await createUser('player');

    const res = await api()
      .patch('/api/v1/auth/me')
      .set('Cookie', user.cookie)
      .send({ inGameName: '  Jane Roe  ' });

    expect(res.status).toBe(200);
    expect(res.body.data.inGameName).toBe('Jane Roe');
  });

  it('lets a player correct a name they already set', async () => {
    const user = await createUser('player');

    await api()
      .patch('/api/v1/auth/me')
      .set('Cookie', user.cookie)
      .send({ inGameName: 'Jhon Doe' });

    const res = await api()
      .patch('/api/v1/auth/me')
      .set('Cookie', user.cookie)
      .send({ inGameName: 'John Doe' });

    expect(res.status).toBe(200);
    expect(res.body.data.inGameName).toBe('John Doe');
  });

  it('only touches the caller, not other accounts', async () => {
    const user = await createUser('player');
    const other = await createUser('other_player');

    await api()
      .patch('/api/v1/auth/me')
      .set('Cookie', user.cookie)
      .send({ inGameName: 'John Doe' });

    const res = await api().get('/api/v1/auth/me').set('Cookie', other.cookie);
    expect(res.body.data.inGameName).toBeNull();
  });

  it('records the change in the audit log', async () => {
    const user = await createUser('player');

    await api()
      .patch('/api/v1/auth/me')
      .set('Cookie', user.cookie)
      .send({ inGameName: 'John Doe' });

    const logs = await db.select().from(auditLogs).where(eq(auditLogs.userId, user.id));
    expect(logs).toHaveLength(1);
    expect(logs[0]!.action).toBe('update_profile');
    expect(logs[0]!.entityType).toBe('user');
    expect(logs[0]!.details).toMatchObject({
      inGameName: 'John Doe',
      previousInGameName: null,
    });
  });

  it('rejects a name that is too short', async () => {
    const user = await createUser('player');

    const res = await api()
      .patch('/api/v1/auth/me')
      .set('Cookie', user.cookie)
      .send({ inGameName: 'J' });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('rejects a name that is only whitespace', async () => {
    const user = await createUser('player');

    const res = await api()
      .patch('/api/v1/auth/me')
      .set('Cookie', user.cookie)
      .send({ inGameName: '    ' });

    expect(res.status).toBe(400);
  });

  it('rejects a name longer than the column allows', async () => {
    const user = await createUser('player');

    const res = await api()
      .patch('/api/v1/auth/me')
      .set('Cookie', user.cookie)
      .send({ inGameName: 'x'.repeat(51) });

    expect(res.status).toBe(400);
  });

  it('rejects a missing or non-string name', async () => {
    const user = await createUser('player');

    const missing = await api()
      .patch('/api/v1/auth/me')
      .set('Cookie', user.cookie)
      .send({});
    expect(missing.status).toBe(400);

    const wrongType = await api()
      .patch('/api/v1/auth/me')
      .set('Cookie', user.cookie)
      .send({ inGameName: 42 });
    expect(wrongType.status).toBe(400);
  });

  it('requires authentication', async () => {
    const anonymous = await api()
      .patch('/api/v1/auth/me')
      .send({ inGameName: 'John Doe' });
    expect(anonymous.status).toBe(401);

    const badCookie = await api()
      .patch('/api/v1/auth/me')
      .set('Cookie', EXPIRED_COOKIE)
      .send({ inGameName: 'John Doe' });
    expect(badCookie.status).toBe(401);
  });
});

/**
 * The in-game name is added alongside the Discord username everywhere a user
 * is surfaced, never in place of it: the frontend picks which one to show, and
 * anything already reading `username` keeps working.
 */
describe('in-game name across the API', () => {
  let w: BasicWorld;
  const f = () => `/api/v1/factions/${w.faction.id}`;

  beforeEach(async () => {
    await resetDatabase();
    w = await seedBasicWorld();
    // Only the member fills in a name; the admin stays null on purpose so the
    // "not answered yet" case is covered by the same assertions.
    await api()
      .patch('/api/v1/auth/me')
      .set('Cookie', w.member.cookie)
      .send({ inGameName: 'John Doe' });
  });

  it('lists it on the faction roster, next to the Discord name', async () => {
    const res = await api().get(`${f()}/members`).set('Cookie', w.admin.cookie);

    expect(res.status).toBe(200);
    const member = res.body.data.find((m: { userId: string }) => m.userId === w.member.id);
    expect(member.username).toBe('member_user');
    expect(member.inGameName).toBe('John Doe');

    const admin = res.body.data.find((m: { userId: string }) => m.userId === w.admin.id);
    expect(admin.username).toBe('admin_user');
    expect(admin.inGameName).toBeNull();
  });

  it('returns it on the member profile', async () => {
    const res = await api()
      .get(`${f()}/members/${w.member.id}`)
      .set('Cookie', w.admin.cookie);

    expect(res.status).toBe(200);
    expect(res.body.data.member.username).toBe('member_user');
    expect(res.body.data.member.inGameName).toBe('John Doe');
  });

  it('returns it on the faction detail roster', async () => {
    const res = await api()
      .get(`/api/v1/factions/${w.faction.id}`)
      .set('Cookie', w.superadmin.cookie);

    expect(res.status).toBe(200);
    const member = res.body.data.members.find((m: { userId: string }) => m.userId === w.member.id);
    expect(member.inGameName).toBe('John Doe');
  });

  it('returns it on the entry list and the dashboard feed', async () => {
    await createEntry(w.faction.id, w.member.id, w.itemTypeId, '1000');

    const list = await api().get(`${f()}/entries`).set('Cookie', w.admin.cookie);
    expect(list.status).toBe(200);
    expect(list.body.data[0].username).toBe('member_user');
    expect(list.body.data[0].inGameName).toBe('John Doe');

    const dashboard = await api().get(`${f()}/dashboard`).set('Cookie', w.admin.cookie);
    expect(dashboard.status).toBe(200);
    expect(dashboard.body.data.recentEntries[0].inGameName).toBe('John Doe');
    expect(dashboard.body.data.topContributors[0].username).toBe('member_user');
    expect(dashboard.body.data.topContributors[0].inGameName).toBe('John Doe');
  });

  it('returns it on the inactive-member list', async () => {
    // Someone who joined more recently than the inactivity threshold is never
    // flagged, so backdate the membership to make the member eligible.
    await db
      .update(factionMembers)
      .set({ joinedAt: new Date(Date.now() - 60 * 24 * 60 * 60 * 1000) })
      .where(eq(factionMembers.userId, w.member.id));

    // No entries at all, so the member counts as inactive for the admin view.
    const res = await api().get(`${f()}/dashboard`).set('Cookie', w.admin.cookie);

    const member = res.body.data.inactiveMembers.find(
      (m: { userId: string }) => m.userId === w.member.id,
    );
    expect(member.inGameName).toBe('John Doe');
  });

  it('returns it on both leaderboards without changing the ranking', async () => {
    await createEntry(w.faction.id, w.member.id, w.itemTypeId, '8000');
    await createEntry(w.faction.id, w.admin.id, w.itemTypeId, '3000');

    const faction = await api()
      .get(`${f()}/leaderboard?period=all`)
      .set('Cookie', w.admin.cookie);
    expect(faction.status).toBe(200);
    // Aggregation is unchanged: one row per member, ranked by total.
    expect(faction.body.data.rankings).toHaveLength(2);
    expect(faction.body.data.rankings[0].username).toBe('member_user');
    expect(faction.body.data.rankings[0].inGameName).toBe('John Doe');
    expect(faction.body.data.rankings[0].total).toBe(8000);
    expect(faction.body.data.rankings[1].inGameName).toBeNull();

    const global = await api()
      .get('/api/v1/leaderboard?period=all')
      .set('Cookie', w.superadmin.cookie);
    expect(global.status).toBe(200);
    expect(global.body.data.rankings[0].inGameName).toBe('John Doe');
    expect(global.body.data.rankings[0].total).toBe(8000);
  });

  it('returns it on the charts without splitting the aggregates', async () => {
    await createEntry(w.faction.id, w.member.id, w.itemTypeId, '1000');
    await createEntry(w.faction.id, w.member.id, w.itemTypeId, '500');

    const res = await api().get(`${f()}/charts`).set('Cookie', w.admin.cookie);
    expect(res.status).toBe(200);
    // Two entries by one member still collapse into a single grouped row.
    expect(res.body.data.memberContributions).toHaveLength(1);
    expect(res.body.data.memberContributions[0].total).toBe(1500);
    expect(res.body.data.memberContributions[0].inGameName).toBe('John Doe');
    expect(res.body.data.memberItemBreakdown[0].inGameName).toBe('John Doe');
  });

  it('returns it on the report member ranking', async () => {
    await createEntry(w.faction.id, w.member.id, w.itemTypeId, '1000');
    await createEntry(w.faction.id, w.member.id, w.itemTypeId, '2000');

    const res = await api().get(`${f()}/reports/summary`).set('Cookie', w.admin.cookie);
    expect(res.status).toBe(200);
    expect(res.body.data.memberRanking).toHaveLength(1);
    expect(res.body.data.memberRanking[0].currencyTotal).toBe(3000);
    expect(res.body.data.memberRanking[0].inGameName).toBe('John Doe');
  });

  it('returns it on payouts and the treasury feed', async () => {
    await createPayout(w.faction.id, w.member.id, w.admin.id, w.itemTypeId, '500', 'completed');

    const list = await api().get(`${f()}/payouts`).set('Cookie', w.admin.cookie);
    expect(list.status).toBe(200);
    expect(list.body.data[0].recipientUsername).toBe('member_user');
    expect(list.body.data[0].recipientInGameName).toBe('John Doe');

    const treasury = await api().get(`${f()}/treasury`).set('Cookie', w.admin.cookie);
    expect(treasury.status).toBe(200);
    expect(treasury.body.data.recentPayouts[0].recipientInGameName).toBe('John Doe');
  });

  it('returns it for the actor on audit logs', async () => {
    await api()
      .post(`${f()}/entries`)
      .set('Cookie', w.member.cookie)
      .send({ itemTypeId: w.itemTypeId, amount: '100' });

    const res = await api()
      .get(`${f()}/audit-logs?action=create`)
      .set('Cookie', w.admin.cookie);
    expect(res.status).toBe(200);
    expect(res.body.data[0].actorUsername).toBe('member_user');
    expect(res.body.data[0].actorInGameName).toBe('John Doe');
  });

  it('returns it for the author of a note and the issuer of a strike', async () => {
    await api()
      .patch('/api/v1/auth/me')
      .set('Cookie', w.admin.cookie)
      .send({ inGameName: 'Tony Admin' });

    await api()
      .post(`${f()}/members/${w.member.id}/notes`)
      .set('Cookie', w.admin.cookie)
      .send({ content: 'Reliable', category: 'general' });
    await api()
      .post(`${f()}/members/${w.member.id}/strikes`)
      .set('Cookie', w.admin.cookie)
      .send({ reason: 'Late', severity: 'warning' });

    const notes = await api()
      .get(`${f()}/members/${w.member.id}/notes`)
      .set('Cookie', w.admin.cookie);
    expect(notes.status).toBe(200);
    expect(notes.body.data[0].authorInGameName).toBe('Tony Admin');

    const memberStrikes = await api()
      .get(`${f()}/members/${w.member.id}/strikes`)
      .set('Cookie', w.admin.cookie);
    expect(memberStrikes.status).toBe(200);
    expect(memberStrikes.body.data[0].issuerInGameName).toBe('Tony Admin');

    const factionStrikes = await api().get(`${f()}/strikes`).set('Cookie', w.admin.cookie);
    expect(factionStrikes.status).toBe(200);
    expect(factionStrikes.body.data.strikes[0].targetInGameName).toBe('John Doe');
  });

  it('returns it on the superadmin signup list', async () => {
    const res = await api().get('/api/v1/admin/analytics').set('Cookie', w.superadmin.cookie);

    expect(res.status).toBe(200);
    const member = res.body.data.recentSignups.find(
      (u: { id: string }) => u.id === w.member.id,
    );
    expect(member.inGameName).toBe('John Doe');
  });

  it('appends a CSV column without moving the existing ones', async () => {
    await createEntry(w.faction.id, w.member.id, w.itemTypeId, '1234.56');

    const res = await api().get(`${f()}/export/entries`).set('Cookie', w.admin.cookie);
    expect(res.status).toBe(200);

    const [header, firstRow] = res.text.trim().split('\n');
    // The original columns keep their position; the new one is appended, so a
    // consumer reading by index is unaffected.
    expect(header).toBe('Member,Item Type,Amount,Description,Entry Date,Created At,In-Game Name');
    expect(firstRow!.split(',')[0]).toBe('member_user');
    expect(firstRow!.split(',').at(-1)).toBe('John Doe');
  });
});
