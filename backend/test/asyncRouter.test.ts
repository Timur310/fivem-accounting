import { describe, it, expect, beforeEach } from 'vitest';
import { api, resetDatabase, seedBasicWorld, type BasicWorld } from './helpers.js';

/**
 * A bad request gets an answer.
 *
 * Express 4 does not follow a rejected promise. A handler declared `async` —
 * which is nearly every handler in this app — that throws for any reason,
 * including the `schema.parse` that guards almost every write, rejects into
 * nothing: the error handler never runs, no response is written, and the
 * caller sits there until it times out. The browser shows a spinner that never
 * stops, and the server logs an unhandled rejection with no request attached.
 *
 * `asyncRouter` closes that, so these are the same assertions anybody would
 * have expected to hold all along.
 */
let w: BasicWorld;
const f = () => `/api/v1/factions/${w.faction.id}`;

beforeEach(async () => {
  await resetDatabase();
  w = await seedBasicWorld();
});

describe('a rejected handler still answers', () => {
  it('400s on a body the schema refuses', async () => {
    const res = await api().post(`${f()}/vehicles`)
      .set('Cookie', w.admin.cookie)
      .send({ plate: '' });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });

  // The message names the field. A 400 saying only "Validation failed" sends
  // somebody hunting through a form of fifteen inputs.
  it('says which field it refused', async () => {
    const res = await api().post(`${f()}/entries`)
      .set('Cookie', w.member.cookie)
      .send({ itemTypeId: w.itemTypeId, amount: 'not a number' });
    expect(res.status).toBe(400);
    expect(res.body.error.message).toMatch(/amount/i);
  });

  it('answers on a nested route too', async () => {
    const res = await api().post(`${f()}/quotas`)
      .set('Cookie', w.admin.cookie)
      .send({ itemTypeId: w.itemTypeId, targetAmount: 'soon' });
    expect(res.status).toBe(400);
  });

  // The guard that runs before the handler is async as well, and a throw
  // there used to disappear the same way.
  it('answers when the request never reaches a handler', async () => {
    const res = await api().get('/api/v1/factions/not-a-uuid/entries')
      .set('Cookie', w.admin.cookie);
    expect([400, 403, 404]).toContain(res.status);
  });
});
