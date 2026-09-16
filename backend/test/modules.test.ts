import { describe, it, expect, beforeEach } from 'vitest';
import { api, resetDatabase, seedBasicWorld, type BasicWorld } from './helpers.js';
import { FACTION_MODULES, isModuleEnabled, PERMISSION_MODULE } from '../src/lib/modules.js';
import { FACTION_PERMISSIONS } from '../src/db/schema.js';

let w: BasicWorld;
const f = () => `/api/v1/factions/${w.faction.id}`;

beforeEach(async () => {
  await resetDatabase();
  w = await seedBasicWorld();
});

/** Turn the faction down to exactly these modules. */
async function only(modules: string[]) {
  const res = await api().patch(`${f()}/settings`)
    .set('Cookie', w.admin.cookie)
    .send({ enabledModules: modules });
  expect(res.status).toBe(200);
}

/**
 * A faction that has never touched this has everything.
 *
 * The column is null rather than a filled-in list, and nothing backfilled it:
 * every faction that existed before modules did kept every screen it had on
 * the day this shipped, and a module added next year arrives switched on
 * rather than silently missing from factions configured before it existed.
 */
describe('the default', () => {
  it('leaves an untouched faction with every module', () => {
    for (const module of FACTION_MODULES) {
      expect(isModuleEnabled(null, module)).toBe(true);
    }
  });

  it('lets a faction that never set them log an entry', async () => {
    const res = await api().post(`${f()}/entries`).set('Cookie', w.member.cookie)
      .send({ itemTypeId: w.itemTypeId, amount: '100' });
    expect(res.status).toBe(201);
  });

  it('reports them as null rather than inventing a list', async () => {
    const res = await api().get(`${f()}/settings`).set('Cookie', w.member.cookie);
    expect(res.body.data.enabledModules).toBeNull();
  });
});

describe('switching a module off', () => {
  it('refuses new entries once entries are off', async () => {
    await only(FACTION_MODULES.filter((m) => m !== 'entries'));

    const res = await api().post(`${f()}/entries`).set('Cookie', w.member.cookie)
      .send({ itemTypeId: w.itemTypeId, amount: '100' });
    expect(res.status).toBe(403);
    expect(res.body.error.message).toMatch(/turned that feature off/i);
  });

  // Off means nobody wants to look at it, not that last year stopped being
  // true. An export or a report covering old data must not start failing.
  it('keeps answering reads', async () => {
    const logged = await api().post(`${f()}/entries`).set('Cookie', w.member.cookie)
      .send({ itemTypeId: w.itemTypeId, amount: '100' });
    expect(logged.status).toBe(201);

    await only(FACTION_MODULES.filter((m) => m !== 'entries'));

    const res = await api().get(`${f()}/entries`).set('Cookie', w.member.cookie);
    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(1);
  });

  it('gives the data back untouched when it is switched on again', async () => {
    await api().post(`${f()}/entries`).set('Cookie', w.member.cookie)
      .send({ itemTypeId: w.itemTypeId, amount: '250' });

    await only(['vehicles']);
    await only([...FACTION_MODULES]);

    const res = await api().get(`${f()}/entries`).set('Cookie', w.member.cookie);
    expect(res.body.data).toHaveLength(1);
    expect(res.body.data[0].amount).toBe('250.00');

    const again = await api().post(`${f()}/entries`).set('Cookie', w.member.cookie)
      .send({ itemTypeId: w.itemTypeId, amount: '50' });
    expect(again.status).toBe(201);
  });

  it('leaves the modules that are still on alone', async () => {
    await only(['vehicles']);

    const res = await api().post(`${f()}/vehicles`).set('Cookie', w.admin.cookie)
      .send({ plate: 'STILLON' });
    expect(res.status).toBe(201);
  });

  /**
   * A sale books entries, and it goes on doing that with the entries screen
   * switched off: the module hid a screen, not a number. Modelling which
   * module needs which other one would be a rule engine between a faction and
   * a checkbox, and wrong the first time somebody combined two features in a
   * way nobody predicted.
   */
  it('does not stop another module writing to the ledger', async () => {
    await only(['operations']);

    const res = await api().post(`${f()}/operations`).set('Cookie', w.admin.cookie).send({
      name: 'Pacific Standard',
      participants: [{ userId: w.member.id }],
      loot: [{ itemTypeId: w.itemTypeId, quantity: '1000.00' }],
    });
    expect(res.status).toBe(201);

    const entries = await api().get(`${f()}/entries`).set('Cookie', w.member.cookie);
    expect(entries.body.data).toHaveLength(1);
  });

  it('refuses a module name the app does not have', async () => {
    const res = await api().patch(`${f()}/settings`).set('Cookie', w.admin.cookie)
      .send({ enabledModules: ['nonsense'] });
    expect(res.status).toBe(400);
  });

  it('restores every module when set back to null', async () => {
    await only(['map']);
    const res = await api().patch(`${f()}/settings`).set('Cookie', w.admin.cookie)
      .send({ enabledModules: null });
    expect(res.status).toBe(200);
    expect(res.body.data.enabledModules).toBeNull();

    const entry = await api().post(`${f()}/entries`).set('Cookie', w.member.cookie)
      .send({ itemTypeId: w.itemTypeId, amount: '100' });
    expect(entry.status).toBe(201);
  });
});

/**
 * Taking a screen away from everybody in the faction is an admin decision.
 * The rank permissions draw the same line, for the same reason.
 */
describe('who may change them', () => {
  it('refuses a member holding manage_settings', async () => {
    await api().patch(`${f()}/settings`).set('Cookie', w.admin.cookie)
      .send({ ranks: [{ name: 'Officer', level: 1, permissions: ['manage_settings'] }] });
    await api().patch(`${f()}/members/${w.member.id}`)
      .set('Cookie', w.admin.cookie).send({ rank: 'Officer' });

    const res = await api().patch(`${f()}/settings`).set('Cookie', w.member.cookie)
      .send({ enabledModules: ['map'] });
    expect(res.status).toBe(403);
  });

  it('allows a faction admin', async () => {
    const res = await api().patch(`${f()}/settings`).set('Cookie', w.admin.cookie)
      .send({ enabledModules: ['map'] });
    expect(res.status).toBe(200);
    expect(res.body.data.enabledModules).toEqual(['map']);
  });
});

/**
 * The rank editor filters its checkbox list through this map, so a permission
 * missing from it would keep showing up for a faction that turned its feature
 * off — the twenty-one-checkbox wall this exists to shrink.
 */
describe('the permission map', () => {
  it('places every permission that belongs to a module', () => {
    const unplaced = FACTION_PERMISSIONS.filter((p) => !PERMISSION_MODULE[p]);
    // The rest govern the faction itself — members, settings, customisation,
    // the audit log, Discord — and are never hidden.
    expect(unplaced.sort()).toEqual([
      'manage_customization',
      'manage_discord',
      'manage_item_types',
      'manage_members',
      'manage_settings',
      'view_audit_logs',
    ].sort());
  });
});

/**
 * The Discord routing list only offers events the faction can cause.
 *
 * A channel picker for "Vehicle added" in a faction with no registry is a
 * setting for a message that will never be sent.
 */
describe('the Discord routing list', () => {
  it('drops the events of switched-off modules', async () => {
    await only(['vehicles']);

    const res = await api().get(`${f()}/discord`).set('Cookie', w.admin.cookie);
    expect(res.status).toBe(200);
    expect(res.body.data.eventTypes).toContain('vehicle_added');
    expect(res.body.data.eventTypes).not.toContain('entry_logged');
    // Not every event belongs to a module — a member joining is the faction
    // itself, and stays routable whatever is switched off.
    expect(res.body.data.eventTypes).toContain('member_joined');
  });
});
