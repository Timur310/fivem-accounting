import { describe, it, expect, beforeEach } from 'vitest';
import {
  api, resetDatabase, seedBasicWorld, createFaction, createUser, addMember,
  type BasicWorld,
} from './helpers.js';

let w: BasicWorld;
const f = () => `/api/v1/factions/${w.faction.id}`;
const base = () => `${f()}/vehicles`;

beforeEach(async () => {
  await resetDatabase();
  w = await seedBasicWorld();
});

/** Define a rank with these permissions and put the plain member on it. */
async function giveMemberRank(permissions: string[], name = 'Mechanic') {
  const ranks = await api().patch(`${f()}/settings`).set('Cookie', w.admin.cookie)
    .send({ ranks: [{ name, level: 1, permissions }] });
  expect(ranks.status).toBe(200);
  const assigned = await api().patch(`${f()}/members/${w.member.id}`)
    .set('Cookie', w.admin.cookie).send({ rank: name });
  expect(assigned.status).toBe(200);
}

async function add(body: Record<string, unknown>, cookie = w.admin.cookie) {
  return api().post(base()).set('Cookie', cookie).send(body);
}

async function list(query = '', cookie = w.member.cookie) {
  const res = await api().get(`${base()}${query}`).set('Cookie', cookie);
  expect(res.status).toBe(200);
  return res.body.data;
}

/**
 * Who may read the registry, and who may change it.
 *
 * Reading is open to the faction: the person who needs to look a plate up is
 * usually staring at the car, and is usually the one holding the fewest
 * permissions.
 */
describe('vehicle permissions', () => {
  it('lets any member read the registry', async () => {
    const res = await api().get(base()).set('Cookie', w.member.cookie);
    expect(res.status).toBe(200);
  });

  it('refuses a new vehicle without manage_vehicles', async () => {
    const res = await add({ plate: '45ABC123' }, w.member.cookie);
    expect(res.status).toBe(403);
  });

  it('allows one once the rank carries it', async () => {
    await giveMemberRank(['manage_vehicles']);
    const res = await add({ plate: '45ABC123' }, w.member.cookie);
    expect(res.status).toBe(201);
  });

  it('shuts an outsider out entirely', async () => {
    const res = await api().get(base()).set('Cookie', w.outsider.cookie);
    expect(res.status).toBe(403);
  });
});

describe('the registry', () => {
  it('records everything the card shows', async () => {
    const res = await add({
      plate: '45ABC123',
      make: 'Bravado',
      model: 'Banshee',
      color: 'Black',
      category: 'suv',
      year: 2019,
      status: 'impounded',
      statusNote: 'Mission Row, out on the 14th',
      ownerName: 'Marco Vega',
      notes: 'Tinted, aftermarket exhaust',
    });
    expect(res.status).toBe(201);
    expect(res.body.data).toMatchObject({
      plate: '45ABC123', make: 'Bravado', category: 'suv', year: 2019, status: 'impounded',
    });
  });

  it('defaults a bare record to a car in service', async () => {
    const res = await add({ plate: 'PLAIN01' });
    expect(res.body.data.category).toBe('car');
    expect(res.body.data.status).toBe('in_service');
  });

  // A plate is one car however it was typed, and two records for one car is
  // the failure this registry exists to prevent.
  it('refuses a second record for the same plate, whatever the casing', async () => {
    expect((await add({ plate: '45ABC123' })).status).toBe(201);
    const again = await add({ plate: '45abc123' });
    expect(again.status).toBe(409);
    expect(again.body.error.message).toMatch(/already in the registry/i);
  });

  it('refuses a plate already held by another vehicle on edit', async () => {
    const first = await add({ plate: 'AAA111' });
    await add({ plate: 'BBB222' });

    const res = await api().patch(`${base()}/${first.body.data.id}`)
      .set('Cookie', w.admin.cookie).send({ plate: 'bbb222' });
    expect(res.status).toBe(409);
  });

  it('lets a vehicle keep its own plate through an edit', async () => {
    const created = await add({ plate: 'AAA111' });
    const res = await api().patch(`${base()}/${created.body.data.id}`)
      .set('Cookie', w.admin.cookie).send({ plate: 'AAA111', color: 'Red' });
    expect(res.status).toBe(200);
    expect(res.body.data.color).toBe('Red');
  });

  it('refuses an owner who is not on the roster', async () => {
    const stranger = await createUser('stranger');
    const res = await add({ plate: 'XYZ999', ownerUserId: stranger.id });
    expect(res.status).toBe(404);
  });

  it('resolves a linked owner to their name', async () => {
    const res = await add({ plate: 'LINK01', ownerUserId: w.member.id });
    expect(res.status).toBe(201);

    const row = (await list()).vehicles.find((v: { plate: string }) => v.plate === 'LINK01');
    expect(row.ownerDisplay).toBe(w.member.username);
  });

  it('falls back to the typed name when there is no member', async () => {
    await add({ plate: 'TEXT01', ownerName: 'Marco Vega' });
    const row = (await list()).vehicles.find((v: { plate: string }) => v.plate === 'TEXT01');
    expect(row.ownerDisplay).toBe('Marco Vega');
  });

  it('404s on another faction\'s vehicle', async () => {
    const other = await createFaction('Other Faction', w.superadmin.id);
    await addMember(other.id, w.superadmin.id, 'admin');
    const theirs = await api().post(`/api/v1/factions/${other.id}/vehicles`)
      .set('Cookie', w.superadmin.cookie).send({ plate: 'OTHER1' });
    expect(theirs.status).toBe(201);

    const res = await api().get(`${base()}/${theirs.body.data.id}`).set('Cookie', w.admin.cookie);
    expect(res.status).toBe(404);
  });
});

/** One box over the four things somebody has in front of them. */
describe('search and filters', () => {
  beforeEach(async () => {
    await add({ plate: '45ABC123', make: 'Bravado', model: 'Banshee', ownerName: 'Marco Vega', category: 'suv' });
    await add({ plate: '99XYZ001', make: 'Declasse', model: 'Sabre', ownerUserId: w.member.id, status: 'stolen' });
    await add({ plate: 'BIKE007', make: 'Pegassi', model: 'Bati', category: 'motorcycle', status: 'sold' });
  });

  it('finds a vehicle by plate', async () => {
    const data = await list('?q=45ABC');
    expect(data.vehicles).toHaveLength(1);
    expect(data.vehicles[0].plate).toBe('45ABC123');
  });

  it('finds one by make or model', async () => {
    expect((await list('?q=sabre')).vehicles[0].plate).toBe('99XYZ001');
    expect((await list('?q=pegassi')).vehicles[0].plate).toBe('BIKE007');
  });

  it('finds one by a typed owner name', async () => {
    expect((await list('?q=vega')).vehicles[0].plate).toBe('45ABC123');
  });

  // The owner is a link for members, so searching their name has to reach
  // through it — otherwise half the registry is unsearchable by owner.
  it('finds one by a linked owner\'s name', async () => {
    const data = await list(`?q=${w.member.username}`);
    expect(data.vehicles.map((v: { plate: string }) => v.plate)).toContain('99XYZ001');
  });

  it('filters by status', async () => {
    const data = await list('?status=stolen');
    expect(data.vehicles).toHaveLength(1);
    expect(data.vehicles[0].plate).toBe('99XYZ001');
  });

  it('filters by category', async () => {
    expect((await list('?category=motorcycle')).vehicles[0].plate).toBe('BIKE007');
  });

  it('filters by owner', async () => {
    const data = await list(`?owner=${w.member.id}`);
    expect(data.vehicles).toHaveLength(1);
  });

  // A chip reading "3" because the page happens to hold three would be worse
  // than no number at all.
  it('counts statuses over the whole registry, not the page', async () => {
    const data = await list('?page_size=1');
    expect(data.vehicles).toHaveLength(1);
    expect(data.total).toBe(3);
    expect(data.statusCounts).toMatchObject({ in_service: 1, stolen: 1, sold: 1 });
  });

  it('sorts by plate by default', async () => {
    const plates = (await list()).vehicles.map((v: { plate: string }) => v.plate);
    expect(plates).toEqual(['45ABC123', '99XYZ001', 'BIKE007']);
  });
});

/**
 * The history on a vehicle's card.
 *
 * Read out of the app's existing audit log rather than a second table, and
 * recording only the fields that actually moved — a log that wrote every field
 * on every save would bury the one change somebody came looking for.
 */
describe('change history', () => {
  async function history(vehicleId: string, cookie = w.admin.cookie) {
    return api().get(`${base()}/${vehicleId}/history`).set('Cookie', cookie);
  }

  it('records who created the vehicle', async () => {
    const created = await add({ plate: 'HIST01', make: 'Bravado' });
    const res = await history(created.body.data.id);
    expect(res.status).toBe(200);
    expect(res.body.data.history[0]).toMatchObject({ action: 'create', actorName: w.admin.username });
  });

  it('records only the fields that changed', async () => {
    const created = await add({ plate: 'HIST02', color: 'Black', make: 'Bravado' });
    await api().patch(`${base()}/${created.body.data.id}`)
      .set('Cookie', w.admin.cookie)
      .send({ color: 'Red', make: 'Bravado' });

    const res = await history(created.body.data.id);
    const update = res.body.data.history.find((h: { action: string }) => h.action === 'update');
    expect(update.details.changes).toEqual({ color: { from: 'Black', to: 'Red' } });
  });

  it('writes nothing when a save changes nothing', async () => {
    const created = await add({ plate: 'HIST03', color: 'Black' });
    await api().patch(`${base()}/${created.body.data.id}`)
      .set('Cookie', w.admin.cookie).send({ color: 'Black' });

    const res = await history(created.body.data.id);
    expect(res.body.data.history.filter((h: { action: string }) => h.action === 'update')).toHaveLength(0);
  });

  it('records a status change like any other', async () => {
    const created = await add({ plate: 'HIST04' });
    await api().patch(`${base()}/${created.body.data.id}`)
      .set('Cookie', w.admin.cookie)
      .send({ status: 'impounded', statusNote: 'Mission Row' });

    const res = await history(created.body.data.id);
    const update = res.body.data.history.find((h: { action: string }) => h.action === 'update');
    expect(update.details.changes.status).toEqual({ from: 'in_service', to: 'impounded' });
  });

  // Whoever may change a record may see who changed it before them. A member
  // who may only read the registry may not read the audit trail behind it.
  it('refuses the history to a member who can only read', async () => {
    const created = await add({ plate: 'HIST05' });
    const res = await history(created.body.data.id, w.member.cookie);
    expect(res.status).toBe(403);
  });

  it('allows it with manage_vehicles', async () => {
    const created = await add({ plate: 'HIST06' });
    await giveMemberRank(['manage_vehicles']);
    const res = await history(created.body.data.id, w.member.cookie);
    expect(res.status).toBe(200);
  });

  it('allows it with view_audit_logs', async () => {
    const created = await add({ plate: 'HIST07' });
    await giveMemberRank(['view_audit_logs']);
    const res = await history(created.body.data.id, w.member.cookie);
    expect(res.status).toBe(200);
  });
});

describe('DELETE /vehicles/:id', () => {
  it('removes the record and logs it', async () => {
    const created = await add({ plate: 'GONE01' });
    const res = await api().delete(`${base()}/${created.body.data.id}`).set('Cookie', w.admin.cookie);
    expect(res.status).toBe(200);

    const after = await api().get(`${base()}/${created.body.data.id}`).set('Cookie', w.admin.cookie);
    expect(after.status).toBe(404);
  });

  it('refuses without manage_vehicles', async () => {
    const created = await add({ plate: 'GONE02' });
    const res = await api().delete(`${base()}/${created.body.data.id}`).set('Cookie', w.member.cookie);
    expect(res.status).toBe(403);
  });
});
