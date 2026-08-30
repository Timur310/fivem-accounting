import { describe, it, expect, beforeEach } from 'vitest';
import { api, resetDatabase, seedBasicWorld, type BasicWorld } from './helpers.js';

let w: BasicWorld;
const settings = () => `/api/v1/factions/${w.faction.id}/settings`;

beforeEach(async () => {
  await resetDatabase();
  w = await seedBasicWorld();
});

/**
 * The app shell reads the brand colour from here on every faction switch. It
 * used to read it from GET /factions/:id, which is superadmin-only — so for
 * every ordinary faction admin the request 403'd and the colour silently fell
 * back to the default however many times it had been saved. These pin the two
 * properties that fix depends on: the settings endpoint carries the colour,
 * and a plain member may read it.
 */
describe('brand colour', () => {
  it('is saved and read back through the settings endpoint', async () => {
    const saved = await api()
      .patch(settings())
      .set('Cookie', w.admin.cookie)
      .send({ brandColor: '#ff8800' });

    expect(saved.status).toBe(200);
    expect(saved.body.data.brandColor).toBe('#ff8800');

    const read = await api().get(settings()).set('Cookie', w.admin.cookie);
    expect(read.body.data.brandColor).toBe('#ff8800');
  });

  it('is readable by a plain member, who has to render it too', async () => {
    await api()
      .patch(settings())
      .set('Cookie', w.admin.cookie)
      .send({ brandColor: '#112233' });

    const res = await api().get(settings()).set('Cookie', w.member.cookie);
    expect(res.status).toBe(200);
    expect(res.body.data.brandColor).toBe('#112233');
  });

  it('survives a save that also carries the other customization fields', async () => {
    const res = await api()
      .patch(settings())
      .set('Cookie', w.admin.cookie)
      .send({
        brandColor: '#445566',
        customFields: [{ name: 'Plate', required: false }],
        payoutApprovalRequired: true,
      });

    expect(res.status).toBe(200);
    expect(res.body.data.brandColor).toBe('#445566');
    expect(res.body.data.payoutApprovalRequired).toBe(true);
  });

  it('is null before anyone sets one, so the client can fall back', async () => {
    const res = await api().get(settings()).set('Cookie', w.member.cookie);
    expect(res.status).toBe(200);
    expect(res.body.data.brandColor).toBeNull();
  });

  it('rejects anything that is not a six-digit hex colour', async () => {
    for (const bad of ['red', '#fff', '3b82f6', '#12345g']) {
      const res = await api()
        .patch(settings())
        .set('Cookie', w.admin.cookie)
        .send({ brandColor: bad });
      expect(res.status, `expected ${bad} to be rejected`).toBe(400);
    }
  });
});

/**
 * The faction switcher paints one row per faction, so /auth/me has to carry
 * each faction's own colour. Reading it from the store instead painted every
 * row in the selected faction's colour.
 */
describe('brand colour per faction on /auth/me', () => {
  it('carries each membership its own faction colour', async () => {
    const second = await api()
      .post('/api/v1/factions')
      .set('Cookie', w.superadmin.cookie)
      .send({ name: 'Second Faction', initialAdminDiscordId: w.admin.discordId });
    expect(second.status).toBe(201);
    const secondId = second.body.data.id;

    await api()
      .patch(`/api/v1/factions/${w.faction.id}/settings`)
      .set('Cookie', w.admin.cookie)
      .send({ brandColor: '#aa0000' });
    await api()
      .patch(`/api/v1/factions/${secondId}/settings`)
      .set('Cookie', w.admin.cookie)
      .send({ brandColor: '#00bb00' });

    const me = await api().get('/api/v1/auth/me').set('Cookie', w.admin.cookie);
    expect(me.status).toBe(200);

    const first = me.body.data.factions.find(
      (f: { factionId: string }) => f.factionId === w.faction.id,
    );
    const other = me.body.data.factions.find(
      (f: { factionId: string }) => f.factionId === secondId,
    );
    expect(first.factionBrandColor).toBe('#aa0000');
    expect(other.factionBrandColor).toBe('#00bb00');
  });

  it('reports null for a faction nobody has coloured yet', async () => {
    const me = await api().get('/api/v1/auth/me').set('Cookie', w.member.cookie);
    const only = me.body.data.factions[0];
    expect(only.factionBrandColor).toBeNull();
  });

  it('carries it on the superadmin browse list too', async () => {
    await api()
      .patch(`/api/v1/factions/${w.faction.id}/settings`)
      .set('Cookie', w.admin.cookie)
      .send({ brandColor: '#123456' });

    const me = await api().get('/api/v1/auth/me').set('Cookie', w.superadmin.cookie);
    const browseable = me.body.data.browseableFactions.find(
      (b: { id: string }) => b.id === w.faction.id,
    );
    expect(browseable.brandColor).toBe('#123456');
  });
});
