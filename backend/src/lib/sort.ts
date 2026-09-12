import { asc, desc, type SQL } from 'drizzle-orm';
import type { PgColumn } from 'drizzle-orm/pg-core';

/**
 * Turn `?sort=field&dir=asc` into an ORDER BY, against a fixed allow-list.
 *
 * Sorting a paginated list has to happen in SQL. Reordering the twenty rows
 * the client happens to be holding produces something that looks like "the
 * biggest entries" and is actually "the biggest of page three" — which is
 * worse than no sorting at all, because it is wrong rather than missing.
 *
 * The column map is the allow-list: an unknown field falls back to the
 * default rather than erroring, so a stale bookmark or an old client degrades
 * to the normal view instead of a 400.
 *
 * A tiebreaker column is always appended. Postgres gives no stable order for
 * equal keys, so without one a member with three entries of the same amount
 * can see them shuffle between pages — and rows can repeat or vanish across
 * page boundaries entirely.
 */
export function resolveSort<TColumns extends Record<string, PgColumn>>(
  params: { sort?: string; dir?: string },
  columns: TColumns,
  // `keyof TColumns` rather than a bare string so a typo in the default is a
  // compile error, and so the generic is inferred from the column map rather
  // than from this argument.
  fallback: { key: keyof TColumns & string; dir: 'asc' | 'desc' },
  tiebreaker: PgColumn,
): SQL[] {
  const key = (params.sort && params.sort in columns ? params.sort : fallback.key) as keyof TColumns;
  const dir = params.dir === 'asc' || params.dir === 'desc' ? params.dir : fallback.dir;
  // `key` came either from the allow-list check above or from `fallback`,
  // which is typed against the same map — so this is always present. The
  // guard keeps a bad lookup from becoming an `undefined` in an ORDER BY.
  const column = columns[key] ?? tiebreaker;
  const direction = dir === 'asc' ? asc : desc;

  // No point repeating the column as its own tiebreaker.
  if (column === tiebreaker) return [direction(column)];
  return [direction(column), desc(tiebreaker)];
}

/** The query-string shape every sortable list accepts. */
export const SORT_QUERY_KEYS = ['sort', 'dir'] as const;
