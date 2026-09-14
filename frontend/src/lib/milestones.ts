import type { TranslationKey } from '@/lib/i18n';

/**
 * Personal milestones, celebrated once each.
 *
 * Deliberately about **your own** work rather than the faction's: a member who
 * has just logged their hundredth entry did something; a member who happened
 * to open the app on the day the vault crossed ten million did not.
 *
 * Kept modest on purpose. A reward that arrives every few days stops reading
 * as a reward, and this is a ledger people open several times a session.
 */
export interface Milestone {
  /** Stable across releases — it is the key the "already seen" record uses. */
  id: string;
  titleKey: TranslationKey;
  bodyKey: TranslationKey;
  /** Interpolated into the body. */
  value: number;
}

/** What a milestone is measured against. */
export interface MilestoneInput {
  entryCount: number;
  currencyContributed: number;
  streakCurrent: number;
}

const ENTRY_STEPS = [1, 10, 50, 100, 250, 500, 1000];
const MONEY_STEPS = [1_000_000, 10_000_000, 100_000_000];
const STREAK_STEPS = [7, 30, 100];

/** The highest step at or below `value`, or null when none is reached. */
function reached(steps: number[], value: number): number | null {
  let best: number | null = null;
  for (const step of steps) if (value >= step) best = step;
  return best;
}

/**
 * Every milestone this member has reached — not only the newest.
 *
 * The caller decides which are new; this function has no memory and no opinion
 * about time, which keeps it trivial to reason about and to test.
 */
export function milestonesFor(input: MilestoneInput): Milestone[] {
  const out: Milestone[] = [];

  const entries = reached(ENTRY_STEPS, input.entryCount);
  if (entries !== null) {
    out.push({
      id: `entries:${entries}`,
      titleKey: entries === 1 ? 'milestone.firstEntryTitle' : 'milestone.entriesTitle',
      bodyKey: entries === 1 ? 'milestone.firstEntryBody' : 'milestone.entriesBody',
      value: entries,
    });
  }

  const money = reached(MONEY_STEPS, input.currencyContributed);
  if (money !== null) {
    out.push({
      id: `money:${money}`,
      titleKey: 'milestone.moneyTitle',
      bodyKey: 'milestone.moneyBody',
      value: money,
    });
  }

  const streak = reached(STREAK_STEPS, input.streakCurrent);
  if (streak !== null) {
    out.push({
      id: `streak:${streak}`,
      titleKey: 'milestone.streakTitle',
      bodyKey: 'milestone.streakBody',
      value: streak,
    });
  }

  return out;
}

/** Where the "already celebrated" record lives, per member per faction. */
export function milestoneStorageKey(factionId: string, userId: string): string {
  return `faction-accountant:milestones:${factionId}:${userId}`;
}
