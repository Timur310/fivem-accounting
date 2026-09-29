'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { storageApi, apiErrorMessage } from '@/lib/api-client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Segmented } from '@/components/ui/segmented';
import { Card, CardContent } from '@/components/ui/card';
import { SearchableSelect } from '@/components/ui/searchable-select';
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { useToast } from '@/hooks/use-toast';
import { useTranslation } from '@/providers/i18n-provider';
import { cn } from '@/lib/utils';
import {
  canPlace, clipTiles, firstFreeSpot, MAX_ROOM_H, MAX_ROOM_W, MIN_ROOM, outerWalls, paint, rotated,
  type Tile,
} from '@/lib/storage-layout';
import { KIND_ICON, RoomGrid, type GridTool } from '@/components/storage/room-grid';
import {
  BrickWall, Copy, DoorOpen, Eraser, MousePointer2, Plus, Redo2, RotateCw, Save, Square, Trash2, Undo2, X, ZoomIn, ZoomOut,
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

const SWATCHES = ['#ef4444', '#f59e0b', '#22c55e', '#3b82f6', '#a855f7', '#ec4899', '#14b8a6', '#71717a'];
const HISTORY_LIMIT = 100;
let seq = 0;
const newKey = () => `new-${Date.now()}-${seq++}`;

/**
 * Drawing a room: walls, doors, and where each container stands.
 *
 * Works on a copy with its own undo and redo, and saves once — so a half-drawn
 * room is never what the rest of the faction sees, and a mis-drag is one
 * Ctrl+Z away. Saving a drawing that leaves out a container with something in
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
  const [cell, setCell] = useState(36);
  const [selected, setSelected] = useState<string | null>(null);
  const [size, setSize] = useState({ w: String(initial.width), h: String(initial.height) });
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

  // A paint stroke is one undo step, not one per cell: the snapshot is taken
  // when the stroke starts and the cells are painted without recording.
  const startStroke = () =>
    setHistory((h) => ({ ...h, past: [...h.past.slice(-HISTORY_LIMIT + 1), h.layout], future: [] }));
  const paintCell = (x: number, y: number) => {
    const kind = tool === 'wall' ? 'wall' : tool === 'door' ? 'door' : null;
    setHistory((h) => ({ ...h, layout: { ...h.layout, tiles: paint(h.layout.tiles, x, y, kind, h.layout.containers) } }));
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

  const addContainer = (kind: StorageContainerKind) => {
    const w = kind === 'bench' || kind === 'rack' ? 2 : 1;
    const spot = firstFreeSpot(w, 1, layout, layout.containers) ?? firstFreeSpot(1, 1, layout, layout.containers);
    if (!spot) {
      toast({ title: t('storage.editor.noRoom'), variant: 'destructive' });
      return;
    }
    const fits = canPlace({ ...spot, w, h: 1 }, layout, layout.containers);
    const count = layout.containers.filter((c) => c.kind === kind).length + 1;
    const draft: Draft = {
      key: newKey(),
      kind,
      name: `${t(`storage.kind.${kind}` as never)} ${count}`,
      color: null,
      tags: [],
      x: spot.x, y: spot.y, w: fits ? w : 1, h: 1,
      capacity: null,
      notes: null,
      lineCount: 0,
    };
    commit((l) => ({ ...l, containers: [...l.containers, draft] }));
    setSelected(draft.key);
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

  const remove = useCallback((key: string) => {
    commit((l) => ({ ...l, containers: l.containers.filter((c) => c.key !== key) }));
    setSelected(null);
  }, [commit]);

  const duplicate = (key: string) => {
    const source = layout.containers.find((c) => c.key === key);
    if (!source) return;
    const spot = firstFreeSpot(source.w, source.h, layout, layout.containers);
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

  // Keyboard: undo/redo, rotate, delete. Ignored while typing in a field.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null;
      if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable)) return;
      const mod = e.ctrlKey || e.metaKey;
      if (mod && e.key.toLowerCase() === 'z') {
        e.preventDefault();
        if (e.shiftKey) redo(); else undo();
      } else if (mod && e.key.toLowerCase() === 'y') {
        e.preventDefault();
        redo();
      } else if (selected && (e.key === 'Delete' || e.key === 'Backspace')) {
        e.preventDefault();
        remove(selected);
      } else if (selected && e.key.toLowerCase() === 'r') {
        rotate(selected);
      } else if (e.key === 'Escape') {
        setSelected(null);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [selected, undo, redo, remove, rotate]);

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

  return (
    <div className="space-y-3">
      {/* Toolbar */}
      <Card>
        <CardContent className="flex flex-wrap items-center gap-2 py-3">
          <Segmented
            label={t('storage.editor.tool')}
            value={tool}
            onChange={setTool}
            options={[
              { value: 'select', label: t('storage.editor.select'), icon: <MousePointer2 className="h-3.5 w-3.5" /> },
              { value: 'wall', label: t('storage.editor.wall'), icon: <BrickWall className="h-3.5 w-3.5" /> },
              { value: 'door', label: t('storage.editor.door'), icon: <DoorOpen className="h-3.5 w-3.5" /> },
              { value: 'erase', label: t('storage.editor.erase'), icon: <Eraser className="h-3.5 w-3.5" /> },
            ]}
          />
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button size="sm"><Plus className="mr-1.5 h-3.5 w-3.5" />{t('storage.editor.addContainer')}</Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start">
              {STORAGE_CONTAINER_KINDS.map((kind) => {
                const Icon = KIND_ICON[kind] ?? Square;
                return (
                  <DropdownMenuItem key={kind} onSelect={() => addContainer(kind)}>
                    <Icon className="mr-2 h-4 w-4" /> {t(`storage.kind.${kind}` as never)}
                  </DropdownMenuItem>
                );
              })}
            </DropdownMenuContent>
          </DropdownMenu>
          <div className="flex items-center gap-1">
            <Button size="icon-sm" variant="ghost" onClick={undo} disabled={past.length === 0} aria-label={t('storage.editor.undo')} title={t('storage.editor.undo')}>
              <Undo2 className="h-4 w-4" />
            </Button>
            <Button size="icon-sm" variant="ghost" onClick={redo} disabled={future.length === 0} aria-label={t('storage.editor.redo')} title={t('storage.editor.redo')}>
              <Redo2 className="h-4 w-4" />
            </Button>
            <Button size="icon-sm" variant="ghost" onClick={() => setCell((c) => Math.max(20, c - 6))} aria-label={t('storage.zoomOut')}>
              <ZoomOut className="h-4 w-4" />
            </Button>
            <Button size="icon-sm" variant="ghost" onClick={() => setCell((c) => Math.min(64, c + 6))} aria-label={t('storage.zoomIn')}>
              <ZoomIn className="h-4 w-4" />
            </Button>
          </div>
          <div className="ml-auto flex items-center gap-2">
            <Button size="sm" variant="outline" onClick={() => onDone(null)}>
              <X className="mr-1.5 h-3.5 w-3.5" />{t('common.cancel')}
            </Button>
            <Button size="sm" onClick={trySave} disabled={!dirty || save.isPending}>
              <Save className="mr-1.5 h-3.5 w-3.5" />{t('common.save')}
            </Button>
          </div>
        </CardContent>
      </Card>

      <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_18rem]">
        <RoomGrid
          width={layout.width}
          height={layout.height}
          tiles={layout.tiles}
          containers={layout.containers.map((c) => ({
            key: c.key, kind: c.kind, name: c.name, color: c.color,
            x: c.x, y: c.y, w: c.w, h: c.h, fill: null, low: false, dim: false, hit: false,
          }))}
          cell={cell}
          editing
          tool={tool}
          selectedKey={selected}
          onSelect={setSelected}
          onPaintStart={startStroke}
          onPaint={paintCell}
          onMove={(key, x, y) => update(key, { x, y })}
          onResize={(key, w, h) => update(key, { w, h })}
        />

        {/* Properties: the selected container, or the room itself. */}
        <Card>
          <CardContent className="space-y-3 py-4">
            {box ? (
              <>
                <div className="flex items-center justify-between gap-2">
                  <p className="text-sm font-medium text-zinc-100">{t('storage.editor.container')}</p>
                  <div className="flex gap-1">
                    <Button size="icon-sm" variant="ghost" onClick={() => rotate(box.key)} aria-label={t('storage.editor.rotate')} title={`${t('storage.editor.rotate')} (R)`}>
                      <RotateCw className="h-4 w-4" />
                    </Button>
                    <Button size="icon-sm" variant="ghost" onClick={() => duplicate(box.key)} aria-label={t('storage.editor.duplicate')} title={t('storage.editor.duplicate')}>
                      <Copy className="h-4 w-4" />
                    </Button>
                    <Button size="icon-sm" variant="ghost" onClick={() => remove(box.key)} aria-label={t('common.remove')} title={`${t('common.remove')} (Del)`}>
                      <Trash2 className="h-4 w-4 text-red-400" />
                    </Button>
                  </div>
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="sc-name">{t('storage.name')}</Label>
                  <Input id="sc-name" value={box.name} maxLength={80} onChange={(e) => update(box.key, { name: e.target.value })} />
                </div>
                <div className="space-y-1.5">
                  <Label>{t('storage.kind')}</Label>
                  <SearchableSelect
                    value={box.kind}
                    onValueChange={(kind) => update(box.key, { kind: kind as StorageContainerKind })}
                    options={STORAGE_CONTAINER_KINDS.map((k) => ({ value: k, label: t(`storage.kind.${k}` as never) }))}
                    aria-label={t('storage.kind')}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label>{t('storage.color')}</Label>
                  <div className="flex flex-wrap gap-1.5">
                    <button
                      type="button"
                      onClick={() => update(box.key, { color: null })}
                      className={cn('size-6 rounded-full border border-zinc-700 bg-zinc-900', box.color === null && 'ring-2 ring-zinc-300')}
                      aria-label={t('storage.noColor')}
                    />
                    {SWATCHES.map((color) => (
                      <button
                        key={color}
                        type="button"
                        onClick={() => update(box.key, { color })}
                        className={cn('size-6 rounded-full', box.color === color && 'ring-2 ring-zinc-100 ring-offset-2 ring-offset-zinc-950')}
                        style={{ backgroundColor: color }}
                        aria-label={color}
                      />
                    ))}
                  </div>
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="sc-tags">{t('storage.tags')}</Label>
                  <Input
                    id="sc-tags"
                    defaultValue={box.tags.join(', ')}
                    key={`${box.key}-tags`}
                    placeholder={t('storage.tagsPlaceholder')}
                    onBlur={(e) => update(box.key, {
                      tags: [...new Set(e.target.value.split(',').map((s) => s.trim()).filter(Boolean))].slice(0, 10),
                    })}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="sc-cap">{t('storage.capacity')}</Label>
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
                  <Label htmlFor="sc-notes">{t('storage.notes')}</Label>
                  <Textarea
                    id="sc-notes"
                    rows={2}
                    key={`${box.key}-notes`}
                    defaultValue={box.notes ?? ''}
                    onBlur={(e) => update(box.key, { notes: e.target.value || null })}
                  />
                </div>
                {box.lineCount > 0 && (
                  <p className="text-[11px] text-zinc-500">{t('storage.editor.holdsLines', { count: box.lineCount })}</p>
                )}
              </>
            ) : (
              <>
                <p className="text-sm font-medium text-zinc-100">{t('storage.editor.room')}</p>
                <div className="flex items-end gap-2">
                  <div className="space-y-1.5">
                    <Label htmlFor="sr-w">{t('storage.width')}</Label>
                    <Input id="sr-w" className="w-20" inputMode="numeric" value={size.w} onChange={(e) => setSize((s) => ({ ...s, w: e.target.value }))} />
                  </div>
                  <span className="pb-2 text-zinc-500">×</span>
                  <div className="space-y-1.5">
                    <Label htmlFor="sr-h">{t('storage.height')}</Label>
                    <Input id="sr-h" className="w-20" inputMode="numeric" value={size.h} onChange={(e) => setSize((s) => ({ ...s, h: e.target.value }))} />
                  </div>
                  <Button size="sm" variant="outline" onClick={applySize}>{t('wages.apply')}</Button>
                </div>
                <Button size="sm" variant="outline" onClick={addOuterWalls}>
                  <BrickWall className="mr-1.5 h-3.5 w-3.5" />{t('storage.editor.outerWalls')}
                </Button>
                <ul className="list-disc space-y-1 pl-4 text-[11px] text-zinc-500">
                  <li>{t('storage.editor.tipPaint')}</li>
                  <li>{t('storage.editor.tipDrag')}</li>
                  <li>{t('storage.editor.tipKeys')}</li>
                </ul>
              </>
            )}
          </CardContent>
        </Card>
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
