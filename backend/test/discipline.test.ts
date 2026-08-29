import { describe, it, expect, beforeEach } from 'vitest';
import { api, resetDatabase, seedBasicWorld, MISSING_UUID, type BasicWorld } from './helpers.js';
import { db } from '../src/db/index.js';
import { strikes } from '../src/db/schema.js';
import { eq } from 'drizzle-orm';

let w: BasicWorld;
const notes = () => `/api/v1/factions/${w.faction.id}/members/${w.member.id}/notes`;
const memberStrikes = () => `/api/v1/factions/${w.faction.id}/members/${w.member.id}/strikes`;
const factionStrikes = () => `/api/v1/factions/${w.faction.id}/strikes`;

beforeEach(async () => {
  await resetDatabase();
  w = await seedBasicWorld();
});

describe('member notes', () => {
  it('creates a note', async () => {
    const res = await api().post(notes()).set('Cookie', w.admin.cookie)
      .send({ category: 'performance', content: 'Hits quota consistently', isFlagged: true });
    expect(res.status).toBe(201);
    expect(res.body.data.category).toBe('performance');
    expect(res.body.data.isFlagged).toBe(true);
  });

  it('defaults the category to general', async () => {
    const res = await api().post(notes()).set('Cookie', w.admin.cookie).send({ content: 'Observed' });
    expect(res.body.data.category).toBe('general');
  });

  it('rejects an unknown category', async () => {
    const res = await api().post(notes()).set('Cookie', w.admin.cookie)
      .send({ category: 'gossip', content: 'x' });
    expect(res.status).toBe(400);
  });

  it('rejects empty content', async () => {
    const res = await api().post(notes()).set('Cookie', w.admin.cookie).send({ content: '' });
    expect(res.status).toBe(400);
  });

  it('hides notes from the member they are about', async () => {
    await api().post(notes()).set('Cookie', w.admin.cookie).send({ content: 'private' });
    const res = await api().get(notes()).set('Cookie', w.member.cookie);
    expect(res.status).toBe(403);
  });

  it('keeps the note body out of the audit log', async () => {
    await api().post(notes()).set('Cookie', w.admin.cookie)
      .send({ category: 'discipline', content: 'SENSITIVE-TEXT' });
    const logs = await api()
      .get(`/api/v1/factions/${w.faction.id}/audit-logs?entity_type=member_note`)
      .set('Cookie', w.admin.cookie);
    const serialised = JSON.stringify(logs.body.data);
    expect(serialised).not.toContain('SENSITIVE-TEXT');
    expect(serialised).toContain('discipline');
  });

  it('lists notes with their author', async () => {
    await api().post(notes()).set('Cookie', w.admin.cookie).send({ content: 'note' });
    const res = await api().get(notes()).set('Cookie', w.admin.cookie);
    expect(res.body.data[0].authorUsername).toBe('admin_user');
  });

  it('filters to flagged notes only', async () => {
    await api().post(notes()).set('Cookie', w.admin.cookie).send({ content: 'plain' });
    await api().post(notes()).set('Cookie', w.admin.cookie).send({ content: 'flagged', isFlagged: true });
    const res = await api().get(`${notes()}?flagged_only=true`).set('Cookie', w.admin.cookie);
    expect(res.body.data).toHaveLength(1);
  });

  it('edits and deletes a note', async () => {
    const created = await api().post(notes()).set('Cookie', w.admin.cookie).send({ content: 'first' });
    const id = created.body.data.id;

    const patched = await api().patch(`${notes()}/${id}`).set('Cookie', w.admin.cookie)
      .send({ content: 'second', isFlagged: true });
    expect(patched.body.data.content).toBe('second');

    const deleted = await api().delete(`${notes()}/${id}`).set('Cookie', w.admin.cookie);
    expect(deleted.status).toBe(200);

    const list = await api().get(notes()).set('Cookie', w.admin.cookie);
    expect(list.body.data).toHaveLength(0);
  });

  it('404s for a note that does not exist', async () => {
    const res = await api().patch(`${notes()}/${MISSING_UUID}`).set('Cookie', w.admin.cookie)
      .send({ content: 'x' });
    expect(res.status).toBe(404);
  });

  it('404s when the target is not a faction member', async () => {
    const res = await api()
      .post(`/api/v1/factions/${w.faction.id}/members/${w.outsider.id}/notes`)
      .set('Cookie', w.admin.cookie)
      .send({ content: 'x' });
    expect(res.status).toBe(404);
  });
});

describe('strikes', () => {
  it('issues a strike with the default expiry for its severity', async () => {
    const res = await api().post(memberStrikes()).set('Cookie', w.admin.cookie)
      .send({ severity: 'minor', reason: 'Missed deadlines' });
    expect(res.status).toBe(201);
    expect(res.body.data.effectiveStatus).toBe('active');
    expect(res.body.data.expiresAt).not.toBeNull();
  });

  it('never expires a major strike', async () => {
    const res = await api().post(memberStrikes()).set('Cookie', w.admin.cookie)
      .send({ severity: 'major', reason: 'Serious' });
    expect(res.body.data.expiresAt).toBeNull();
  });

  it('honours a configured expiry', async () => {
    await api().patch(`/api/v1/factions/${w.faction.id}/settings`).set('Cookie', w.admin.cookie)
      .send({ strikeExpiryDays: { warning: 1, minor: 2, major: null } });
    const res = await api().post(memberStrikes()).set('Cookie', w.admin.cookie)
      .send({ severity: 'warning', reason: 'Configured' });
    const days = Math.round(
      (new Date(res.body.data.expiresAt).getTime() - Date.now()) / 86_400_000,
    );
    expect(days).toBeLessThanOrEqual(1);
  });

  it('refuses a self-strike', async () => {
    const res = await api()
      .post(`/api/v1/factions/${w.faction.id}/members/${w.admin.id}/strikes`)
      .set('Cookie', w.admin.cookie)
      .send({ severity: 'minor', reason: 'self' });
    expect(res.status).toBe(400);
    expect(res.body.error.message).toMatch(/yourself/i);
  });

  it('rejects an unknown severity', async () => {
    const res = await api().post(memberStrikes()).set('Cookie', w.admin.cookie)
      .send({ severity: 'catastrophic', reason: 'x' });
    expect(res.status).toBe(400);
  });

  it('lets a member read their own strikes but not another member’s', async () => {
    await api().post(memberStrikes()).set('Cookie', w.admin.cookie)
      .send({ severity: 'minor', reason: 'x' });

    const own = await api().get(memberStrikes()).set('Cookie', w.member.cookie);
    expect(own.status).toBe(200);
    expect(own.body.data).toHaveLength(1);

    const other = await api()
      .get(`/api/v1/factions/${w.faction.id}/members/${w.admin.id}/strikes`)
      .set('Cookie', w.member.cookie);
    expect(other.status).toBe(403);
  });

  it('walks active -> appealed -> revoked and stops there', async () => {
    const created = await api().post(memberStrikes()).set('Cookie', w.admin.cookie)
      .send({ severity: 'minor', reason: 'x' });
    const id = created.body.data.id;

    const appealed = await api().patch(`${memberStrikes()}/${id}`).set('Cookie', w.admin.cookie)
      .send({ status: 'appealed' });
    expect(appealed.body.data.effectiveStatus).toBe('appealed');

    const revoked = await api().patch(`${memberStrikes()}/${id}`).set('Cookie', w.admin.cookie)
      .send({ status: 'revoked' });
    expect(revoked.body.data.effectiveStatus).toBe('revoked');

    const reopen = await api().patch(`${memberStrikes()}/${id}`).set('Cookie', w.admin.cookie)
      .send({ status: 'active' });
    expect(reopen.status).toBe(400);
  });

  it('reports a past-expiry strike as expired without a scheduler', async () => {
    const created = await api().post(memberStrikes()).set('Cookie', w.admin.cookie)
      .send({ severity: 'minor', reason: 'x' });
    // Backdate the expiry; stored status stays 'active'.
    await db.update(strikes)
      .set({ expiresAt: new Date(Date.now() - 86_400_000) })
      .where(eq(strikes.id, created.body.data.id));

    const res = await api().get(memberStrikes()).set('Cookie', w.admin.cookie);
    expect(res.body.data[0].status).toBe('active');
    expect(res.body.data[0].effectiveStatus).toBe('expired');
  });

  it('excludes expired strikes from the faction overview by default', async () => {
    const created = await api().post(memberStrikes()).set('Cookie', w.admin.cookie)
      .send({ severity: 'minor', reason: 'x' });
    await db.update(strikes)
      .set({ expiresAt: new Date(Date.now() - 86_400_000) })
      .where(eq(strikes.id, created.body.data.id));

    const active = await api().get(factionStrikes()).set('Cookie', w.admin.cookie);
    expect(active.body.data.strikes).toHaveLength(0);
    expect(active.body.data.activeSummary).toEqual({ warning: 0, minor: 0, major: 0 });

    const all = await api().get(`${factionStrikes()}?status=all`).set('Cookie', w.admin.cookie);
    expect(all.body.data.strikes).toHaveLength(1);
  });

  it('summarises active strikes by severity', async () => {
    await api().post(memberStrikes()).set('Cookie', w.admin.cookie)
      .send({ severity: 'minor', reason: 'a' });
    await api().post(memberStrikes()).set('Cookie', w.admin.cookie)
      .send({ severity: 'major', reason: 'b' });
    const res = await api().get(factionStrikes()).set('Cookie', w.admin.cookie);
    expect(res.body.data.activeSummary).toEqual({ warning: 0, minor: 1, major: 1 });
  });

  it('forbids a plain member from the faction-wide overview', async () => {
    const res = await api().get(factionStrikes()).set('Cookie', w.member.cookie);
    expect(res.status).toBe(403);
  });
});
