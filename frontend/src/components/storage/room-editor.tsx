'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { storageApi, apiErrorMessage } from '@/lib/api-client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { useToast } from '@/hooks/use-toast';
import { useTranslation } from '@/providers/i18n-provider';
import { cn } from '@/lib/utils';
import {
  canPlace, clipTiles, MAX_ROOM_H, MAX_ROOM_W, MAX_SIDE, MIN_ROOM, outerWalls, paint, rotated,
  type Tile,
} from '@/lib/storage-layout';
import { KIND_ICON, NEUTRAL, RoomGrid, type GridTool } from '@/components/storage/room-grid';
import { ZoomControls, fitCell } from '@/components/storage/zoom-controls';
import {
  BrickWall, Copy, DoorOpen, Eraser, Hand, Minus, MousePointer2, Plus, Redo2, RotateCw, Save, Square,
  SquareDashed, Trash2, Undo2, X,
} from 'lucide-react';
import {
  STORAGE_CONTAINER_KINDS,
  type StorageContainerInput, type StorageContainerKind, type StorageRoomDetail,
} from '@/lib/api-types';

/** A container as the editor holds it: a stable key, and how much is in it. */
interface Draft extends StorageContainerInput {
  key: string;
  /** Lines in it on the server; removing it removes those. */
  lineCount: number;
}

interface Layout {
  width: number;
  height: number;
  tiles: Tile[];
  containers: Draft[];
}

const SWATCHES = ['#ef4444', '#f97316', '#f59e0b', '#22c55e', '#14b8a6', '#3b82f6', '#6366f1', '#a855f7', '#ec4899', '#71717a'];
const HISTORY_LIMIT = 100;
/** What each kind of container is put down as. Changed afterwards like any other. */
const DEFAULT_SIZE: Record<StorageContainerKind, { w: number; h: number }> = {
  bench: { w: 2, h: 1 }, chest: { w: 1, h: 1 }, safe: { w: 1, h: 1 }, fridge: { w: 1, h: 1 },
  locker: { w: 1, h: 2 }, rack: { w: 3, h: 1 }, crate: { w: 2, h: 1 }, other: { w: 1, h: 1 },
};
let seq = 0;
const newKey = () => `new-${Date.now()}-${seq++}`;

const TOOLS: { tool: GridTool; icon: typeof Hand; key: string; label: string }[] = [
  { tool: 'select', icon: MousePointer2, key: 'V', label: 'storage.editor.select' },
  { tool: 'pan', icon: Hand, key: 'H', label: 'storage.editor.pan' },
  { tool: 'wall', icon: BrickWall, key: 'W', label: 'storage.editor.wall' },
  { tool: 'rect', icon: SquareDashed, key: 'B', label: 'storage.editor.rect' },
  { tool: 'door', icon: DoorOpen, key: 'D', label: 'storage.editor.door' },
  { tool: 'erase', icon: Eraser, key: 'E', label: 'storage.editor.erase' },
];

/**
 * Drawing a room: walls, doors, and where each container stands.
 *
 * Laid out like a design tool: a palette of containers on the left, the
 * canvas in the middle with its tools floating over it, and the selected
 * container's details on the right. Works on a copy with its own undo and
 * redo, and saves once — a half-drawn room is never what the rest of the
 * faction sees. Saving a drawing that leaves out a container with something in
 * it asks first, because the server removes what was in it too.
 */
export function RoomEditor({
  factionId,
  detail,
  onDone,
}: {
  factionId: string;
  detail: StorageRoomDetail;
  onDone: (saved: StorageRoomDetail | null) => void;
}) {
  const { t } = useTranslation();
  const { toast } = useToast();
  const canvasRef = useRef<HTMLDivElement>(null);

  const initial = useMemo<Layout>(() => ({
    width: detail.room.width,
    height: detail.room.height,
    tiles: detail.room.tiles,
    containers: detail.containers.map((c) => ({
      key: c.id,
      id: c.id,
      kind: c.kind,
      name: c.name,
      color: c.color,
      tags: c.tags,
      x: c.x, y: c.y, w: c.w, h: c.h,
      capacity: c.capacity,
      notes: c.notes,
      lineCount: c.contents.length,
    })),
  }), [detail]);

  // One state for the drawing and its history, so every change is a pure
  // update and undo can never disagree with what is on screen.
  const [history, setHistory] = useState<{ layout: Layout; past: Layout[]; future: Layout[] }>(
    { layout: initial, past: [], future: [] },
  );
  const { layout, past, future } = history;
  const [tool, setTool] = useState<GridTool>('select');
  const [placing, setPlacing] = useState<StorageContainerKind | null>(null);
  const [cell, setCell] = useState(36);
  const [selected, setSelected] = useState<string | null>(null);
  const [hoverCell, setHoverCell] = useState<{ x: number; y: number } | null>(null);
  const [size, setSize] = useState({ w: String(initial.width), h: String(initial.height) });
  const [tagDraft, setTagDraft] = useState('');
  const [confirmRemoval, setConfirmRemoval] = useState<Draft[] | null>(null);

  const dirty = past.length > 0;

  /** Every change goes through here, so undo sees all of them. */
  const commit = useCallback((next: (l: Layout) => Layout) => {
    setHistory((h) => {
      const value = next(h.layout);
      if (value === h.layout) return h;
      return { layout: value, past: [...h.past.slice(-HISTORY_LIMIT + 1), h.layout], future: [] };
    });
  }, []);

  // A stroke is one undo step, not one per cell: the snapshot is taken when it
  // starts and the cells are painted without recording.
  const startStroke = () =>
    setHistory((h) => ({ ...h, past: [...h.past.slice(-HISTORY_LIMIT + 1), h.layout], future: [] }));
  const paintCell = (x: number, y: number) => {
    const kind = tool === 'wall' ? 'wall' : tool === 'door' ? 'door' : null;
    setHistory((h) => ({ ...h, layout: { ...h.layout, tiles: paint(h.layout.tiles, x, y, kind, h.layout.containers) } }));
  };
  const paintRect = (a: { x: number; y: number }, b: { x: number; y: number }) => {
    const [x0, x1] = [Math.min(a.x, b.x), Math.max(a.x, b.x)];
    const [y0, y1] = [Math.min(a.y, b.y), Math.max(a.y, b.y)];
    setHistory((h) => {
      let tiles = h.layout.tiles;
      for (let x = x0; x <= x1; x++) {
        for (let y = y0; y <= y1; y++) {
          const edge = x === x0 || x === x1 || y === y0 || y === y1;
          if (!edge || tiles.some((t) => t.x === x && t.y === y)) continue;
          tiles = paint(tiles, x, y, 'wall', h.layout.containers);
        }
      }
      return { ...h, layout: { ...h.layout, tiles } };
    });
  };

  const undo = useCallback(() => setHistory((h) => (h.past.length === 0 ? h : {
    layout: h.past[h.past.length - 1]!,
    past: h.past.slice(0, -1),
    future: [h.layout, ...h.future],
  })), []);

  const redo = useCallback(() => setHistory((h) => (h.future.length === 0 ? h : {
    layout: h.future[0]!,
    past: [...h.past, h.layout],
    future: h.future.slice(1),
  })), []);

  const box = layout.containers.find((c) => c.key === selected) ?? null;

  const update = (key: string, patch: Partial<Draft>) =>
    commit((l) => ({ ...l, containers: l.containers.map((c) => (c.key === key ? { ...c, ...patch } : c)) }));

  const pick = (kind: StorageContainerKind) => {
    if (placing === kind) {
      setPlacing(null);
      setTool('select');
      return;
    }
    setPlacing(kind);
    setTool('place');
    setSelected(null);
  };

  const place = (x: number, y: number) => {
    if (!placing) return;
    const { w, h } = DEFAULT_SIZE[placing];
    if (!canPlace({ x, y, w, h }, layout, layout.containers)) {
      toast({ title: t('storage.editor.cannotPlace'), variant: 'destructive' });
      return;
    }
    const count = layout.containers.filter((c) => c.kind === placing).length + 1;
    const draft: Draft = {
      key: newKey(), kind: placing, name: `${t(`storage.kind.${placing}` as never)} ${count}`,
      color: null, tags: [], x, y, w, h, capacity: null, notes: null, lineCount: 0,
    };
    commit((l) => ({ ...l, containers: [...l.containers, draft] }));
    setSelected(draft.key);
    setPlacing(null);
    setTool('select');
  };

  const rotate = useCallback((key: string) => {
    const target = layout.containers.find((c) => c.key === key);
    if (!target) return;
    const next = rotated(target);
    if (!canPlace(next, layout, layout.containers, key)) {
      toast({ title: t('storage.editor.cannotRotate'), variant: 'destructive' });
      return;
    }
    commit((l) => ({ ...l, containers: l.containers.map((c) => (c.key === key ? next : c)) }));
  }, [commit, layout, t, toast]);

  const resizeBy = (key: string, dw: number, dh: number) => {
    const target = layout.containers.find((c) => c.key === key);
    if (!target) return;
    const next = { ...target, w: Math.min(MAX_SIDE, Math.max(1, target.w + dw)), h: Math.min(MAX_SIDE, Math.max(1, target.h + dh)) };
    if (next.w === target.w && next.h === target.h) return;
    if (!canPlace(next, layout, layout.containers, key)) {
      toast({ title: t('storage.editor.cannotPlace'), variant: 'destructive' });
      return;
    }
    update(key, { w: next.w, h: next.h });
  };

  const remove = useCallback((key: string) => {
    commit((l) => ({ ...l, containers: l.containers.filter((c) => c.key !== key) }));
    setSelected(null);
  }, [commit]);

  const duplicate = (key: string) => {
    const source = layout.containers.find((c) => c.key === key);
    if (!source) return;
    // Next to the original if it fits there, otherwise the first free spot.
    const candidates = [
      { x: source.x + source.w, y: source.y }, { x: source.x, y: source.y + source.h },
      { x: source.x - source.w, y: source.y }, { x: source.x, y: source.y - source.h },
    ];
    let spot = candidates.find((p) => canPlace({ ...p, w: source.w, h: source.h }, layout, layout.containers));
    if (!spot) {
      for (let y = 0; y + source.h <= layout.height && !spot; y++) {
        for (let x = 0; x + source.w <= layout.width && !spot; x++) {
          if (canPlace({ x, y, w: source.w, h: source.h }, layout, layout.containers)) spot = { x, y };
        }
      }
    }
    if (!spot) {
      toast({ title: t('storage.editor.noRoom'), variant: 'destructive' });
      return;
    }
    const copy: Draft = { ...source, key: newKey(), id: undefined, ...spot, name: `${source.name} (2)`, lineCount: 0 };
    commit((l) => ({ ...l, containers: [...l.containers, copy] }));
    setSelected(copy.key);
  };

  const applySize = () => {
    const w = Math.round(Number(size.w));
    const h = Math.round(Number(size.h));
    if (!(w >= MIN_ROOM && w <= MAX_ROOM_W && h >= MIN_ROOM && h <= MAX_ROOM_H)) {
      toast({ title: t('storage.editor.sizeRange', { maxW: MAX_ROOM_W, maxH: MAX_ROOM_H, min: MIN_ROOM }), variant: 'destructive' });
      return;
    }
    const outside = layout.containers.filter((c) => c.x + c.w > w || c.y + c.h > h);
    if (outside.length > 0) {
      toast({ title: t('storage.editor.wouldCut', { names: outside.map((c) => c.name).join(', ') }), variant: 'destructive' });
      return;
    }
    commit((l) => ({ ...l, width: w, height: h, tiles: clipTiles(l.tiles, w, h) }));
  };

  const addOuterWalls = () => commit((l) => {
    let tiles = l.tiles;
    for (const wall of outerWalls(l.width, l.height)) {
      if (!tiles.some((t) => t.x === wall.x && t.y === wall.y)) tiles = paint(tiles, wall.x, wall.y, 'wall', l.containers);
    }
    return { ...l, tiles };
  });

  const clearWalls = () => commit((l) => (l.tiles.length === 0 ? l : { ...l, tiles: [] }));

  const zoom = useCallback((direction: 1 | -1) => setCell((c) => Math.min(64, Math.max(16, c + direction * 4))), []);
  const fit = useCallback(() => {
    if (canvasRef.current) setCell(fitCell(canvasRef.current, layout.width, layout.height));
  }, [layout.width, layout.height]);

  // Start fitted to the space there is.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { fit(); }, []);

  const chooseTool = useCallback((next: GridTool) => {
    setPlacing(null);
    setTool(next);
  }, []);

  // Keyboard: tools, undo/redo, rotate, delete, zoom. Ignored while typing.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null;
      if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable)) return;
      const mod = e.ctrlKey || e.metaKey;
      const key = e.key.toLowerCase();
      if (mod && key === 'z') {
        e.preventDefault();
        if (e.shiftKey) redo(); else undo();
      } else if (mod && key === 'y') {
        e.preventDefault();
        redo();
      } else if (mod && key === 'd' && selected) {
        e.preventDefault();
        duplicate(selected);
      } else if (mod) {
        return;
      } else if (selected && (e.key === 'Delete' || e.key === 'Backspace')) {
        e.preventDefault();
        remove(selected);
      } else if (selected && key === 'r') {
        rotate(selected);
      } else if (e.key === 'Escape') {
        if (placing) chooseTool('select'); else setSelected(null);
      } else if (e.key === '+' || e.key === '=') {
        zoom(1);
      } else if (e.key === '-') {
        zoom(-1);
      } else if (e.key === '0') {
        fit();
      } else {
        const match = TOOLS.find((x) => x.key.toLowerCase() === key);
        if (match) chooseTool(match.tool);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  const save = useMutation({
    mutationFn: () => storageApi.saveLayout(factionId, detail.room.id, {
      width: layout.width,
      height: layout.height,
      tiles: layout.tiles,
      containers: layout.containers.map(({ key: _key, lineCount: _lines, ...c }) => ({
        ...c,
        name: c.name.trim() || t('storage.kind.other'),
        capacity: c.capacity && c.capacity.trim() ? c.capacity.trim() : null,
        notes: c.notes && c.notes.trim() ? c.notes : null,
      })),
    }),
    onSuccess: (saved) => {
      toast({ title: t('storage.editor.saved') });
      onDone(saved);
    },
    onError: (err) => toast({ title: t('common.failed'), description: apiErrorMessage(err), variant: 'destructive' }),
  });

  const trySave = () => {
    const keptIds = new Set(layout.containers.map((c) => c.id).filter(Boolean));
    const lost = initial.containers.filter((c) => c.id && !keptIds.has(c.id) && c.lineCount > 0);
    if (lost.length > 0) setConfirmRemoval(lost);
    else save.mutate();
  };

  const capacityOk = !box?.capacity || /^\d{1,13}(\.\d{1,2})?$/.test(box.capacity.trim());
  const addTag = () => {
    if (!box) return;
    const tag = tagDraft.trim();
    if (!tag || box.tags.includes(tag) || box.tags.length >= 10) { setTagDraft(''); return; }
    update(box.key, { tags: [...box.tags, tag.slice(0, 30)] });
    setTagDraft('');
  };

  return (
    <div className="space-y-3">
      {/* Header: what is being edited, history, and the way out. */}
      <div className="flex flex-wrap items-center gap-2 rounded-xl border border-zinc-800 bg-zinc-900/60 px-3 py-2">
        <div className="mr-auto flex min-w-0 items-center gap-2">
          <span className="text-xs uppercase tracking-wider text-zinc-500">{t('storage.editor.editing')}</span>
          <span className="truncate text-sm font-medium text-zinc-100">{detail.room.name}</span>
          {dirty && (
            <span className="flex items-center gap-1 rounded-full bg-amber-500/10 px-2 py-0.5 text-[10px] text-amber-300">
              <span className="size-1.5 rounded-full bg-amber-400" />{t('storage.editor.unsaved')}
            </span>
          )}
        </div>
        <Button size="icon-sm" variant="ghost" onClick={undo} disabled={past.length === 0} aria-label={t('storage.editor.undo')} title={t('storage.editor.undo')}>
          <Undo2 className="h-4 w-4" />
        </Button>
        <Button size="icon-sm" variant="ghost" onClick={redo} disabled={future.length === 0} aria-label={t('storage.editor.redo')} title={t('storage.editor.redo')}>
          <Redo2 className="h-4 w-4" />
        </Button>
        <span className="mx-1 h-5 w-px bg-zinc-800" />
        <Button size="sm" variant="ghost" onClick={() => onDone(null)}>
          <X className="mr-1.5 h-3.5 w-3.5" />{t('common.cancel')}
        </Button>
        <Button size="sm" onClick={trySave} disabled={!dirty || save.isPending}>
          <Save className="mr-1.5 h-3.5 w-3.5" />{t('common.save')}
        </Button>
      </div>

      {/* Wide screens: palette, canvas, inspector side by side. Narrower:
          the palette becomes a strip over the canvas and the inspector goes
          underneath, so the canvas always gets the width. */}
      <div className="grid gap-3 xl:grid-cols-[11rem_minmax(0,1fr)_16.5rem]">
        {/* Palette */}
        <aside className="grid gap-4 rounded-xl border border-zinc-800 bg-zinc-900/40 p-3 lg:grid-cols-[minmax(0,1fr)_16rem] xl:block xl:space-y-4">
          <section className="space-y-2">
            <p className="text-[11px] font-medium uppercase tracking-wider text-zinc-500">{t('storage.editor.palette')}</p>
            <div className="grid grid-cols-4 gap-1.5 sm:grid-cols-8 xl:grid-cols-2">
              {STORAGE_CONTAINER_KINDS.map((kind) => {
                const Icon = KIND_ICON[kind] ?? Square;
                const on = placing === kind;
                const { w, h } = DEFAULT_SIZE[kind];
                return (
                  <button
                    key={kind}
                    type="button"
                    onClick={() => pick(kind)}
                    aria-pressed={on}
                    className={cn(
                      'flex flex-col items-center gap-1 rounded-lg border px-1 py-2 text-[11px] transition-colors',
                      on
                        ? 'border-[var(--brand-color)] bg-[var(--brand-color-light)] text-zinc-100'
                        : 'border-zinc-800 bg-zinc-900/60 text-zinc-400 hover:border-zinc-700 hover:text-zinc-200',
                    )}
                  >
                    <span className="flex size-7 items-center justify-center rounded-md bg-zinc-800/80"><Icon className="h-4 w-4" /></span>
                    <span className="truncate">{t(`storage.kind.${kind}` as never)}</span>
                    <span className="text-[9px] tabular-nums text-zinc-600">{w}×{h}</span>
                  </button>
                );
              })}
            </div>
            <p className="text-[11px] leading-snug text-zinc-500">
              {placing ? t('storage.editor.placeHint') : t('storage.editor.paletteHint')}
            </p>
          </section>

          <section className="space-y-2 border-zinc-800 lg:border-l lg:pl-4 xl:border-l-0 xl:border-t xl:pl-0 xl:pt-3">
            <p className="text-[11px] font-medium uppercase tracking-wider text-zinc-500">{t('storage.editor.room')}</p>
            <div className="grid grid-cols-[1fr_auto_1fr] items-end gap-1.5">
              <label className="min-w-0 space-y-1 text-[11px] text-zinc-500">
                <span>{t('storage.width')}</span>
                <Input className="h-8 w-full" inputMode="numeric" value={size.w} onChange={(e) => setSize((s) => ({ ...s, w: e.target.value }))} />
              </label>
              <span className="pb-2 text-zinc-600">×</span>
              <label className="min-w-0 space-y-1 text-[11px] text-zinc-500">
                <span>{t('storage.height')}</span>
                <Input className="h-8 w-full" inputMode="numeric" value={size.h} onChange={(e) => setSize((s) => ({ ...s, h: e.target.value }))} />
              </label>
            </div>
            <Button size="sm" variant="outline" className="w-full" onClick={applySize}
              disabled={size.w === String(layout.width) && size.h === String(layout.height)}>
              {t('storage.editor.resize')}
            </Button>
            <div className="grid gap-1.5">
              <Button size="sm" variant="outline" className="justify-start overflow-hidden" onClick={addOuterWalls}>
                <BrickWall className="mr-1.5 h-3.5 w-3.5" />{t('storage.editor.outerWalls')}
              </Button>
              <Button size="sm" variant="ghost" className="justify-start overflow-hidden text-zinc-400" onClick={clearWalls} disabled={layout.tiles.length === 0}>
                <Eraser className="mr-1.5 h-3.5 w-3.5 shrink-0" /><span className="truncate">{t('storage.editor.clearWalls')}</span>
              </Button>
            </div>
          </section>
        </aside>

        {/* Canvas */}
        <div ref={canvasRef} className="min-w-0">
          <RoomGrid
            width={layout.width}
            height={layout.height}
            tiles={layout.tiles}
            containers={layout.containers.map((c) => ({
              key: c.key, kind: c.kind, name: c.name, color: c.color,
              x: c.x, y: c.y, w: c.w, h: c.h, fill: null, low: false, dim: false, hit: false,
              caption: c.capacity ? t('storage.editor.holdsCaption', { n: c.capacity }) : undefined,
            }))}
            cell={cell}
            editing
            tool={tool}
            selectedKey={selected}
            placing={placing ? { kind: placing, ...DEFAULT_SIZE[placing], color: null } : null}
            onSelect={setSelected}
            onPaintStart={startStroke}
            onPaint={paintCell}
            onRect={paintRect}
            onPlace={place}
            onMove={(key, x, y) => update(key, { x, y })}
            onResize={(key, w, h) => update(key, { w, h })}
            onHoverCell={setHoverCell}
            onZoom={zoom}
            overlay={
              <>
                {/* The tool dock, floating over the top of the canvas. */}
                <div className="absolute left-1/2 top-3 z-10 flex -translate-x-1/2 items-center gap-0.5 rounded-full border border-zinc-700/70 bg-zinc-900/90 p-1 shadow-xl backdrop-blur" role="toolbar" aria-label={t('storage.editor.tool')}>
                  {TOOLS.map(({ tool: value, icon: Icon, key, label }) => (
                    <button
                      key={value}
                      type="button"
                      onClick={() => chooseTool(value)}
                      aria-pressed={tool === value}
                      aria-label={t(label as never)}
                      title={`${t(label as never)} (${key})`}
                      className={cn(
                        'relative flex size-8 items-center justify-center rounded-full transition-colors pointer-coarse:size-10',
                        tool === value ? 'bg-[var(--brand-color)] text-white shadow' : 'text-zinc-400 hover:bg-zinc-800 hover:text-zinc-100',
                      )}
                    >
                      <Icon className="h-4 w-4" />
                    </button>
                  ))}
                </div>
                <ZoomControls cell={cell} onZoom={zoom} onFit={fit} />
              </>
            }
            footer={
              <div className="flex flex-wrap items-center gap-x-4 gap-y-1 border-t border-zinc-800/80 bg-zinc-900/60 px-3 py-1.5 text-[11px] text-zinc-500">
                <span className="tabular-nums">{layout.width} × {layout.height}</span>
                <span>{t('storage.editor.containerCount', { count: layout.containers.length })}</span>
                <span className="tabular-nums">{hoverCell ? `x ${hoverCell.x + 1} · y ${hoverCell.y + 1}` : '—'}</span>
                <span className="ml-auto hidden sm:inline">{t(`storage.editor.hint.${tool}` as never)}</span>
              </div>
            }
          />
        </div>

        {/* Inspector */}
        <aside className="rounded-xl border border-zinc-800 bg-zinc-900/40 p-3">
          {box ? (
            <div className="space-y-4">
              <div className="flex items-center gap-2">
                <span
                  className="flex size-9 shrink-0 items-center justify-center rounded-lg"
                  style={{ backgroundColor: `${box.color ?? NEUTRAL}30`, color: box.color ?? NEUTRAL }}
                >
                  {(() => { const Icon = KIND_ICON[box.kind] ?? Square; return <Icon className="h-5 w-5" />; })()}
                </span>
                <Input
                  value={box.name}
                  maxLength={80}
                  onChange={(e) => update(box.key, { name: e.target.value })}
                  aria-label={t('storage.name')}
                  className="h-9 font-medium"
                />
              </div>

              <div className="grid grid-cols-3 gap-1.5">
                {[
                  { icon: RotateCw, label: t('storage.editor.rotate'), key: 'R', run: () => rotate(box.key), danger: false },
                  { icon: Copy, label: t('storage.editor.duplicate'), key: 'Ctrl+D', run: () => duplicate(box.key), danger: false },
                  { icon: Trash2, label: t('common.remove'), key: 'Del', run: () => remove(box.key), danger: true },
                ].map(({ icon: Icon, label, key, run, danger }) => (
                  <button
                    key={key}
                    type="button"
                    onClick={run}
                    title={`${label} (${key})`}
                    className={cn(
                      'flex min-w-0 flex-col items-center gap-1 rounded-lg border border-zinc-800 bg-zinc-900/60 px-1 py-2 text-[10px] transition-colors',
                      danger ? 'text-red-300 hover:border-red-500/40 hover:bg-red-500/10' : 'text-zinc-300 hover:border-zinc-700 hover:bg-zinc-800',
                    )}
                  >
                    <Icon className="h-4 w-4" />
                    <span className="max-w-full truncate">{label}</span>
                  </button>
                ))}
              </div>

              <div className="space-y-1.5">
                <Label className="text-[11px] uppercase tracking-wider text-zinc-500">{t('storage.kind')}</Label>
                <div className="grid grid-cols-4 gap-1">
                  {STORAGE_CONTAINER_KINDS.map((k) => {
                    const Icon = KIND_ICON[k] ?? Square;
                    return (
                      <button
                        key={k}
                        type="button"
                        onClick={() => update(box.key, { kind: k })}
                        aria-pressed={box.kind === k}
                        title={t(`storage.kind.${k}` as never)}
                        aria-label={t(`storage.kind.${k}` as never)}
                        className={cn(
                          'flex h-9 items-center justify-center rounded-md border transition-colors',
                          box.kind === k ? 'border-[var(--brand-color)] bg-[var(--brand-color-light)] text-zinc-100' : 'border-zinc-800 text-zinc-500 hover:text-zinc-200',
                        )}
                      >
                        <Icon className="h-4 w-4" />
                      </button>
                    );
                  })}
                </div>
              </div>

              <div className="space-y-1.5">
                <Label className="text-[11px] uppercase tracking-wider text-zinc-500">{t('storage.color')}</Label>
                <div className="flex flex-wrap gap-1.5">
                  <button
                    type="button"
                    onClick={() => update(box.key, { color: null })}
                    className={cn('size-6 rounded-full border border-dashed border-zinc-600 bg-zinc-900', box.color === null && 'ring-2 ring-zinc-200 ring-offset-2 ring-offset-zinc-950')}
                    aria-label={t('storage.noColor')}
                  />
                  {SWATCHES.map((color) => (
                    <button
                      key={color}
                      type="button"
                      onClick={() => update(box.key, { color })}
                      className={cn('size-6 rounded-full shadow-inner transition-transform hover:scale-110', box.color === color && 'ring-2 ring-zinc-100 ring-offset-2 ring-offset-zinc-950')}
                      style={{ backgroundColor: color }}
                      aria-label={color}
                    />
                  ))}
                </div>
              </div>

              <div className="grid grid-cols-2 gap-2">
                {(['w', 'h'] as const).map((side) => (
                  <div key={side} className="space-y-1.5">
                    <Label className="text-[11px] uppercase tracking-wider text-zinc-500">{side === 'w' ? t('storage.width') : t('storage.height')}</Label>
                    <div className="flex items-center rounded-md border border-zinc-800">
                      <button type="button" className="flex size-8 items-center justify-center text-zinc-400 hover:text-zinc-100" onClick={() => resizeBy(box.key, side === 'w' ? -1 : 0, side === 'h' ? -1 : 0)} aria-label="−">
                        <Minus className="h-3.5 w-3.5" />
                      </button>
                      <span className="flex-1 text-center text-sm tabular-nums text-zinc-100">{box[side]}</span>
                      <button type="button" className="flex size-8 items-center justify-center text-zinc-400 hover:text-zinc-100" onClick={() => resizeBy(box.key, side === 'w' ? 1 : 0, side === 'h' ? 1 : 0)} aria-label="+">
                        <Plus className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  </div>
                ))}
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="sc-cap" className="text-[11px] uppercase tracking-wider text-zinc-500">{t('storage.capacity')}</Label>
                <Input
                  id="sc-cap"
                  inputMode="decimal"
                  value={box.capacity ?? ''}
                  placeholder={t('storage.noLimit')}
                  className={cn(!capacityOk && 'border-red-500/60')}
                  onChange={(e) => update(box.key, { capacity: e.target.value || null })}
                />
                <p className="text-[11px] text-zinc-500">{t('storage.capacityHint')}</p>
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="sc-tag" className="text-[11px] uppercase tracking-wider text-zinc-500">{t('storage.tags')}</Label>
                {box.tags.length > 0 && (
                  <div className="flex flex-wrap gap-1">
                    {box.tags.map((tag) => (
                      <span key={tag} className="flex items-center gap-1 rounded-full border border-zinc-700 bg-zinc-800/60 py-0.5 pl-2 pr-1 text-[11px] text-zinc-300">
                        {tag}
                        <button type="button" onClick={() => update(box.key, { tags: box.tags.filter((x) => x !== tag) })} aria-label={`${t('common.remove')} ${tag}`} className="rounded-full p-0.5 hover:bg-zinc-700">
                          <X className="h-2.5 w-2.5" />
                        </button>
                      </span>
                    ))}
                  </div>
                )}
                <Input
                  id="sc-tag"
                  value={tagDraft}
                  placeholder={t('storage.editor.tagPlaceholder')}
                  onChange={(e) => setTagDraft(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ',') { e.preventDefault(); addTag(); } }}
                  onBlur={addTag}
                />
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="sc-notes" className="text-[11px] uppercase tracking-wider text-zinc-500">{t('storage.notes')}</Label>
                <Textarea
                  id="sc-notes"
                  rows={2}
                  key={`${box.key}-notes`}
                  defaultValue={box.notes ?? ''}
                  onBlur={(e) => update(box.key, { notes: e.target.value || null })}
                />
              </div>
              {box.lineCount > 0 && (
                <p className="rounded-md bg-zinc-800/50 px-2 py-1.5 text-[11px] text-zinc-400">{t('storage.editor.holdsLines', { count: box.lineCount })}</p>
              )}
            </div>
          ) : (
            <div className="space-y-3">
              <p className="text-sm font-medium text-zinc-200">{t('storage.editor.noSelection')}</p>
              <p className="text-xs text-zinc-500">{t('storage.editor.noSelectionHint')}</p>
              <ul className="space-y-1.5 text-[11px] text-zinc-500">
                {[
                  ['V', 'storage.editor.select'], ['H', 'storage.editor.pan'], ['W', 'storage.editor.wall'],
                  ['B', 'storage.editor.rect'], ['D', 'storage.editor.door'], ['E', 'storage.editor.erase'],
                  ['R', 'storage.editor.rotate'], ['Shift', 'storage.editor.straight'], ['Ctrl+Z', 'storage.editor.undoShort'],
                  ['0', 'storage.editor.fit'],
                ].map(([k, label]) => (
                  <li key={k} className="flex items-center justify-between gap-2">
                    <span>{t(label as never)}</span>
                    <kbd className="rounded border border-zinc-700 bg-zinc-800 px-1.5 py-0.5 font-mono text-[10px] text-zinc-300">{k}</kbd>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </aside>
      </div>

      <AlertDialog open={!!confirmRemoval} onOpenChange={(open) => !open && setConfirmRemoval(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t('storage.editor.removeTitle')}</AlertDialogTitle>
            <AlertDialogDescription>
              {t('storage.editor.removeBody', { names: (confirmRemoval ?? []).map((c) => c.name).join(', ') })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t('common.cancel')}</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => { setConfirmRemoval(null); save.mutate(); }}
              className="bg-red-600 hover:bg-red-500"
            >
              {t('storage.editor.removeAndSave')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
