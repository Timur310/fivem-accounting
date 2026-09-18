import { describe, it, expect, beforeEach } from 'vitest';
import { and, eq } from 'drizzle-orm';
import {
  api, resetDatabase, seedBasicWorld, createUser, addMember, createItemType,
  createFaction, type BasicWorld,
} from './helpers.js';
import { db } from '../src/db/index.js';
import {
  auditLogs, entries, operationLoot, operationMovements, operationParticipants, operations,
} from '../src/db/schema.js';
import { splitQuantity, splitHaul } from '../src/lib/operations.js';
import { toCents } from '../src/lib/treasury.js';

let w: BasicWorld;
let third: Awaited<ReturnType<typeof createUser>>;
let gold: string;

const f = () => `/api/v1/factions/${w.faction.id}`;
const base = () => `${f()}/operations`;

beforeEach(async () => {
  await resetDatabase();
  w = await seedBasicWorld();
  third = await createUser('third_user');
  await addMember(w.faction.id, third.id, 'member');
  gold = await createItemType(w.faction.id, 'Gold Bar', { unit: 'x', isCurrency: false });
});

/** Give the plain member a rank carrying exactly these permissions. */
async function giveMemberRank(permissions: string[], name = 'Crew') {
  const ranks = await api().patch(`${f()}/settings`).set('Cookie', w.admin.cookie)
    .send({ ranks: [{ name, level: 1, permissions }] });
  expect(ranks.status).toBe(200);
  const assigned = await api().patch(`${f()}/members/${w.member.id}`)
    .set('Cookie', w.admin.cookie).send({ rank: name });
  expect(assigned.status).toBe(200);
}

function log(body: Record<string, unknown>, cookie = w.admin.cookie) {
  return api().post(base()).set('Cookie', cookie).send(body);
}

const sum = (values: string[]) => values.reduce((a, b) => a + toCents(b), 0n);

/**
 * The arithmetic, on its own.
 *
 * This is the whole feature. Everything else is a form around it, and a split
 * that loses a hundredth is a split somebody has to fix by hand — which is
 * exactly the job people were doing before this existed.
 */
describe('splitting a haul', () => {
  it('divides evenly between three', () => {
    const { shares } = splitQuantity('3000.00', [
      { userId: 'a', share: 1 }, { userId: 'b', share: 1 }, { userId: 'c', share: 1 },
    ]);
    expect(shares.map((s) => s.quantity)).toEqual(['1000.00', '1000.00', '1000.00']);
  });

  // 100.00 is 10000 hundredths; three ways is 3333 each with one left over.
  it('hands the odd hundredth out rather than losing it', () => {
    const { shares } = splitQuantity('100.00', [
      { userId: 'a', share: 1 }, { userId: 'b', share: 1 }, { userId: 'c', share: 1 },
    ]);
    expect(shares.map((s) => s.quantity)).toEqual(['33.34', '33.33', '33.33']);
    expect(sum(shares.map((s) => s.quantity))).toBe(toCents('100.00'));
  });

  it('weights a bigger share', () => {
    const { shares } = splitQuantity('1000.00', [
      { userId: 'driver', share: 2 }, { userId: 'b', share: 1 }, { userId: 'c', share: 1 },
    ]);
    expect(shares.map((s) => s.quantity)).toEqual(['500.00', '250.00', '250.00']);
  });

  // 12.5% of 8000 is 1000, leaving 7000 over three: 2333.34 / 2333.33 / 2333.33.
  it('takes the faction cut off the top before the crew split', () => {
    const { factionCut, shares } = splitQuantity('8000.00', [
      { userId: 'a', share: 1 }, { userId: 'b', share: 1 }, { userId: 'c', share: 1 },
    ], '12.50');
    expect(factionCut).toBe('1000.00');
    expect(shares.map((s) => s.quantity)).toEqual(['2333.34', '2333.33', '2333.33']);
    expect(sum([factionCut, ...shares.map((s) => s.quantity)])).toBe(toCents('8000.00'));
  });

  it('gives the whole haul to the faction at 100%', () => {
    const { factionCut, shares } = splitQuantity('500.00', [{ userId: 'a', share: 1 }], '100');
    expect(factionCut).toBe('500.00');
    expect(shares[0]!.quantity).toBe('0.00');
  });

  // Seven people and an awkward number: the only thing that must always hold
  // is that what went in comes out.
  it('always adds back up to the haul', () => {
    const crew = ['a', 'b', 'c', 'd', 'e', 'f', 'g'].map((userId, i) => ({ userId, share: i + 1 }));
    for (const amount of ['1.00', '0.07', '999.99', '1234567.89', '3.33']) {
      for (const cut of ['0', '7.50', '33.33']) {
        const { factionCut, shares } = splitQuantity(amount, crew, cut);
        expect(sum([factionCut, ...shares.map((s) => s.quantity)])).toBe(toCents(amount));
      }
    }
  });

  // Re-logging a job that was typed in wrong must produce the same numbers,
  // not new ones, or the correction is its own argument.
  it('divides the same haul the same way every time', () => {
    const crew = [{ userId: 'a', share: 1 }, { userId: 'b', share: 1 }, { userId: 'c', share: 1 }];
    const once = splitHaul([{ itemTypeId: 'x', quantity: '100.00' }], crew);
    const twice = splitHaul([{ itemTypeId: 'x', quantity: '100.00' }], crew);
    expect(once).toEqual(twice);
  });
});

describe('who may log and revert', () => {
  it('refuses to log without log_operations', async () => {
    const res = await log({
      name: 'Pacific Standard',
      participants: [{ userId: w.member.id }],
      loot: [{ itemTypeId: w.itemTypeId, quantity: '100.00' }],
    }, w.member.cookie);
    expect(res.status).toBe(403);
  });

  it('allows it once the rank carries it', async () => {
    await giveMemberRank(['log_operations']);
    const res = await log({
      name: 'Pacific Standard',
      participants: [{ userId: w.member.id }],
      loot: [{ itemTypeId: w.itemTypeId, quantity: '100.00' }],
    }, w.member.cookie);
    expect(res.status).toBe(201);
  });

  // Logging your own night's work is the crew's business; taking credit back
  // out of several people's totals at once is not.
  it('refuses a revert to somebody who may only log', async () => {
    const created = await log({
      name: 'Vangelico',
      participants: [{ userId: w.member.id }],
      loot: [{ itemTypeId: w.itemTypeId, quantity: '100.00' }],
    });
    await giveMemberRank(['log_operations']);
    const res = await api().post(`${base()}/${created.body.data.operation.id}/revert`)
      .set('Cookie', w.member.cookie);
    expect(res.status).toBe(403);
  });

  it('lets any member read the log', async () => {
    const res = await api().get(base()).set('Cookie', w.member.cookie);
    expect(res.status).toBe(200);
  });

  it('shuts an outsider out entirely', async () => {
    const res = await api().get(base()).set('Cookie', w.outsider.cookie);
    expect(res.status).toBe(403);
  });
});

describe('logging an operation', () => {
  const crew = () => [
    { userId: w.admin.id }, { userId: w.member.id }, { userId: third.id },
  ];

  it('writes one entry per person per item, adding up to the haul', async () => {
    const res = await log({
      name: 'Pacific Standard',
      kind: 'bank',
      location: 'Vinewood',
      participants: crew(),
      loot: [
        { itemTypeId: w.itemTypeId, quantity: '90000.00' },
        { itemTypeId: gold, quantity: '10.00' },
      ],
    });
    expect(res.status).toBe(201);

    const cash = await db.select().from(entries)
      .where(and(eq(entries.factionId, w.faction.id), eq(entries.itemTypeId, w.itemTypeId)));
    expect(cash).toHaveLength(3);
    expect(sum(cash.map((e) => e.amount))).toBe(toCents('90000.00'));

    const bars = await db.select().from(entries)
      .where(and(eq(entries.factionId, w.faction.id), eq(entries.itemTypeId, gold)));
    expect(bars.map((e) => e.amount).sort()).toEqual(['3.33', '3.33', '3.34']);
  });

  // The faction's own cut belongs to nobody, or it would quietly put whoever
  // typed the form at the top of the leaderboard every week.
  it('books the faction cut against no member', async () => {
    const res = await log({
      name: 'Bank job',
      participants: crew(),
      loot: [{ itemTypeId: w.itemTypeId, quantity: '10000.00' }],
      factionCutPercent: '20',
    });
    expect(res.status).toBe(201);

    const rows = await db.select().from(entries).where(eq(entries.itemTypeId, w.itemTypeId));
    expect(sum(rows.map((e) => e.amount))).toBe(toCents('10000.00'));

    const crewIds = [w.admin.id, w.member.id, third.id];
    const cut = rows.find((r) => !crewIds.includes(r.userId));
    expect(cut?.amount).toBe('2000.00');
  });

  it('dates the entries to the night of the job, not to today', async () => {
    const res = await log({
      name: 'Old job',
      participants: [{ userId: w.member.id }],
      loot: [{ itemTypeId: w.itemTypeId, quantity: '500.00' }],
      occurredAt: '2026-01-15T23:40:00.000Z',
    });
    expect(res.status).toBe(201);

    const [row] = await db.select().from(entries).where(eq(entries.userId, w.member.id));
    expect(row!.entryDate).toBe('2026-01-15');
  });

  it('refuses a crew member who is not in the faction', async () => {
    const res = await log({
      name: 'Nope',
      participants: [{ userId: w.outsider.id }],
      loot: [{ itemTypeId: w.itemTypeId, quantity: '100.00' }],
    });
    expect(res.status).toBe(404);
  });

  it('refuses loot the faction does not track', async () => {
    const other = await createFaction('Other Faction', w.superadmin.id);
    const theirItem = await createItemType(other.id, 'Their Cash');

    const res = await log({
      name: 'Nope',
      participants: [{ userId: w.member.id }],
      loot: [{ itemTypeId: theirItem, quantity: '100.00' }],
    });
    expect(res.status).toBe(404);
  });

  it('refuses an operation with nobody on it', async () => {
    const res = await log({
      name: 'Nobody',
      participants: [],
      loot: [{ itemTypeId: w.itemTypeId, quantity: '100.00' }],
    });
    expect(res.status).toBe(400);
  });

  // Two lines for the same item is what a form with an "add line" button
  // produces; splitting each separately would round twice.
  it('merges two lines of the same item before splitting', async () => {
    const res = await log({
      name: 'Two bags',
      participants: crew(),
      loot: [
        { itemTypeId: w.itemTypeId, quantity: '50.00' },
        { itemTypeId: w.itemTypeId, quantity: '50.00' },
      ],
    });
    expect(res.status).toBe(201);

    const rows = await db.select().from(entries).where(eq(entries.itemTypeId, w.itemTypeId));
    expect(rows).toHaveLength(3);
    expect(sum(rows.map((e) => e.amount))).toBe(toCents('100.00'));
  });

  it('shows the whole log back with its crew and haul', async () => {
    await log({
      name: 'Vangelico',
      kind: 'jewelry',
      participants: crew(),
      loot: [{ itemTypeId: gold, quantity: '9.00' }],
    });

    const res = await api().get(base()).set('Cookie', w.member.cookie);
    expect(res.status).toBe(200);
    const [row] = res.body.data.operations;
    expect(row.name).toBe('Vangelico');
    expect(row.crew).toHaveLength(3);
    expect(row.loot[0].quantity).toBe('9.00');
  });
});

/** What the crew sees before they agree to it. */
describe('POST /preview', () => {
  it('returns the split without writing anything', async () => {
    const res = await api().post(`${base()}/preview`).set('Cookie', w.member.cookie).send({
      participants: [{ userId: w.admin.id }, { userId: w.member.id }],
      loot: [{ itemTypeId: w.itemTypeId, quantity: '1000.00' }],
      factionCutPercent: '10',
    });
    expect(res.status).toBe(200);
    expect(res.body.data.lines[0].factionCut).toBe('100.00');
    expect(res.body.data.lines[0].shares.map((s: { quantity: string }) => s.quantity))
      .toEqual(['450.00', '450.00']);

    const rows = await db.select().from(entries);
    expect(rows).toHaveLength(0);
  });

  // Anyone who was on the job can work out the split before somebody with the
  // permission writes it down.
  it('is open to a member who may not log one', async () => {
    const res = await api().post(`${base()}/preview`).set('Cookie', w.member.cookie).send({
      participants: [{ userId: w.member.id }],
      loot: [{ itemTypeId: w.itemTypeId, quantity: '10.00' }],
    });
    expect(res.status).toBe(200);
  });
});

describe('reverting an operation', () => {
  async function logged() {
    const res = await log({
      name: 'Pacific Standard',
      participants: [{ userId: w.admin.id }, { userId: w.member.id }],
      loot: [{ itemTypeId: w.itemTypeId, quantity: '1000.00' }],
    });
    expect(res.status).toBe(201);
    return res.body.data.operation.id as string;
  }

  it('takes every share back out together', async () => {
    const id = await logged();
    const res = await api().post(`${base()}/${id}/revert`).set('Cookie', w.admin.cookie);
    expect(res.status).toBe(200);

    const live = await db.select().from(entries).where(eq(entries.isDeleted, false));
    expect(live).toHaveLength(0);

    const [row] = await db.select().from(operations).where(eq(operations.id, id));
    expect(row!.revertedAt).not.toBeNull();
  });

  it('refuses to revert one twice', async () => {
    const id = await logged();
    await api().post(`${base()}/${id}/revert`).set('Cookie', w.admin.cookie);
    const again = await api().post(`${base()}/${id}/revert`).set('Cookie', w.admin.cookie);
    expect(again.status).toBe(400);
  });

  // Undoing a haul the faction has already spent would drive the balance
  // below zero — a real state, but never one to walk into on a correction.
  it('refuses when the haul has already been spent', async () => {
    const id = await logged();
    const payout = await api().post(`${f()}/payouts`).set('Cookie', w.admin.cookie).send({
      recipientUserId: w.member.id,
      itemTypeId: w.itemTypeId,
      amount: '900.00',
    });
    expect(payout.status).toBe(201);
    await api().patch(`${f()}/payouts/${payout.body.data.id}`)
      .set('Cookie', w.admin.cookie).send({ status: 'completed' });

    const res = await api().post(`${base()}/${id}/revert`).set('Cookie', w.admin.cookie);
    expect(res.status).toBe(400);
    expect(res.body.error.message).toMatch(/treasury holds/i);
  });
});

/**
 * Erasing one, which a revert deliberately does not do.
 *
 * A revert leaves the night in the list where everybody can see it was taken
 * back; a delete is for the rows that should never have been there at all.
 */
describe('deleting an operation for good', () => {
  async function logged() {
    const res = await log({
      name: 'Test Run',
      participants: [{ userId: w.admin.id }, { userId: w.member.id }],
      loot: [{ itemTypeId: w.itemTypeId, quantity: '1000.00' }],
    });
    expect(res.status).toBe(201);
    return res.body.data.operation.id as string;
  }

  const del = (id: string, cookie = w.admin.cookie) =>
    api().delete(`${base()}/${id}`).set('Cookie', cookie);

  it('refuses while the operation is still booked', async () => {
    const id = await logged();
    const res = await del(id);
    expect(res.status).toBe(400);
    expect(res.body.error.message).toMatch(/revert/i);

    const [row] = await db.select().from(operations).where(eq(operations.id, id));
    expect(row).toBeDefined();
  });

  it('removes the operation, its crew, its haul and its ledger rows', async () => {
    const id = await logged();
    await api().post(`${base()}/${id}/revert`).set('Cookie', w.admin.cookie);

    const res = await del(id);
    expect(res.status).toBe(200);

    expect(await db.select().from(operations).where(eq(operations.id, id))).toHaveLength(0);
    expect(await db.select().from(operationParticipants)
      .where(eq(operationParticipants.operationId, id))).toHaveLength(0);
    expect(await db.select().from(operationLoot)
      .where(eq(operationLoot.operationId, id))).toHaveLength(0);
    expect(await db.select().from(operationMovements)
      .where(eq(operationMovements.operationId, id))).toHaveLength(0);
    // Including the soft-deleted ones the revert left behind.
    expect(await db.select().from(entries)).toHaveLength(0);
  });

  // The record goes; the fact that somebody removed it does not.
  it('leaves an audit row behind', async () => {
    const id = await logged();
    await api().post(`${base()}/${id}/revert`).set('Cookie', w.admin.cookie);
    await del(id);

    const rows = await db.select().from(auditLogs)
      .where(and(eq(auditLogs.entityType, 'operation'), eq(auditLogs.entityId, id)));
    const erased = rows.filter((r) => (r.details as { hardDelete?: boolean } | null)?.hardDelete);
    expect(erased).toHaveLength(1);
    expect((erased[0]!.details as { name?: string }).name).toBe('Test Run');
  });

  it('refuses somebody who may only log', async () => {
    const id = await logged();
    await api().post(`${base()}/${id}/revert`).set('Cookie', w.admin.cookie);
    await giveMemberRank(['log_operations']);
    expect((await del(id, w.member.cookie)).status).toBe(403);
  });

  it('will not reach across factions', async () => {
    const id = await logged();
    await api().post(`${base()}/${id}/revert`).set('Cookie', w.admin.cookie);
    const other = await createFaction('Other Crew', third.id);
    const res = await api().delete(`/api/v1/factions/${other.id}/operations/${id}`)
      .set('Cookie', w.admin.cookie);
    expect(res.status).toBe(403);
    expect(await db.select().from(operations).where(eq(operations.id, id))).toHaveLength(1);
  });
});

/**
 * One share is not a thing on its own.
 *
 * Editing a single crew member's entry leaves the split no longer adding up to
 * what was taken, which is the exact state this feature exists to prevent.
 */
describe('a share cannot be edited on its own', () => {
  async function oneShare() {
    await log({
      name: 'Pacific Standard',
      participants: [{ userId: w.admin.id }, { userId: w.member.id }],
      loot: [{ itemTypeId: w.itemTypeId, quantity: '1000.00' }],
    });
    const [row] = await db.select().from(entries).where(eq(entries.userId, w.member.id));
    return row!.id;
  }

  it('refuses to delete it', async () => {
    const entryId = await oneShare();
    const res = await api().delete(`${f()}/entries/${entryId}`).set('Cookie', w.admin.cookie);
    expect(res.status).toBe(400);
    expect(res.body.error.message).toMatch(/revert that operation/i);
  });

  it('refuses to edit it', async () => {
    const entryId = await oneShare();
    const res = await api().patch(`${f()}/entries/${entryId}`)
      .set('Cookie', w.admin.cookie).send({ amount: '5.00' });
    expect(res.status).toBe(400);
  });

  // Once the operation is reverted its rows are soft-deleted, and a deleted
  // row nobody can edit needs no protecting.
  it('stops holding anything once the operation is reverted', async () => {
    const res = await log({
      name: 'Pacific Standard',
      participants: [{ userId: w.admin.id }],
      loot: [{ itemTypeId: w.itemTypeId, quantity: '1000.00' }],
    });
    await api().post(`${base()}/${res.body.data.operation.id}/revert`).set('Cookie', w.admin.cookie);

    const fresh = await api().post(`${f()}/entries`).set('Cookie', w.admin.cookie)
      .send({ itemTypeId: w.itemTypeId, amount: '10.00' });
    expect(fresh.status).toBe(201);

    const edited = await api().patch(`${f()}/entries/${fresh.body.data.id}`)
      .set('Cookie', w.admin.cookie).send({ amount: '20.00' });
    expect(edited.status).toBe(200);
  });
});

/**
 * What the crews asked for after using it.
 *
 * The first version made a haul mandatory and always divided it, and the
 * answer that came back was that plenty of nights have nothing to divide:
 * a job that went wrong, a favour, a fight, or takings that go straight to
 * the faction with nobody owed a share.
 */
describe('an operation without a split', () => {
  it('records a job where nothing was taken', async () => {
    const res = await log({
      name: 'Turf scrap',
      kind: 'territory',
      participants: [{ userId: w.admin.id }, { userId: w.member.id }],
      loot: [],
      notes: 'Held the corner, took nothing.',
    });
    expect(res.status).toBe(201);

    // Nothing to divide, so nothing reaches the ledger.
    expect(await db.select().from(entries)).toHaveLength(0);

    const [row] = (await api().get(base()).set('Cookie', w.member.cookie)).body.data.operations;
    expect(row.name).toBe('Turf scrap');
    expect(row.crew).toHaveLength(2);
    expect(row.loot).toEqual([]);
  });

  it('takes an operation with the loot key left out entirely', async () => {
    const res = await log({ name: 'Quiet night', participants: [{ userId: w.member.id }] });
    expect(res.status).toBe(201);
  });

  // The takings go in the vault; nobody is owed a share of them.
  it('books the whole haul to the faction when asked', async () => {
    const res = await log({
      name: 'Store job',
      participants: [{ userId: w.admin.id }, { userId: w.member.id }],
      loot: [{ itemTypeId: w.itemTypeId, quantity: '5000.00' }],
      creditTo: 'faction',
    });
    expect(res.status).toBe(201);

    const rows = await db.select().from(entries);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.amount).toBe('5000.00');

    // Against the placeholder, so the treasury moves and no leaderboard does.
    const crew = [w.admin.id, w.member.id];
    expect(crew).not.toContain(rows[0]!.userId);
  });

  it('still divides between the crew by default', async () => {
    const res = await log({
      name: 'Normal job',
      participants: [{ userId: w.admin.id }, { userId: w.member.id }],
      loot: [{ itemTypeId: w.itemTypeId, quantity: '1000.00' }],
    });
    expect(res.status).toBe(201);
    expect(res.body.data.operation.creditTo).toBe('crew');

    const rows = await db.select().from(entries);
    expect(rows).toHaveLength(2);
    expect(sum(rows.map((e) => e.amount))).toBe(toCents('1000.00'));
  });

  // The record should say what happened, not what was typed: crediting the
  // faction is the whole haul off the top, and the stored percentage says so.
  it('records the cut it actually applied', async () => {
    const res = await log({
      name: 'All in',
      participants: [{ userId: w.member.id }],
      loot: [{ itemTypeId: w.itemTypeId, quantity: '100.00' }],
      creditTo: 'faction',
      factionCutPercent: '10',
    });
    expect(res.body.data.operation.factionCutPercent).toBe('100.00');
  });

  it('reverts a haulless operation without complaint', async () => {
    const created = await log({
      name: 'Nothing doing',
      participants: [{ userId: w.member.id }],
      loot: [],
    });
    const res = await api().post(`${base()}/${created.body.data.operation.id}/revert`)
      .set('Cookie', w.admin.cookie);
    expect(res.status).toBe(200);
  });
});

/**
 * How the night went for each person on it.
 *
 * Asked for alongside the split being optional, and for the same reason: an
 * operation with nothing to divide still has something worth recording about
 * the people who ran it.
 */
describe('rating the crew', () => {
  it('keeps a rating and a note per member', async () => {
    const res = await log({
      name: 'Vangelico',
      participants: [
        { userId: w.admin.id, rating: 5, ratingNote: 'Drove clean' },
        { userId: w.member.id, rating: 2, ratingNote: 'Late to the pickup' },
      ],
      loot: [],
    });
    expect(res.status).toBe(201);

    const [row] = (await api().get(base()).set('Cookie', w.admin.cookie)).body.data.operations;
    const crew = row.crew as { userId: string; rating: number | null; ratingNote: string | null }[];
    expect(crew.find((c) => c.userId === w.admin.id)).toMatchObject({ rating: 5, ratingNote: 'Drove clean' });
    expect(crew.find((c) => c.userId === w.member.id)?.rating).toBe(2);
  });

  // Most crews will rate nobody most of the time.
  it('leaves an unrated member null rather than inventing a score', async () => {
    await log({ name: 'Unrated', participants: [{ userId: w.member.id }], loot: [] });

    const [row] = (await api().get(base()).set('Cookie', w.admin.cookie)).body.data.operations;
    expect(row.crew[0].rating).toBeNull();
    expect(row.crew[0].ratingNote).toBeNull();
  });

  it('refuses a rating outside one to five', async () => {
    const res = await log({
      name: 'Six stars',
      participants: [{ userId: w.member.id, rating: 6 }],
      loot: [],
    });
    expect(res.status).toBe(400);
  });
});
