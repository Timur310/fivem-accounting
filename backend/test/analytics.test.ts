import { describe, it, expect, beforeEach } from 'vitest';
import {
  api, resetDatabase, seedBasicWorld, createEntry, createItemType,
  createPayout, type BasicWorld,
} from './helpers.js';

let w: BasicWorld;
const f = () => `/api/v1/factions/${w.faction.id}`;

beforeEach(async () => {
  await resetDatabase();
  w = await seedBasicWorld();
});

describe('GET /dashboard', () => {
  it('aggregates totals, members and treasury', async () => {
    await createEntry(w.faction.id, w.member.id, w.itemTypeId, '5000');
    const res = await api().get(`${f()}/dashboard`).set('Cookie', w.member.cookie);
    expect(res.status).toBe(200);
    expect(res.body.data.grandTotal).toBe(5000);
    expect(res.body.data.memberCount).toBe(2);
    expect(res.body.data.adminCount).toBe(1);
    expect(res.body.data.totalsByType[0]).toHaveProperty('isCurrency');
    expect(res.body.data.netBalance).toBe(5000);
  });

  it('counts only currency types in netBalance', async () => {
    const goods = await createItemType(w.faction.id, 'Ammo', { unit: 'pcs', isCurrency: false });
    await createEntry(w.faction.id, w.member.id, w.itemTypeId, '5000');
    await createEntry(w.faction.id, w.member.id, goods, '700');

    const res = await api().get(`${f()}/dashboard`).set('Cookie', w.member.cookie);
    expect(res.body.data.grandTotal).toBe(5700);   // every entry
    expect(res.body.data.netBalance).toBe(5000);   // money only
  });

  it('exposes the inactive-member list to admins only', async () => {
    const asAdmin = await api().get(`${f()}/dashboard`).set('Cookie', w.admin.cookie);
    expect(asAdmin.body.data).toHaveProperty('inactiveMembers');
    const asMember = await api().get(`${f()}/dashboard`).set('Cookie', w.member.cookie);
    expect(asMember.body.data).not.toHaveProperty('inactiveMembers');
  });

  it('404s for an inactive faction', async () => {
    await api().delete(`${f()}`).set('Cookie', w.superadmin.cookie);
    const res = await api().get(`${f()}/dashboard`).set('Cookie', w.admin.cookie);
    expect(res.status).toBe(404);
  });
});

describe('GET /charts', () => {
  it('returns member contributions, item distribution and a gap-filled trend', async () => {
    await createEntry(w.faction.id, w.member.id, w.itemTypeId, '1000');
    const res = await api().get(`${f()}/charts`).set('Cookie', w.member.cookie);
    expect(res.status).toBe(200);
    expect(res.body.data.memberContributions).toHaveLength(1);
    expect(res.body.data.itemDistribution[0]).toHaveProperty('isCurrency');
    expect(res.body.data.dailyTrend.length).toBeGreaterThan(1);
  });

  it('honours the range parameter', async () => {
    const res = await api().get(`${f()}/charts?range=7d`).set('Cookie', w.member.cookie);
    expect(res.status).toBe(200);
    expect(res.body.data.range.days).toBe(7);
  });
});

describe('GET /reports/summary', () => {
  it('separates currency from item totals', async () => {
    const goods = await createItemType(w.faction.id, 'Ammo', { unit: 'pcs', isCurrency: false });
    await createEntry(w.faction.id, w.member.id, w.itemTypeId, '8000');
    await createEntry(w.faction.id, w.admin.id, w.itemTypeId, '3000');
    await createEntry(w.faction.id, w.member.id, goods, '700');

    const res = await api().get(`${f()}/reports/summary`).set('Cookie', w.admin.cookie);
    expect(res.status).toBe(200);
    expect(res.body.data.overview.currencyTotal).toBe(11000);
    expect(res.body.data.overview.itemTotal).toBe(700);
    expect(res.body.data.overview.currencyEntryCount).toBe(2);
    expect(res.body.data.overview.avgPerCurrencyEntry).toBe(5500);
  });

  it('ranks members on currency, reporting goods alongside', async () => {
    const goods = await createItemType(w.faction.id, 'Ammo', { unit: 'pcs', isCurrency: false });
    await createEntry(w.faction.id, w.member.id, w.itemTypeId, '8000');
    await createEntry(w.faction.id, w.member.id, goods, '500');
    await createEntry(w.faction.id, w.admin.id, w.itemTypeId, '3000');

    const res = await api().get(`${f()}/reports/summary`).set('Cookie', w.admin.cookie);
    expect(res.body.data.memberRanking[0].username).toBe('member_user');
    expect(res.body.data.memberRanking[0].currencyTotal).toBe(8000);
    expect(res.body.data.memberRanking[0].itemTotal).toBe(500);
  });

  it('splits the daily breakdown too', async () => {
    await createEntry(w.faction.id, w.member.id, w.itemTypeId, '1000');
    const res = await api().get(`${f()}/reports/summary`).set('Cookie', w.admin.cookie);
    expect(res.body.data.dailyBreakdown[0]).toHaveProperty('currencyTotal');
    expect(res.body.data.dailyBreakdown[0]).toHaveProperty('itemTotal');
  });
});

describe('GET /reports/comparison', () => {
  it('splits period totals and returns null percentages with no baseline', async () => {
    await createEntry(w.faction.id, w.member.id, w.itemTypeId, '5000');
    const res = await api()
      .get(`${f()}/reports/comparison?period_a=last_month&period_b=this_month`)
      .set('Cookie', w.admin.cookie);
    expect(res.status).toBe(200);
    expect(res.body.data.periodB.currencyTotal).toBe(5000);
    expect(res.body.data.deltas.currencyTotal).toBe(5000);
    // Previous period was empty — no baseline, which is not 0%.
    expect(res.body.data.deltas.currencyTotalPercent).toBeNull();
  });
});

describe('GET /reports/growth', () => {
  it('returns one bucket per period, newest last', async () => {
    await createEntry(w.faction.id, w.member.id, w.itemTypeId, '1000');
    const res = await api().get(`${f()}/reports/growth?periods=3`).set('Cookie', w.admin.cookie);
    expect(res.status).toBe(200);
    expect(res.body.data.periods).toHaveLength(3);
    expect(res.body.data.periods[2].totalEntries).toBe(1);
    expect(res.body.data.partial).toBe(true);
  });

  it('supports weekly granularity', async () => {
    const res = await api().get(`${f()}/reports/growth?periods=2&granularity=week`).set('Cookie', w.admin.cookie);
    expect(res.body.data.granularity).toBe('week');
    expect(res.body.data.periods).toHaveLength(2);
  });

  it('forbids a plain member', async () => {
    const res = await api().get(`${f()}/reports/growth`).set('Cookie', w.member.cookie);
    expect(res.status).toBe(403);
  });
});

describe('GET /leaderboard', () => {
  it('ranks members, marking the caller', async () => {
    await createEntry(w.faction.id, w.member.id, w.itemTypeId, '8000');
    await createEntry(w.faction.id, w.admin.id, w.itemTypeId, '3000');

    const res = await api().get(`${f()}/leaderboard?period=all`).set('Cookie', w.admin.cookie);
    expect(res.status).toBe(200);
    expect(res.body.data.rankings[0].username).toBe('member_user');
    expect(res.body.data.rankings[0].rank).toBe(1);
    expect(res.body.data.myRank).toBe(2);
    const mine = res.body.data.rankings.find((r: { isMe: boolean }) => r.isMe);
    expect(mine.username).toBe('admin_user');
  });

  it('gives equal totals the same rank', async () => {
    await createEntry(w.faction.id, w.member.id, w.itemTypeId, '5000');
    await createEntry(w.faction.id, w.admin.id, w.itemTypeId, '5000');
    const res = await api().get(`${f()}/leaderboard?period=all`).set('Cookie', w.admin.cookie);
    expect(res.body.data.rankings[0].rank).toBe(1);
    expect(res.body.data.rankings[1].rank).toBe(1);
  });

  it('filters by item type', async () => {
    const goods = await createItemType(w.faction.id, 'Ammo', { unit: 'pcs', isCurrency: false });
    await createEntry(w.faction.id, w.member.id, w.itemTypeId, '8000');
    await createEntry(w.faction.id, w.admin.id, goods, '50');

    const res = await api()
      .get(`${f()}/leaderboard?period=all&item_type_id=${goods}`)
      .set('Cookie', w.admin.cookie);
    expect(res.body.data.rankings).toHaveLength(1);
    expect(res.body.data.rankings[0].username).toBe('admin_user');
  });

  it('never advertises a period end in the future', async () => {
    const res = await api().get(`${f()}/leaderboard?period=month`).set('Cookie', w.admin.cookie);
    const today = new Date().toISOString().slice(0, 10);
    expect(res.body.data.period.to <= today).toBe(true);
  });
});

describe('GET /leaderboard (cross-faction)', () => {
  it('is superadmin only', async () => {
    const res = await api().get('/api/v1/leaderboard?period=all').set('Cookie', w.admin.cookie);
    expect(res.status).toBe(403);
  });

  it('lists contributors with their faction', async () => {
    await createEntry(w.faction.id, w.member.id, w.itemTypeId, '8000');
    const res = await api().get('/api/v1/leaderboard?period=all').set('Cookie', w.superadmin.cookie);
    expect(res.status).toBe(200);
    expect(res.body.data.rankings[0].factionName).toBe('Test Faction');
  });
});

describe('GET /admin/analytics', () => {
  it('is superadmin only', async () => {
    const res = await api().get('/api/v1/admin/analytics').set('Cookie', w.admin.cookie);
    expect(res.status).toBe(403);
  });

  it('returns system-wide counts', async () => {
    await createEntry(w.faction.id, w.member.id, w.itemTypeId, '1000');
    const res = await api().get('/api/v1/admin/analytics').set('Cookie', w.superadmin.cookie);
    expect(res.status).toBe(200);
    expect(res.body.data.overview.totalFactions).toBeGreaterThanOrEqual(1);
  });
});

describe('GET /audit-logs', () => {
  it('records mutations and is admin-only', async () => {
    await api().post(`${f()}/item-types`).set('Cookie', w.admin.cookie).send({ name: 'Logged' });

    const res = await api().get(`${f()}/audit-logs`).set('Cookie', w.admin.cookie);
    expect(res.status).toBe(200);
    expect(res.body.data.length).toBeGreaterThan(0);

    const denied = await api().get(`${f()}/audit-logs`).set('Cookie', w.member.cookie);
    expect(denied.status).toBe(403);
  });

  it('filters by action and entity type', async () => {
    await api().post(`${f()}/item-types`).set('Cookie', w.admin.cookie).send({ name: 'Logged' });
    const res = await api()
      .get(`${f()}/audit-logs?action=create&entity_type=item_type`)
      .set('Cookie', w.admin.cookie);
    expect(res.body.data.every((l: { action: string }) => l.action === 'create')).toBe(true);
  });
});

describe('GET /export', () => {
  it('streams entries as CSV', async () => {
    await createEntry(w.faction.id, w.member.id, w.itemTypeId, '1234.56');
    const res = await api().get(`${f()}/export/entries`).set('Cookie', w.admin.cookie);
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/csv/);
    expect(res.text).toMatch(/Member,Item Type,Amount/);
    expect(res.text).toMatch(/member_user/);
    // The created-at column used to throw a TypeError here.
    expect(res.text).not.toMatch(/undefined/);
  });

  it('streams the quota report as CSV', async () => {
    await api().post(`${f()}/quotas`).set('Cookie', w.admin.cookie).send({
      itemTypeId: w.itemTypeId, targetAmount: '10000',
      periodType: 'monthly', periodStart: new Date().toISOString().slice(0, 10),
    });
    const res = await api().get(`${f()}/export/quota-report`).set('Cookie', w.admin.cookie);
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/csv/);
    expect(res.text).not.toMatch(/undefined/);
  });
});

describe('POST /bulk', () => {
  it('adds several members at once, reporting skips', async () => {
    const res = await api().post(`${f()}/bulk/members`).set('Cookie', w.admin.cookie)
      .send({ discordIds: [w.outsider.discordId, '000000000000000000'] });
    expect(res.status).toBe(200);
    expect(res.body.data.added).toBe(1);
    // `skipped` is an object, not a list: unknown discord ids vs existing members.
    expect(res.body.data.skipped.notFound).toEqual(['000000000000000000']);
  });

  it('bulk-deletes entries', async () => {
    const e1 = await createEntry(w.faction.id, w.member.id, w.itemTypeId, '100');
    const e2 = await createEntry(w.faction.id, w.member.id, w.itemTypeId, '200');
    const res = await api().post(`${f()}/bulk/entries/bulk-delete`).set('Cookie', w.admin.cookie)
      .send({ entryIds: [e1, e2] });
    expect(res.status).toBe(200);
    expect(res.body.data.deletedCount).toBe(2);

    const list = await api().get(`${f()}/entries`).set('Cookie', w.member.cookie);
    expect(list.body.data).toHaveLength(0);
  });

  it('imports entries from CSV', async () => {
    const csv = 'Item Type,Amount,Date,Description\nCash,500,2026-01-15,imported\n';
    const res = await api().post(`${f()}/bulk/entries/import`).set('Cookie', w.admin.cookie)
      .send({ csv });
    expect(res.status).toBe(200);
    expect(res.body.data.errors).toEqual([]);
    expect(res.body.data.imported).toBe(1);
  });

  it('rejects a CSV without the required columns', async () => {
    const res = await api().post(`${f()}/bulk/entries/import`).set('Cookie', w.admin.cookie)
      .send({ csv: 'Foo,Bar\n1,2\n' });
    expect(res.status).toBe(400);
  });

  it('forbids a plain member', async () => {
    const res = await api().post(`${f()}/bulk/members`).set('Cookie', w.member.cookie)
      .send({ discordIds: [w.outsider.discordId] });
    expect(res.status).toBe(403);
  });
});
