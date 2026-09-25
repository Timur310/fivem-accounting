import { describe, it, expect, beforeEach } from 'vitest';
import { eq } from 'drizzle-orm';
import {
  api, resetDatabase, seedBasicWorld, createUser, addMember, type BasicWorld,
} from './helpers.js';
import { db } from '../src/db/index.js';
import { auditLogs, factionReports } from '../src/db/schema.js';

let w: BasicWorld;
let third: Awaited<ReturnType<typeof createUser>>;

const f = () => `/api/v1/factions/${w.faction.id}`;
const base = () => `${f()}/complaints`;

beforeEach(async () => {
  await resetDatabase();
  w = await seedBasicWorld();
  third = await createUser('third_member');
  await addMember(w.faction.id, third.id, 'member');
});

/** Give the plain member a rank carrying exactly these permissions. */
async function giveMemberRank(permissions: string[], name = 'Staff') {
  const ranks = await api().patch(`${f()}/settings`).set('Cookie', w.admin.cookie)
    .send({ ranks: [{ name, level: 1, permissions }] });
  expect(ranks.status).toBe(200);
  const assigned = await api().patch(`${f()}/members/${w.member.id}`)
    .set('Cookie', w.admin.cookie).send({ rank: name });
  expect(assigned.status).toBe(200);
}

const file = (body: Record<string, unknown>, cookie = w.member.cookie) =>
  api().post(base()).set('Cookie', cookie).send(body);

describe('raising something', () => {
  // A complaints box only the trusted may write into is not a complaints box.
  it('takes one from a member holding no permissions at all', async () => {
    await giveMemberRank([]);
    const res = await file({ subject: 'Rota is unfair', body: 'Same people every weekend.' });
    expect(res.status).toBe(201);
    expect(res.body.data.targetUserId).toBeNull();
    expect(res.body.data.status).toBe('open');
  });

  it('takes one about another member', async () => {
    const res = await file({
      targetUserId: third.id,
      category: 'conduct',
      subject: 'Shouting in the garage',
      body: 'Third told a customer to get lost.',
    });
    expect(res.status).toBe(201);
    expect(res.body.data.targetUserId).toBe(third.id);
    expect(res.body.data.targetName).toBe(third.username);
  });

  it('refuses one about somebody outside the faction', async () => {
    const outsider = await createUser('not_a_member');
    const res = await file({ targetUserId: outsider.id, subject: 'x', body: 'y' });
    expect(res.status).toBe(400);
  });

  it('refuses one about yourself', async () => {
    const res = await file({ targetUserId: w.member.id, subject: 'x', body: 'y' });
    expect(res.status).toBe(400);
  });

  it('needs a subject and a body', async () => {
    expect((await file({ subject: '', body: 'y' })).status).toBe(400);
    expect((await file({ subject: 'x', body: '' })).status).toBe(400);
  });
});

describe('who can read what', () => {
  async function aComplaint(body: Record<string, unknown> = {}) {
    const res = await file({
      targetUserId: third.id,
      subject: 'Took from the vault',
      body: 'Twice this week.',
      ...body,
    });
    expect(res.status).toBe(201);
    return res.body.data.id as string;
  }

  // The whole point of the feature. Being named in a complaint gives you no
  // read of it at all.
  it('hides a complaint from the person it is about', async () => {
    const id = await aComplaint();

    const list = await api().get(base()).set('Cookie', third.cookie);
    expect(list.status).toBe(200);
    expect(list.body.data.complaints).toHaveLength(0);

    const direct = await api().get(`${base()}/${id}`).set('Cookie', third.cookie);
    expect(direct.status).toBe(404);
  });

  it('shows a member the ones they filed', async () => {
    const id = await aComplaint();
    const list = await api().get(base()).set('Cookie', w.member.cookie);
    expect(list.body.data.handlesQueue).toBe(false);
    expect(list.body.data.complaints.map((c: { id: string }) => c.id)).toContain(id);
  });

  it('shows the whole queue to somebody with manage_complaints', async () => {
    await aComplaint();
    await file({ subject: 'Second one', body: 'About the faction.' }, third.cookie);

    const list = await api().get(base()).set('Cookie', w.admin.cookie);
    expect(list.body.data.handlesQueue).toBe(true);
    expect(list.body.data.complaints).toHaveLength(2);
    expect(list.body.data.openCount).toBe(2);
  });

  it('gives a plain member the queue once the rank carries the permission', async () => {
    await aComplaint();
    await giveMemberRank(['manage_complaints']);
    const list = await api().get(base()).set('Cookie', w.member.cookie);
    expect(list.body.data.handlesQueue).toBe(true);
  });
});

/**
 * Anonymity, which is the one thing here that cannot be undone by apologising.
 */
describe('filing anonymously', () => {
  async function anonymous() {
    const res = await file({
      isAnonymous: true,
      targetUserId: third.id,
      subject: 'Bullying newer members',
      body: 'It has been going on for weeks.',
    });
    expect(res.status).toBe(201);
    return res.body.data.id as string;
  }

  it('never stores the author', async () => {
    const id = await anonymous();
    const [row] = await db.select().from(factionReports).where(eq(factionReports.id, id));
    expect(row!.authorUserId).toBeNull();
    expect(row!.isAnonymous).toBe(true);
  });

  it('returns no author to the people who handle it', async () => {
    await anonymous();
    const list = await api().get(base()).set('Cookie', w.admin.cookie);
    const row = list.body.data.complaints[0];
    expect(row.isAnonymous).toBe(true);
    expect(row.authorUserId).toBeNull();
    expect(row.authorName).toBeNull();
    // The complaint itself is still readable — that is the point of filing it.
    expect(row.body).toContain('going on for weeks');
  });

  // An audit log a faction admin can read would hand back exactly the name
  // the member was promised was not being kept.
  it('writes no audit row that would name them', async () => {
    await anonymous();
    const rows = await db.select().from(auditLogs)
      .where(eq(auditLogs.entityType, 'complaint'));
    expect(rows).toHaveLength(0);
  });

  it('still audits a signed complaint', async () => {
    await file({ subject: 'Signed', body: 'With my name on it.' });
    const rows = await db.select().from(auditLogs)
      .where(eq(auditLogs.entityType, 'complaint'));
    expect(rows).toHaveLength(1);
    expect(rows[0]!.userId).toBe(w.member.id);
  });
});

describe('settling one', () => {
  async function aComplaint(cookie = w.member.cookie) {
    const res = await file({ subject: 'Something', body: 'Happened.' }, cookie);
    return res.body.data.id as string;
  }

  it('records who settled it and what they said', async () => {
    const id = await aComplaint();
    const res = await api().patch(`${base()}/${id}`).set('Cookie', w.admin.cookie)
      .send({ status: 'resolved', resolutionNote: 'Spoke to everyone, rota changed.' });
    expect(res.status).toBe(200);
    expect(res.body.data.status).toBe('resolved');
    expect(res.body.data.handledBy).toBe(w.admin.id);
    expect(res.body.data.handledAt).not.toBeNull();
    expect(res.body.data.resolutionNote).toContain('rota changed');
  });

  // A complaint that closes in silence teaches people not to file the next
  // one, so the author reads the outcome and the note.
  it('lets the author read the answer', async () => {
    const id = await aComplaint();
    await api().patch(`${base()}/${id}`).set('Cookie', w.admin.cookie)
      .send({ status: 'dismissed', resolutionNote: 'Not what happened.' });

    const res = await api().get(`${base()}/${id}`).set('Cookie', w.member.cookie);
    expect(res.status).toBe(200);
    expect(res.body.data.status).toBe('dismissed');
    expect(res.body.data.resolutionNote).toBe('Not what happened.');
  });

  it('lets the author withdraw it', async () => {
    const id = await aComplaint();
    const res = await api().patch(`${base()}/${id}`).set('Cookie', w.member.cookie)
      .send({ status: 'withdrawn' });
    expect(res.status).toBe(200);
    expect(res.body.data.status).toBe('withdrawn');
  });

  // Otherwise anybody could close their own case.
  it('refuses to let the author resolve their own', async () => {
    const id = await aComplaint();
    const res = await api().patch(`${base()}/${id}`).set('Cookie', w.member.cookie)
      .send({ status: 'resolved' });
    expect(res.status).toBe(403);
  });

  it('refuses to let the person it is about touch it', async () => {
    const res = await file({ targetUserId: third.id, subject: 'x', body: 'y' });
    const id = res.body.data.id as string;
    const patched = await api().patch(`${base()}/${id}`).set('Cookie', third.cookie)
      .send({ status: 'dismissed' });
    expect(patched.status).toBe(403);
  });

  // Nothing on the row says who wrote it, so there is nobody to withdraw it.
  it('leaves an anonymous complaint with no author to withdraw it', async () => {
    const res = await file({ isAnonymous: true, subject: 'x', body: 'y' });
    const id = res.body.data.id as string;
    const patched = await api().patch(`${base()}/${id}`).set('Cookie', w.member.cookie)
      .send({ status: 'withdrawn' });
    expect(patched.status).toBe(403);
  });
});

describe('the module switch', () => {
  it('refuses new complaints when the faction has them off, and still answers reads', async () => {
    const off = await api().patch(`${f()}/settings`).set('Cookie', w.admin.cookie)
      .send({ enabledModules: ['entries'] });
    expect(off.status).toBe(200);

    expect((await file({ subject: 'x', body: 'y' })).status).toBe(403);
    expect((await api().get(base()).set('Cookie', w.admin.cookie)).status).toBe(200);
  });
});
