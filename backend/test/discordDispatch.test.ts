import { describe, it, expect, beforeEach, vi } from 'vitest';
import { api, resetDatabase, seedBasicWorld, createUser, addMember, type BasicWorld } from './helpers.js';
import { db } from '../src/db/index.js';
import { discordIntegrations, discordChannelRoutes, users } from '../src/db/schema.js';
import { eq } from 'drizzle-orm';

/**
 * The one call that would leave the machine.
 *
 * `postToChannel` is replaced; `recordDeliveryOutcome` and everything else in
 * the module stay real, so the tests still exercise the actual lookup, the
 * actual rendering and the actual database writes.
 */
const postMock = vi.hoisted(() => vi.fn(async () => ({ ok: true })));
vi.mock('../src/lib/discord.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../src/lib/discord.js')>()),
  postToChannel: postMock,
}));

const { dispatchDiscord } = await import('../src/lib/discordDispatch.js');

let w: BasicWorld;
const f = () => `/api/v1/factions/${w.faction.id}`;
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

async function route(eventType: string, isEnabled = true) {
  await db.insert(discordChannelRoutes).values({
    factionId: w.faction.id,
    eventType,
    channelId: CHANNEL,
    channelName: 'ledger',
    isEnabled,
  });
}

/** The embed of the single message that was sent. */
function sentEmbed() {
  expect(postMock).toHaveBeenCalledTimes(1);
  const [, payload] = postMock.mock.calls[0] as unknown as [
    string,
    { embeds: { title: string; description: string; author?: { name: string }; footer?: { text: string } }[] },
  ];
  return payload.embeds[0]!;
}

describe('routing', () => {
  it('sends nothing when the faction never connected Discord', async () => {
    await dispatchDiscord(w.faction.id, {
      type: 'entry_logged', actorUserId: w.member.id, itemTypeId: w.itemTypeId, amount: '1000',
    });
    expect(postMock).not.toHaveBeenCalled();
  });

  // Connected but with nothing routed is the state every faction lands in
  // straight after the invite. Silence is the correct behaviour, not a bug.
  it('sends nothing when the event has no channel', async () => {
    await link();
    await dispatchDiscord(w.faction.id, {
      type: 'entry_logged', actorUserId: w.member.id, itemTypeId: w.itemTypeId, amount: '1000',
    });
    expect(postMock).not.toHaveBeenCalled();
  });

  it('sends nothing when the route is switched off', async () => {
    await link();
    await route('entry_logged', false);
    await dispatchDiscord(w.faction.id, {
      type: 'entry_logged', actorUserId: w.member.id, itemTypeId: w.itemTypeId, amount: '1000',
    });
    expect(postMock).not.toHaveBeenCalled();
  });

  it('sends to the routed channel when one is set', async () => {
    await link();
    await route('entry_logged');
    await dispatchDiscord(w.faction.id, {
      type: 'entry_logged', actorUserId: w.member.id, itemTypeId: w.itemTypeId, amount: '1000',
    });
    expect(postMock).toHaveBeenCalledTimes(1);
    expect(postMock.mock.calls[0]![0]).toBe(CHANNEL);
  });

  // Only the event that was routed. Pointing entries at a channel must not
  // start posting everyone's strikes there too.
  it('does not send an event that was not routed', async () => {
    await link();
    await route('entry_logged');
    await dispatchDiscord(w.faction.id, {
      type: 'strike_issued', actorUserId: w.admin.id, targetUserId: w.member.id,
      severity: 'minor', reason: 'late',
    });
    expect(postMock).not.toHaveBeenCalled();
  });
});

describe('the message', () => {
  beforeEach(async () => {
    await link();
  });

  it('names the member and the item', async () => {
    await route('entry_logged');
    await dispatchDiscord(w.faction.id, {
      type: 'entry_logged', actorUserId: w.member.id, itemTypeId: w.itemTypeId, amount: '1000',
    });
    const embed = sentEmbed();
    expect(embed.title).toContain('Entry logged');
    expect(embed.author?.name).toBe(w.member.username);
  });

  // FiveM money runs long and Number() starts lying past 2^53, so the grouping
  // is done on the digits rather than through a float.
  it('groups a very large amount without losing a digit', async () => {
    await route('entry_logged');
    await dispatchDiscord(w.faction.id, {
      type: 'entry_logged', actorUserId: w.member.id, itemTypeId: w.itemTypeId,
      amount: '9007199254740993',
    });
    expect(sentEmbed().description).toContain('9,007,199,254,740,993');
  });

  it('does not put a name on an anonymous entry', async () => {
    await route('entry_logged');
    await dispatchDiscord(w.faction.id, {
      type: 'entry_logged', actorUserId: w.member.id, itemTypeId: w.itemTypeId,
      amount: '500', anonymous: true,
    });
    const embed = sentEmbed();
    expect(embed.author?.name).toBe('Anonymous');
    expect(JSON.stringify(embed)).not.toContain(w.member.username);
  });

  // The placeholder is not a person. Printing its name in a public channel
  // would read as an accusation against whoever it happens to be called.
  it('calls the system placeholder "the faction"', async () => {
    const [placeholder] = await db
      .insert(users)
      .values({ discordId: '900000000000000999', username: 'system_placeholder', isSystem: true })
      .returning();

    await route('entry_logged');
    await dispatchDiscord(w.faction.id, {
      type: 'entry_logged', actorUserId: placeholder!.id, itemTypeId: w.itemTypeId, amount: '500',
    });
    const embed = sentEmbed();
    expect(embed.author?.name).toBe('the faction');
    expect(JSON.stringify(embed)).not.toContain('system_placeholder');
  });

  it('prefers the in-game name over the Discord username', async () => {
    await db.update(users).set({ inGameName: 'Tony Cipriani' }).where(eq(users.id, w.member.id));
    await route('entry_logged');
    await dispatchDiscord(w.faction.id, {
      type: 'entry_logged', actorUserId: w.member.id, itemTypeId: w.itemTypeId, amount: '500',
    });
    expect(sentEmbed().author?.name).toBe('Tony Cipriani');
  });
});

describe('failures stay contained', () => {
  it('records the reason when Discord refuses', async () => {
    await link();
    await route('entry_logged');
    postMock.mockResolvedValue({ ok: false, error: 'That channel no longer exists' } as never);

    await dispatchDiscord(w.faction.id, {
      type: 'entry_logged', actorUserId: w.member.id, itemTypeId: w.itemTypeId, amount: '500',
    });

    const [row] = await db
      .select()
      .from(discordIntegrations)
      .where(eq(discordIntegrations.factionId, w.faction.id));
    expect(row!.lastError).toBe('That channel no longer exists');
  });

  // The entry was really logged. A Discord problem must not undo it or turn a
  // successful request into a 500.
  it('never throws, whatever happens', async () => {
    await link();
    await route('entry_logged');
    postMock.mockRejectedValue(new Error('socket hang up') as never);

    await expect(
      dispatchDiscord(w.faction.id, {
        type: 'entry_logged', actorUserId: w.member.id, itemTypeId: w.itemTypeId, amount: '500',
      }),
    ).resolves.toBeUndefined();
  });
});

describe('through the routes that raise the events', () => {
  it('posts when a member logs an entry', async () => {
    await link();
    await route('entry_logged');

    const res = await api().post(`${f()}/entries`).set('Cookie', w.member.cookie)
      .send({ itemTypeId: w.itemTypeId, amount: '2500' });
    expect(res.status).toBe(201);

    // The call site does not await the dispatch, so the request can answer
    // before the message goes out. Give the microtasks a turn.
    await vi.waitFor(() => expect(postMock).toHaveBeenCalledTimes(1));
    expect(sentEmbed().description).toContain('2,500');
  });

  it('posts when a strike is issued', async () => {
    await link();
    await route('strike_issued');

    const res = await api().post(`${f()}/members/${w.member.id}/strikes`)
      .set('Cookie', w.admin.cookie)
      .send({ reason: 'Missed quota twice', severity: 'minor' });
    expect(res.status).toBe(201);

    await vi.waitFor(() => expect(postMock).toHaveBeenCalledTimes(1));
    expect(sentEmbed().title).toContain('Strike issued');
  });

  it('posts a withdrawal request from a plain member as a request', async () => {
    await link();
    await route('payout_requested');

    const res = await api().post(`${f()}/payouts`).set('Cookie', w.member.cookie)
      .send({ recipientUserId: w.member.id, itemTypeId: w.itemTypeId, amount: '750' });
    expect(res.status).toBe(201);

    await vi.waitFor(() => expect(postMock).toHaveBeenCalledTimes(1));
    expect(sentEmbed().title).toContain('Withdrawal requested');
  });

  // Someone holding manage_payouts creates an already-settled row, so it is
  // the money-left-the-vault event, not a request waiting on somebody.
  it('posts an admin-created payout as completed, not as a request', async () => {
    await link();
    await route('payout_completed');

    const res = await api().post(`${f()}/payouts`).set('Cookie', w.admin.cookie)
      .send({ recipientUserId: w.member.id, itemTypeId: w.itemTypeId, amount: '750' });
    expect(res.status).toBe(201);

    await vi.waitFor(() => expect(postMock).toHaveBeenCalledTimes(1));
    expect(sentEmbed().title).toContain('Withdrawal paid out');
  });

  it('posts when someone joins the faction', async () => {
    await link();
    await route('member_joined');

    const newcomer = await createUser('newcomer');
    const res = await api().post(`${f()}/members`).set('Cookie', w.admin.cookie)
      .send({ discordId: newcomer.discordId });
    expect(res.status).toBe(201);

    await vi.waitFor(() => expect(postMock).toHaveBeenCalledTimes(1));
    expect(sentEmbed().title).toContain('Member joined');
  });

  it('posts when someone is removed from the faction', async () => {
    await link();
    await route('member_left');

    const leaver = await createUser('leaver');
    await addMember(w.faction.id, leaver.id, 'member');

    const res = await api().delete(`${f()}/members/${leaver.id}`).set('Cookie', w.admin.cookie);
    expect(res.status).toBe(200);

    await vi.waitFor(() => expect(postMock).toHaveBeenCalledTimes(1));
    expect(sentEmbed().title).toContain('Member left');
  });

  it('posts when an expense is recorded', async () => {
    await link();
    await route('expense_recorded');

    const res = await api().post(`${f()}/expenses`).set('Cookie', w.admin.cookie)
      .send({ itemTypeId: w.itemTypeId, amount: '1200', category: 'utilities' });
    expect(res.status).toBe(201);

    await vi.waitFor(() => expect(postMock).toHaveBeenCalledTimes(1));
    expect(sentEmbed().title).toContain('Expense recorded');
  });

  it('posts when an announcement goes up', async () => {
    await link();
    await route('announcement_posted');

    const res = await api().post(`${f()}/announcements`).set('Cookie', w.admin.cookie)
      .send({ title: 'Quota deadline Friday', body: 'Get it in.' });
    expect(res.status).toBe(201);

    await vi.waitFor(() => expect(postMock).toHaveBeenCalledTimes(1));
    expect(sentEmbed().description).toContain('Quota deadline Friday');
  });

  // A channel that only reports additions can be gamed: log it, take the
  // credit, quietly undo it. Removals are the half that closes that.
  it('posts when an entry is removed', async () => {
    await link();
    await route('entry_deleted');

    const created = await api().post(`${f()}/entries`).set('Cookie', w.admin.cookie)
      .send({ userId: w.member.id, itemTypeId: w.itemTypeId, amount: '5000' });
    expect(created.status).toBe(201);

    const res = await api().delete(`${f()}/entries/${created.body.data.id}`)
      .set('Cookie', w.admin.cookie);
    expect(res.status).toBe(200);

    await vi.waitFor(() => expect(postMock).toHaveBeenCalledTimes(1));
    const embed = sentEmbed();
    expect(embed.title).toContain('Entry removed');
    // Whose entry it was, not only who struck it out.
    expect(embed.author?.name).toBe(w.member.username);
  });

  // The 5-minute self-undo and a leader striking a row out are different acts.
  it('says when the member undid their own entry', async () => {
    await link();
    await route('entry_deleted');

    const created = await api().post(`${f()}/entries`).set('Cookie', w.member.cookie)
      .send({ itemTypeId: w.itemTypeId, amount: '100' });
    await api().delete(`${f()}/entries/${created.body.data.id}`).set('Cookie', w.member.cookie);

    await vi.waitFor(() => expect(postMock).toHaveBeenCalledTimes(1));
    expect(sentEmbed().footer!.text).toMatch(/within 5 minutes/);
  });

  it('posts a member cancelling their own withdrawal request as a cancellation', async () => {
    await link();
    await route('payout_deleted');

    const created = await api().post(`${f()}/payouts`).set('Cookie', w.member.cookie)
      .send({ recipientUserId: w.member.id, itemTypeId: w.itemTypeId, amount: '300' });
    expect(created.status).toBe(201);

    const res = await api().delete(`${f()}/payouts/${created.body.data.id}`)
      .set('Cookie', w.member.cookie);
    expect(res.status).toBe(200);

    await vi.waitFor(() => expect(postMock).toHaveBeenCalledTimes(1));
    expect(sentEmbed().title).toContain('Withdrawal request cancelled');
  });

  it('posts when an expense is removed', async () => {
    await link();
    await route('expense_deleted');

    const created = await api().post(`${f()}/expenses`).set('Cookie', w.admin.cookie)
      .send({ itemTypeId: w.itemTypeId, amount: '400', category: 'supplies' });
    await api().delete(`${f()}/expenses/${created.body.data.id}`).set('Cookie', w.admin.cookie);

    await vi.waitFor(() => expect(postMock).toHaveBeenCalledTimes(1));
    expect(sentEmbed().title).toContain('Expense removed');
  });

  it('posts when a strike is revoked', async () => {
    await link();
    await route('strike_revoked');

    const created = await api().post(`${f()}/members/${w.member.id}/strikes`)
      .set('Cookie', w.admin.cookie).send({ reason: 'Wrong call', severity: 'minor' });
    expect(created.status).toBe(201);

    const res = await api().patch(`${f()}/members/${w.member.id}/strikes/${created.body.data.id}`)
      .set('Cookie', w.admin.cookie).send({ status: 'revoked' });
    expect(res.status).toBe(200);

    await vi.waitFor(() => expect(postMock).toHaveBeenCalledTimes(1));
    expect(sentEmbed().title).toContain('Strike revoked');
  });

  // 'appealed' is a conversation in progress, not news. A channel that reports
  // every click on a strike stops being read.
  it('does not post for any other strike status change', async () => {
    await link();
    await route('strike_revoked');

    const created = await api().post(`${f()}/members/${w.member.id}/strikes`)
      .set('Cookie', w.admin.cookie).send({ reason: 'Late', severity: 'minor' });
    await api().patch(`${f()}/members/${w.member.id}/strikes/${created.body.data.id}`)
      .set('Cookie', w.admin.cookie).send({ status: 'appealed' });

    expect(postMock).not.toHaveBeenCalled();
  });

  it('posts when an announcement is removed', async () => {
    await link();
    await route('announcement_removed');

    const created = await api().post(`${f()}/announcements`).set('Cookie', w.admin.cookie)
      .send({ title: 'Cancelled meeting', body: 'Never mind.' });
    await api().delete(`${f()}/announcements/${created.body.data.id}`)
      .set('Cookie', w.admin.cookie);

    await vi.waitFor(() => expect(postMock).toHaveBeenCalledTimes(1));
    expect(sentEmbed().description).toContain('Cancelled meeting');
  });

  // Routing additions must not silently start posting removals too.
  it('does not post a removal when only the addition is routed', async () => {
    await link();
    await route('entry_logged');

    const created = await api().post(`${f()}/entries`).set('Cookie', w.member.cookie)
      .send({ itemTypeId: w.itemTypeId, amount: '100' });
    await vi.waitFor(() => expect(postMock).toHaveBeenCalledTimes(1));

    await api().delete(`${f()}/entries/${created.body.data.id}`).set('Cookie', w.member.cookie);
    // Still one: the creation. Nothing for the removal.
    expect(postMock).toHaveBeenCalledTimes(1);
  });

  // The request must answer whatever Discord does. This is the whole reason
  // the dispatch is fire-and-forget and never throws.
  it('still answers 201 when Discord is down', async () => {
    await link();
    await route('entry_logged');
    postMock.mockRejectedValue(new Error('ECONNREFUSED') as never);

    const res = await api().post(`${f()}/entries`).set('Cookie', w.member.cookie)
      .send({ itemTypeId: w.itemTypeId, amount: '100' });
    expect(res.status).toBe(201);
  });
});
