import { describe, it, expect, beforeEach } from 'vitest';
import { api, resetDatabase, seedBasicWorld, type BasicWorld } from './helpers.js';
import { PERMISSION_TIER, templatesFor } from '../src/lib/rankTemplates.js';
import { FACTION_PERMISSIONS } from '../src/db/schema.js';

let w: BasicWorld;
const f = () => `/api/v1/factions/${w.faction.id}`;

beforeEach(async () => {
  await resetDatabase();
  w = await seedBasicWorld();
});

async function templates(cookie = w.admin.cookie) {
  const res = await api().get(`${f()}/settings/rank-templates`).set('Cookie', cookie);
  expect(res.status).toBe(200);
  return res.body.data.templates as {
    key: string;
    ranks: { nameKey: string; level: number; tier: string; permissions: string[] }[];
  }[];
}

describe('what a template contains', () => {
  it('offers a shape for a crew, an organisation and a business', async () => {
    expect((await templates()).map((t) => t.key)).toEqual(['crew', 'organisation', 'business']);
  });

  // Level 1 is the boss in this app, and a template that got that backwards
  // would hand the newest recruit everything.
  it('puts the most authority on the lowest level', async () => {
    for (const template of await templates()) {
      const sorted = [...template.ranks].sort((a, b) => a.level - b.level);
      expect(sorted).toEqual(template.ranks);
      for (let i = 1; i < sorted.length; i += 1) {
        expect(sorted[i]!.permissions.length).toBeLessThanOrEqual(sorted[i - 1]!.permissions.length);
      }
    }
  });

  // Reading is open to members throughout this app, so the bottom rank can
  // already see the registry, the map and the board on day one.
  it('ends every template with a rank that holds nothing', async () => {
    for (const template of await templates()) {
      expect(template.ranks[template.ranks.length - 1]!.permissions).toEqual([]);
    }
  });

  it('gives the top rank every permission the faction has', async () => {
    const [crew] = await templates();
    expect(crew!.ranks[0]!.permissions.sort()).toEqual([...FACTION_PERMISSIONS].sort());
  });

  it('never suggests a permission the app does not have', async () => {
    for (const template of await templates()) {
      for (const rank of template.ranks) {
        for (const permission of rank.permissions) {
          expect(FACTION_PERMISSIONS).toContain(permission);
        }
      }
    }
  });
});

/**
 * A template is the one place that could rebuild the twenty-one-chip wall the
 * modules setting exists to pull down.
 */
describe('templates follow the faction\'s modules', () => {
  it('leaves out permissions for switched-off modules', async () => {
    const res = await api().patch(`${f()}/settings`).set('Cookie', w.admin.cookie)
      .send({ enabledModules: ['vehicles', 'map'] });
    expect(res.status).toBe(200);

    const [crew] = await templates();
    const boss = crew!.ranks[0]!.permissions;
    expect(boss).toContain('manage_vehicles');
    expect(boss).toContain('manage_map');
    expect(boss).not.toContain('manage_prices');
    expect(boss).not.toContain('craft');

    // The permissions that govern the faction itself belong to no module and
    // survive whatever is switched off.
    expect(boss).toContain('manage_members');
    expect(boss).toContain('manage_settings');
  });

  it('still names every rank when a faction runs almost nothing', async () => {
    await api().patch(`${f()}/settings`).set('Cookie', w.admin.cookie)
      .send({ enabledModules: [] });

    const [, organisation] = await templates();
    expect(organisation!.ranks).toHaveLength(5);
    expect(organisation!.ranks[0]!.permissions).toContain('manage_members');
  });
});

describe('every permission is classified', () => {
  it('has a tier for each one, so a new permission cannot go missing', () => {
    for (const permission of FACTION_PERMISSIONS) {
      expect(PERMISSION_TIER[permission]).toBeDefined();
    }
  });

  // The library is pure: the same faction settings always produce the same
  // template, and reading them writes nothing.
  it('writes nothing when a template is read', async () => {
    await templates();
    const settings = await api().get(`${f()}/settings`).set('Cookie', w.admin.cookie);
    expect(settings.body.data.ranks).toEqual([]);
  });

  it('computes the same list without going through the API', () => {
    const [crew] = templatesFor(['vehicles']);
    expect(crew!.ranks[0]!.permissions).toContain('manage_vehicles');
    expect(crew!.ranks[0]!.permissions).not.toContain('sell');
  });
});

describe('who may read them', () => {
  it('lets a member see them, because the rank editor is readable', async () => {
    const res = await api().get(`${f()}/settings/rank-templates`).set('Cookie', w.member.cookie);
    expect(res.status).toBe(200);
  });

  it('shuts an outsider out', async () => {
    const res = await api().get(`${f()}/settings/rank-templates`).set('Cookie', w.outsider.cookie);
    expect(res.status).toBe(403);
  });
});
