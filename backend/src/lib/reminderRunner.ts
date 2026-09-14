import { eq, sql } from 'drizzle-orm';
import { db } from '../db/index.js';
import { discordReminders, discordIntegrations, type DiscordReminder } from '../db/schema.js';
import { isDiscordConfigured, postToChannel } from './discord.js';
import { nextRun, isTooLate, type ReminderSchedule } from './reminderSchedule.js';
import { buildReminderMessage } from './reminderMessage.js';

/** How often the ticker looks for work. */
const TICK_MS = 60_000;

/**
 * Rebuild the schedule from the row's columns.
 *
 * The columns are nullable because each schedule type uses a different subset;
 * a row that cannot produce a valid schedule returns null and is switched off
 * rather than retried forever.
 */
export function scheduleOf(row: DiscordReminder): ReminderSchedule | null {
  switch (row.scheduleType) {
    case 'once':
      return row.runAt ? { type: 'once', runAt: row.runAt } : null;
    case 'daily':
      return row.timeOfDay ? { type: 'daily', timeOfDay: row.timeOfDay } : null;
    case 'weekly':
      return row.timeOfDay && row.weekdays?.length
        ? { type: 'weekly', timeOfDay: row.timeOfDay, weekdays: row.weekdays }
        : null;
    case 'monthly':
      return row.timeOfDay && row.dayOfMonth
        ? { type: 'monthly', timeOfDay: row.timeOfDay, dayOfMonth: row.dayOfMonth }
        : null;
    default:
      return null;
  }
}

/** A claimed row, plus the moment it was due — which the claim erases. */
interface ClaimedReminder {
  row: DiscordReminder;
  dueAt: Date;
}

/**
 * Take ownership of every reminder that is due.
 *
 * Selecting first and updating afterwards would send every reminder twice the
 * day this app runs on two instances, so selecting and claiming happen in one
 * statement. `FOR UPDATE SKIP LOCKED` settles the race: the loser skips the
 * row rather than waiting for it and then re-sending it.
 *
 * Hand-written SQL because of one detail Drizzle's builder cannot express.
 * `UPDATE ... RETURNING` returns the row as it is *after* the update, and the
 * update is what clears `next_run_at` — so the returned row no longer knows
 * when it was due. A CTE sees the pre-update snapshot, which is where `due_at`
 * comes from, and without it a run delayed by an outage is indistinguishable
 * from one that is on time.
 *
 * Claiming writes `next_run_at = null`. Whatever happens next — sent, refused,
 * skipped as stale — the row is out of the queue until something deliberately
 * puts it back.
 */
async function claimDue(now: Date): Promise<ClaimedReminder[]> {
  const result = await db.execute(sql`
    WITH due AS (
      SELECT id, next_run_at
      FROM discord_reminders
      WHERE is_enabled = true
        AND next_run_at IS NOT NULL
        AND next_run_at <= ${now}
      FOR UPDATE SKIP LOCKED
    )
    UPDATE discord_reminders AS r
    SET next_run_at = NULL
    FROM due
    WHERE r.id = due.id
    RETURNING r.*, due.next_run_at AS due_at
  `);

  const rows =
    (result as unknown as { rows?: Record<string, unknown>[] }).rows ??
    (result as unknown as Record<string, unknown>[]);

  return rows.map((raw) => ({
    dueAt: new Date(raw.due_at as string),
    row: {
      id: raw.id,
      factionId: raw.faction_id,
      channelId: raw.channel_id,
      channelName: raw.channel_name,
      message: raw.message,
      title: raw.title,
      scheduleType: raw.schedule_type,
      timeOfDay: raw.time_of_day,
      weekdays: raw.weekdays,
      dayOfMonth: raw.day_of_month,
      runAt: raw.run_at ? new Date(raw.run_at as string) : null,
      isEnabled: raw.is_enabled,
      nextRunAt: null,
      lastRunAt: raw.last_run_at ? new Date(raw.last_run_at as string) : null,
      lastError: raw.last_error,
      createdBy: raw.created_by,
      createdAt: new Date(raw.created_at as string),
      updatedAt: new Date(raw.updated_at as string),
    } as DiscordReminder,
  }));
}

/**
 * Send one claimed reminder and put it back in the queue.
 *
 * `dueAt` is passed separately because the claim has already cleared it off
 * the row, and both decisions below need it: whether the run is too stale to
 * send, and where the next occurrence is measured from.
 */
async function runOne(row: DiscordReminder, dueAt: Date, now: Date): Promise<void> {
  const schedule = scheduleOf(row);

  // Next occurrence is computed from the moment it was *due*, not from now.
  // Measuring from now would drag a 20:00 daily reminder later every time the
  // tick that picked it up ran a few seconds after the minute.
  const following = schedule ? nextRun(schedule, dueAt) : null;

  // The app was down, or the machine slept. A "quota deadline tonight" that
  // arrives the next morning is worse than one that never arrives, because
  // people act on it. Skip the run; keep the schedule.
  if (isTooLate(dueAt, now)) {
    await db
      .update(discordReminders)
      .set({ nextRunAt: following, updatedAt: now })
      .where(eq(discordReminders.id, row.id));
    return;
  }

  const [integration] = await db
    .select({ id: discordIntegrations.id })
    .from(discordIntegrations)
    .where(eq(discordIntegrations.factionId, row.factionId))
    .limit(1);

  // Disconnected since the reminder was written. Keep the row and its schedule
  // — reconnecting should bring their reminders back rather than make them
  // retype a dozen of them — but say why nothing arrived.
  if (!integration) {
    await db
      .update(discordReminders)
      .set({
        nextRunAt: following,
        lastError: 'This faction is not connected to a Discord server',
        updatedAt: now,
      })
      .where(eq(discordReminders.id, row.id));
    return;
  }

  const result = await postToChannel(row.channelId, await buildReminderMessage(row, now));

  await db
    .update(discordReminders)
    .set({
      nextRunAt: following,
      lastRunAt: now,
      lastError: result.ok ? null : result.error ?? 'Unknown error',
      // A one-off has nothing left to do. Switched off rather than deleted, so
      // the faction can see it went out and reuse it.
      ...(following === null ? { isEnabled: false } : {}),
      updatedAt: now,
    })
    .where(eq(discordReminders.id, row.id));
}

/**
 * One pass. Exported so a test can drive it without waiting for a timer, and
 * so the tick below stays a one-liner.
 *
 * **Never throws.** It runs on a timer with nobody to catch it; an unhandled
 * rejection here would take the process down over a chat message.
 */
export async function runDueReminders(now: Date = new Date()): Promise<number> {
  if (!isDiscordConfigured()) return 0;

  let claimed: ClaimedReminder[];
  try {
    claimed = await claimDue(now);
  } catch (err) {
    console.error('[REMINDERS] could not claim due reminders', err);
    return 0;
  }

  for (const { row, dueAt } of claimed) {
    try {
      await runOne(row, dueAt, now);
    } catch (err) {
      // One bad reminder must not stop the rest of the batch, and must not
      // leave the row claimed forever with no way back into the queue.
      console.error('[REMINDERS] reminder failed', row.id, err);
      try {
        const schedule = scheduleOf(row);
        await db
          .update(discordReminders)
          .set({
            nextRunAt: schedule ? nextRun(schedule, dueAt) : null,
            lastError: 'Something went wrong sending this reminder',
            updatedAt: now,
          })
          .where(eq(discordReminders.id, row.id));
      } catch {
        // Nothing further to try; the next deploy or an edit will reschedule.
      }
    }
  }

  return claimed.length;
}

let timer: NodeJS.Timeout | null = null;
let running = false;

/**
 * One tick, skipped if the previous one is still going.
 *
 * Sending is serial, so a batch big enough to outlast the 60-second interval
 * would have the next tick start on top of it. Nothing double-sends if that
 * happens — the claim and `FOR UPDATE SKIP LOCKED` see to that — but the runs
 * stack, each one holding a connection, and a slow Discord turns a backlog
 * into a pile-up rather than a queue.
 *
 * Reaching it needs roughly 300 reminders due in the same minute across every
 * faction. Far off at current scale, and one boolean cheaper to have than to
 * diagnose: the skipped tick loses nothing, because whatever was due is still
 * in the table and the run in progress is already working through it.
 */
async function tick(): Promise<void> {
  if (running) {
    console.warn('[REMINDERS] previous run still going; skipping this tick');
    return;
  }
  running = true;
  try {
    await runDueReminders();
  } finally {
    // `finally`, not after the await: runDueReminders swallows its own errors,
    // but a throw that ever escaped it would otherwise wedge the flag on and
    // silently stop every reminder in the app until the next restart.
    running = false;
  }
}

/**
 * Start the ticker.
 *
 * Called from `index.ts` rather than `app.ts` so that importing the app — which
 * every test does — does not start a timer that outlives the suite.
 *
 * `unref()` keeps it from holding the process open on shutdown: a pending tick
 * is never worth delaying a restart, and the work it would have done is still
 * in the table.
 */
export function startReminderRunner(): void {
  if (timer || !isDiscordConfigured()) return;
  timer = setInterval(() => {
    void tick();
  }, TICK_MS);
  timer.unref();
}

export function stopReminderRunner(): void {
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
  // A run already in flight finishes on its own; clearing the flag keeps a
  // restarted runner from finding it stuck on from the previous life.
  running = false;
}

/** Exposed for the test that proves a tick cannot overlap the previous one. */
export const _testing = { tick, isRunning: () => running };

// Used by the routes to keep `nextRunAt` honest after a change.
export { nextRun };
