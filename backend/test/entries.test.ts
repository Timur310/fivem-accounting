import { describe, it, expect, beforeEach } from 'vitest';
import {
  api, resetDatabase, seedBasicWorld, createEntry, createItemType,
  createUser, createFaction, addMember, MISSING_UUID, type BasicWorld,
} from './helpers.js';
import { todayDateString } from '../src/lib/date.js';
import { db } from '../src/db/index.js';
import { entries } from '../src/db/schema.js';
import { eq } from 'drizzle-orm';

let w: BasicWorld;
const base = () => `/api/v1/factions/${w.faction.id}/entries`;

beforeEach(async () => {
  await resetDatabase();
  w = await seedBasicWorld();
});

describe('POST /entries', () => {
  it('lets a member log their own contribution', async () => {
    const res = await api()
      .post(base())
      .set('Cookie', w.member.cookie)
      .send({ itemTypeId: w.itemTypeId, amount: '1500.50', description: 'Heist' });
    expect(res.status).toBe(201);
    expect(res.body.data.amount).toBe('1500.50');
    expect(res.body.data.userId).toBe(w.member.id);
  });

  it('defaults the date to today', async () => {
    const res = await api()
      .post(base())
      .set('Cookie', w.member.cookie)
      .send({ itemTypeId: w.itemTypeId, amount: '10' });
    expect(res.status).toBe(201);
    expect(res.body.data.entryDate).toBe(todayDateString());
  });

  it('rejects a future date', async () => {
    const res = await api()
      .post(base())
      .set('Cookie', w.member.cookie)
      .send({ itemTypeId: w.itemTypeId, amount: '10', entryDate: '2099-01-01' });
    expect(res.status).toBe(400);
    expect(res.body.error.message).toMatch(/future/i);
  });

  it('rejects a zero or negative amount', async () => {
    for (const amount of ['0', '-5']) {
      const res = await api()
        .post(base())
        .set('Cookie', w.member.cookie)
        .send({ itemTypeId: w.itemTypeId, amount });
      expect(res.status).toBe(400);
    }
  });

  it('rejects a non-numeric amount', async () => {
    const res = await api()
      .post(base())
      .set('Cookie', w.member.cookie)
      .send({ itemTypeId: w.itemTypeId, amount: 'lots' });
    expect(res.status).toBe(400);
  });

  it('404s for an item type from another faction', async () => {
    const other = await createUser('other_admin');
    const otherFaction = await createFaction('Other Faction', other.id);
    const foreignType = await createItemType(otherFaction.id);
    const res = await api()
      .post(base())
      .set('Cookie', w.member.cookie)
      .send({ itemTypeId: foreignType, amount: '10' });
    expect(res.status).toBe(404);
  });

  it('rejects a disabled item type', async () => {
    const disabled = await createItemType(w.faction.id, 'Old', { isActive: false });
    const res = await api()
      .post(base())
      .set('Cookie', w.member.cookie)
      .send({ itemTypeId: disabled, amount: '10' });
    expect(res.status).toBe(400);
    expect(res.body.error.message).toMatch(/disabled/i);
  });

  // A superadmin is not on the roster of a faction they merely browse, so an
  // entry with nobody named on it would credit someone the leaderboard and the
  // member totals have no row for. They can still book one — they just have to
  // say whose it is.
  it('forbids a superadmin who is not a member from logging onto themselves', async () => {
    const res = await api()
      .post(base())
      .set('Cookie', w.superadmin.cookie)
      .send({ itemTypeId: w.itemTypeId, amount: '10' });
    expect(res.status).toBe(403);
    expect(res.body.error.message).toMatch(/member of this faction/i);
  });

  it('forbids it just the same when they name themselves explicitly', async () => {
    const res = await api()
      .post(base())
      .set('Cookie', w.superadmin.cookie)
      .send({ itemTypeId: w.itemTypeId, amount: '10', userId: w.superadmin.id });
    expect(res.status).toBe(403);
  });

  it('lets a superadmin who is not a member log for a member', async () => {
    const res = await api()
      .post(base())
      .set('Cookie', w.superadmin.cookie)
      .send({ itemTypeId: w.itemTypeId, amount: '250', userId: w.member.id });
    expect(res.status).toBe(201);
    expect(res.body.data.userId).toBe(w.member.id);
  });

  it('lets a superadmin who is not a member log anonymously', async () => {
    const res = await api()
      .post(base())
      .set('Cookie', w.superadmin.cookie)
      .send({ itemTypeId: w.itemTypeId, amount: '250', anonymous: true });
    expect(res.status).toBe(201);
    expect(res.body.data.userId).not.toBe(w.superadmin.id);
  });

  it('still refuses to credit someone outside the faction', async () => {
    const outsider = await createUser('outsider_user');
    const res = await api()
      .post(base())
      .set('Cookie', w.superadmin.cookie)
      .send({ itemTypeId: w.itemTypeId, amount: '250', userId: outsider.id });
    expect(res.status).toBe(404);
  });
});

describe('POST /entries — custom fields', () => {
  it('rejects when a required custom field is missing', async () => {
    await api()
      .patch(`/api/v1/factions/${w.faction.id}`)
      .set('Cookie', w.superadmin.cookie)
      .send({ customFields: [{ name: 'Location', required: true }] });

    const res = await api()
      .post(base())
      .set('Cookie', w.member.cookie)
      .send({ itemTypeId: w.itemTypeId, amount: '10' });
    expect(res.status).toBe(400);
    expect(res.body.error.message).toMatch(/Location/);
  });

  it('stores values for defined fields and drops unknown ones', async () => {
    await api()
      .patch(`/api/v1/factions/${w.faction.id}`)
      .set('Cookie', w.superadmin.cookie)
      .send({ customFields: [{ name: 'Location', required: false }] });

    const res = await api()
      .post(base())
      .set('Cookie', w.member.cookie)
      .send({
        itemTypeId: w.itemTypeId,
        amount: '10',
        customValues: { Location: 'Docks', Bogus: 'dropped' },
      });
    expect(res.status).toBe(201);
    expect(res.body.data.customValues).toEqual({ Location: 'Docks' });
  });
});

describe('GET /entries', () => {
  it('lists entries with joined user and item type', async () => {
    await createEntry(w.faction.id, w.member.id, w.itemTypeId, '100');
    const res = await api().get(base()).set('Cookie', w.member.cookie);
    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(1);
    expect(res.body.data[0].username).toBe('member_user');
    expect(res.body.data[0]).toHaveProperty('itemIsCurrency');
    expect(res.body.meta.total_count).toBe(1);
  });

  it('filters by member', async () => {
    await createEntry(w.faction.id, w.member.id, w.itemTypeId, '100');
    await createEntry(w.faction.id, w.admin.id, w.itemTypeId, '200');
    const res = await api()
      .get(`${base()}?user_id=${w.admin.id}`)
      .set('Cookie', w.member.cookie);
    expect(res.body.data).toHaveLength(1);
    expect(res.body.data[0].amount).toBe('200.00');
  });

  it('filters by date range', async () => {
    await createEntry(w.faction.id, w.member.id, w.itemTypeId, '100', '2020-01-01');
    await createEntry(w.faction.id, w.member.id, w.itemTypeId, '200');
    const res = await api()
      .get(`${base()}?date_from=2020-01-01&date_to=2020-12-31`)
      .set('Cookie', w.member.cookie);
    expect(res.body.data).toHaveLength(1);
  });

  it('searches descriptions', async () => {
    await api().post(base()).set('Cookie', w.member.cookie)
      .send({ itemTypeId: w.itemTypeId, amount: '10', description: 'jewelry store' });
    await api().post(base()).set('Cookie', w.member.cookie)
      .send({ itemTypeId: w.itemTypeId, amount: '20', description: 'bank' });
    const res = await api().get(`${base()}?search=jewel`).set('Cookie', w.member.cookie);
    expect(res.body.data).toHaveLength(1);
  });

  it('paginates', async () => {
    for (let i = 0; i < 3; i++) await createEntry(w.faction.id, w.member.id, w.itemTypeId, '10');
    const res = await api().get(`${base()}?page=1&page_size=2`).set('Cookie', w.member.cookie);
    expect(res.body.data).toHaveLength(2);
    expect(res.body.meta.total_count).toBe(3);
  });

  it('rejects a malformed uuid filter', async () => {
    const res = await api().get(`${base()}?user_id=nope`).set('Cookie', w.member.cookie);
    expect(res.status).toBe(400);
  });
});

describe('PATCH /entries/:entryId', () => {
  it('lets an admin edit an entry', async () => {
    const id = await createEntry(w.faction.id, w.member.id, w.itemTypeId, '100');
    const res = await api()
      .patch(`${base()}/${id}`)
      .set('Cookie', w.admin.cookie)
      .send({ amount: '250.00', description: 'corrected' });
    expect(res.status).toBe(200);
    expect(res.body.data.amount).toBe('250.00');
    expect(res.body.data.updatedAt).not.toBeNull();
  });

  it('forbids a plain member from editing', async () => {
    const id = await createEntry(w.faction.id, w.member.id, w.itemTypeId, '100');
    const res = await api()
      .patch(`${base()}/${id}`)
      .set('Cookie', w.member.cookie)
      .send({ amount: '250.00' });
    expect(res.status).toBe(403);
  });

  it('404s for an unknown entry', async () => {
    const res = await api()
      .patch(`${base()}/${MISSING_UUID}`)
      .set('Cookie', w.admin.cookie)
      .send({ amount: '1' });
    expect(res.status).toBe(404);
  });
});

describe('DELETE /entries/:entryId', () => {
  it('soft-deletes so the entry disappears from listings', async () => {
    const id = await createEntry(w.faction.id, w.member.id, w.itemTypeId, '100');
    const del = await api().delete(`${base()}/${id}`).set('Cookie', w.admin.cookie);
    expect(del.status).toBe(200);

    const list = await api().get(base()).set('Cookie', w.member.cookie);
    expect(list.body.data).toHaveLength(0);
  });

  /**
   * Deleting an entry is `manage_entries`, with one carve-out: a member may
   * undo their OWN entry for five minutes after logging it (§8.2). These pin
   * both edges of that window.
   *
   * This block used to be a single `forbids a plain member` expecting 403 on
   * exactly the case the undo window now allows — it predates the feature and
   * had been failing ever since.
   */
  /** Backdate an entry so it falls outside the five-minute undo window. */
  async function ageBeyondUndoWindow(entryId: string): Promise<void> {
    await db
      .update(entries)
      .set({ createdAt: new Date(Date.now() - 6 * 60 * 1000) })
      .where(eq(entries.id, entryId));
  }

  it('lets a member undo their own entry inside the window', async () => {
    const id = await createEntry(w.faction.id, w.member.id, w.itemTypeId, '100');

    const res = await api().delete(`${base()}/${id}`).set('Cookie', w.member.cookie);
    expect(res.status).toBe(200);

    const list = await api().get(base()).set('Cookie', w.member.cookie);
    expect(list.body.data).toHaveLength(0);
  });

  it('marks that undo as self-undone in the audit log', async () => {
    const id = await createEntry(w.faction.id, w.member.id, w.itemTypeId, '100');
    await api().delete(`${base()}/${id}`).set('Cookie', w.member.cookie);

    const logs = await api()
      .get(`/api/v1/factions/${w.faction.id}/audit-logs?entity_type=entry`)
      .set('Cookie', w.admin.cookie);
    const row = logs.body.data.find((l: { entityId: string }) => l.entityId === id);
    expect(row.details.selfUndone).toBe(true);
  });

  it('forbids a member undoing their own entry once the window has passed', async () => {
    const id = await createEntry(w.faction.id, w.member.id, w.itemTypeId, '100');
    await ageBeyondUndoWindow(id);

    const res = await api().delete(`${base()}/${id}`).set('Cookie', w.member.cookie);
    expect(res.status).toBe(403);
    expect(res.body.error.message).toMatch(/5 minutes/i);
  });

  it("forbids a member deleting somebody else's entry, even a fresh one", async () => {
    const id = await createEntry(w.faction.id, w.admin.id, w.itemTypeId, '100');

    const res = await api().delete(`${base()}/${id}`).set('Cookie', w.member.cookie);
    expect(res.status).toBe(403);
    expect(res.body.error.message).toMatch(/your own entries/i);
  });

  // The permission is not bounded by the window — that carve-out exists only
  // for people who do not hold it.
  it('lets manage_entries delete an old entry belonging to someone else', async () => {
    const id = await createEntry(w.faction.id, w.member.id, w.itemTypeId, '100');
    await ageBeyondUndoWindow(id);

    const res = await api().delete(`${base()}/${id}`).set('Cookie', w.admin.cookie);
    expect(res.status).toBe(200);
  });

  it('404s on a second delete', async () => {
    const id = await createEntry(w.faction.id, w.member.id, w.itemTypeId, '100');
    await api().delete(`${base()}/${id}`).set('Cookie', w.admin.cookie);
    const again = await api().delete(`${base()}/${id}`).set('Cookie', w.admin.cookie);
    expect(again.status).toBe(404);
  });
});

/**
 * Sorting a paginated list has to happen in SQL.
 *
 * Reordering the page the client happens to hold produces something that
 * looks like "the biggest entries" and is actually "the biggest of this
 * page" — wrong rather than merely missing, which is worse.
 */
describe('GET /entries — sorting', () => {
  async function threeAmounts() {
    await createEntry(w.faction.id, w.member.id, w.itemTypeId, '100', '2026-01-01');
    await createEntry(w.faction.id, w.member.id, w.itemTypeId, '900', '2026-01-02');
    await createEntry(w.faction.id, w.member.id, w.itemTypeId, '500', '2026-01-03');
  }

  const amounts = async (qs: string) => {
    const res = await api().get(`${base()}${qs}`).set('Cookie', w.member.cookie);
    expect(res.status).toBe(200);
    return res.body.data.map((e: { amount: string }) => Number(e.amount));
  };

  it('sorts by amount, both ways', async () => {
    await threeAmounts();
    expect(await amounts('?sort=amount&dir=desc')).toEqual([900, 500, 100]);
    expect(await amounts('?sort=amount&dir=asc')).toEqual([100, 500, 900]);
  });

  it('sorts by date', async () => {
    await threeAmounts();
    // Newest first by date means the 3rd of January, which holds 500.
    expect((await amounts('?sort=date&dir=desc'))[0]).toBe(500);
    expect((await amounts('?sort=date&dir=asc'))[0]).toBe(100);
  });

  it('defaults to newest first with no sort given', async () => {
    await threeAmounts();
    expect((await amounts(''))[0]).toBe(500);
  });

  // A stale bookmark should degrade to the normal view, not 400.
  it('falls back to the default on an unknown field', async () => {
    await threeAmounts();
    expect(await amounts('?sort=nonsense&dir=desc')).toEqual(await amounts(''));
  });

  it('refuses a direction that is not asc or desc', async () => {
    const res = await api().get(`${base()}?sort=amount&dir=sideways`).set('Cookie', w.member.cookie);
    expect(res.status).toBe(400);
  });

  // The whole reason this is server-side: page two must be the real page two
  // of the sorted set, not a re-shuffle of whatever arrived.
  it('sorts across pages rather than within one', async () => {
    for (const amount of ['10', '20', '30', '40', '50']) {
      await createEntry(w.faction.id, w.member.id, w.itemTypeId, amount);
    }

    const page1 = await amounts('?sort=amount&dir=desc&page=1&page_size=2');
    const page2 = await amounts('?sort=amount&dir=desc&page=2&page_size=2');
    expect(page1).toEqual([50, 40]);
    expect(page2).toEqual([30, 20]);
  });

  // Equal keys have no inherent order in Postgres, so without a tiebreaker
  // rows can repeat or vanish between pages.
  it('keeps equal amounts in a stable order across pages', async () => {
    for (let i = 0; i < 6; i++) {
      await createEntry(w.faction.id, w.member.id, w.itemTypeId, '100');
    }

    const ids = async (page: number) => {
      const res = await api()
        .get(`${base()}?sort=amount&dir=desc&page=${page}&page_size=3`)
        .set('Cookie', w.member.cookie);
      return res.body.data.map((e: { id: string }) => e.id);
    };

    const first = [...(await ids(1)), ...(await ids(2))];
    const again = [...(await ids(1)), ...(await ids(2))];
    expect(first).toEqual(again);
    expect(new Set(first).size).toBe(6);
  });
});
