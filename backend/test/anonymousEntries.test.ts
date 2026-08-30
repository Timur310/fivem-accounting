import { describe, it, expect, beforeEach } from 'vitest';
import { db } from '../src/db/index.js';
import { users, auditLogs } from '../src/db/schema.js';
import { eq } from 'drizzle-orm';
import { api, resetDatabase, seedBasicWorld, type BasicWorld } from './helpers.js';

let w: BasicWorld;
const f = () => `/api/v1/factions/${w.faction.id}`;

async function logEntry(cookie: string, body: Record<string, unknown>) {
  return api().post(`${f()}/entries`).set('Cookie', cookie).send(body);
}

beforeEach(async () => {
  await resetDatabase();
  w = await seedBasicWorld();
});

/**
 * Income that belongs to the faction rather than to any one member. It still
 * has to count towards the treasury — it is real money — but crediting it to
 * whoever happened to type it in would distort every ranking.
 */
describe('anonymous entries', () => {
  it('lets an admin log one', async () => {
    const res = await logEntry(w.admin.cookie, {
      itemTypeId: w.itemTypeId,
      amount: '5000',
      anonymous: true,
    });

    expect(res.status).toBe(201);
    const [placeholder] = await db.select().from(users).where(eq(users.isSystem, true));
    expect(placeholder).toBeDefined();
    expect(res.body.data.userId).toBe(placeholder!.id);
  });

  it('refuses a member without manage_entries', async () => {
    const res = await logEntry(w.member.cookie, {
      itemTypeId: w.itemTypeId,
      amount: '5000',
      anonymous: true,
    });

    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('FORBIDDEN');
    const placeholders = await db.select().from(users).where(eq(users.isSystem, true));
    expect(placeholders).toHaveLength(0);
  });

  it('still credits a normal entry to whoever logged it', async () => {
    const res = await logEntry(w.member.cookie, { itemTypeId: w.itemTypeId, amount: '100' });
    expect(res.status).toBe(201);
    expect(res.body.data.userId).toBe(w.member.id);
  });

  it('reuses the one placeholder rather than making a new one each time', async () => {
    await logEntry(w.admin.cookie, { itemTypeId: w.itemTypeId, amount: '10', anonymous: true });
    await logEntry(w.admin.cookie, { itemTypeId: w.itemTypeId, amount: '20', anonymous: true });

    const placeholders = await db.select().from(users).where(eq(users.isSystem, true));
    expect(placeholders).toHaveLength(1);
  });

  it('records who actually logged it in the audit trail', async () => {
    await logEntry(w.admin.cookie, { itemTypeId: w.itemTypeId, amount: '10', anonymous: true });

    const logs = await db.select().from(auditLogs).where(eq(auditLogs.entityType, 'entry'));
    expect(logs).toHaveLength(1);
    // Anonymous hides the name from the rankings, not from the faction's history.
    expect(logs[0]!.userId).toBe(w.admin.id);
    expect(logs[0]!.details).toMatchObject({ anonymous: true });
  });

  it('keeps the placeholder off the faction roster', async () => {
    await logEntry(w.admin.cookie, { itemTypeId: w.itemTypeId, amount: '10', anonymous: true });

    const res = await api().get(`${f()}/members`).set('Cookie', w.admin.cookie);
    expect(res.body.data).toHaveLength(2);
  });
});

describe('anonymous entries and the rankings', () => {
  beforeEach(async () => {
    await logEntry(w.member.cookie, { itemTypeId: w.itemTypeId, amount: '1000' });
    await logEntry(w.admin.cookie, { itemTypeId: w.itemTypeId, amount: '9999', anonymous: true });
  });

  it('leaves them out of the faction leaderboard', async () => {
    const res = await api().get(`${f()}/leaderboard?period=all`).set('Cookie', w.admin.cookie);

    expect(res.status).toBe(200);
    expect(res.body.data.rankings).toHaveLength(1);
    expect(res.body.data.rankings[0].username).toBe('member_user');
    expect(res.body.data.rankings[0].total).toBe(1000);
  });

  it('leaves them out of the cross-faction leaderboard', async () => {
    const res = await api().get('/api/v1/leaderboard?period=all').set('Cookie', w.superadmin.cookie);

    expect(res.status).toBe(200);
    expect(res.body.data.rankings).toHaveLength(1);
    expect(res.body.data.rankings[0].username).toBe('member_user');
  });

  it('leaves them out of the dashboard contributors and the charts', async () => {
    const dashboard = await api().get(`${f()}/dashboard`).set('Cookie', w.admin.cookie);
    expect(dashboard.body.data.topContributors).toHaveLength(1);
    expect(dashboard.body.data.topContributors[0].username).toBe('member_user');

    const charts = await api().get(`${f()}/charts`).set('Cookie', w.admin.cookie);
    expect(charts.body.data.memberContributions).toHaveLength(1);
    expect(charts.body.data.memberItemBreakdown).toHaveLength(1);
  });

  it('leaves them out of the report member ranking', async () => {
    const res = await api().get(`${f()}/reports/summary`).set('Cookie', w.admin.cookie);

    expect(res.body.data.memberRanking).toHaveLength(1);
    expect(res.body.data.memberRanking[0].username).toBe('member_user');
  });

  it('still counts them as faction income', async () => {
    // The whole point: the money is real, it just has no owner.
    const dashboard = await api().get(`${f()}/dashboard`).set('Cookie', w.admin.cookie);
    expect(dashboard.body.data.grandTotal).toBe(10999);

    const treasury = await api().get(`${f()}/treasury`).set('Cookie', w.admin.cookie);
    expect(treasury.body.data.balances[0].inflow).toBe(10999);

    const report = await api().get(`${f()}/reports/summary`).set('Cookie', w.admin.cookie);
    expect(report.body.data.overview.currencyTotal).toBe(10999);
  });

  it('still shows them in the entry list, under the placeholder name', async () => {
    const res = await api().get(`${f()}/entries`).set('Cookie', w.admin.cookie);

    expect(res.status).toBe(200);
    const anonymous = res.body.data.find((e: { amount: string }) => Number(e.amount) === 9999);
    expect(anonymous).toBeDefined();
    expect(anonymous.username).toBe('Anonymous');
  });
});
