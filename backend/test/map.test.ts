import { describe, it, expect, beforeEach } from 'vitest';
import { api, resetDatabase, seedBasicWorld, type BasicWorld } from './helpers.js';

let w: BasicWorld;
const f = () => `/api/v1/factions/${w.faction.id}`;
const map = () => `${f()}/map`;

/**
 * Lower level means higher rank. Boss is 1, Soldier is 5 — so a marker
 * restricted to level 2 is visible to the Boss and the Underboss and to
 * nobody below them.
 */
async function defineRanks() {
  const res = await api().patch(`${f()}/settings`).set('Cookie', w.admin.cookie).send({
    ranks: [
      { name: 'Boss', level: 1, permissions: ['manage_map'] },
      { name: 'Underboss', level: 2, permissions: ['manage_map'] },
      { name: 'Soldier', level: 5, permissions: [] },
    ],
  });
  expect(res.status).toBe(200);
}

async function setRank(rank: string | null) {
  const res = await api().patch(`${f()}/members/${w.member.id}`)
    .set('Cookie', w.admin.cookie).send({ rank });
  expect(res.status).toBe(200);
}

async function place(over: Record<string, unknown> = {}) {
  return api().post(map()).set('Cookie', w.admin.cookie).send({
    kind: 'point',
    name: 'Stash',
    points: [{ x: -1037.2, y: -2737.5, z: 20.1 }],
    ...over,
  });
}

async function visibleTo(cookie: string): Promise<string[]> {
  const res = await api().get(map()).set('Cookie', cookie);
  expect(res.status).toBe(200);
  return res.body.data.markers.map((m: { name: string }) => m.name);
}

beforeEach(async () => {
  await resetDatabase();
  w = await seedBasicWorld();
  await defineRanks();
});

describe('placing markers', () => {
  it('needs manage_map', async () => {
    await setRank('Soldier');
    const res = await api().post(map()).set('Cookie', w.member.cookie).send({
      kind: 'point', name: 'Stash', points: [{ x: 1, y: 2 }],
    });
    expect(res.status).toBe(403);
  });

  it('keeps game coordinates exactly as given', async () => {
    const res = await place();
    expect(res.status).toBe(201);
    // The number a player read off /coords is the number that must survive.
    expect(res.body.data.points).toEqual([{ x: -1037.2, y: -2737.5, z: 20.1 }]);
  });

  it('accepts a route and an area', async () => {
    const route = await place({
      kind: 'route', name: 'Supply run',
      points: [{ x: 0, y: 0 }, { x: 100, y: 100 }],
    });
    expect(route.status).toBe(201);

    const area = await place({
      kind: 'area', name: 'Turf',
      points: [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 100 }],
    });
    expect(area.status).toBe(201);
  });

  it('refuses a shape with too few corners', async () => {
    const route = await place({ kind: 'route', name: 'Nowhere', points: [{ x: 0, y: 0 }] });
    expect(route.status).toBe(400);

    const area = await place({
      kind: 'area', name: 'Flat', points: [{ x: 0, y: 0 }, { x: 1, y: 1 }],
    });
    expect(area.status).toBe(400);

    const point = await place({ points: [{ x: 0, y: 0 }, { x: 1, y: 1 }] });
    expect(point.status).toBe(400);
  });

  // Interiors and custom MLOs sit outside the vanilla map, so the accepted
  // range is deliberately wider than GTA V's own world.
  it('accepts a coordinate outside the vanilla world', async () => {
    const res = await place({ points: [{ x: -6000, y: 9500, z: -900 }] });
    expect(res.status).toBe(201);
  });
});

/**
 * The part that matters. A marker the viewer may not see must never reach
 * them: filtering in the client would put the faction's stash in a network
 * response anybody can open devtools and read.
 */
describe('who sees what', () => {
  it('shows an unrestricted marker to everybody', async () => {
    await setRank('Soldier');
    await place({ name: 'Meet point' });
    expect(await visibleTo(w.member.cookie)).toContain('Meet point');
  });

  it('hides a leadership marker from a lower rank', async () => {
    await setRank('Soldier');
    await place({ name: 'Main stash', minRankLevel: 2 });

    expect(await visibleTo(w.member.cookie)).not.toContain('Main stash');
    expect(await visibleTo(w.admin.cookie)).toContain('Main stash');
  });

  it('shows it once the member holds a high enough rank', async () => {
    await place({ name: 'Main stash', minRankLevel: 2 });

    await setRank('Soldier');
    expect(await visibleTo(w.member.cookie)).not.toContain('Main stash');

    await setRank('Underboss');
    expect(await visibleTo(w.member.cookie)).toContain('Main stash');
  });

  it('treats a member with no rank as lower than every rank', async () => {
    await setRank(null);
    await place({ name: 'Main stash', minRankLevel: 5 });
    expect(await visibleTo(w.member.cookie)).not.toContain('Main stash');
  });

  // Deleting a rank leaves members holding a name nothing defines. Hiding is
  // the safe read — it can only ever hide a marker, never reveal one.
  it('treats a deleted rank as no rank', async () => {
    await setRank('Underboss');
    await place({ name: 'Main stash', minRankLevel: 2 });
    expect(await visibleTo(w.member.cookie)).toContain('Main stash');

    await api().patch(`${f()}/settings`).set('Cookie', w.admin.cookie).send({
      ranks: [{ name: 'Boss', level: 1, permissions: ['manage_map'] }],
    });

    expect(await visibleTo(w.member.cookie)).not.toContain('Main stash');
  });

  it('never sends the coordinates of a hidden marker', async () => {
    await setRank('Soldier');
    await place({ name: 'Main stash', minRankLevel: 1, points: [{ x: 4242.5, y: -1337.25 }] });

    const res = await api().get(map()).set('Cookie', w.member.cookie);
    expect(JSON.stringify(res.body)).not.toContain('4242.5');
  });

  it('keeps one faction off another faction’s map', async () => {
    await place({ name: 'Meet point' });
    const res = await api().get(map()).set('Cookie', w.outsider.cookie);
    expect(res.status).toBe(403);
  });
});

describe('editing and removing', () => {
  it('re-checks the shape when the kind changes', async () => {
    const created = await place({
      kind: 'area', name: 'Turf',
      points: [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 1 }],
    });

    const res = await api().patch(`${map()}/${created.body.data.id}`)
      .set('Cookie', w.admin.cookie).send({ kind: 'point' });

    expect(res.status).toBe(400);
  });

  it('moves a marker', async () => {
    const created = await place();
    const res = await api().patch(`${map()}/${created.body.data.id}`)
      .set('Cookie', w.admin.cookie).send({ points: [{ x: 10, y: 20, z: 30 }] });

    expect(res.status).toBe(200);
    expect(res.body.data.points).toEqual([{ x: 10, y: 20, z: 30 }]);
  });

  it('needs manage_map to remove one', async () => {
    await setRank('Soldier');
    const created = await place();
    const res = await api().delete(`${map()}/${created.body.data.id}`)
      .set('Cookie', w.member.cookie);
    expect(res.status).toBe(403);
  });

  it('removes it', async () => {
    const created = await place();
    const res = await api().delete(`${map()}/${created.body.data.id}`)
      .set('Cookie', w.admin.cookie);
    expect(res.status).toBe(200);
    expect(await visibleTo(w.admin.cookie)).toHaveLength(0);
  });
});
