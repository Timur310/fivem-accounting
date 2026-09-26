/**
 * Which local day a shift's minutes belong to.
 *
 * Kept on its own so it can be tested without rendering anything: this is the
 * arithmetic that decides whether a night shift's hours after midnight land on
 * the right day, and it is the part of the calendar that went wrong.
 */

export interface DaySplittable {
  startedAt: string;
  endedAt: string | null;
  breakMinutes: number;
}

/** The local day a moment falls on, as `YYYY-MM-DD`. */
export function dayKey(value: string | Date): string {
  const d = value instanceof Date ? value : new Date(value);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/**
 * A shift's worked minutes, split across the local days it covers.
 *
 * Cut at each local midnight, so 18:00 to 02:00 is six hours on the first day
 * and two on the second. The break is shared between the pieces in proportion
 * to their length, because nothing records when it was taken — which is also
 * how the server clips a month total, so the two agree. A shift still running
 * is counted up to now.
 */
export function minutesByDay(shift: DaySplittable, now: number): Map<string, number> {
  const out = new Map<string, number>();
  const start = new Date(shift.startedAt).getTime();
  const end = shift.endedAt ? new Date(shift.endedAt).getTime() : now;
  const gross = end - start;
  if (gross <= 0) {
    out.set(dayKey(shift.startedAt), 0);
    return out;
  }

  let cursor = start;
  while (cursor < end) {
    const at = new Date(cursor);
    const midnight = new Date(at.getFullYear(), at.getMonth(), at.getDate() + 1).getTime();
    const pieceEnd = Math.min(midnight, end);
    const piece = pieceEnd - cursor;
    const worked = (piece - shift.breakMinutes * 60_000 * (piece / gross)) / 60_000;
    const key = dayKey(at);
    out.set(key, (out.get(key) ?? 0) + Math.max(0, Math.round(worked)));
    cursor = pieceEnd;
  }
  return out;
}

