'use client';

import { useMemo, useRef, useState, type ReactNode } from 'react';
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

/** The colour a container without one of its own is drawn in. */
export const NEUTRAL = '#71717a';

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
  /** A short second line when there is room for one: "45 / 50". */
  caption?: string;
  /** Shown on hover: the first few things inside. */
  preview?: { label: string; quantity: string; low?: boolean }[];
}

/**
 * `pan` edits nothing, so a finger can scroll a big room while drawing it.
 * `rect` drags out a rectangle of walls; `place` puts down the container the
 * palette is holding.
 */
export type GridTool = 'pan' | 'select' | 'wall' | 'door' | 'erase' | 'rect' | 'place';

type Gesture =
  | { type: 'paint'; start: { x: number; y: number }; last: string }
  | { type: 'rect'; start: { x: number; y: number } }
  | { type: 'drag'; key: string; dx: number; dy: number; moved: boolean; startX: number; startY: number }
  | { type: 'resize'; key: string };

type Cell = { x: number; y: number };

/** Every cell on the straight line from a to b, along whichever axis is longer. */
function straightLine(a: Cell, b: Cell): Cell[] {
  const horizontal = Math.abs(b.x - a.x) >= Math.abs(b.y - a.y);
  const out: Cell[] = [];
  if (horizontal) {
    const [from, to] = a.x <= b.x ? [a.x, b.x] : [b.x, a.x];
    for (let x = from; x <= to; x++) out.push({ x, y: a.y });
  } else {
    const [from, to] = a.y <= b.y ? [a.y, b.y] : [b.y, a.y];
    for (let y = from; y <= to; y++) out.push({ x: a.x, y });
  }
  return out;
}

/**
 * Walls and doors, drawn as one picture rather than as painted squares.
 *
 * A wall cell becomes a bar through the middle of the cell, with an arm out to
 * every neighbouring wall or door — so a run of cells reads as one continuous
 * wall with clean corners and T-joints, the way a floor plan does. A door is
 * the gap in that line with its leaf and swing drawn in, opening towards the
 * side that is floor.
 */
function Structure({ tiles, cell, width, height }: { tiles: Tile[]; cell: number; width: number; height: number }) {
  const shapes = useMemo(() => {
    const kind = new Map(tiles.map((t) => [`${t.x},${t.y}`, t.kind]));
    const at = (x: number, y: number) => kind.get(`${x},${y}`);
    const thick = Math.max(5, Math.round(cell * 0.38));
    const half = thick / 2;
    const walls: ReactNode[] = [];
    const doors: ReactNode[] = [];

    for (const t of tiles) {
      const cx = t.x * cell + cell / 2;
      const cy = t.y * cell + cell / 2;
      const k = `${t.x},${t.y}`;
      if (t.kind === 'wall') {
        const n = !!at(t.x, t.y - 1);
        const s = !!at(t.x, t.y + 1);
        const e = !!at(t.x + 1, t.y);
        const w = !!at(t.x - 1, t.y);
        // The joint, rounded when nothing joins it.
        walls.push(<rect key={`${k}c`} x={cx - half} y={cy - half} width={thick} height={thick} rx={n || s || e || w ? 1 : half * 0.6} />);
        if (n) walls.push(<rect key={`${k}n`} x={cx - half} y={t.y * cell} width={thick} height={cell / 2} />);
        if (s) walls.push(<rect key={`${k}s`} x={cx - half} y={cy} width={thick} height={cell / 2} />);
        if (e) walls.push(<rect key={`${k}e`} x={cx} y={cy - half} width={cell / 2} height={thick} />);
        if (w) walls.push(<rect key={`${k}w`} x={t.x * cell} y={cy - half} width={cell / 2} height={thick} />);
      } else {
        // A door in a wall that runs left–right swings up or down, and the
        // other way round. It opens towards whichever side is open floor.
        const horizontal = !!at(t.x - 1, t.y) || !!at(t.x + 1, t.y) || !(at(t.x, t.y - 1) || at(t.x, t.y + 1));
        const x0 = t.x * cell;
        const y0 = t.y * cell;
        if (horizontal) {
          const up = !at(t.x, t.y - 1) && t.y > 0;
          const dir = up ? -1 : 1;
          const r = cell * 0.9;
          const hx = x0 + cell * 0.05;
          doors.push(
            <g key={k}>
              <path d={`M ${hx + r} ${cy} A ${r} ${r} 0 0 ${up ? 0 : 1} ${hx} ${cy + dir * r}`} className="fill-none stroke-amber-400/50" strokeWidth={1} strokeDasharray="3 3" />
              <line x1={hx} y1={cy} x2={hx} y2={cy + dir * r} className="stroke-amber-400" strokeWidth={2} strokeLinecap="round" />
              <line x1={x0} y1={cy} x2={x0 + cell} y2={cy} className="stroke-amber-400/25" strokeWidth={thick} />
            </g>,
          );
        } else {
          const left = !at(t.x - 1, t.y) && t.x > 0;
          const dir = left ? -1 : 1;
          const r = cell * 0.9;
          const hy = y0 + cell * 0.05;
          doors.push(
            <g key={k}>
              <path d={`M ${cx} ${hy + r} A ${r} ${r} 0 0 ${left ? 1 : 0} ${cx + dir * r} ${hy}`} className="fill-none stroke-amber-400/50" strokeWidth={1} strokeDasharray="3 3" />
              <line x1={cx} y1={hy} x2={cx + dir * r} y2={hy} className="stroke-amber-400" strokeWidth={2} strokeLinecap="round" />
              <line x1={cx} y1={y0} x2={cx} y2={y0 + cell} className="stroke-amber-400/25" strokeWidth={thick} />
            </g>,
          );
        }
      }
    }
    return { walls, doors };
  }, [tiles, cell]);

  return (
    <svg
      aria-hidden
      className="pointer-events-none absolute inset-0 overflow-visible"
      width={width * cell}
      height={height * cell}
    >
      {/* One flat colour: a gradient per piece shows every joint as a seam. */}
      <g fill="#63636e" shapeRendering="crispEdges" style={{ filter: 'drop-shadow(0 2px 3px rgb(0 0 0 / 0.55))' }}>{shapes.walls}</g>
      <g>{shapes.doors}</g>
    </svg>
  );
}

/**
 * A room drawn to scale: the floor, its walls and doors, and the containers
 * standing in it.
 *
 * One component for looking and for drawing. Looking, a container is a card
 * that opens what is in it, and hovering one previews its contents. Drawing,
 * containers can be dragged and resized from their corner, cells painted by
 * dragging across them (hold Shift for a straight line), a rectangle of walls
 * dragged out in one go, and a container from the palette put down where the
 * ghost shows. Pointer events throughout, so a finger works the same as a
 * mouse; touch scrolling is switched off only while a drag means "draw".
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
  placing,
  overlay,
  footer,
  onSelect,
  onPaintStart,
  onPaint,
  onRect,
  onPlace,
  onMove,
  onResize,
  onHoverCell,
  onZoom,
  emptyLabel = '—',
}: {
  width: number;
  height: number;
  tiles: Tile[];
  containers: GridContainer[];
  cell: number;
  editing: boolean;
  tool?: GridTool;
  selectedKey?: string | null;
  /** What the palette is holding, for the `place` tool. */
  placing?: { kind: StorageContainerKind; w: number; h: number; color: string | null } | null;
  /** Floating controls drawn over the canvas, outside the scrolling stage. */
  overlay?: ReactNode;
  /** A bar under the canvas. */
  footer?: ReactNode;
  onSelect: (key: string | null) => void;
  /** A stroke is starting: the editor takes its undo snapshot here. */
  onPaintStart?: () => void;
  onPaint?: (x: number, y: number) => void;
  onRect?: (a: Cell, b: Cell) => void;
  onPlace?: (x: number, y: number) => void;
  onMove?: (key: string, x: number, y: number) => void;
  onResize?: (key: string, w: number, h: number) => void;
  onHoverCell?: (p: Cell | null) => void;
  /** Ctrl+wheel over the canvas: positive zooms in. */
  onZoom?: (direction: 1 | -1) => void;
  /** What the hover card says for an empty container. */
  emptyLabel?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const gesture = useRef<Gesture | null>(null);
  const [ghost, setGhost] = useState<{ key: string; x: number; y: number; w: number; h: number } | null>(null);
  const [hover, setHover] = useState<Cell | null>(null);
  const [rect, setRect] = useState<{ a: Cell; b: Cell } | null>(null);
  const [peek, setPeek] = useState<string | null>(null);

  const room = { width, height, tiles };
  const capture = (e: React.PointerEvent) => {
    try { ref.current?.setPointerCapture(e.pointerId); } catch { /* a pointer that is already gone */ }
  };

  const cellAt = (e: { clientX: number; clientY: number }): Cell => {
    const r = ref.current!.getBoundingClientRect();
    return { x: Math.floor((e.clientX - r.left) / cell), y: Math.floor((e.clientY - r.top) / cell) };
  };
  const inRoom = (p: Cell) => p.x >= 0 && p.y >= 0 && p.x < width && p.y < height;
  const clamp = (p: Cell): Cell => ({ x: Math.min(width - 1, Math.max(0, p.x)), y: Math.min(height - 1, Math.max(0, p.y)) });

  const brush = tool === 'wall' || tool === 'door' || tool === 'erase';

  const onGridDown = (e: React.PointerEvent) => {
    if (!editing || tool === 'pan') return;
    const p = cellAt(e);
    if (tool === 'select') {
      if (e.target === ref.current) onSelect(null);
      return;
    }
    if (!inRoom(p)) return;
    if (tool === 'place') {
      if (placing) onPlace?.(p.x, p.y);
      return;
    }
    capture(e);
    onPaintStart?.();
    if (tool === 'rect') {
      gesture.current = { type: 'rect', start: p };
      setRect({ a: p, b: p });
      return;
    }
    onPaint?.(p.x, p.y);
    gesture.current = { type: 'paint', start: p, last: `${p.x},${p.y}` };
  };

  const onBoxDown = (e: React.PointerEvent, box: GridContainer) => {
    if (!editing || tool !== 'select') return;
    e.stopPropagation();
    const p = cellAt(e);
    capture(e);
    gesture.current = { type: 'drag', key: box.key, dx: p.x - box.x, dy: p.y - box.y, moved: false, startX: box.x, startY: box.y };
    onSelect(box.key);
  };

  const onHandleDown = (e: React.PointerEvent, box: GridContainer) => {
    e.stopPropagation();
    capture(e);
    gesture.current = { type: 'resize', key: box.key };
    onSelect(box.key);
  };

  const onPointerMove = (e: React.PointerEvent) => {
    const p = cellAt(e);
    if (editing) {
      const next = inRoom(p) ? p : null;
      if (next?.x !== hover?.x || next?.y !== hover?.y) {
        setHover(next);
        onHoverCell?.(next);
      }
    }
    const g = gesture.current;
    if (!g) return;
    if (g.type === 'paint') {
      const cells = e.shiftKey ? straightLine(g.start, clamp(p)) : [p];
      for (const c of cells) {
        const key = `${c.x},${c.y}`;
        if (!inRoom(c) || (!e.shiftKey && key === g.last)) continue;
        g.last = key;
        onPaint?.(c.x, c.y);
      }
      return;
    }
    if (g.type === 'rect') {
      setRect({ a: g.start, b: clamp(p) });
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
    if (g.type === 'rect') {
      if (rect) onRect?.(rect.a, rect.b);
      setRect(null);
      return;
    }
    const current = ghost;
    setGhost(null);
    if (!current || current.key !== g.key) return;
    if (!canPlace(current, room, containers, current.key)) return;
    if (g.type === 'drag' && g.moved) onMove?.(g.key, current.x, current.y);
    if (g.type === 'resize') onResize?.(g.key, current.w, current.h);
  };

  const onLeave = () => {
    setHover(null);
    onHoverCell?.(null);
  };

  const ghostOk = ghost ? canPlace(ghost, room, containers, ghost.key) : true;
  const placeGhost = tool === 'place' && placing && hover ? { ...hover, w: placing.w, h: placing.h } : null;
  const placeOk = placeGhost ? canPlace(placeGhost, room, containers) : true;
  const peeked = !editing && peek ? containers.find((c) => c.key === peek) : null;
  const radius = Math.max(4, Math.round(cell * 0.18));

  return (
    <div className="overflow-hidden rounded-xl border border-zinc-800/80 bg-zinc-950 shadow-[inset_0_1px_0_rgb(255_255_255/0.03)]">
    <div
      className="relative"
      onWheel={(e) => {
        if (!onZoom || !(e.ctrlKey || e.metaKey)) return;
        e.preventDefault();
        onZoom(e.deltaY < 0 ? 1 : -1);
      }}
    >
      {/* A soft light over the middle of the canvas, and a fine dot field. */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0"
        style={{
          backgroundImage:
            'radial-gradient(ellipse at 50% 0%, rgb(var(--brand-rgb, 99 102 241) / 0.08), transparent 60%), radial-gradient(circle, rgb(63 63 70 / 0.35) 1px, transparent 1px)',
          backgroundSize: '100% 100%, 18px 18px',
        }}
      />
      {overlay}

      <div className="relative overflow-auto px-6 pb-8 pt-16 sm:px-10">
        <div
          ref={ref}
          role={editing ? 'application' : undefined}
          className={cn(
            'relative mx-auto select-none rounded-lg',
            editing && tool !== 'pan' && 'touch-none',
            editing && (brush || tool === 'rect') && 'cursor-crosshair',
            editing && tool === 'place' && 'cursor-copy',
            editing && tool === 'pan' && 'cursor-grab',
          )}
          style={{
            width: width * cell,
            height: height * cell,
            backgroundColor: 'rgb(24 24 27)',
            // Dots on every corner of the grid, and — while drawing — the
            // faintest of lines so a cell is easy to aim at.
            backgroundImage: editing
              ? `radial-gradient(circle, rgb(113 113 122 / 0.45) 1px, transparent 1.5px), linear-gradient(to right, rgb(63 63 70 / 0.22) 1px, transparent 1px), linear-gradient(to bottom, rgb(63 63 70 / 0.22) 1px, transparent 1px)`
              : 'radial-gradient(circle, rgb(113 113 122 / 0.35) 1px, transparent 1.5px)',
            backgroundSize: `${cell}px ${cell}px`,
            backgroundPosition: editing ? `${-cell / 2}px ${-cell / 2}px, 0 0, 0 0` : `${-cell / 2}px ${-cell / 2}px`,
            boxShadow: '0 0 0 1px rgb(63 63 70 / 0.6), 0 24px 48px -16px rgb(0 0 0 / 0.7), inset 0 1px 0 rgb(255 255 255 / 0.04)',
          }}
          onPointerDown={onGridDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerLeave={onLeave}
          onPointerCancel={() => { gesture.current = null; setGhost(null); setRect(null); }}
        >
          <Structure tiles={tiles} cell={cell} width={width} height={height} />

          {/* The brush, under the cursor. */}
          {editing && brush && hover && !gesture.current && (
            <div
              aria-hidden
              className={cn(
                'pointer-events-none absolute rounded-md border-2',
                tool === 'wall' && 'border-zinc-300/70 bg-zinc-300/10',
                tool === 'door' && 'border-amber-400/70 bg-amber-400/10',
                tool === 'erase' && 'border-red-400/70 bg-red-400/10',
              )}
              style={{ left: hover.x * cell, top: hover.y * cell, width: cell, height: cell }}
            />
          )}

          {/* A rectangle of walls, while it is being dragged out. */}
          {rect && (
            <div
              aria-hidden
              className="pointer-events-none absolute rounded-md border-2 border-dashed border-zinc-200/80 bg-zinc-200/5"
              style={{
                left: Math.min(rect.a.x, rect.b.x) * cell,
                top: Math.min(rect.a.y, rect.b.y) * cell,
                width: (Math.abs(rect.b.x - rect.a.x) + 1) * cell,
                height: (Math.abs(rect.b.y - rect.a.y) + 1) * cell,
              }}
            >
              <span className="absolute -top-6 left-0 rounded bg-zinc-800 px-1.5 py-0.5 text-[10px] tabular-nums text-zinc-200 shadow">
                {Math.abs(rect.b.x - rect.a.x) + 1} × {Math.abs(rect.b.y - rect.a.y) + 1}
              </span>
            </div>
          )}

          {containers.map((box) => {
            const Icon = KIND_ICON[box.kind] ?? Square;
            const selected = selectedKey === box.key;
            const hidden = ghost?.key === box.key;
            const fill = box.fill === null ? null : Math.min(1, box.fill);
            const color = box.color ?? NEUTRAL;
            const roomy = box.w * cell >= 70 && box.h * cell >= 52;
            const row = box.h === 1 && box.w > 1;
            const tiny = cell < 28 || (box.w === 1 && box.h === 1 && cell < 44);
            // A one-cell-tall row needs its width for the name, not a big chip.
            const compact = tiny || (row && cell < 48);
            // Too narrow for both: the name matters more than the icon.
            const nameOnly = row && !tiny && box.w * cell < 96;
            return (
              <button
                key={box.key}
                type="button"
                onPointerDown={(e) => onBoxDown(e, box)}
                onClick={() => { if (!editing) onSelect(box.key); }}
                onPointerEnter={() => setPeek(box.key)}
                onPointerLeave={() => setPeek((p) => (p === box.key ? null : p))}
                aria-label={box.name}
                className={cn(
                  'group absolute flex items-center justify-center gap-1.5 overflow-hidden border text-left transition-[transform,box-shadow,opacity,filter] duration-150',
                  row ? 'flex-row px-1' : 'flex-col px-1',
                  editing && tool === 'select' ? 'cursor-grab active:cursor-grabbing' : 'cursor-pointer',
                  !editing && 'hover:-translate-y-px hover:brightness-110',
                  box.dim && 'opacity-20 saturate-0',
                  hidden && 'opacity-30',
                  editing && tool !== 'select' && tool !== 'pan' && 'pointer-events-none',
                )}
                style={{
                  left: box.x * cell + 2,
                  top: box.y * cell + 2,
                  width: box.w * cell - 4,
                  height: box.h * cell - 4,
                  borderRadius: radius,
                  borderColor: `${color}80`,
                  backgroundImage: `linear-gradient(145deg, ${color}38, ${color}12 60%, ${color}08)`,
                  backgroundColor: 'rgb(24 24 27 / 0.92)',
                  boxShadow: [
                    'inset 0 1px 0 rgb(255 255 255 / 0.07)',
                    '0 6px 14px -6px rgb(0 0 0 / 0.75)',
                    selected ? `0 0 0 2px var(--brand-color), 0 0 18px -2px var(--brand-color)` : '',
                    box.hit ? '0 0 0 2px rgb(252 211 77), 0 0 22px -4px rgb(252 211 77)' : '',
                  ].filter(Boolean).join(', '),
                }}
              >
                {!nameOnly && <span
                  className={cn('flex shrink-0 items-center justify-center rounded-md', compact ? 'size-5' : 'size-7')}
                  style={{ backgroundColor: `${color}30`, color }}
                >
                  <Icon className={compact ? 'h-3 w-3' : 'h-4 w-4'} />
                </span>}
                {!tiny && (box.w > 1 || box.h > 1 || cell >= 48) && (
                  <span className={cn('min-w-0', row ? 'flex-1' : 'max-w-full text-center')}>
                    <span className="block truncate text-[11px] font-medium leading-tight text-zinc-100">{box.name}</span>
                    {roomy && box.caption && (
                      <span className="block truncate text-[10px] leading-tight text-zinc-400 tabular-nums">{box.caption}</span>
                    )}
                  </span>
                )}
                {fill !== null && (
                  <span className="absolute inset-x-1.5 bottom-1 h-[3px] overflow-hidden rounded-full bg-black/40">
                    <span
                      className={cn('block h-full rounded-full', box.fill! > 1 ? 'bg-red-500' : box.fill! >= 0.9 ? 'bg-red-400' : box.fill! >= 0.7 ? 'bg-amber-400' : 'bg-emerald-400')}
                      style={{ width: `${fill * 100}%` }}
                    />
                  </span>
                )}
                {box.low && (
                  <span className="absolute right-1 top-1 flex size-2" aria-hidden>
                    <span className="absolute inline-flex size-full animate-ping rounded-full bg-red-500/60" />
                    <span className="relative inline-flex size-2 rounded-full bg-red-500" />
                  </span>
                )}
                {editing && selected && tool === 'select' && (
                  <span
                    onPointerDown={(e) => onHandleDown(e, box)}
                    className="absolute bottom-0.5 right-0.5 size-3 cursor-nwse-resize rounded-sm border border-white/60 bg-[var(--brand-color)] shadow pointer-coarse:size-5"
                    aria-hidden
                  />
                )}
              </button>
            );
          })}

          {/* What is inside, on hover. */}
          {peeked && peeked.preview && (
            <div
              className="pointer-events-none absolute z-20 w-48 rounded-lg border border-zinc-700/80 bg-zinc-900/95 p-2.5 text-xs shadow-2xl backdrop-blur"
              style={{
                left: Math.min(peeked.x * cell, Math.max(0, width * cell - 192)),
                top: peeked.y * cell + peeked.h * cell + 6 + 120 > height * cell + 40
                  ? Math.max(0, peeked.y * cell - 6 - Math.min(6, peeked.preview.length) * 18 - 28)
                  : peeked.y * cell + peeked.h * cell + 6,
              }}
            >
              <p className="mb-1.5 truncate font-medium text-zinc-100">{peeked.name}</p>
              {peeked.caption && <p className="-mt-1 mb-1.5 text-[10px] tabular-nums text-zinc-500">{peeked.caption}</p>}
              {peeked.preview.length === 0 && <p className="text-zinc-600">{emptyLabel}</p>}
              <ul className="space-y-0.5">
                {peeked.preview.slice(0, 6).map((line) => (
                  <li key={line.label} className={cn('flex justify-between gap-2', line.low ? 'text-red-300' : 'text-zinc-400')}>
                    <span className="truncate">{line.label}</span>
                    <span className="tabular-nums text-zinc-200">{line.quantity}</span>
                  </li>
                ))}
                {peeked.preview.length > 6 && <li className="text-zinc-600">+{peeked.preview.length - 6}</li>}
              </ul>
            </div>
          )}

          {(ghost || placeGhost) && (() => {
            const g = (ghost ?? placeGhost)!;
            const ok = ghost ? ghostOk : placeOk;
            return (
              <div
                aria-hidden
                className={cn(
                  'pointer-events-none absolute border-2 border-dashed transition-[left,top,width,height] duration-75',
                  ok ? 'border-emerald-400 bg-emerald-400/10' : 'border-red-500 bg-red-500/15',
                )}
                style={{ left: g.x * cell, top: g.y * cell, width: g.w * cell, height: g.h * cell, borderRadius: radius }}
              />
            );
          })()}
        </div>
      </div>
    </div>
      {footer}
    </div>
  );
}
