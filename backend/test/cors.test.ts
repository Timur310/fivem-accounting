import { describe, it, expect } from 'vitest';
import { api } from './helpers.js';

// Several routes save a whole table with PUT (rates, prices, storage layouts).
// A deployment where the API is on another origin has to be told PUT is fine,
// or the browser refuses the request before it is sent.
describe('CORS preflight', () => {
  it('allows every method the routes use', async () => {
    const res = await api()
      .options('/api/v1/factions/x/storage/rooms/y/layout')
      .set('Origin', 'http://localhost:3000')
      .set('Access-Control-Request-Method', 'PUT');
    const allowed = String(res.headers['access-control-allow-methods']);
    for (const method of ['GET', 'POST', 'PUT', 'PATCH', 'DELETE']) expect(allowed).toContain(method);
  });
});
