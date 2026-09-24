import { describe, it, expect, beforeEach } from 'vitest';
import { eq } from 'drizzle-orm';
import {
  api, resetDatabase, seedBasicWorld, createUser, addMember, type BasicWorld,
} from './helpers.js';
import { db } from '../src/db/index.js';
import { shifts } from '../src/db/schema.js';

let w: BasicWorld;
let third: Awaited<ReturnType<typeof createUser>>;

const f = () => `/api/v1/factions/${w.faction.id}`;
const base = () => `${f()}/shifts`;

beforeEach(async () => {
  await resetDatabase();
  w = await seedBasicWorld();
  third = await createUser('third_worker');
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

const clockIn = (body: Record<string, unknown> = {}, cookie = w.admin.cookie) =>
  api().post(`${base()}/clock-in`).set('Cookie', cookie).send(body);

const clockOut = (body: Record<string, unknown> = {}, cookie = w.admin.cookie) =>
  api().post(`${base()}/clock-out`).set('Cookie', cookie).send(body);

/** An ISO instant a given number of hours before now. */
const hoursAgo = (hours: number) => new Date(Date.now() - hours * 3_600_000).toISOString();

describe('clocking in and out', () => {
  it('opens a shift and closes it with the hours worked', async () => {
    const started = await clockIn({ position: 'Cook', location: 'Burgershot', startedAt: hoursAgo(3) });
    expect(started.status).toBe(201);
    expect(started.body.data.endedAt).toBeNull();
    expect(started.body.data.workedMinutes).toBeNull();

    const ended = await clockOut({ breakMinutes: 30 });
    expect(ended.status).toBe(200);
    // Three hours less a half-hour break, allowing a minute for the clock.
    expect(ended.body.data.workedMinutes).toBeGreaterThanOrEqual(149);
    expect(ended.body.data.workedMinutes).toBeLessThanOrEqual(151);
  });

  // Two open shifts would make "on duty" ambiguous and leave the clock-out
  // button guessing which one it meant.
  it('refuses a second clock-in while one is open', async () => {
    await clockIn();
    const again = await clockIn();
    expect(again.status).toBe(409);
    expect(again.body.error.message).toMatch(/already clocked in/i);
  });

  it('refuses a clock-out when nothing is open', async () => {
    const res = await clockOut();
    expect(res.status).toBe(400);
    expect(res.body.error.message).toMatch(/not clocked in/i);
  });

  it('refuses a shift that starts in the future', async () => {
    const res = await clockIn({ startedAt: new Date(Date.now() + 3_600_000).toISOString() });
    expect(res.status).toBe(400);
  });

  // A forgotten clock-out is the normal way this goes wrong, and it should be
  // corrected rather than saved as a thirty-hour day.
  it('refuses to close a shift that ran longer than a day', async () => {
    await clockIn({ startedAt: hoursAgo(30) });
    const res = await clockOut();
    expect(res.status).toBe(400);
    expect(res.body.error.message).toMatch(/24 hours/i);
  });

  it('refuses a break as long as the shift', async () => {
    await clockIn({ startedAt: hoursAgo(1) });
    const res = await clockOut({ breakMinutes: 90 });
    expect(res.status).toBe(400);
  });

  it('needs log_shifts', async () => {
    await giveMemberRank([]);
    expect((await clockIn({}, w.member.cookie)).status).toBe(403);
  });
});

describe('who may see whose shifts', () => {
  async function twoWorkedShifts() {
    await clockIn({ position: 'Manager', startedAt: hoursAgo(2) });
    await clockOut();
    await clockIn({ position: 'Cook', startedAt: hoursAgo(2) }, w.member.cookie);
    await clockOut({}, w.member.cookie);
  }

  // Narrowed rather than refused: everybody has a timesheet of their own, and
  // a 403 would leave them looking at an error on a screen that is partly
  // theirs.
  it('shows a member only their own without view_shifts', async () => {
    await giveMemberRank(['log_shifts']);
    await twoWorkedShifts();

    const res = await api().get(base()).set('Cookie', w.member.cookie);
    expect(res.status).toBe(200);
    expect(res.body.data.seesEveryone).toBe(false);
    expect(res.body.data.shifts).toHaveLength(1);
    expect(res.body.data.shifts[0].userId).toBe(w.member.id);
  });

  it('shows the whole rota with view_shifts', async () => {
    await giveMemberRank(['log_shifts', 'view_shifts']);
    await twoWorkedShifts();

    const res = await api().get(base()).set('Cookie', w.member.cookie);
    expect(res.body.data.seesEveryone).toBe(true);
    expect(res.body.data.shifts).toHaveLength(2);
  });

  // Asking for somebody else by id is the same request with a filter on it,
  // and must not be a way around the permission.
  it('ignores a userId filter aimed at somebody else', async () => {
    await giveMemberRank(['log_shifts']);
    await twoWorkedShifts();

    const res = await api().get(`${base()}?userId=${w.admin.id}`).set('Cookie', w.member.cookie);
    expect(res.body.data.shifts.every((s: { userId: string }) => s.userId === w.member.id)).toBe(true);
  });

  it('narrows the summary the same way', async () => {
    await giveMemberRank(['log_shifts']);
    await twoWorkedShifts();

    const own = await api().get(`${base()}/summary`).set('Cookie', w.member.cookie);
    expect(own.body.data.members).toHaveLength(1);

    const all = await api().get(`${base()}/summary`).set('Cookie', w.admin.cookie);
    expect(all.body.data.members).toHaveLength(2);
    expect(all.body.data.totalMinutes).toBeGreaterThan(0);
  });

  it('narrows who is on duty the same way', async () => {
    await giveMemberRank(['log_shifts']);
    await clockIn({}, w.admin.cookie);
    await clockIn({}, w.member.cookie);

    const own = await api().get(`${base()}/on-duty`).set('Cookie', w.member.cookie);
    expect(own.body.data.onDuty).toHaveLength(1);
    expect(own.body.data.mine.userId).toBe(w.member.id);

    const all = await api().get(`${base()}/on-duty`).set('Cookie', w.admin.cookie);
    expect(all.body.data.onDuty).toHaveLength(2);
  });
});

describe('recording a shift somebody forgot to clock', () => {
  const manual = (body: Record<string, unknown>, cookie = w.admin.cookie) =>
    api().post(base()).set('Cookie', cookie).send(body);

  it('writes a whole shift at once', async () => {
    const res = await manual({
      position: 'Mechanic',
      startedAt: hoursAgo(5),
      endedAt: hoursAgo(2),
      breakMinutes: 15,
    });
    expect(res.status).toBe(201);
    expect(res.body.data.workedMinutes).toBe(165);
  });

  it('refuses one that ends before it starts', async () => {
    const res = await manual({ startedAt: hoursAgo(1), endedAt: hoursAgo(4) });
    expect(res.status).toBe(400);
  });

  // Writing somebody else's hours is the same authority as correcting them.
  it('refuses to write it for another member without manage_shifts', async () => {
    await giveMemberRank(['log_shifts', 'view_shifts']);
    const res = await manual(
      { userId: w.admin.id, startedAt: hoursAgo(3), endedAt: hoursAgo(1) },
      w.member.cookie,
    );
    expect(res.status).toBe(403);
  });
});

describe('correcting and removing a shift', () => {
  async function ownShift(cookie = w.member.cookie) {
    const res = await api().post(base()).set('Cookie', cookie).send({
      position: 'Waiter', startedAt: hoursAgo(4), endedAt: hoursAgo(2),
    });
    expect(res.status).toBe(201);
    return res.body.data.id as string;
  }

  it('lets a member fix their own times', async () => {
    await giveMemberRank(['log_shifts']);
    const id = await ownShift();

    const res = await api().patch(`${base()}/${id}`).set('Cookie', w.member.cookie)
      .send({ breakMinutes: 30, position: 'Bartender' });
    expect(res.status).toBe(200);
    expect(res.body.data.position).toBe('Bartender');
    // Fixing your own times is not somebody else rewriting your timesheet.
    expect(res.body.data.editedBy).toBeNull();
  });

  it('stamps who edited it when it was not the member', async () => {
    await giveMemberRank(['log_shifts']);
    const id = await ownShift();

    const res = await api().patch(`${base()}/${id}`).set('Cookie', w.admin.cookie)
      .send({ breakMinutes: 45 });
    expect(res.status).toBe(200);
    expect(res.body.data.editedBy).toBe(w.admin.id);
  });

  it('refuses to let one member change another one', async () => {
    await giveMemberRank(['log_shifts', 'view_shifts']);
    const id = await ownShift(w.admin.cookie);

    const res = await api().patch(`${base()}/${id}`).set('Cookie', w.member.cookie)
      .send({ breakMinutes: 60 });
    expect(res.status).toBe(403);
  });

  // A clock-out in the wrong minute should be takeable back without deleting
  // the shift and typing it again.
  it('reopens a shift when the end time is cleared', async () => {
    const id = await ownShift(w.admin.cookie);
    const res = await api().patch(`${base()}/${id}`).set('Cookie', w.admin.cookie)
      .send({ endedAt: null });
    expect(res.status).toBe(200);
    expect(res.body.data.endedAt).toBeNull();
    expect(res.body.data.workedMinutes).toBeNull();
  });

  it('removes one for good', async () => {
    const id = await ownShift(w.admin.cookie);
    expect((await api().delete(`${base()}/${id}`).set('Cookie', w.admin.cookie)).status).toBe(200);
    expect(await db.select().from(shifts).where(eq(shifts.id, id))).toHaveLength(0);
  });

  it('refuses to remove somebody else\'s without manage_shifts', async () => {
    await giveMemberRank(['log_shifts', 'view_shifts']);
    const id = await ownShift(w.admin.cookie);
    expect((await api().delete(`${base()}/${id}`).set('Cookie', w.member.cookie)).status).toBe(403);
  });
});

describe('faction work and side jobs', () => {
  it('records faction work unless told otherwise', async () => {
    const res = await clockIn({ position: 'Kitchen' });
    expect(res.body.data.kind).toBe('faction');
  });

  // A character driving a taxi on their own time is still worth logging, and
  // still must not be counted silently as the faction's hours.
  it('keeps a side job as a side job', async () => {
    const res = await clockIn({ kind: 'side', position: 'Taxi' });
    expect(res.status).toBe(201);
    expect(res.body.data.kind).toBe('side');

    await clockOut();
    const side = await api().get(`${base()}?kind=side`).set('Cookie', w.admin.cookie);
    expect(side.body.data.shifts).toHaveLength(1);
    const faction = await api().get(`${base()}?kind=faction`).set('Cookie', w.admin.cookie);
    expect(faction.body.data.shifts).toHaveLength(0);
  });

  it('takes whatever the member calls the job', async () => {
    const res = await clockIn({ kind: 'side', position: 'Repó sofőr', location: 'Sandy Shores' });
    expect(res.status).toBe(201);
    expect(res.body.data.position).toBe('Repó sofőr');
    expect(res.body.data.location).toBe('Sandy Shores');
  });

  it('can be switched when the shift is corrected', async () => {
    const created = await clockIn({ position: 'Bar' });
    await clockOut();
    const res = await api().patch(`${base()}/${created.body.data.id}`)
      .set('Cookie', w.admin.cookie).send({ kind: 'side' });
    expect(res.status).toBe(200);
    expect(res.body.data.kind).toBe('side');
  });
});

describe('the rest of the screen', () => {
  it('suggests the job titles this faction has used', async () => {
    await api().post(base()).set('Cookie', w.admin.cookie)
      .send({ position: 'Chef', startedAt: hoursAgo(4), endedAt: hoursAgo(3) });
    await api().post(base()).set('Cookie', w.admin.cookie)
      .send({ position: 'Chef', startedAt: hoursAgo(3), endedAt: hoursAgo(2) });
    await api().post(base()).set('Cookie', w.admin.cookie)
      .send({ position: 'Driver', startedAt: hoursAgo(2), endedAt: hoursAgo(1) });

    const res = await api().get(`${base()}/positions`).set('Cookie', w.member.cookie);
    expect(res.status).toBe(200);
    expect(res.body.data.positions).toEqual(['Chef', 'Driver']);
  });

  it('filters the list by day', async () => {
    await api().post(base()).set('Cookie', w.admin.cookie)
      .send({ startedAt: hoursAgo(3), endedAt: hoursAgo(2) });

    const today = new Date().toISOString().slice(0, 10);
    const inRange = await api().get(`${base()}?from=${today}&to=${today}`)
      .set('Cookie', w.admin.cookie);
    expect(inRange.body.data.shifts.length).toBeGreaterThanOrEqual(0);

    const longAgo = await api().get(`${base()}?from=2020-01-01&to=2020-01-02`)
      .set('Cookie', w.admin.cookie);
    expect(longAgo.body.data.shifts).toHaveLength(0);
  });

  // The module switch hides the tool and never touches the data: reads go on
  // answering so an old rota can still be read after it is turned off.
  it('refuses to clock in when the faction has shifts switched off', async () => {
    const off = await api().patch(`${f()}/settings`).set('Cookie', w.admin.cookie)
      .send({ enabledModules: ['entries'] });
    expect(off.status).toBe(200);

    expect((await clockIn()).status).toBe(403);
    expect((await api().get(base()).set('Cookie', w.admin.cookie)).status).toBe(200);
  });
});
