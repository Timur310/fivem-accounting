import { toCents } from './treasury.js';

/**
 * The storage planner's rules that are arithmetic rather than database.
 *
 * A room is a grid of cells. Walls and doors are painted cells; a container
 * is a rectangle of cells. The rules are the ones a real depot has: nothing
 * sticks out of the room, two containers do not stand in the same place, and
 * nothing stands in a wall or in a doorway.
 */

export const MIN_ROOM_SIZE = 4;
export const MAX_ROOM_WIDTH = 60;
export const MAX_ROOM_HEIGHT = 40;
/** The biggest footprint a single container may have, either way. */
export const MAX_CONTAINER_SIDE = 8;
/** Enough for a big warehouse floor; not enough to be a denial of service. */
export const MAX_CONTAINERS_PER_ROOM = 300;
export const MAX_CONTENTS_PER_CONTAINER = 100;

export interface LayoutTile { x: number; y: number; kind: 'wall' | 'door' }
export interface LayoutBox { name: string; x: number; y: number; w: number; h: number }

/**
 * What is wrong with a layout, in words for the person who drew it, or null.
 *
 * Checked on the server whatever the editor already prevented: the editor is
 * one client, and a room saved with two chests in one cell is a room nobody
 * can draw again.
 */
export function layoutProblem(
  width: number,
  height: number,
  tiles: LayoutTile[],
  boxes: LayoutBox[],
): string | null {
  const blocked = new Set<string>();
  for (const tile of tiles) {
    if (tile.x < 0 || tile.y < 0 || tile.x >= width || tile.y >= height) {
      return 'A wall or door is outside the room — make the room bigger or erase it first';
    }
    const key = `${tile.x},${tile.y}`;
    if (blocked.has(key)) return 'The same cell is painted twice';
    blocked.add(key);
  }

  const taken = new Map<string, string>();
  for (const box of boxes) {
    if (box.x < 0 || box.y < 0 || box.x + box.w > width || box.y + box.h > height) {
      return `"${box.name}" sticks out of the room`;
    }
    for (let dx = 0; dx < box.w; dx++) {
      for (let dy = 0; dy < box.h; dy++) {
        const key = `${box.x + dx},${box.y + dy}`;
        if (blocked.has(key)) return `"${box.name}" stands in a wall or a doorway`;
        const other = taken.get(key);
        if (other !== undefined) return `"${box.name}" and "${other}" stand in the same place`;
        taken.set(key, box.name);
      }
    }
  }
  return null;
}

/**
 * Why a container cannot hold this, or null.
 *
 * `total` is everything in the container after the change, `quantity` is the
 * one line's count after it. A limit only refuses a change that goes *up*
 * past it: a container that is already over (its capacity was lowered after
 * it was filled) can still be emptied, which is the way out of being over.
 */
export function fitProblem(opts: {
  label: string;
  quantity: string;
  previousQuantity: string;
  total: string;
  previousTotal: string;
  capacity: string | null;
  maxQuantity: string | null;
}): string | null {
  const q = toCents(opts.quantity);
  const growing = q > toCents(opts.previousQuantity);
  if (opts.maxQuantity !== null && growing && q > toCents(opts.maxQuantity)) {
    return `At most ${opts.maxQuantity} ${opts.label} fit here`;
  }
  const total = toCents(opts.total);
  if (opts.capacity !== null && total > toCents(opts.previousTotal) && total > toCents(opts.capacity)) {
    return `That is more than this container holds (${opts.capacity} in total)`;
  }
  return null;
}

/** Did this change take a count from at-or-above its minimum to below it? */
export function droppedBelowMin(before: string, after: string, min: string | null): boolean {
  if (min === null) return false;
  const m = toCents(min);
  return toCents(before) >= m && toCents(after) < m;
}

/**
 * A count as people type it, made into the form the server takes.
 *
 * Hungarian writes 12,5 for twelve and a half and 1 000 for a thousand; others
 * write 1,000 or 1.000. A count has at most two decimals, so a comma or dot
 * followed by groups of exactly three digits can only be thousands, and any
 * other comma is a decimal point. Spaces (including the narrow ones a phone
 * keyboard inserts) and apostrophes are dropped. A minus sign is kept, for
 * add/take deltas.
 */
export function normalizeCount(value: string): string {
  let s = value.trim().replace(/[\s  ']/g, '');
  const sign = s.startsWith('-') ? '-' : '';
  if (sign) s = s.slice(1);
  if (/^\d{1,3}([.,]\d{3})+$/.test(s)) s = s.replace(/[.,]/g, '');
  else if (s.includes(',') && s.includes('.')) s = s.replace(/,/g, '');
  else s = s.replace(',', '.');
  return sign + s;
}
