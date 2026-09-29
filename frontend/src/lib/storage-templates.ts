import { outerWalls, type Tile } from './storage-layout';
import type { StorageContainerInput } from '@/lib/api-types';
import type { TranslationKey } from '@/lib/i18n';

/**
 * Rooms to start from rather than an empty grid. Only a drawing: the new room
 * gets these walls and containers, and every one of them can be moved,
 * renamed or deleted afterwards like any other.
 */
export interface StorageTemplate {
  key: string;
  label: TranslationKey;
  hint: TranslationKey;
  width: number;
  height: number;
  tiles: () => Tile[];
  containers: Omit<StorageContainerInput, 'id'>[];
}

/** A wall round the edge with one door in it. */
function walled(width: number, height: number, door: { x: number; y: number }[]): Tile[] {
  const doors = new Set(door.map((d) => `${d.x},${d.y}`));
  return [
    ...outerWalls(width, height).filter((t) => !doors.has(`${t.x},${t.y}`)),
    ...door.map((d) => ({ ...d, kind: 'door' as const })),
  ];
}

const c = (
  kind: StorageContainerInput['kind'], name: string, x: number, y: number, w = 1, h = 1, extra: Partial<StorageContainerInput> = {},
): Omit<StorageContainerInput, 'id'> => ({ kind, name, x, y, w, h, color: null, tags: [], capacity: null, notes: null, ...extra });

export const STORAGE_TEMPLATES: StorageTemplate[] = [
  {
    key: 'empty',
    label: 'storage.template.empty',
    hint: 'storage.template.emptyHint',
    width: 16,
    height: 10,
    tiles: () => [],
    containers: [],
  },
  {
    key: 'walls',
    label: 'storage.template.walls',
    hint: 'storage.template.wallsHint',
    width: 16,
    height: 10,
    tiles: () => walled(16, 10, [{ x: 7, y: 9 }, { x: 8, y: 9 }]),
    containers: [],
  },
  {
    key: 'garage',
    label: 'storage.template.garage',
    hint: 'storage.template.garageHint',
    width: 12,
    height: 8,
    tiles: () => walled(12, 8, [{ x: 4, y: 7 }, { x: 5, y: 7 }, { x: 6, y: 7 }, { x: 7, y: 7 }]),
    containers: [
      c('bench', 'Workbench', 1, 1, 3, 1, { tags: ['tools'] }),
      c('rack', 'Parts rack', 5, 1, 3, 1, { tags: ['parts'] }),
      c('locker', 'Locker', 10, 1, 1, 2),
      c('chest', 'Chest', 1, 5, 1, 1),
    ],
  },
  {
    key: 'depot',
    label: 'storage.template.depot',
    hint: 'storage.template.depotHint',
    width: 20,
    height: 12,
    tiles: () => walled(20, 12, [{ x: 9, y: 11 }, { x: 10, y: 11 }]),
    containers: [
      c('bench', 'Bench 1', 1, 1, 2, 1, { tags: ['weapons'], color: '#ef4444' }),
      c('bench', 'Bench 2', 4, 1, 2, 1, { tags: ['weapons'], color: '#ef4444' }),
      c('bench', 'Bench 3', 7, 1, 2, 1, { tags: ['materials'], color: '#3b82f6' }),
      c('bench', 'Bench 4', 10, 1, 2, 1, { tags: ['materials'], color: '#3b82f6' }),
      c('chest', 'Chest 1', 1, 4, 1, 1),
      c('chest', 'Chest 2', 1, 6, 1, 1),
      c('chest', 'Chest 3', 1, 8, 1, 1),
      c('safe', 'Safe', 18, 1, 1, 1, { tags: ['money'], color: '#22c55e' }),
      c('rack', 'Rack', 14, 5, 1, 4),
    ],
  },
  {
    key: 'stash',
    label: 'storage.template.stash',
    hint: 'storage.template.stashHint',
    width: 10,
    height: 8,
    tiles: () => [
      ...walled(10, 8, [{ x: 1, y: 7 }]),
      { x: 5, y: 1, kind: 'wall' }, { x: 5, y: 2, kind: 'wall' }, { x: 5, y: 3, kind: 'door' },
      { x: 5, y: 4, kind: 'wall' }, { x: 5, y: 5, kind: 'wall' }, { x: 5, y: 6, kind: 'wall' },
    ],
    containers: [
      c('fridge', 'Fridge', 1, 1, 1, 1),
      c('chest', 'Chest', 3, 1, 1, 1),
      c('safe', 'Hidden safe', 8, 1, 1, 1, { tags: ['money'], color: '#22c55e' }),
      c('crate', 'Drug lab crate', 7, 5, 2, 1, { tags: ['drugs'], color: '#a855f7' }),
    ],
  },
];
