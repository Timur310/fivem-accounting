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
