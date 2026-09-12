import { describe, it, expect, beforeEach } from 'vitest';
import { api, resetDatabase, seedBasicWorld, createUser, MISSING_UUID, type BasicWorld } from './helpers.js';

let w: BasicWorld;
const bell = () => '/api/v1/notifications';
const f = () => `/api/v1/factions/${w.faction.id}`;

beforeEach(async () => {
  await resetDatabase();
  w = await seedBasicWorld();
});

/** A pending request raised by the member, ready to be settled by the admin. */
async function pendingPayout(): Promise<string> {
  const res = await api().post(`${f()}/payouts`).set('Cookie', w.member.cookie)
    .send({ recipientUserId: w.member.id, itemTypeId: w.itemTypeId, amount: '500' });
  expect(res.body.data.status).toBe('pending');
  return res.body.data.id;
}

const inbox = async (cookie: string) => {
  const res = await api().get(bell()).set('Cookie', cookie);
  expect(res.status).toBe(200);
  return res.body.data as {
    id: string; type: string; readAt: string | null;
    data: Record<string, unknown> | null; linkView: string | null; factionId: string | null;
  }[];
};

/**
 * The whole point of the bell: things the app already knew now reach the
 * person they concern, instead of waiting to be stumbled upon.
 */
describe('notifications are raised by the events that matter', () => {
  it('tells the recipient their withdrawal was approved', async () => {
    const id = await pendingPayout();
    await api().patch(`${f()}/payouts/${id}`).set('Cookie', w.admin.cookie).send({ status: 'approved' });

    const rows = await inbox(w.member.cookie);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.type).toBe('payout_approved');
    expect(rows[0]!.linkView).toBe('payouts');
    expect(rows[0]!.factionId).toBe(w.faction.id);
  });

  it('tells them when it is rejected, and when it is paid', async () => {
    const rejected = await pendingPayout();
    await api().patch(`${f()}/payouts/${rejected}`).set('Cookie', w.admin.cookie).send({ status: 'rejected' });

    const paid = await pendingPayout();
    await api().patch(`${f()}/payouts/${paid}`).set('Cookie', w.admin.cookie).send({ status: 'approved' });
    await api().patch(`${f()}/payouts/${paid}`).set('Cookie', w.admin.cookie).send({ status: 'completed' });

    const types = (await inbox(w.member.cookie)).map((r) => r.type);
    expect(types).toContain('payout_rejected');
    expect(types).toContain('payout_approved');
    expect(types).toContain('payout_completed');
  });

  // Text is never stored: the interface is bilingual and a member can switch
  // language at any time.
  it('stores a type and a data bag rather than a sentence', async () => {
    const id = await pendingPayout();
    await api().patch(`${f()}/payouts/${id}`).set('Cookie', w.admin.cookie).send({ status: 'approved' });

    const row = (await inbox(w.member.cookie))[0]!;
    expect(row.data).toMatchObject({ amount: '500.00', itemTypeName: 'Cash' });
  });

  // Telling someone they did the thing they just did is how a bell becomes
  // something people switch off.
  it('does not tell someone about their own action', async () => {
    const id = await pendingPayout();
    // The admin settles a request raised for the admin.
    const own = await api().post(`${f()}/payouts`).set('Cookie', w.admin.cookie)
      .send({ recipientUserId: w.admin.id, itemTypeId: w.itemTypeId, amount: '100' });
    await api().patch(`${f()}/payouts/${own.body.data.id}`)
      .set('Cookie', w.admin.cookie).send({ status: 'rejected' });

    expect(await inbox(w.admin.cookie)).toHaveLength(0);
    // ...and the member's own request is untouched by that.
    await api().patch(`${f()}/payouts/${id}`).set('Cookie', w.admin.cookie).send({ status: 'approved' });
    expect(await inbox(w.member.cookie)).toHaveLength(1);
  });

  it('tells a member they were struck', async () => {
    await api().post(`${f()}/members/${w.member.id}/strikes`).set('Cookie', w.admin.cookie)
      .send({ severity: 'minor', reason: 'Missed the quota twice running.' });

    const rows = await inbox(w.member.cookie);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.type).toBe('strike_issued');
    expect(rows[0]!.data).toMatchObject({ severity: 'minor' });
  });

  it('tells a reporter their support ticket was answered', async () => {
    const created = await api().post('/api/v1/support').set('Cookie', w.member.cookie)
      .send({ kind: 'bug', subject: 'Quick log broken', message: 'It does not add a row at all.' });

    await api().patch(`/api/v1/support/${created.body.data.id}`)
      .set('Cookie', w.superadmin.cookie).send({ status: 'resolved', resolutionNote: 'Fixed.' });

    const rows = await inbox(w.member.cookie);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.type).toBe('support_resolved');
    expect(rows[0]!.data).toMatchObject({ subject: 'Quick log broken' });
  });

  // The reporter withdrew it themselves; there is nothing to tell them.
  it('raises nothing when a reporter cancels their own ticket', async () => {
    const created = await api().post('/api/v1/support').set('Cookie', w.member.cookie)
      .send({ kind: 'bug', subject: 'Never mind this', message: 'Turned out to be my own mistake.' });
    await api().patch(`/api/v1/support/${created.body.data.id}`)
      .set('Cookie', w.member.cookie).send({ status: 'cancelled' });

    expect(await inbox(w.member.cookie)).toHaveLength(0);
  });
});

describe('the bell is private to its owner', () => {
  it('never shows one person another person\'s notifications', async () => {
    const id = await pendingPayout();
    await api().patch(`${f()}/payouts/${id}`).set('Cookie', w.admin.cookie).send({ status: 'approved' });

    expect(await inbox(w.admin.cookie)).toHaveLength(0);
    expect(await inbox(w.member.cookie)).toHaveLength(1);
  });

  // Not even the superadmin: this is somebody's mail, not a faction ledger.
  it('does not open somebody else\'s bell to a superadmin', async () => {
    const id = await pendingPayout();
    await api().patch(`${f()}/payouts/${id}`).set('Cookie', w.admin.cookie).send({ status: 'approved' });

    expect(await inbox(w.superadmin.cookie)).toHaveLength(0);
  });

  it('refuses an anonymous caller', async () => {
    const res = await api().get(bell());
    expect(res.status).toBe(401);
  });

  it('refuses to let one user mark another\'s notification read', async () => {
    const id = await pendingPayout();
    await api().patch(`${f()}/payouts/${id}`).set('Cookie', w.admin.cookie).send({ status: 'approved' });
    const target = (await inbox(w.member.cookie))[0]!;

    const res = await api().post(`${bell()}/${target.id}/read`).set('Cookie', w.admin.cookie);
    expect(res.status).toBe(404);

    // ...and it is genuinely still unread for its owner.
    expect((await inbox(w.member.cookie))[0]!.readAt).toBeNull();
  });
});

describe('reading and clearing', () => {
  async function twoNotifications() {
    const a = await pendingPayout();
    const b = await pendingPayout();
    await api().patch(`${f()}/payouts/${a}`).set('Cookie', w.admin.cookie).send({ status: 'approved' });
    await api().patch(`${f()}/payouts/${b}`).set('Cookie', w.admin.cookie).send({ status: 'rejected' });
  }

  it('counts the unread ones for the badge', async () => {
    await twoNotifications();
    const res = await api().get(`${bell()}/unread-count`).set('Cookie', w.member.cookie);
    expect(res.body.data.unread).toBe(2);
  });

  it('marks one read without touching the other', async () => {
    await twoNotifications();
    const first = (await inbox(w.member.cookie))[0]!;

    const res = await api().post(`${bell()}/${first.id}/read`).set('Cookie', w.member.cookie);
    expect(res.status).toBe(200);

    const count = await api().get(`${bell()}/unread-count`).set('Cookie', w.member.cookie);
    expect(count.body.data.unread).toBe(1);
  });

  it('marks everything read at once', async () => {
    await twoNotifications();
    await api().post(`${bell()}/read-all`).set('Cookie', w.member.cookie);

    const count = await api().get(`${bell()}/unread-count`).set('Cookie', w.member.cookie);
    expect(count.body.data.unread).toBe(0);
    // Read, not deleted — the list still reads back.
    expect(await inbox(w.member.cookie)).toHaveLength(2);
  });

  it('filters down to the unread ones', async () => {
    await twoNotifications();
    const first = (await inbox(w.member.cookie))[0]!;
    await api().post(`${bell()}/${first.id}/read`).set('Cookie', w.member.cookie);

    const res = await api().get(`${bell()}?unread=true`).set('Cookie', w.member.cookie);
    expect(res.body.data).toHaveLength(1);
    expect(res.body.data[0].id).not.toBe(first.id);
  });

  it('clears the whole list', async () => {
    await twoNotifications();
    await api().delete(bell()).set('Cookie', w.member.cookie);
    expect(await inbox(w.member.cookie)).toHaveLength(0);
  });

  it('404s marking a notification that does not exist', async () => {
    const res = await api().post(`${bell()}/${MISSING_UUID}/read`).set('Cookie', w.member.cookie);
    expect(res.status).toBe(404);
  });
});

/**
 * A notification is a courtesy attached to something that already happened.
 * It must never be able to undo it.
 */
describe('notifications never break the thing that caused them', () => {
  it('still settles the payout for a recipient who has since left', async () => {
    const outsider = await createUser('will_leave');
    const res = await api().post(`${f()}/members`).set('Cookie', w.admin.cookie)
      .send({ discordId: outsider.discordId });
    expect([200, 201]).toContain(res.status);

    const created = await api().post(`${f()}/payouts`).set('Cookie', outsider.cookie)
      .send({ recipientUserId: outsider.id, itemTypeId: w.itemTypeId, amount: '250' });

    const settled = await api().patch(`${f()}/payouts/${created.body.data.id}`)
      .set('Cookie', w.admin.cookie).send({ status: 'approved' });
    expect(settled.status).toBe(200);
    expect(settled.body.data.status).toBe('approved');
  });
});
