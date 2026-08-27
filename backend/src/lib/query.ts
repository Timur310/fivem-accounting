import type { SQL } from 'drizzle-orm';
import { and } from 'drizzle-orm';

/**
 * Helper: build an and() clause from an array that may contain undefined values.
 * Returns undefined if the array is empty (no conditions).
 */
export function buildWhere(conditions: (SQL | undefined)[]): SQL | undefined {
  const filtered = conditions.filter((c): c is SQL => c !== undefined);
  if (filtered.length === 0) return undefined;
  if (filtered.length === 1) return filtered[0];
  return and(...filtered);
}
