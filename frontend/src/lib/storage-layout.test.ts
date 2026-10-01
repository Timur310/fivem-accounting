import { describe, it, expect } from 'vitest';
import { canPlace, clipTiles, firstFreeSpot, fullness, isLow, outerWalls, paint, plainNumber, rotated } from './storage-layout';

const room = { width: 6, height: 4, tiles: [{ x: 0, y: 0, kind: 'wall' as const }] };

describe('the storage grid', () => {
  it('keeps boxes inside the room and off walls and each other', () => {
    const boxes = [{ key: 'a', x: 2, y: 1, w: 2, h: 1 }];
    expect(canPlace({ x: 1, y: 1, w: 1, h: 1 }, room, boxes)).toBe(true);
    expect(canPlace({ x: 0, y: 0, w: 1, h: 1 }, room, boxes)).toBe(false);
    expect(canPlace({ x: 3, y: 1, w: 1, h: 1 }, room, boxes)).toBe(false);
    expect(canPlace({ x: 5, y: 3, w: 2, h: 1 }, room, boxes)).toBe(false);
    // Moving a box onto part of where it already is.
    expect(canPlace({ x: 3, y: 1, w: 2, h: 1 }, room, boxes, 'a')).toBe(true);
  });

  it('paints and erases, but not under a box', () => {
    const boxes = [{ key: 'a', x: 2, y: 1, w: 1, h: 1 }];
    expect(paint(room.tiles, 1, 1, 'door', boxes)).toHaveLength(2);
    expect(paint(room.tiles, 2, 1, 'wall', boxes)).toBe(room.tiles);
    expect(paint(room.tiles, 0, 0, null, boxes)).toHaveLength(0);
  });

  it('rotates by swapping sides', () => {
    expect(rotated({ key: 'a', x: 1, y: 1, w: 3, h: 1 })).toMatchObject({ w: 1, h: 3 });
  });

  it('finds the first free spot', () => {
    expect(firstFreeSpot(2, 1, room, [])).toEqual({ x: 1, y: 0 });
    expect(firstFreeSpot(7, 1, room, [])).toBeNull();
  });

  it('draws outer walls and clips tiles to a smaller room', () => {
    expect(outerWalls(4, 4)).toHaveLength(12);
    expect(clipTiles([{ x: 5, y: 1, kind: 'wall' }, { x: 1, y: 1, kind: 'wall' }], 4, 4)).toHaveLength(1);
  });

  it('knows how full and how low a container is', () => {
    expect(fullness([{ quantity: '25.00' }, { quantity: '25' }], '100')).toBe(0.5);
    expect(fullness([{ quantity: '1' }], null)).toBeNull();
    expect(isLow([{ quantity: '2', minQuantity: '5' }])).toBe(true);
    expect(isLow([{ quantity: '5', minQuantity: '5' }])).toBe(false);
  });

  it('writes counts plainly', () => {
    expect(plainNumber('12.00')).toBe('12');
    expect(plainNumber('12.50')).toBe('12.5');
  });
});

describe('room templates', () => {
  it('are all layouts the server would accept', async () => {
    const { STORAGE_TEMPLATES } = await import('./storage-templates');
    for (const tpl of STORAGE_TEMPLATES) {
      const room = { width: tpl.width, height: tpl.height, tiles: tpl.tiles() };
      const placed: { key: string; x: number; y: number; w: number; h: number }[] = [];
      for (const [i, c] of tpl.containers.entries()) {
        expect(canPlace(c, room, placed), `${tpl.key}: ${c.name}`).toBe(true);
        placed.push({ key: String(i), ...c });
      }
      expect(room.tiles.every((t) => t.x < tpl.width && t.y < tpl.height)).toBe(true);
    }
  });
});

describe('counts as people type them', () => {
  it('reads Hungarian and English number styles', async () => {
    const { normalizeCount, isCount } = await import('./storage-layout');
    expect(normalizeCount('12,5')).toBe('12.5');
    expect(normalizeCount('1 000')).toBe('1000');
    expect(normalizeCount('1,000')).toBe('1000');
    expect(normalizeCount('1.000')).toBe('1000');
    expect(normalizeCount('1,000.50')).toBe('1000.50');
    expect(normalizeCount(' 50 ')).toBe('50');
    expect(normalizeCount('-3,5')).toBe('-3.5');
    expect(isCount('12,5')).toBe(true);
    expect(isCount('abc')).toBe(false);
    expect(isCount('1,2345')).toBe(false);
  });
});
