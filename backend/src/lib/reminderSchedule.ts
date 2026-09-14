/**
 * When a reminder should next fire.
 *
 * Pure, and deliberately separate from the runner that sends anything: this is
 * the part with all the edge cases — month lengths, week wrap, the clock going
 * forward — and it can be tested without a database or a Discord.
 *
 * **Everything here is server local time.** "20:00" means 20:00 on the machine
 * running the app, the same clock quotas reset on and entry dates are measured
 * in (§9.2 of the architecture doc). One notion of "local" across the app is
 * worth more than a second one that is right for a faction spread across
 * timezones, which none currently are.
 */

export const REMINDER_SCHEDULE_TYPES = ['once', 'daily', 'weekly', 'monthly'] as const;
export type ReminderScheduleType = (typeof REMINDER_SCHEDULE_TYPES)[number];

export type ReminderSchedule =
  | { type: 'once'; runAt: Date }
  | { type: 'daily'; timeOfDay: string }
  /** `weekdays` are 0–6 with Sunday = 0, matching `Date.getDay()`. */
  | { type: 'weekly'; timeOfDay: string; weekdays: number[] }
  | { type: 'monthly'; timeOfDay: string; dayOfMonth: number };

/** `HH:MM`, 24-hour. */
export const TIME_OF_DAY_PATTERN = /^([01]\d|2[0-3]):([0-5]\d)$/;

function parseTimeOfDay(timeOfDay: string): { hours: number; minutes: number } | null {
  const match = TIME_OF_DAY_PATTERN.exec(timeOfDay);
  if (!match) return null;
  return { hours: Number(match[1]), minutes: Number(match[2]) };
}

/** How many days a given month has, in local time. Day 0 of the next month. */
function daysInMonth(year: number, monthIndex: number): number {
  return new Date(year, monthIndex + 1, 0).getDate();
}

/**
 * A local wall-clock moment.
 *
 * `new Date(y, m, d, hh, mm)` is the local-time constructor, so it follows the
 * clock through daylight saving rather than drifting an hour twice a year. The
 * one oddity it cannot avoid is the hour that does not exist on the night the
 * clock goes forward: 02:30 becomes 03:30, which is the least surprising thing
 * that can happen to a reminder set for a time that did not occur.
 */
function at(year: number, monthIndex: number, day: number, hours: number, minutes: number): Date {
  return new Date(year, monthIndex, day, hours, minutes, 0, 0);
}

/**
 * The next moment this schedule fires strictly after `after`.
 *
 * Returns null when there is no next run — a one-off whose moment has passed,
 * or a weekly reminder with no days selected. The caller stores null and the
 * runner never picks the row up again.
 */
export function nextRun(schedule: ReminderSchedule, after: Date = new Date()): Date | null {
  if (schedule.type === 'once') {
    return schedule.runAt.getTime() > after.getTime() ? schedule.runAt : null;
  }

  const time = parseTimeOfDay(schedule.timeOfDay);
  if (!time) return null;
  const { hours, minutes } = time;

  const year = after.getFullYear();
  const month = after.getMonth();
  const day = after.getDate();

  if (schedule.type === 'daily') {
    const today = at(year, month, day, hours, minutes);
    return today.getTime() > after.getTime() ? today : at(year, month, day + 1, hours, minutes);
  }

  if (schedule.type === 'weekly') {
    const wanted = new Set(schedule.weekdays);
    if (wanted.size === 0) return null;

    // Eight days rather than seven: today still counts if its time has not
    // passed yet, and the eighth covers today-next-week when it has.
    for (let offset = 0; offset <= 7; offset += 1) {
      const candidate = at(year, month, day + offset, hours, minutes);
      if (wanted.has(candidate.getDay()) && candidate.getTime() > after.getTime()) {
        return candidate;
      }
    }
    return null;
  }

  // Monthly. A reminder set for the 31st fires on the 30th of a 30-day month
  // and the 28th of February — clamped, never skipped. Somebody who picked the
  // last day of the month means the last day of the month.
  for (let ahead = 0; ahead <= 12; ahead += 1) {
    const targetMonth = month + ahead;
    const targetYear = year + Math.floor(targetMonth / 12);
    const normalisedMonth = ((targetMonth % 12) + 12) % 12;
    const clampedDay = Math.min(schedule.dayOfMonth, daysInMonth(targetYear, normalisedMonth));
    const candidate = at(targetYear, normalisedMonth, clampedDay, hours, minutes);
    if (candidate.getTime() > after.getTime()) return candidate;
  }
  return null;
}

/**
 * Is a due run too old to be worth sending?
 *
 * The app was down, or the machine slept. A "quota deadline tonight" that
 * arrives the following morning is worse than one that never arrives: people
 * act on it, and it is wrong. Past the grace window the run is skipped and the
 * schedule simply rolls forward to its next occurrence.
 */
export const MISSED_RUN_GRACE_MS = 60 * 60 * 1000;

export function isTooLate(dueAt: Date, now: Date = new Date()): boolean {
  return now.getTime() - dueAt.getTime() > MISSED_RUN_GRACE_MS;
}
