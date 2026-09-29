'use client';

import { useRef, useState } from 'react';
import { Box, Hammer, LibraryBig, Lock, Package, Refrigerator, Square, Vault, type LucideIcon } from 'lucide-react';
import { cn } from '@/lib/utils';
import { canPlace, MAX_SIDE, type Box as GridBox, type Tile } from '@/lib/storage-layout';
import type { StorageContainerKind } from '@/lib/api-types';

export const KIND_ICON: Record<StorageContainerKind, LucideIcon> = {
  bench: Hammer,
  chest: Package,
  safe: Vault,
  fridge: Refrigerator,
  locker: Lock,
  rack: LibraryBig,
  crate: Box,
  other: Square,
};

export interface GridContainer extends GridBox {
  kind: StorageContainerKind;
  name: string;
  color: string | null;
  /** 0..1 (or over), or null with no limit. */
  fill: number | null;
  low: boolean;
  /** Faded: a search is on and this one holds nothing that matches. */
  dim: boolean;
  /** Lit: a search is on and this one holds something that matches. */
  hit: boolean;
}

/** `pan` edits nothing, so a finger can scroll a big room while drawing it. */
export type GridTool = 'pan' | 'select' | 'wall' | 'door' | 'erase';

type Gesture =
  | { type: 'paint'; last: string }
  | { type: 'drag'; key: string; dx: number; dy: number; moved: boolean; startX: number; startY: number }
  | { type: 'resize'; key: string };

/**
 * A room drawn to scale: the grid, its walls and doors, and the containers
 * standing in it.
 *
 * One component for looking and for drawing. Looking, a container is a button
 * that opens what is in it; drawing, it can be dragged, resized from its
 * corner, and cells can be painted by dragging across them. Pointer events
 * throughout, so a finger works the same as a mouse, and touch scrolling is
 * switched off only while drawing, when a drag has to mean "move this".
 *
 * Placement is checked as you go: the ghost turns red where a container cannot
 * stand, and letting go there puts it back.
 */
export function RoomGrid({
  width,
  height,
  tiles,
  containers,
  cell,
  editing,
  tool = 'select',
  selectedKey,
  onSelect,
  onPaintStart,
  onPaint,
  onMove,
  onResize,
}: {
  width: number;
  height: number;
  tiles: Tile[];
  containers: GridContainer[];
  cell: number;
  editing: boolean;
  tool?: GridTool;
  selectedKey?: string | null;
  onSelect: (key: string | null) => void;
  /** A stroke is starting: the editor takes its undo snapshot here. */
  onPaintStart?: () => void;
  onPaint?: (x: number, y: number) => void;
  onMove?: (key: string, x: number, y: number) => void;
  onResize?: (key: string, w: number, h: number) => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const gesture = useRef<Gesture | null>(null);
  const [ghost, setGhost] = useState<{ key: string; x: number; y: number; w: number; h: number } | null>(null);

  const room = { width, height, tiles };

  const cellAt = (e: React.PointerEvent) => {
    const rect = ref.current!.getBoundingClientRect();
    return {
      x: Math.floor((e.clientX - rect.left) / cell),
      y: Math.floor((e.clientY - rect.top) / cell),
    };
  };
  const inRoom = (p: { x: number; y: number }) => p.x >= 0 && p.y >= 0 && p.x < width && p.y < height;

  const onGridDown = (e: React.PointerEvent) => {
    if (!editing || tool === 'pan') return;
    if (tool === 'select') {
      if (e.target === ref.current) onSelect(null);
      return;
    }
    const p = cellAt(e);
    if (!inRoom(p)) return;
    ref.current!.setPointerCapture(e.pointerId);
    onPaintStart?.();
    onPaint?.(p.x, p.y);
    gesture.current = { type: 'paint', last: `${p.x},${p.y}` };
  };

  const onBoxDown = (e: React.PointerEvent, box: GridContainer) => {
    if (!editing || tool !== 'select') return;
    e.stopPropagation();
    const p = cellAt(e);
    ref.current!.setPointerCapture(e.pointerId);
    gesture.current = { type: 'drag', key: box.key, dx: p.x - box.x, dy: p.y - box.y, moved: false, startX: box.x, startY: box.y };
    onSelect(box.key);
  };

  const onHandleDown = (e: React.PointerEvent, box: GridContainer) => {
    e.stopPropagation();
    ref.current!.setPointerCapture(e.pointerId);
    gesture.current = { type: 'resize', key: box.key };
    onSelect(box.key);
  };

  const onPointerMove = (e: React.PointerEvent) => {
    const g = gesture.current;
    if (!g) return;
    const p = cellAt(e);
    if (g.type === 'paint') {
      const key = `${p.x},${p.y}`;
      if (key !== g.last && inRoom(p)) {
        g.last = key;
        onPaint?.(p.x, p.y);
      }
      return;
    }
    const box = containers.find((c) => c.key === g.key);
    if (!box) return;
    if (g.type === 'drag') {
      const x = p.x - g.dx;
      const y = p.y - g.dy;
      if (x !== g.startX || y !== g.startY) g.moved = true;
      setGhost({ key: box.key, x, y, w: box.w, h: box.h });
    } else {
      const w = Math.min(MAX_SIDE, Math.max(1, p.x - box.x + 1));
      const h = Math.min(MAX_SIDE, Math.max(1, p.y - box.y + 1));
      setGhost({ key: box.key, x: box.x, y: box.y, w, h });
    }
  };

  const onPointerUp = () => {
    const g = gesture.current;
    gesture.current = null;
    if (!g || g.type === 'paint') return;
    const current = ghost;
    setGhost(null);
    if (!current || current.key !== g.key) return;
    if (!canPlace(current, room, containers, current.key)) return;
    if (g.type === 'drag' && g.moved) onMove?.(g.key, current.x, current.y);
    if (g.type === 'resize') onResize?.(g.key, current.w, current.h);
  };

  const ghostOk = ghost ? canPlace(ghost, room, containers, ghost.key) : true;
  const small = cell < 30;

  return (
    <div className="overflow-auto rounded-lg border border-zinc-800 bg-zinc-950/60 p-3">
      <div
        ref={ref}
        role={editing ? 'application' : undefined}
        className={cn(
          'relative select-none',
          editing && tool !== 'pan' && 'touch-none',
          editing && tool !== 'select' && tool !== 'pan' && 'cursor-crosshair',
          editing && tool === 'pan' && 'cursor-grab',
        )}
        style={{
          width: width * cell,
          height: height * cell,
          backgroundImage:
            'linear-gradient(to right, rgb(63 63 70 / 0.35) 1px, transparent 1px), linear-gradient(to bottom, rgb(63 63 70 / 0.35) 1px, transparent 1px)',
          backgroundSize: `${cell}px ${cell}px`,
        }}
        onPointerDown={onGridDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={() => { gesture.current = null; setGhost(null); }}
      >
        {tiles.map((t) => (
          <div
            key={`${t.x},${t.y}`}
            aria-hidden
            className={cn(
              'pointer-events-none absolute',
              t.kind === 'wall'
                ? 'bg-zinc-600'
                : 'bg-[repeating-linear-gradient(45deg,rgb(180_83_9/0.55)_0_4px,rgb(120_53_15/0.35)_4px_8px)]',
            )}
            style={{ left: t.x * cell, top: t.y * cell, width: cell, height: cell }}
          />
        ))}

        {containers.map((box) => {
          const Icon = KIND_ICON[box.kind] ?? Square;
          const selected = selectedKey === box.key;
          const hidden = ghost?.key === box.key;
          const fill = box.fill === null ? null : Math.min(1, box.fill);
          return (
            <button
              key={box.key}
              type="button"
              onPointerDown={(e) => onBoxDown(e, box)}
              onClick={() => { if (!editing) onSelect(box.key); }}
              aria-label={box.name}
              title={box.name}
              className={cn(
                // Long and one cell tall reads as a row; anything else stacks.
                'absolute flex items-center justify-center gap-1 overflow-hidden rounded-md border-2 bg-zinc-900 px-1 pb-1 text-zinc-200 transition-[opacity,box-shadow] duration-150',
                box.h === 1 && box.w > 1 ? 'flex-row' : 'flex-col',
                editing && tool === 'select' ? 'cursor-grab active:cursor-grabbing' : 'cursor-pointer hover:brightness-125',
                selected && 'ring-2 ring-[var(--brand-color)] ring-offset-1 ring-offset-zinc-950',
                box.dim && 'opacity-25',
                box.hit && 'ring-2 ring-amber-300',
                hidden && 'opacity-30',
                editing && tool !== 'select' && tool !== 'pan' && 'pointer-events-none',
              )}
              style={{
                left: box.x * cell + 1,
                top: box.y * cell + 1,
                width: box.w * cell - 2,
                height: box.h * cell - 2,
                borderColor: box.color ?? '#52525b',
                backgroundColor: box.color ? `${box.color}22` : undefined,
              }}
            >
              <Icon className={small ? 'h-3 w-3' : 'h-4 w-4'} style={box.color ? { color: box.color } : undefined} />
              {(box.w > 1 || cell >= 44) && !small && (
                <span className="min-w-0 max-w-full truncate text-[10px] leading-tight">{box.name}</span>
              )}
              {fill !== null && (
                <span className="absolute inset-x-1 bottom-[3px] h-[3px] overflow-hidden rounded-full bg-zinc-800">
                  <span
                    className={cn('block h-full rounded-full', box.fill! > 1 ? 'bg-red-500' : box.fill! >= 0.9 ? 'bg-red-400' : box.fill! >= 0.7 ? 'bg-amber-400' : 'bg-emerald-400')}
                    style={{ width: `${fill * 100}%` }}
                  />
                </span>
              )}
              {box.low && <span className="absolute right-1 top-1 size-2 rounded-full bg-red-500" aria-hidden />}
              {editing && selected && tool === 'select' && (
                <span
                  onPointerDown={(e) => onHandleDown(e, box)}
                  className="absolute bottom-0 right-0 size-3 cursor-nwse-resize rounded-tl bg-[var(--brand-color)] pointer-coarse:size-5"
                  aria-hidden
                />
              )}
            </button>
          );
        })}

        {ghost && (
          <div
            aria-hidden
            className={cn(
              'pointer-events-none absolute rounded-md border-2 border-dashed',
              ghostOk ? 'border-emerald-400 bg-emerald-400/10' : 'border-red-500 bg-red-500/15',
            )}
            style={{ left: ghost.x * cell, top: ghost.y * cell, width: ghost.w * cell, height: ghost.h * cell }}
          />
        )}
      </div>
    </div>
  );
}
