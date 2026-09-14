import { describe, it, expect, beforeEach, vi } from 'vitest';
import { eq } from 'drizzle-orm';
import { api, resetDatabase, seedBasicWorld, type BasicWorld } from './helpers.js';
import { db } from '../src/db/index.js';
import { discordIntegrations, discordReminders } from '../src/db/schema.js';

const postMock = vi.hoisted(() => vi.fn(async () => ({ ok: true })));
vi.mock('../src/lib/discord.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../src/lib/discord.js')>()),
  postToChannel: postMock,
}));

const { runDueReminders } = await import('../src/lib/reminderRunner.js');

let w: BasicWorld;
const f = () => `/api/v1/factions/${w.faction.id}`;
const base = () => `${f()}/discord/reminders`;
const CHANNEL = '123456789012345678';

beforeEach(async () => {
  await resetDatabase();
  w = await seedBasicWorld();
  postMock.mockClear();
  postMock.mockResolvedValue({ ok: true });
});

async function link() {
  await db.insert(discordIntegrations).values({
    factionId: w.faction.id,
    guildId: '555000111222333444',
    guildName: 'Test Server',
    linkedBy: w.admin.id,
  });
}

function daily(over: Record<string, unknown> = {}) {
  return {
    channelId: CHANNEL,
    channelName: 'general',
    title: 'Rent',
    message: 'Pay your rent before tonight.',
    scheduleType: 'daily',
    timeOfDay: '20:00',
    ...over,
  };
}

const create = (cookie: string, body: Record<string, unknown> = daily()) =>
  api().post(base()).set('Cookie', cookie).send(body);

describe('permissions', () => {
  it('refuses a plain member', async () => {
    await link();
    expect((await api().get(base()).set('Cookie', w.member.cookie)).status).toBe(403);
  });

  it('refuses an outsider', async () => {
    await link();
    expect((await api().get(base()).set('Cookie', w.outsider.cookie)).status).toBe(403);
  });

  it('lets a rank holding manage_discord in', async () => {
    await link();
    const ranks = await api().patch(`${f()}/settings`).set('Cookie', w.admin.cookie)
      .send({ ranks: [{ name: 'Capo', level: 1, permissions: ['manage_discord'] }] });
    expect(ranks.status).toBe(200);
    await api().patch(`${f()}/members/${w.member.id}`).set('Cookie', w.admin.cookie)
      .send({ rank: 'Capo' });

    expect((await api().get(base()).set('Cookie', w.member.cookie)).status).toBe(200);
  });
});

describe('creating', () => {
  it('refuses before a Discord server is connected', async () => {
    expect((await create(w.admin.cookie)).status).toBe(404);
  });

  it('schedules a daily reminder and works out when it first fires', async () => {
    await link();
    const res = await create(w.admin.cookie);
    expect(res.status).toBe(201);
    expect(res.body.data.nextRunAt).not.toBeNull();
    expect(new Date(res.body.data.nextRunAt).getTime()).toBeGreaterThan(Date.now());
  });

  it('lets a faction keep as many as it likes', async () => {
    await link();
    for (let i = 0; i < 5; i += 1) {
      expect((await create(w.admin.cookie, daily({ title: `Reminder ${i}` }))).status).toBe(201);
    }
    const list = await api().get(base()).set('Cookie', w.admin.cookie);
    expect(list.body.data).toHaveLength(5);
  });

  // A reminder missing the field that says *when* would sit in the table
  // looking configured and never fire. Refuse it while somebody is watching.
  it('refuses a repeating reminder with no time', async () => {
    await link();
    const res = await create(w.admin.cookie, daily({ timeOfDay: undefined }));
    expect(res.status).toBe(400);
  });

  it('refuses a weekly reminder with no days', async () => {
    await link();
    const res = await create(w.admin.cookie, daily({ scheduleType: 'weekly', weekdays: [] }));
    expect(res.status).toBe(400);
  });

  it('refuses a monthly reminder with no day of the month', async () => {
    await link();
    const res = await create(w.admin.cookie, daily({ scheduleType: 'monthly' }));
    expect(res.status).toBe(400);
  });

  it('refuses a one-off in the past', async () => {
    await link();
    const res = await create(w.admin.cookie, daily({
      scheduleType: 'once',
      timeOfDay: undefined,
      runAt: new Date(Date.now() - 60_000).toISOString(),
    }));
    expect(res.status).toBe(400);
  });

  it('refuses an empty message', async () => {
    await link();
    expect((await create(w.admin.cookie, daily({ message: '   ' }))).status).toBe(400);
  });

  // Disabled means no pending run at all, rather than a flag the runner has to
  // remember to check.
  it('gives a disabled reminder no next run', async () => {
    await link();
    const res = await create(w.admin.cookie, daily({ isEnabled: false }));
    expect(res.status).toBe(201);
    expect(res.body.data.nextRunAt).toBeNull();
  });
});

describe('editing', () => {
  it('recomputes the next run when the time changes', async () => {
    await link();
    const created = await create(w.admin.cookie);
    const before = created.body.data.nextRunAt;

    const res = await api().patch(`${base()}/${created.body.data.id}`)
      .set('Cookie', w.admin.cookie).send({ timeOfDay: '06:00' });
    expect(res.status).toBe(200);
    expect(res.body.data.nextRunAt).not.toBe(before);
  });

  // Half-updating the schedule is how a reminder ends up weekly with a
  // day-of-month and no weekdays, so an edit replaces the whole set.
  it('clears the fields belonging to the old schedule type', async () => {
    await link();
    const created = await create(w.admin.cookie, daily({ scheduleType: 'weekly', weekdays: [1, 5] }));

    const res = await api().patch(`${base()}/${created.body.data.id}`)
      .set('Cookie', w.admin.cookie)
      .send({ scheduleType: 'monthly', dayOfMonth: 1 });
    expect(res.status).toBe(200);
    expect(res.body.data.weekdays).toBeNull();
    expect(res.body.data.dayOfMonth).toBe(1);
  });

  it('switching one off takes it out of the queue', async () => {
    await link();
    const created = await create(w.admin.cookie);
    const res = await api().patch(`${base()}/${created.body.data.id}`)
      .set('Cookie', w.admin.cookie).send({ isEnabled: false });
    expect(res.body.data.nextRunAt).toBeNull();
  });

  it('404s for a reminder belonging to nobody', async () => {
    await link();
    const res = await api().patch(`${base()}/11111111-2222-3333-4444-555555555555`)
      .set('Cookie', w.admin.cookie).send({ timeOfDay: '06:00' });
    expect(res.status).toBe(404);
  });
});

describe('deleting', () => {
  it('removes it', async () => {
    await link();
    const created = await create(w.admin.cookie);
    expect((await api().delete(`${base()}/${created.body.data.id}`)
      .set('Cookie', w.admin.cookie)).status).toBe(200);

    const rows = await db.select().from(discordReminders)
      .where(eq(discordReminders.factionId, w.faction.id));
    expect(rows).toHaveLength(0);
  });
});

describe('send now', () => {
  it('posts the reminder without disturbing its schedule', async () => {
    await link();
    const created = await create(w.admin.cookie);
    const scheduled = created.body.data.nextRunAt;

    const res = await api().post(`${base()}/${created.body.data.id}/send`)
      .set('Cookie', w.admin.cookie);
    expect(res.status).toBe(200);
    expect(res.body.data.ok).toBe(true);
    expect(postMock).toHaveBeenCalledTimes(1);

    const [row] = await db.select().from(discordReminders)
      .where(eq(discordReminders.id, created.body.data.id));
    expect(row!.nextRunAt!.toISOString()).toBe(new Date(scheduled).toISOString());
  });

  it('reports Discord refusing without failing the request', async () => {
    await link();
    const created = await create(w.admin.cookie);
    postMock.mockResolvedValue({ ok: false, error: 'That channel no longer exists' } as never);

    const res = await api().post(`${base()}/${created.body.data.id}/send`)
      .set('Cookie', w.admin.cookie);
    expect(res.status).toBe(200);
    expect(res.body.data.ok).toBe(false);
    expect(res.body.data.error).toBe('That channel no longer exists');
  });
});

// ── The runner ──
// Driven directly rather than through the timer, with nextRunAt written by
// hand so a test does not have to wait for a real minute to pass.
describe('the runner', () => {
  async function due(at: Date, over: Partial<typeof discordReminders.$inferInsert> = {}) {
    const [row] = await db.insert(discordReminders).values({
      factionId: w.faction.id,
      channelId: CHANNEL,
      message: 'Pay your rent.',
      scheduleType: 'daily',
      timeOfDay: '20:00',
      nextRunAt: at,
      createdBy: w.admin.id,
      ...over,
    }).returning();
    return row!;
  }

  it('sends a reminder whose moment has come', async () => {
    await link();
    await due(new Date(Date.now() - 1000));

    expect(await runDueReminders()).toBe(1);
    expect(postMock).toHaveBeenCalledTimes(1);
    expect(postMock.mock.calls[0]![0]).toBe(CHANNEL);
  });

  it('leaves a reminder that is not due yet alone', async () => {
    await link();
    await due(new Date(Date.now() + 60 * 60 * 1000));

    expect(await runDueReminders()).toBe(0);
    expect(postMock).not.toHaveBeenCalled();
  });

  it('ignores a disabled reminder', async () => {
    await link();
    await due(new Date(Date.now() - 1000), { isEnabled: false });

    expect(await runDueReminders()).toBe(0);
    expect(postMock).not.toHaveBeenCalled();
  });

  // The claim is what makes this safe. A second pass must find nothing, or a
  // second app instance would send every reminder twice.
  it('cannot send the same run twice', async () => {
    await link();
    await due(new Date(Date.now() - 1000));

    await runDueReminders();
    await runDueReminders();
    expect(postMock).toHaveBeenCalledTimes(1);
  });

  it('queues the next occurrence after sending', async () => {
    await link();
    const row = await due(new Date(Date.now() - 1000));

    await runDueReminders();
    const [after] = await db.select().from(discordReminders)
      .where(eq(discordReminders.id, row.id));
    expect(after!.nextRunAt).not.toBeNull();
    expect(after!.nextRunAt!.getTime()).toBeGreaterThan(Date.now());
    expect(after!.lastRunAt).not.toBeNull();
  });

  // The app was down. A "quota deadline tonight" arriving the next morning is
  // worse than one that never arrives, because people act on it.
  it('skips a run left over from an outage but keeps the schedule', async () => {
    await link();
    const row = await due(new Date(Date.now() - 6 * 60 * 60 * 1000));

    expect(await runDueReminders()).toBe(1);
    expect(postMock).not.toHaveBeenCalled();

    const [after] = await db.select().from(discordReminders)
      .where(eq(discordReminders.id, row.id));
    expect(after!.nextRunAt).not.toBeNull();
    expect(after!.lastRunAt).toBeNull();
  });

  // Switched off rather than deleted, so the faction can see it went out.
  it('retires a one-off after it fires', async () => {
    await link();
    const row = await due(new Date(Date.now() - 1000), {
      scheduleType: 'once',
      timeOfDay: null,
      runAt: new Date(Date.now() - 1000),
    });

    await runDueReminders();
    const [after] = await db.select().from(discordReminders)
      .where(eq(discordReminders.id, row.id));
    expect(after!.nextRunAt).toBeNull();
    expect(after!.isEnabled).toBe(false);
    expect(postMock).toHaveBeenCalledTimes(1);
  });

  it('records why a delivery failed', async () => {
    await link();
    const row = await due(new Date(Date.now() - 1000));
    postMock.mockResolvedValue({ ok: false, error: 'That channel no longer exists' } as never);

    await runDueReminders();
    const [after] = await db.select().from(discordReminders)
      .where(eq(discordReminders.id, row.id));
    expect(after!.lastError).toBe('That channel no longer exists');
    // Still scheduled: one refusal is not a reason to stop trying.
    expect(after!.nextRunAt).not.toBeNull();
  });

  // Reconnecting should bring a faction's reminders back, not make them retype
  // a dozen of them.
  it('keeps a reminder alive when the faction has disconnected Discord', async () => {
    const row = await due(new Date(Date.now() - 1000));

    await runDueReminders();
    expect(postMock).not.toHaveBeenCalled();

    const [after] = await db.select().from(discordReminders)
      .where(eq(discordReminders.id, row.id));
    expect(after!.lastError).toMatch(/not connected/i);
    expect(after!.nextRunAt).not.toBeNull();
  });

  it('one broken reminder does not stop the others', async () => {
    await link();
    await due(new Date(Date.now() - 1000), { message: 'first' });
    await due(new Date(Date.now() - 1000), { message: 'second' });
    postMock.mockRejectedValueOnce(new Error('socket hang up') as never);

    await expect(runDueReminders()).resolves.toBe(2);

    const rows = await db.select().from(discordReminders)
      .where(eq(discordReminders.factionId, w.faction.id));
    // Both are back in the queue whatever happened to them.
    expect(rows.every((r) => r.nextRunAt !== null)).toBe(true);
  });
});
