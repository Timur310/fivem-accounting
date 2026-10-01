import { describe, it, expect, beforeEach } from 'vitest';
import { api, resetDatabase, seedBasicWorld, createItemType, createEntry, type BasicWorld } from './helpers.js';
import { droppedBelowMin, fitProblem, layoutProblem } from '../src/lib/storage.js';
import { and, eq } from 'drizzle-orm';
import { db } from '../src/db/index.js';
import { factions, payouts } from '../src/db/schema.js';

describe('layout rules', () => {
  const box = (name: string, x: number, y: number, w = 1, h = 1) => ({ name, x, y, w, h });

  it('accepts a sensible room', () => {
    expect(layoutProblem(10, 8, [{ x: 0, y: 0, kind: 'wall' }], [box('A', 1, 1, 2, 1), box('B', 4, 4)])).toBeNull();
  });

  it('refuses a container sticking out of the room', () => {
    expect(layoutProblem(10, 8, [], [box('A', 9, 0, 2, 1)])).toMatch(/sticks out/);
  });

  it('refuses two containers in one place', () => {
    expect(layoutProblem(10, 8, [], [box('A', 1, 1, 2, 2), box('B', 2, 2)])).toMatch(/same place/);
  });

  it('refuses a container in a wall or a doorway', () => {
    expect(layoutProblem(10, 8, [{ x: 3, y: 3, kind: 'door' }], [box('A', 3, 3)])).toMatch(/wall or a doorway/);
  });

  it('refuses growing past a limit, but not emptying something already over it', () => {
    const base = { label: 'Pistol', capacity: '10', maxQuantity: null };
    expect(fitProblem({ ...base, quantity: '11', previousQuantity: '5', total: '11', previousTotal: '5' })).toMatch(/holds/);
    expect(fitProblem({ ...base, quantity: '11', previousQuantity: '12', total: '11', previousTotal: '12' })).toBeNull();
    expect(fitProblem({ ...base, capacity: null, maxQuantity: '3', quantity: '4', previousQuantity: '3', total: '4', previousTotal: '3' }))
      .toMatch(/At most 3/);
  });

  it('notices a count falling below its minimum only once', () => {
    expect(droppedBelowMin('10', '4', '5')).toBe(true);
    expect(droppedBelowMin('4', '3', '5')).toBe(false);
    expect(droppedBelowMin('10', '4', null)).toBe(false);
  });
});

describe('storage through the API', () => {
  let w: BasicWorld;
  let pistol: string;
  const base = () => `/api/v1/factions/${w.faction.id}/storage`;
  const asAdmin = { cookie: () => w.admin.cookie };

  beforeEach(async () => {
    await resetDatabase();
    w = await seedBasicWorld();
    pistol = await createItemType(w.faction.id, 'Pistol', { isCurrency: false, unit: 'x' });
    // These are about rooms and counting; the treasury link has its own tests.
    await db.update(factions).set({ storageLinked: false }).where(eq(factions.id, w.faction.id));
  });

  async function room(containers: unknown[] = [{ kind: 'bench', name: 'Bench 1', x: 1, y: 1, w: 2, h: 1, capacity: '50' }]) {
    const res = await api().post(`${base()}/rooms`).set('Cookie', asAdmin.cookie())
      .send({ name: 'Depot', width: 12, height: 8, tiles: [{ x: 0, y: 0, kind: 'wall' }], containers });
    expect(res.status).toBe(201);
    const detail = await api().get(`${base()}/rooms/${res.body.data.id}`).set('Cookie', w.member.cookie);
    return { roomId: res.body.data.id as string, containers: detail.body.data.containers as { id: string; name: string }[] };
  }

  const add = (containerId: string, body: Record<string, unknown>) =>
    api().post(`${base()}/containers/${containerId}/contents`).set('Cookie', asAdmin.cookie()).send(body);

  it('lets every member look, and nobody without the permission draw', async () => {
    const { roomId } = await room();
    const listed = (await api().get(`${base()}/rooms`).set('Cookie', w.member.cookie)).body.data.rooms;
    expect(listed).toHaveLength(1);
    expect(listed[0].containerCount).toBe(1);
    const drawn = await api().put(`${base()}/rooms/${roomId}/layout`).set('Cookie', w.member.cookie)
      .send({ width: 12, height: 8, tiles: [], containers: [] });
    expect(drawn.status).toBe(403);
  });

  it('refuses a layout with overlapping containers', async () => {
    const res = await api().post(`${base()}/rooms`).set('Cookie', asAdmin.cookie()).send({
      name: 'Depot', width: 12, height: 8,
      containers: [
        { kind: 'chest', name: 'A', x: 1, y: 1, w: 2, h: 2 },
        { kind: 'chest', name: 'B', x: 2, y: 2, w: 1, h: 1 },
      ],
    });
    expect(res.status).toBe(400);
  });

  it('keeps what is in a container when the layout moves it, and removes it with the container', async () => {
    const { roomId, containers } = await room();
    const bench = containers[0]!;
    await add(bench.id, { itemTypeId: pistol, quantity: '5' });

    const moved = await api().put(`${base()}/rooms/${roomId}/layout`).set('Cookie', asAdmin.cookie()).send({
      width: 12, height: 8, tiles: [],
      containers: [
        { id: bench.id, kind: 'bench', name: 'Bench 1', x: 5, y: 5, w: 1, h: 2 },
        { kind: 'safe', name: 'Safe', x: 0, y: 0, w: 1, h: 1 },
      ],
    });
    expect(moved.status).toBe(200);
    const kept = moved.body.data.containers.find((c: { id: string }) => c.id === bench.id);
    expect(kept.contents[0].quantity).toBe('5.00');

    const emptied = await api().put(`${base()}/rooms/${roomId}/layout`).set('Cookie', asAdmin.cookie())
      .send({ width: 12, height: 8, tiles: [], containers: [] });
    expect(emptied.body.data.containers).toHaveLength(0);
    expect((await api().get(`${base()}/search?q=pistol`).set('Cookie', w.member.cookie)).body.data.results).toHaveLength(0);
  });

  it('adds, takes and refuses what does not fit', async () => {
    const { containers } = await room();
    const bench = containers[0]!.id;
    const created = await add(bench, { itemTypeId: pistol, quantity: '40', maxQuantity: '45' });
    expect(created.status).toBe(201);
    expect(created.body.data.label).toBe('Pistol');

    const twice = await add(bench, { itemTypeId: pistol, quantity: '1' });
    expect(twice.status).toBe(409);

    const pastMax = await api().patch(`${base()}/contents/${created.body.data.id}`).set('Cookie', asAdmin.cookie()).send({ delta: '6' });
    expect(pastMax.status).toBe(400);

    const overCapacity = await add(bench, { label: 'Ammo box', quantity: '11' });
    expect(overCapacity.status).toBe(400);
    expect(overCapacity.body.error.message).toMatch(/holds/);

    const taken = await api().patch(`${base()}/contents/${created.body.data.id}`).set('Cookie', asAdmin.cookie()).send({ delta: '-15' });
    expect(taken.body.data.quantity).toBe('25.00');

    const tooMany = await api().patch(`${base()}/contents/${created.body.data.id}`).set('Cookie', asAdmin.cookie()).send({ delta: '-26' });
    expect(tooMany.status).toBe(400);
  });

  it('moves between containers, merging with what is there', async () => {
    const { containers } = await room([
      { kind: 'bench', name: 'Bench 1', x: 1, y: 1, w: 1, h: 1 },
      { kind: 'chest', name: 'Chest', x: 3, y: 1, w: 1, h: 1 },
    ]);
    const [a, b] = containers;
    const line = await add(a!.id, { itemTypeId: pistol, quantity: '10' });
    await add(b!.id, { itemTypeId: pistol, quantity: '2' });

    const moved = await api().post(`${base()}/contents/${line.body.data.id}/move`).set('Cookie', asAdmin.cookie())
      .send({ toContainerId: b!.id, amount: '4' });
    expect(moved.status).toBe(200);

    const results = (await api().get(`${base()}/search?q=pis`).set('Cookie', w.member.cookie)).body.data.results;
    const byName = Object.fromEntries(results.map((r: { containerName: string; quantity: string }) => [r.containerName, r.quantity]));
    expect(byName).toEqual({ 'Bench 1': '6.00', Chest: '6.00' });

    const history = (await api().get(`${base()}/containers/${b!.id}/history`).set('Cookie', w.member.cookie)).body.data.history;
    expect(history[0]).toMatchObject({ kind: 'move', containerName: 'Bench 1', toContainerName: 'Chest', amount: '4.00' });
  });

  it('needs update_storage to change a count', async () => {
    const { containers } = await room();
    const res = await api().post(`${base()}/containers/${containers[0]!.id}/contents`).set('Cookie', w.member.cookie)
      .send({ label: 'Rope', quantity: '1' });
    expect(res.status).toBe(403);
  });

  it('compares storage with the books', async () => {
    const { containers } = await room();
    await createEntry(w.faction.id, w.member.id, pistol, '12');
    await add(containers[0]!.id, { itemTypeId: pistol, quantity: '8' });
    const items = (await api().get(`${base()}/compare`).set('Cookie', w.member.cookie)).body.data.items;
    expect(items.find((i: { itemTypeId: string }) => i.itemTypeId === pistol)).toMatchObject({ inBooks: '12.00', inStorage: '8.00', containers: 1 });
  });

  it('records a stocktake', async () => {
    const { roomId, containers } = await room();
    expect((await api().post(`${base()}/containers/${containers[0]!.id}/checked`).set('Cookie', asAdmin.cookie())).status).toBe(200);
    const detail = await api().get(`${base()}/rooms/${roomId}`).set('Cookie', w.member.cookie);
    expect(detail.body.data.containers[0].checkedAt).not.toBeNull();
    expect(detail.body.data.containers[0].checkedByName).toBeTruthy();
  });
});

describe('storage held to the treasury', () => {
  let w: BasicWorld;
  let pistol: string;
  let bench: string;
  let chest: string;
  const base = () => `/api/v1/factions/${w.faction.id}/storage`;
  const add = (containerId: string, body: Record<string, unknown>) =>
    api().post(`${base()}/containers/${containerId}/contents`).set('Cookie', w.admin.cookie).send(body);
  const change = (contentId: string, body: Record<string, unknown>) =>
    api().patch(`${base()}/contents/${contentId}`).set('Cookie', w.admin.cookie).send(body);
  const withdrawals = () => db.select().from(payouts).where(and(eq(payouts.factionId, w.faction.id), eq(payouts.itemTypeId, pistol)));

  beforeEach(async () => {
    await resetDatabase();
    w = await seedBasicWorld();
    pistol = await createItemType(w.faction.id, 'Pistol', { isCurrency: false, unit: 'x' });
    // The treasury holds 20 pistols.
    await createEntry(w.faction.id, w.member.id, pistol, '20');
    const res = await api().post(`${base()}/rooms`).set('Cookie', w.admin.cookie).send({
      name: 'Depot', width: 10, height: 6,
      containers: [
        { kind: 'bench', name: 'Bench', x: 1, y: 1, w: 1, h: 1 },
        { kind: 'chest', name: 'Chest', x: 3, y: 1, w: 1, h: 1 },
      ],
    });
    const detail = await api().get(`${base()}/rooms/${res.body.data.id}`).set('Cookie', w.admin.cookie);
    [bench, chest] = detail.body.data.containers.map((c: { id: string }) => c.id);
  });

  it('is on by default', async () => {
    expect((await api().get(`${base()}/rooms`).set('Cookie', w.member.cookie)).body.data.linked).toBe(true);
  });

  it('refuses storing more than the treasury holds, across every container', async () => {
    expect((await add(bench, { itemTypeId: pistol, quantity: '15' })).status).toBe(201);
    const over = await add(chest!, { itemTypeId: pistol, quantity: '6' });
    expect(over.status).toBe(400);
    expect(over.body.error.message).toMatch(/at most 5\.00 more/);
    expect((await add(chest!, { itemTypeId: pistol, quantity: '5' })).status).toBe(201);
  });

  it('withdraws from the treasury when something is taken out', async () => {
    const line = await add(bench, { itemTypeId: pistol, quantity: '10' });
    const taken = await change(line.body.data.id, { delta: '-3' });
    expect(taken.status).toBe(200);
    expect(taken.body.data.withdrawal.amount).toBe('3.00');

    const [payout] = await withdrawals();
    expect(payout).toMatchObject({ amount: '3.00', status: 'completed', recipientUserId: w.admin.id });
    expect(payout!.description).toMatch(/Taken from storage: Bench \(Depot\)/);

    const history = (await api().get(`${base()}/containers/${bench}/history`).set('Cookie', w.admin.cookie)).body.data.history;
    expect(history[0]).toMatchObject({ kind: 'take', amount: '3.00' });
  });

  // Where things are is not what the faction owns.
  it('does not withdraw for a move, a correction down, or removing a line', async () => {
    const line = await add(bench, { itemTypeId: pistol, quantity: '10' });
    await api().post(`${base()}/contents/${line.body.data.id}/move`).set('Cookie', w.admin.cookie).send({ toContainerId: chest, amount: '4' });
    await change(line.body.data.id, { quantity: '5' });
    await api().delete(`${base()}/contents/${line.body.data.id}`).set('Cookie', w.admin.cookie);
    expect(await withdrawals()).toHaveLength(0);
  });

  it('refuses a withdrawal the treasury cannot cover', async () => {
    await db.update(factions).set({ storageLinked: false }).where(eq(factions.id, w.faction.id));
    const line = await add(bench, { itemTypeId: pistol, quantity: '30' });
    await db.update(factions).set({ storageLinked: true }).where(eq(factions.id, w.faction.id));
    const res = await change(line.body.data.id, { delta: '-25' });
    expect(res.status).toBe(400);
    expect(res.body.error.message).toMatch(/shows only 20\.00/);
  });

  it('leaves typed-in things alone', async () => {
    const line = await add(bench, { label: 'Spare tyres', quantity: '99' });
    expect(line.status).toBe(201);
    await change(line.body.data.id, { delta: '-9' });
    expect(await db.select().from(payouts).where(eq(payouts.factionId, w.faction.id))).toHaveLength(0);
  });

  const deletePayout = (payoutId: string) =>
    api().delete(`/api/v1/factions/${w.faction.id}/payouts/${payoutId}`).set('Cookie', w.admin.cookie);
  const pistolsIn = async (containerId: string) => {
    const results = (await api().get(`${base()}/search?q=pistol`).set('Cookie', w.admin.cookie)).body.data.results;
    return results.find((r: { containerId: string }) => r.containerId === containerId)?.quantity ?? null;
  };

  // A withdrawal that is deleted never happened: the pistols are back in the chest.
  it('puts the items back when the withdrawal is deleted', async () => {
    const line = await add(bench, { itemTypeId: pistol, quantity: '10' });
    const taken = await change(line.body.data.id, { delta: '-3' });
    expect(await pistolsIn(bench)).toBe('7.00');

    expect((await deletePayout(taken.body.data.withdrawal.id)).status).toBe(200);
    expect(await pistolsIn(bench)).toBe('10.00');

    const history = (await api().get(`${base()}/containers/${bench}/history`).set('Cookie', w.admin.cookie)).body.data.history;
    expect(history[0]).toMatchObject({ kind: 'return', amount: '3.00' });
  });

  it('brings a removed line back, and never returns the same withdrawal twice', async () => {
    const line = await add(bench, { itemTypeId: pistol, quantity: '4' });
    const taken = await change(line.body.data.id, { delta: '-4' });
    await api().delete(`${base()}/contents/${line.body.data.id}`).set('Cookie', w.admin.cookie);
    expect(await pistolsIn(bench)).toBeNull();

    await deletePayout(taken.body.data.withdrawal.id);
    expect(await pistolsIn(bench)).toBe('4.00');
    // Deleting it again changes nothing.
    await deletePayout(taken.body.data.withdrawal.id);
    expect(await pistolsIn(bench)).toBe('4.00');
  });

  it('copes with the container being gone', async () => {
    const line = await add(chest!, { itemTypeId: pistol, quantity: '5' });
    const taken = await change(line.body.data.id, { delta: '-2' });
    const roomId = (await api().get(`${base()}/rooms`).set('Cookie', w.admin.cookie)).body.data.rooms[0].id;
    await api().put(`${base()}/rooms/${roomId}/layout`).set('Cookie', w.admin.cookie).send({
      width: 10, height: 6, tiles: [], containers: [{ id: bench, kind: 'bench', name: 'Bench', x: 1, y: 1, w: 1, h: 1 }],
    });
    expect((await deletePayout(taken.body.data.withdrawal.id)).status).toBe(200);
    expect(await pistolsIn(bench)).toBeNull();
  });

  it('can be switched off by whoever manages storage', async () => {
    expect((await api().patch(`${base()}/settings`).set('Cookie', w.member.cookie).send({ linked: false })).status).toBe(403);
    expect((await api().patch(`${base()}/settings`).set('Cookie', w.admin.cookie).send({ linked: false })).status).toBe(200);
    expect((await add(bench, { itemTypeId: pistol, quantity: '500' })).status).toBe(201);
  });

  it('is cleared with the treasury, keeping typed-in lines', async () => {
    await add(bench, { itemTypeId: pistol, quantity: '10' });
    await add(bench, { label: 'Spare tyres', quantity: '4' });
    const res = await api().post(`/api/v1/factions/${w.faction.id}/reset-treasury`).set('Cookie', w.superadmin.cookie)
      .send({ confirmName: 'Test Faction' });
    expect(res.body.data.removed.storageLines).toBe(1);
    const tyres = (await api().get(`${base()}/search?q=tyres`).set('Cookie', w.admin.cookie)).body.data.results;
    const pistols = (await api().get(`${base()}/search?q=pistol`).set('Cookie', w.admin.cookie)).body.data.results;
    expect(tyres).toHaveLength(1);
    expect(pistols).toHaveLength(0);
  });
});
