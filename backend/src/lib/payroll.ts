import { fromCents, toCents } from './treasury.js';

/** A rate as payroll reads it. */
export interface PayRate {
  position: string | null;
  itemTypeId: string;
  hourlyRate: string;
}

/** One finished, unpaid shift as payroll reads it. */
export interface PayableShift {
  id: string;
  userId: string;
  position: string | null;
  workedMinutes: number;
}

/** What one member is owed in one currency. */
export interface PayLine {
  userId: string;
  itemTypeId: string;
  /** Decimal string, exact. */
  amount: string;
  minutes: number;
  shiftIds: string[];
}

export interface Payroll {
  lines: PayLine[];
  /** Shifts no rate covered: worked, recorded, and not paid for. */
  unrated: { userId: string; minutes: number; shiftIds: string[] }[];
}

const normalise = (position: string | null) => (position ?? '').trim().toLowerCase();

/**
 * The rate that applies to a shift's position.
 *
 * Matched on the free text, ignoring case and surrounding spaces — "Cook",
 * "cook " and "COOK" are the same job, typed three ways by three people. A
 * shift with no position, or one nobody set a rate for, falls back to the
 * default (the rate with no position), and gets nothing if there is none.
 */
export function rateFor(position: string | null, rates: PayRate[]): PayRate | null {
  const wanted = normalise(position);
  if (wanted) {
    const exact = rates.find((r) => r.position !== null && normalise(r.position) === wanted);
    if (exact) return exact;
  }
  return rates.find((r) => r.position === null || normalise(r.position) === '') ?? null;
}

/**
 * What some minutes are worth at an hourly rate, in cents, rounded to the
 * nearest cent — half a cent rounds up.
 *
 * Integer arithmetic throughout, the same as the rest of the ledger: a float
 * that is a cent out on every shift is a real amount of money by the end of
 * a month of them.
 */
export function payFor(minutes: number, hourlyRate: string): bigint {
  const cents = toCents(hourlyRate);
  const m = BigInt(Math.max(0, Math.round(minutes)));
  return (m * cents * 2n + 60n) / 120n;
}

/**
 * Work out a payroll: what each member is owed, per currency.
 *
 * Each shift is priced on its own and the cents added up, rather than hours
 * summed and priced once, so a member working two positions at two rates is
 * paid each at its own — and so the total is exactly the sum of the shifts a
 * member can see.
 */
export function computePayroll(shifts: PayableShift[], rates: PayRate[]): Payroll {
  const lines = new Map<string, { cents: bigint; minutes: number; shiftIds: string[]; userId: string; itemTypeId: string }>();
  const unrated = new Map<string, { minutes: number; shiftIds: string[] }>();

  for (const shift of shifts) {
    const rate = rateFor(shift.position, rates);
    if (!rate || toCents(rate.hourlyRate) <= 0n) {
      const bucket = unrated.get(shift.userId) ?? { minutes: 0, shiftIds: [] };
      bucket.minutes += shift.workedMinutes;
      bucket.shiftIds.push(shift.id);
      unrated.set(shift.userId, bucket);
      continue;
    }
    const key = `${shift.userId}:${rate.itemTypeId}`;
    const line = lines.get(key)
      ?? { cents: 0n, minutes: 0, shiftIds: [], userId: shift.userId, itemTypeId: rate.itemTypeId };
    line.cents += payFor(shift.workedMinutes, rate.hourlyRate);
    line.minutes += shift.workedMinutes;
    line.shiftIds.push(shift.id);
    lines.set(key, line);
  }

  return {
    lines: [...lines.values()]
      .filter((l) => l.cents > 0n)
      .map((l) => ({
        userId: l.userId,
        itemTypeId: l.itemTypeId,
        amount: fromCents(l.cents),
        minutes: l.minutes,
        shiftIds: l.shiftIds,
      })),
    unrated: [...unrated.entries()].map(([userId, u]) => ({ userId, ...u })),
  };
}
