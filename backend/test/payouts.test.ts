import { describe, it, expect, beforeEach } from 'vitest';
import {
  api, resetDatabase, seedBasicWorld, createEntry, createItemType, createUser,
  createFaction, addMember, MISSING_UUID, type BasicWorld,
} from './helpers.js';
import { db } from '../src/db/index.js';
import { factions, factionMembers } from '../src/db/schema.js';
import { eq, and } from 'drizzle-orm';

let w: BasicWorld;
const base = () => `/api/v1/factions/${w.faction.id}/payouts`;

beforeEach(async () => {
  await resetDatabase();
  w = await seedBasicWorld();
});

/** Promote the plain member so they hold manage_payouts. */
async function promoteMember(): Promise<void> {
  await db.update(factionMembers).set({ role: 'admin' })
    .where(and(eq(factionMembers.factionId, w.faction.id), eq(factionMembers.userId, w.member.id)));
}

describe('POST /payouts', () => {
  // The permission is the only thing that decides where a payout starts.
  it('settles immediately for someone who can manage payouts', async () => {
    const res = await api().post(base()).set('Cookie', w.admin.cookie)
      .send({ recipientUserId: w.member.id, itemTypeId: w.itemTypeId, amount: '500' });
    expect(res.status).toBe(201);
    expect(res.body.data.status).toBe('completed');
  });

  it('rejects a recipient who is not a faction member', async () => {
    const res = await api().post(base()).set('Cookie', w.admin.cookie)
      .send({ recipientUserId: w.outsider.id, itemTypeId: w.itemTypeId, amount: '500' });
    expect(res.status).toBe(400);
    expect(res.body.error.message).toMatch(/not a member/i);
  });

  it('404s for an item type from another faction', async () => {
    const other = await createUser('other_admin2');
    const otherFaction = await createFaction('Other Faction 2', other.id);
    const foreign = await createItemType(otherFaction.id);
    const res = await api().post(base()).set('Cookie', w.admin.cookie)
      .send({ recipientUserId: w.member.id, itemTypeId: foreign, amount: '500' });
    expect(res.status).toBe(404);
  });

  it('rejects a future payout date', async () => {
    const res = await api().post(base()).set('Cookie', w.admin.cookie)
      .send({ recipientUserId: w.member.id, itemTypeId: w.itemTypeId, amount: '5', payoutDate: '2099-01-01' });
    expect(res.status).toBe(400);
  });

  it('rejects a non-positive amount', async () => {
    const res = await api().post(base()).set('Cookie', w.admin.cookie)
      .send({ recipientUserId: w.member.id, itemTypeId: w.itemTypeId, amount: '0' });
    expect(res.status).toBe(400);
  });

  // Asking for a withdrawal is not a management action; granting one is. A
  // member may put their own name on a request and nobody else's.
  it('lets a plain member request one for themselves', async () => {
    const res = await api().post(base()).set('Cookie', w.member.cookie)
      .send({ recipientUserId: w.member.id, itemTypeId: w.itemTypeId, amount: '5' });
    expect(res.status).toBe(201);
    expect(res.body.data.recipientUserId).toBe(w.member.id);
  });

  it('forbids a plain member putting someone else on it', async () => {
    const res = await api().post(base()).set('Cookie', w.member.cookie)
      .send({ recipientUserId: w.admin.id, itemTypeId: w.itemTypeId, amount: '5' });
    expect(res.status).toBe(403);
  });

  // The whole point of asking is that somebody else answers. Auto-completing a
  // member's own request would let them pay themselves out of the treasury.
  it('leaves a member request pending', async () => {
    const res = await api().post(base()).set('Cookie', w.member.cookie)
      .send({ recipientUserId: w.member.id, itemTypeId: w.itemTypeId, amount: '5' });
    expect(res.body.data.status).toBe('pending');
  });

  it('still settles a payout an admin creates immediately when approval is off', async () => {
    const res = await api().post(base()).set('Cookie', w.admin.cookie)
      .send({ recipientUserId: w.member.id, itemTypeId: w.itemTypeId, amount: '5' });
    expect(res.body.data.status).toBe('completed');
  });
});

describe('GET /payouts', () => {
  it('lists payouts for admins with joined recipient and item type', async () => {
    await api().post(base()).set('Cookie', w.admin.cookie)
      .send({ recipientUserId: w.member.id, itemTypeId: w.itemTypeId, amount: '500' });
    const res = await api().get(base()).set('Cookie', w.admin.cookie);
    expect(res.status).toBe(200);
    expect(res.body.data[0].recipientUsername).toBe('member_user');
    expect(res.body.data[0]).toHaveProperty('itemIsCurrency');
  });

  it('filters by status', async () => {
    await api().post(base()).set('Cookie', w.admin.cookie)
      .send({ recipientUserId: w.member.id, itemTypeId: w.itemTypeId, amount: '500' });
    const none = await api().get(`${base()}?status=pending`).set('Cookie', w.admin.cookie);
    expect(none.body.data).toHaveLength(0);
    const some = await api().get(`${base()}?status=completed`).set('Cookie', w.admin.cookie);
    expect(some.body.data).toHaveLength(1);
  });

  // The full list names every recipient and amount in the faction. Without the
  // permission you see the requests you made and nothing else — but you do see
  // those, or asking would send them somewhere you cannot look.
  it('shows a plain member only the requests they made', async () => {
    await api().post(base()).set('Cookie', w.admin.cookie)
      .send({ recipientUserId: w.admin.id, itemTypeId: w.itemTypeId, amount: '900' });
    await api().post(base()).set('Cookie', w.member.cookie)
      .send({ recipientUserId: w.member.id, itemTypeId: w.itemTypeId, amount: '5' });

    const mine = await api().get(base()).set('Cookie', w.member.cookie);
    expect(mine.status).toBe(200);
    expect(mine.body.data).toHaveLength(1);
    expect(mine.body.data[0].recipientUserId).toBe(w.member.id);

    // The admin still sees both.
    const all = await api().get(base()).set('Cookie', w.admin.cookie);
    expect(all.body.data).toHaveLength(2);
  });

  it('does not let a member widen the list by asking for someone else', async () => {
    await api().post(base()).set('Cookie', w.admin.cookie)
      .send({ recipientUserId: w.admin.id, itemTypeId: w.itemTypeId, amount: '900' });

    const res = await api().get(`${base()}?recipient_user_id=${w.admin.id}`)
      .set('Cookie', w.member.cookie);
    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(0);
  });
});

describe('PATCH /payouts/:payoutId — status machine', () => {
  /**
   * The only way a payout waits: someone without `manage_payouts` asks for one.
   * Anything raised by a person who can settle payouts is settled on the spot.
   */
  async function pendingPayout(): Promise<string> {
    const res = await api().post(base()).set('Cookie', w.member.cookie)
      .send({ recipientUserId: w.member.id, itemTypeId: w.itemTypeId, amount: '500' });
    expect(res.body.data.status).toBe('pending');
    return res.body.data.id;
  }

  // Holding manage_payouts is the whole qualification: there is no separate
  // "somebody else" requirement. Someone who asked for a withdrawal and was
  // then given the permission can settle their own request.
  it('lets the requester settle their own once they hold the permission', async () => {
    const id = await pendingPayout();
    await promoteMember();

    const res = await api().patch(`${base()}/${id}`).set('Cookie', w.member.cookie)
      .send({ status: 'approved' });
    expect(res.status).toBe(200);
    expect(res.body.data.status).toBe('approved');
    expect(res.body.data.approvedBy).toBe(w.member.id);
  });

  it('lets them take it all the way to completed', async () => {
    const id = await pendingPayout();
    await promoteMember();

    const res = await api().patch(`${base()}/${id}`).set('Cookie', w.member.cookie)
      .send({ status: 'completed' });
    expect(res.status).toBe(200);
    expect(res.body.data.status).toBe('completed');
  });

  // Settling is still gated on the permission, just not on who asked.
  it('refuses approval from the requester while they still lack it', async () => {
    const id = await pendingPayout();

    const res = await api().patch(`${base()}/${id}`).set('Cookie', w.member.cookie)
      .send({ status: 'approved' });
    expect(res.status).toBe(403);
  });

  it('allows approval by an admin and records who', async () => {
    const id = await pendingPayout();
    const res = await api().patch(`${base()}/${id}`).set('Cookie', w.admin.cookie)
      .send({ status: 'approved' });
    expect(res.status).toBe(200);
    expect(res.body.data.status).toBe('approved');
    expect(res.body.data.approvedBy).toBe(w.admin.id);
    expect(res.body.data.approvedAt).not.toBeNull();
  });

  it('walks approved -> completed', async () => {
    const id = await pendingPayout();
    await api().patch(`${base()}/${id}`).set('Cookie', w.admin.cookie).send({ status: 'approved' });
    const res = await api().patch(`${base()}/${id}`).set('Cookie', w.admin.cookie).send({ status: 'completed' });
    expect(res.body.data.status).toBe('completed');
  });

  it('treats completed as terminal', async () => {
    const created = await api().post(base()).set('Cookie', w.admin.cookie)
      .send({ recipientUserId: w.member.id, itemTypeId: w.itemTypeId, amount: '500' });
    const res = await api().patch(`${base()}/${created.body.data.id}`)
      .set('Cookie', w.admin.cookie).send({ status: 'pending' });
    expect(res.status).toBe(400);
    expect(res.body.error.message).toMatch(/cannot change/i);
  });

  it('locks the amount once completed', async () => {
    const created = await api().post(base()).set('Cookie', w.admin.cookie)
      .send({ recipientUserId: w.member.id, itemTypeId: w.itemTypeId, amount: '500' });
    const res = await api().patch(`${base()}/${created.body.data.id}`)
      .set('Cookie', w.admin.cookie).send({ amount: '999' });
    expect(res.status).toBe(400);
    expect(res.body.error.message).toMatch(/cannot edit/i);
  });

  it('allows editing while still pending', async () => {
    const id = await pendingPayout();
    const res = await api().patch(`${base()}/${id}`).set('Cookie', w.admin.cookie)
      .send({ amount: '750.00', description: 'revised' });
    expect(res.status).toBe(200);
    expect(res.body.data.amount).toBe('750.00');
  });

  it('404s for an unknown payout', async () => {
    const res = await api().patch(`${base()}/${MISSING_UUID}`).set('Cookie', w.admin.cookie)
      .send({ status: 'completed' });
    expect(res.status).toBe(404);
  });
});

describe('DELETE /payouts/:payoutId', () => {
  it('soft-deletes and removes it from listings', async () => {
    const created = await api().post(base()).set('Cookie', w.admin.cookie)
      .send({ recipientUserId: w.member.id, itemTypeId: w.itemTypeId, amount: '500' });
    const del = await api().delete(`${base()}/${created.body.data.id}`).set('Cookie', w.admin.cookie);
    expect(del.status).toBe(200);
    const list = await api().get(base()).set('Cookie', w.admin.cookie);
    expect(list.body.data).toHaveLength(0);
  });
});

describe('POST /payouts/even-split', () => {
  it('splits evenly across all members', async () => {
    const res = await api().post(`${base()}/even-split`).set('Cookie', w.admin.cookie)
      .send({ itemTypeId: w.itemTypeId, totalAmount: '1000' });
    expect(res.status).toBe(201);
    expect(res.body.data.created).toBe(2);
    expect(res.body.data.perMember).toBe(500);
    expect(res.body.data.remainder).toBe(0);
  });

  it('rounds down and keeps the remainder in the vault', async () => {
    const res = await api().post(`${base()}/even-split`).set('Cookie', w.admin.cookie)
      .send({ itemTypeId: w.itemTypeId, totalAmount: '1000.01' });
    expect(res.body.data.perMember).toBe(500);
    expect(res.body.data.distributedTotal).toBe(1000);
    expect(res.body.data.remainder).toBeCloseTo(0.01, 5);
  });

  it('rejects an amount too small to split', async () => {
    const res = await api().post(`${base()}/even-split`).set('Cookie', w.admin.cookie)
      .send({ itemTypeId: w.itemTypeId, totalAmount: '0.01' });
    expect(res.status).toBe(400);
    expect(res.body.error.message).toMatch(/too small/i);
  });

  it('writes a single batch audit entry, not one per member', async () => {
    await api().post(`${base()}/even-split`).set('Cookie', w.admin.cookie)
      .send({ itemTypeId: w.itemTypeId, totalAmount: '1000' });
    const logs = await api()
      .get(`/api/v1/factions/${w.faction.id}/audit-logs?entity_type=payout_batch`)
      .set('Cookie', w.admin.cookie);
    expect(logs.body.data).toHaveLength(1);
  });

  it('forbids a plain member', async () => {
    const res = await api().post(`${base()}/even-split`).set('Cookie', w.member.cookie)
      .send({ itemTypeId: w.itemTypeId, totalAmount: '100' });
    expect(res.status).toBe(403);
  });
});

describe('GET /treasury', () => {
  const treasury = () => `/api/v1/factions/${w.faction.id}/treasury`;

  it('computes balance as inflow minus completed payouts', async () => {
    await createEntry(w.faction.id, w.member.id, w.itemTypeId, '10000');
    await api().post(base()).set('Cookie', w.admin.cookie)
      .send({ recipientUserId: w.member.id, itemTypeId: w.itemTypeId, amount: '2000' });

    const res = await api().get(treasury()).set('Cookie', w.member.cookie);
    expect(res.status).toBe(200);
    expect(res.body.data.balances[0].inflow).toBe(10000);
    expect(res.body.data.balances[0].outflow).toBe(2000);
    expect(res.body.data.balances[0].balance).toBe(8000);
  });

  it('excludes pending payouts from the balance but reports them separately', async () => {
    await createEntry(w.faction.id, w.member.id, w.itemTypeId, '10000');
    await api().post(base()).set('Cookie', w.member.cookie)
      .send({ recipientUserId: w.member.id, itemTypeId: w.itemTypeId, amount: '500' });

    const res = await api().get(treasury()).set('Cookie', w.member.cookie);
    expect(res.body.data.balances[0].balance).toBe(10000);
    expect(res.body.data.pending).toEqual({ count: 1, total: 500 });
  });

  it('totals only currency types, listing goods separately', async () => {
    const goods = await createItemType(w.faction.id, 'Ammo', { unit: 'pcs', isCurrency: false });
    await createEntry(w.faction.id, w.member.id, w.itemTypeId, '10000');
    await createEntry(w.faction.id, w.member.id, goods, '999');

    const res = await api().get(treasury()).set('Cookie', w.member.cookie);
    expect(res.body.data.netBalance).toBe(10000);
    expect(res.body.data.totals).toEqual({ currencyTypeCount: 1, nonCurrencyTypeCount: 1 });
    const ammo = res.body.data.balances.find((b: { itemTypeName: string }) => b.itemTypeName === 'Ammo');
    expect(ammo.balance).toBe(999);
  });

  it('is readable by a plain member', async () => {
    const res = await api().get(treasury()).set('Cookie', w.member.cookie);
    expect(res.status).toBe(200);
  });

  it('forbids a non-member', async () => {
    const res = await api().get(treasury()).set('Cookie', w.outsider.cookie);
    expect(res.status).toBe(403);
  });
});
