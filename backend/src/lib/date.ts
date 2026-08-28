/**
 * Date helpers.
 *
 * Postgres `date` columns are returned by Drizzle as `YYYY-MM-DD` strings,
 * so the API works with date strings rather than Date objects throughout.
 */

/**
 * Format a Date as a `YYYY-MM-DD` string (UTC).
 *
 * Prefer this over `d.toISOString().split('T')[0]`: `slice` always returns a
 * string, so the result is not `string | undefined` under
 * `noUncheckedIndexedAccess`.
 */
export function toDateString(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/**
 * Today's date as a `YYYY-MM-DD` string (UTC).
 */
export function todayDateString(): string {
  return toDateString(new Date());
}

/**
 * Format a value that may be a Date, a date string, or nullish.
 * Returns an empty string for nullish input — intended for CSV output.
 */
export function formatDateValue(value: Date | string | null | undefined): string {
  if (value == null) return '';
  return value instanceof Date ? toDateString(value) : String(value).slice(0, 10);
}
