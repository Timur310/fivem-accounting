import { describe, it, expect, beforeEach } from 'vitest';
import { api, resetDatabase, seedBasicWorld, createUser, MISSING_UUID, type BasicWorld } from './helpers.js';

let w: BasicWorld;
const base = () => '/api/v1/support';

beforeEach(async () => {
  await resetDatabase();
  w = await seedBasicWorld();
});

/** The ordinary case: a plain member with no permissions sends a bug report. */
async function sendTicket(cookie: string, over: Record<string, unknown> = {}) {
  return api().post(base()).set('Cookie', cookie).send({
    kind: 'bug',
    subject: 'Quick log does nothing',
    message: 'Tapping Log it on the dashboard does not add a row.',
    ...over,
  });
}

/**
 * Support is the one feature with no faction authority in front of it. Gating
 * a bug report behind a rank would silence exactly the people most likely to
 * hit a bug, so these pin that a permissionless member can send one — and that
 * reading everybody else's stays superadmin-only.
 */
describe('POST /support', () => {
  it('lets a plain member with no permissions send a ticket', async () => {
    const res = await sendTicket(w.member.cookie);
    expect(res.status).toBe(201);
    expect(res.body.data.status).toBe('open');
    expect(res.body.data.kind).toBe('bug');
  });

  it('accepts a feature request too', async () => {
    const res = await sendTicket(w.member.cookie, { kind: 'feature', subject: 'Dark mode toggle' });
    expect(res.status).toBe(201);
    expect(res.body.data.kind).toBe('feature');
  });

  it('refuses an unknown kind', async () => {
    const res = await sendTicket(w.member.cookie, { kind: 'complaint' });
    expect(res.status).toBe(400);
  });

  it('refuses a message too short to act on', async () => {
    const res = await sendTicket(w.member.cookie, { message: 'broken' });
    expect(res.status).toBe(400);
  });

  it('refuses an anonymous caller', async () => {
    const res = await api().post(base()).send({
      kind: 'bug', subject: 'Hello there', message: 'A message long enough to pass.',
    });
    expect(res.status).toBe(401);
  });

  it('records the faction the reporter was looking at', async () => {
    const res = await sendTicket(w.member.cookie, { factionId: w.faction.id });
    expect(res.status).toBe(201);
    expect(res.body.data.factionId).toBe(w.faction.id);
  });

  // Context, never authority — losing the breadcrumb must not cost someone
  // their bug report.
  it('still accepts the ticket when the faction id is unknown', async () => {
    const res = await sendTicket(w.member.cookie, { factionId: MISSING_UUID });
    expect(res.status).toBe(201);
    expect(res.body.data.factionId).toBeNull();
  });
});

describe('GET /support/mine', () => {
  it('returns only the tickets the caller sent', async () => {
    await sendTicket(w.member.cookie, { subject: 'Mine own report' });
    await sendTicket(w.admin.cookie, { subject: 'Somebody elses report' });

    const res = await api().get(`${base()}/mine`).set('Cookie', w.member.cookie);
    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(1);
    expect(res.body.data[0].subject).toBe('Mine own report');
  });

  it('is empty for someone who has never sent one', async () => {
    const res = await api().get(`${base()}/mine`).set('Cookie', w.member.cookie);
    expect(res.body.data).toEqual([]);
  });
});

describe('GET /support — the maintainer inbox', () => {
  it('refuses a faction admin', async () => {
    const res = await api().get(base()).set('Cookie', w.admin.cookie);
    expect(res.status).toBe(403);
  });

  it('refuses a plain member', async () => {
    const res = await api().get(base()).set('Cookie', w.member.cookie);
    expect(res.status).toBe(403);
  });

  it('shows the superadmin every ticket, with the reporter named', async () => {
    await sendTicket(w.member.cookie, { factionId: w.faction.id });

    const res = await api().get(base()).set('Cookie', w.superadmin.cookie);
    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(1);
    expect(res.body.data[0].reporterUsername).toBe(w.member.username);
    expect(res.body.data[0].factionName).toBe(w.faction.name);
  });

  it('filters by status and by kind', async () => {
    await sendTicket(w.member.cookie, { kind: 'bug' });
    await sendTicket(w.member.cookie, { kind: 'feature', subject: 'A feature please' });

    const bugs = await api().get(`${base()}?kind=bug`).set('Cookie', w.superadmin.cookie);
    expect(bugs.body.data).toHaveLength(1);
    expect(bugs.body.data[0].kind).toBe('bug');

    const open = await api().get(`${base()}?status=open`).set('Cookie', w.superadmin.cookie);
    expect(open.body.data).toHaveLength(2);
  });

  // The inbox should open on the work, not on the history of it.
  it('sorts open tickets above closed ones', async () => {
    const first = await sendTicket(w.member.cookie, { subject: 'Older still open' });
    const second = await sendTicket(w.member.cookie, { subject: 'Newer but resolved' });
    await api().patch(`${base()}/${second.body.data.id}`)
      .set('Cookie', w.superadmin.cookie).send({ status: 'resolved' });

    const res = await api().get(base()).set('Cookie', w.superadmin.cookie);
    expect(res.body.data[0].id).toBe(first.body.data.id);
  });

  it('counts the open ones for the sidebar badge', async () => {
    await sendTicket(w.member.cookie);
    const created = await sendTicket(w.member.cookie, { subject: 'Second one here' });
    await api().patch(`${base()}/${created.body.data.id}`)
      .set('Cookie', w.superadmin.cookie).send({ status: 'declined' });

    const res = await api().get(`${base()}/open-count`).set('Cookie', w.superadmin.cookie);
    expect(res.body.data.open).toBe(1);
  });

  it('refuses the open count to a faction admin', async () => {
    const res = await api().get(`${base()}/open-count`).set('Cookie', w.admin.cookie);
    expect(res.status).toBe(403);
  });
});

describe('PATCH /support/:ticketId', () => {
  it('lets the superadmin resolve with a note the reporter can read', async () => {
    const created = await sendTicket(w.member.cookie);

    const res = await api().patch(`${base()}/${created.body.data.id}`)
      .set('Cookie', w.superadmin.cookie)
      .send({ status: 'resolved', resolutionNote: 'Fixed in v1.0.1, thanks.' });
    expect(res.status).toBe(200);
    expect(res.body.data.status).toBe('resolved');

    const mine = await api().get(`${base()}/mine`).set('Cookie', w.member.cookie);
    expect(mine.body.data[0].resolutionNote).toBe('Fixed in v1.0.1, thanks.');
  });

  it('lets the superadmin decline, which is not the same as resolving', async () => {
    const created = await sendTicket(w.member.cookie);
    const res = await api().patch(`${base()}/${created.body.data.id}`)
      .set('Cookie', w.superadmin.cookie)
      .send({ status: 'declined', resolutionNote: 'Working as intended.' });
    expect(res.body.data.status).toBe('declined');
  });

  it('lets the reporter cancel their own open ticket', async () => {
    const created = await sendTicket(w.member.cookie);
    const res = await api().patch(`${base()}/${created.body.data.id}`)
      .set('Cookie', w.member.cookie).send({ status: 'cancelled' });
    expect(res.status).toBe(200);
    expect(res.body.data.status).toBe('cancelled');
  });

  it('refuses to let the reporter resolve their own ticket', async () => {
    const created = await sendTicket(w.member.cookie);
    const res = await api().patch(`${base()}/${created.body.data.id}`)
      .set('Cookie', w.member.cookie).send({ status: 'resolved' });
    expect(res.status).toBe(403);
  });

  // Withdrawing an answered ticket would erase the answer.
  it('refuses a cancellation once the ticket has been answered', async () => {
    const created = await sendTicket(w.member.cookie);
    await api().patch(`${base()}/${created.body.data.id}`)
      .set('Cookie', w.superadmin.cookie).send({ status: 'resolved' });

    const res = await api().patch(`${base()}/${created.body.data.id}`)
      .set('Cookie', w.member.cookie).send({ status: 'cancelled' });
    expect(res.status).toBe(403);
  });

  it('refuses to let one member cancel a ticket somebody else sent', async () => {
    const created = await sendTicket(w.admin.cookie);
    const res = await api().patch(`${base()}/${created.body.data.id}`)
      .set('Cookie', w.member.cookie).send({ status: 'cancelled' });
    expect(res.status).toBe(403);
  });

  it('404s on a ticket that does not exist', async () => {
    const res = await api().patch(`${base()}/${MISSING_UUID}`)
      .set('Cookie', w.superadmin.cookie).send({ status: 'resolved' });
    expect(res.status).toBe(404);
  });
});

describe('DELETE /support/:ticketId', () => {
  it('lets the superadmin remove a ticket for good', async () => {
    const created = await sendTicket(w.member.cookie);

    const del = await api().delete(`${base()}/${created.body.data.id}`).set('Cookie', w.superadmin.cookie);
    expect(del.status).toBe(200);

    const mine = await api().get(`${base()}/mine`).set('Cookie', w.member.cookie);
    expect(mine.body.data).toHaveLength(0);
  });

  it('refuses the reporter', async () => {
    const created = await sendTicket(w.member.cookie);
    const res = await api().delete(`${base()}/${created.body.data.id}`).set('Cookie', w.member.cookie);
    expect(res.status).toBe(403);
  });
});

/** A brand new account on no roster at all can still reach support. */
describe('support is reachable without a faction', () => {
  it('accepts a ticket from someone on no roster', async () => {
    const loner = await createUser('faction_less');
    const res = await sendTicket(loner.cookie);
    expect(res.status).toBe(201);
  });
});
