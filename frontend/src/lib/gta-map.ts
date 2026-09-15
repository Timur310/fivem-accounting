/**
 * Turning GTA V world coordinates into map pixels, and back.
 *
 * This is the whole feature. Everything else is drawing: markers are stored in
 * game coordinates — the numbers a player reads off `/coords` — and the map
 * image is a rendering detail. Get this transform wrong and every pin sits in
 * the sea while nothing else looks broken.
 *
 * ── Calibration ──────────────────────────────────────────────────────────
 *
 * The constants below are the values the widely-used FiveM tile packs assume.
 * They were **not** measured against your tiles, so treat them as a starting
 * point rather than a fact: if pins land consistently off, the fix is here and
 * nowhere else.
 *
 * How to correct them without guessing: the map shows the game coordinate
 * under the cursor in its bottom corner. Hover a place you know the real
 * coordinates of — Legion Square is about (195, -935), the airport tower about
 * (-1035, -2735) — and compare. A constant offset means WORLD's min/max are
 * shifted; a drift that grows as you move away from the centre means the span
 * is wrong.
 */

/**
 * The map styles on offer, first one the default.
 *
 * Add an entry per pyramid. `npm run map:tiles -- image.png --theme satellite`
 * writes the tiles and prints the block to paste here.
 *
 * Every theme must cover the same WORLD rectangle: the transform is shared, so
 * a style sliced from a differently-framed image would put the same marker in
 * two different places depending on which style you were looking at.
 */
export interface MapTheme {
  /** Stable — it is what gets remembered in the browser. */
  id: string;
  /** Shown in the switcher. Not translated: these are style names. */
  label: string;
  url: string;
  /**
   * Deepest zoom this pyramid actually has tiles for. Leaflet upscales beyond
   * it rather than requesting tiles that are not there, so a coarser style can
   * sit next to a finer one without the map going blank at high zoom.
   */
  maxNativeZoom: number;
}

export const MAP_THEMES: MapTheme[] = [
  { id: 'atlas', label: 'Atlas', url: '/map-tiles/{z}/{x}/{y}.png', maxNativeZoom: 5 },
  {
    id: 'road',
    label: 'Road',
    url: '/map-tiles/road/{z}/{x}/{y}.png',
    maxNativeZoom: 5,
  },
];

/** Where the browser remembers the reader's choice. Per viewer, not per faction. */
export const MAP_THEME_STORAGE_KEY = 'faction-accountant:map-theme';

/**
 * How far the map can be zoomed, whatever the styles provide.
 *
 * Separate from a theme's `maxNativeZoom` on purpose: this is the projection's
 * ceiling and changing it moves every coordinate, so it must not depend on
 * which style happens to be showing.
 */
export const MAP_MAX_ZOOM = 5;
export const MAP_TILE_SIZE = 256;
export const MAP_IMAGE_SIZE = MAP_TILE_SIZE * 2 ** MAP_MAX_ZOOM;

/**
 * The slice of the game world the image covers.
 *
 * X and Y are scaled independently because the world is not square and the
 * image is. Assuming one scale for both is the most common way these maps end
 * up subtly wrong — correct near the middle, further out the closer you get to
 * an edge.
 */
export const WORLD = {
  minX: -4000,
  maxX: 4500,
  minY: -4000,
  maxY: 8000,
} as const;

export interface GamePoint {
  x: number;
  y: number;
  z?: number;
}

/** Pixel position on the native-size image, top-left origin. */
export function gameToPixel(point: GamePoint): [number, number] {
  const spanX = WORLD.maxX - WORLD.minX;
  const spanY = WORLD.maxY - WORLD.minY;
  const px = ((point.x - WORLD.minX) / spanX) * MAP_IMAGE_SIZE;
  // Game Y grows north; image Y grows downward. Flipping here rather than in
  // the caller keeps every call site free of the question.
  const py = ((WORLD.maxY - point.y) / spanY) * MAP_IMAGE_SIZE;
  return [px, py];
}

/** And back, for placing a marker by clicking. */
export function pixelToGame(px: number, py: number): GamePoint {
  const spanX = WORLD.maxX - WORLD.minX;
  const spanY = WORLD.maxY - WORLD.minY;
  return {
    x: (px / MAP_IMAGE_SIZE) * spanX + WORLD.minX,
    y: WORLD.maxY - (py / MAP_IMAGE_SIZE) * spanY,
  };
}

/** `-1037.2, -2737.5` — how the game prints them, and how people paste them. */
export function formatGamePoint(point: GamePoint): string {
  const n = (v: number) => v.toFixed(1);
  return point.z === undefined
    ? `${n(point.x)}, ${n(point.y)}`
    : `${n(point.x)}, ${n(point.y)}, ${n(point.z)}`;
}

/**
 * Read what somebody pasted out of the game console.
 *
 * Deliberately forgiving about the shapes `/coords` and its many replacements
 * produce: `1.0, 2.0, 3.0`, `vector3(1.0, 2.0, 3.0)`, `[1.0 2.0 3.0]`,
 * `x = 1.0 y = 2.0 z = 3.0`. Somebody pasting a coordinate has already done
 * the work of finding it; refusing their punctuation is not a useful place to
 * be strict.
 */
export function parseGamePoint(input: string): GamePoint | null {
  // Strip the type name first. `vector3(1.0, 2.0, 3.0)` is what FiveM prints
  // most often, and the 3 in "vector3" is a digit like any other — read
  // naively it becomes the X coordinate and every later number shifts along.
  const cleaned = input.replace(/(?:vec|vector)[234]?/gi, ' ');
  const numbers = cleaned.match(/-?\d+(?:\.\d+)?/g);
  if (!numbers || numbers.length < 2) return null;

  const [x, y, z] = numbers.map(Number);
  if (x === undefined || y === undefined) return null;
  if (!Number.isFinite(x) || !Number.isFinite(y)) return null;

  return z !== undefined && Number.isFinite(z) ? { x, y, z } : { x, y };
}
