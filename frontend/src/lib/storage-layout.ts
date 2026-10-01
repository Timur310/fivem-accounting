/**
 * The storage planner's grid, as plain functions the editor and the tests can
 * both use. Mirrors the server's rules (backend lib/storage.ts): nothing sticks
 * out of the room, two containers do not share a cell, and nothing stands in a
 * wall or a doorway. The editor checks as you drag; the server checks again.
 */

export type TileKind = 'wall' | 'door';
export interface Tile { x: number; y: number; kind: TileKind }
export interface Box { key: string; x: number; y: number; w: number; h: number }

export const MIN_ROOM = 4;
export const MAX_ROOM_W = 60;
export const MAX_ROOM_H = 40;
export const MAX_SIDE = 8;

const cellKey = (x: number, y: number) => `${x},${y}`;

/** Every cell a box covers. */
export function cellsOf(box: Pick<Box, 'x' | 'y' | 'w' | 'h'>): string[] {
  const out: string[] = [];
  for (let dx = 0; dx < box.w; dx++) for (let dy = 0; dy < box.h; dy++) out.push(cellKey(box.x + dx, box.y + dy));
  return out;
}

/**
 * Can this box stand here? `ignore` is the box being moved, which does not
 * collide with where it used to be.
 */
export function canPlace(
  box: Pick<Box, 'x' | 'y' | 'w' | 'h'>,
  room: { width: number; height: number; tiles: Tile[] },
  others: Box[],
  ignore?: string,
): boolean {
  if (box.x < 0 || box.y < 0 || box.x + box.w > room.width || box.y + box.h > room.height) return false;
  const blocked = new Set(room.tiles.map((t) => cellKey(t.x, t.y)));
  for (const other of others) {
    if (other.key === ignore) continue;
    for (const c of cellsOf(other)) blocked.add(c);
  }
  return cellsOf(box).every((c) => !blocked.has(c));
}

/** Paint (or erase, with `kind` null) one cell. Refuses a cell a box stands on. */
export function paint(tiles: Tile[], x: number, y: number, kind: TileKind | null, boxes: Box[]): Tile[] {
  if (kind !== null && boxes.some((b) => cellsOf(b).includes(cellKey(x, y)))) return tiles;
  const rest = tiles.filter((t) => t.x !== x || t.y !== y);
  return kind === null ? rest : [...rest, { x, y, kind }];
}

/** Turned a quarter: width and height swap, the top-left corner stays. */
export function rotated<T extends Box>(box: T): T {
  return { ...box, w: box.h, h: box.w };
}

/** The first free spot for a box of this size, scanning row by row, or null. */
export function firstFreeSpot(
  w: number,
  h: number,
  room: { width: number; height: number; tiles: Tile[] },
  boxes: Box[],
): { x: number; y: number } | null {
  for (let y = 0; y + h <= room.height; y++) {
    for (let x = 0; x + w <= room.width; x++) {
      if (canPlace({ x, y, w, h }, room, boxes)) return { x, y };
    }
  }
  return null;
}

/** Walls and doors that would fall outside a smaller room. */
export function clipTiles(tiles: Tile[], width: number, height: number): Tile[] {
  return tiles.filter((t) => t.x < width && t.y < height);
}

/** A wall all the way round, with nothing else — the start of most rooms. */
export function outerWalls(width: number, height: number): Tile[] {
  const out: Tile[] = [];
  for (let x = 0; x < width; x++) {
    out.push({ x, y: 0, kind: 'wall' }, { x, y: height - 1, kind: 'wall' });
  }
  for (let y = 1; y < height - 1; y++) {
    out.push({ x: 0, y, kind: 'wall' }, { x: width - 1, y, kind: 'wall' });
  }
  return out;
}

/** "12.50" as 1250. */
export function cents(v: string | null | undefined): number {
  if (!v) return 0;
  const negative = v.trim().startsWith('-');
  const [whole = '0', fraction = ''] = v.trim().replace('-', '').split('.');
  const value = Number(whole) * 100 + Number((fraction + '00').slice(0, 2));
  return negative ? -value : value;
}

/** How full a container is, 0 to 1 (or above, when over), or null with no limit. */
export function fullness(contents: { quantity: string }[], capacity: string | null): number | null {
  const cap = cents(capacity);
  if (!capacity || cap <= 0) return null;
  return contents.reduce((s, c) => s + cents(c.quantity), 0) / cap;
}

/** Is any line in the container below the minimum set for it? */
export function isLow(contents: { quantity: string; minQuantity: string | null }[]): boolean {
  return contents.some((c) => c.minQuantity !== null && cents(c.quantity) < cents(c.minQuantity));
}

/** A count as people write it: "12", "12.5". */
export function plainNumber(v: string): string {
  return v.includes('.') ? v.replace(/\.?0+$/, '') : v;
}

/**
 * A count as people type it, made into the form the server takes: 12,5 is
 * 12.5, and 1 000, 1,000 and 1.000 are a thousand. The same rule as the
 * server's normalizeCount (backend lib/storage.ts).
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

/** Is this, once normalised, a count the server takes? */
export function isCount(value: string): boolean {
  return /^\d{1,13}(\.\d{1,2})?$/.test(normalizeCount(value));
}
