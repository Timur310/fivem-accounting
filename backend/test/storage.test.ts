import { describe, it, expect, beforeEach } from 'vitest';
import { api, resetDatabase, seedBasicWorld, createItemType, createEntry, type BasicWorld } from './helpers.js';
import { droppedBelowMin, fitProblem, layoutProblem } from '../src/lib/storage.js';

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
