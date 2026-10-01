'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { itemTypesApi, mapApi, storageApi, apiErrorMessage } from '@/lib/api-client';
import { usePersistedState } from '@/hooks/use-persisted-state';
import { useAppStore } from '@/lib/store';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { Segmented } from '@/components/ui/segmented';
import { SearchableSelect } from '@/components/ui/searchable-select';
import { Switch } from '@/components/ui/switch';
import { EmptyState, ErrorState } from '@/components/ui/empty-state';
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { useToast } from '@/hooks/use-toast';
import { useTranslation } from '@/providers/i18n-provider';
import { formatAmount } from '@/lib/format';
import { cn } from '@/lib/utils';
import { cents, fullness, isLow, MAX_ROOM_H, MAX_ROOM_W, MIN_ROOM, plainNumber } from '@/lib/storage-layout';
import { STORAGE_TEMPLATES } from '@/lib/storage-templates';
import { KIND_ICON, RoomGrid } from '@/components/storage/room-grid';
import { ZoomControls, fitCell, MAX_CELL, MIN_CELL } from '@/components/storage/zoom-controls';
import { RoomEditor } from '@/components/storage/room-editor';
import { ContainerPanel } from '@/components/storage/container-panel';
import {
  ChevronDown, FlaskConical, LayoutGrid, List, MapPin, Pencil, Plus, Scale, Search, Settings2, Square, Warehouse, X,
} from 'lucide-react';
import type { ItemType, StorageContainer, StorageRoomDetail } from '@/lib/api-types';

/**
 * The storage planner: which bench, chest or safe in the depot holds what.
 *
 * **Beta**, and it says so at the top, in words the members can read: it is
 * new, it may change, and feedback goes through Support.
 *
 * A faction draws its depots as rooms on a grid — walls, doors, and every
 * container where it really stands — and keeps a count of what is in each.
 * "Where is…?" lights up every container holding something, across rooms.
 * The counts are the faction's own and never touch the ledger; a comparison
 * underneath shows what the books say it owns next to what is put away.
 */
export function StorageView({
  factionId,
  canUpdate,
  canManage,
  mapOn,
}: {
  factionId: string;
  canUpdate: boolean;
  canManage: boolean;
  mapOn: boolean;
}) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const setCurrentView = useAppStore((s) => s.setCurrentView);
  const setFocusMarkerId = useAppStore((s) => s.setFocusMarkerId);

  const [roomPick, setRoomPick] = usePersistedState<string>(`storage.room.${factionId}`, '');
  const [display, setDisplay] = usePersistedState<'grid' | 'list'>(`storage.display.${factionId}`, 'grid');
  const [cell, setCell] = useState(36);
  const canvasRef = useRef<HTMLDivElement>(null);
  const zoom = (direction: 1 | -1) => setCell((c) => Math.min(MAX_CELL, Math.max(MIN_CELL, c + direction * 4)));
  const [query, setQuery] = useState('');
  const [openContainer, setOpenContainer] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [creating, setCreating] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);

  const rooms = useQuery({
    queryKey: ['storage-rooms', factionId],
    queryFn: () => storageApi.rooms(factionId),
  });
  const roomList = rooms.data?.rooms ?? [];
  const linked = rooms.data?.linked ?? true;
  const setLinked = useMutation({
    mutationFn: (next: boolean) => storageApi.setLinked(factionId, next),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['storage-rooms', factionId] }),
  });
  const roomId = roomList.some((r) => r.id === roomPick) ? roomPick : roomList[0]?.id ?? '';

  const detail = useQuery({
    queryKey: ['storage-room', factionId, roomId],
    queryFn: () => storageApi.room(factionId, roomId),
    enabled: !!roomId,
  });
  const items = useQuery({
    queryKey: ['item-types', factionId],
    queryFn: () => itemTypesApi.list(factionId),
  });
  const activeItems = useMemo(() => (items.data ?? []).filter((i: ItemType) => i.isActive !== false), [items.data]);

  const q = query.trim().toLowerCase();
  const search = useQuery({
    queryKey: ['storage-search', factionId, q],
    queryFn: () => storageApi.search(factionId, q),
    enabled: q.length > 0,
  });

  // Leaving a room drops whatever was open in it.
  useEffect(() => {
    setOpenContainer(null);
    setEditing(false);
  }, [roomId]);

  const containers = detail.data?.containers ?? [];
  const matches = (c: StorageContainer) => c.contents.some((line) => line.label.toLowerCase().includes(q) && cents(line.quantity) > 0);
  const opened = containers.find((c) => c.id === openContainer) ?? null;

  const elsewhere = (search.data?.results ?? []).filter((r) => r.roomId !== roomId);
  const hereCount = q ? containers.filter(matches).length : 0;

  const afterEdit = (saved: StorageRoomDetail | null) => {
    if (saved) {
      queryClient.setQueryData(['storage-room', factionId, roomId], saved);
      void queryClient.invalidateQueries({ queryKey: ['storage-rooms', factionId] });
      void queryClient.invalidateQueries({ queryKey: ['storage-search', factionId] });
    }
    setEditing(false);
  };

  const room = detail.data?.room;
  const fit = () => {
    if (canvasRef.current && room) setCell(fitCell(canvasRef.current, room.width, room.height));
  };

  // Each room opens fitted to the screen; zooming afterwards is the viewer's own.
  useEffect(() => {
    if (display === 'grid') fit();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [room?.id, room?.width, room?.height, display]);

  return (
    <div className="space-y-4">
      {/* Beta notice. Plain words, and a way to say what is wrong. */}
      <div className="flex items-start gap-3 rounded-lg border border-amber-500/30 bg-amber-500/5 px-4 py-3">
        <FlaskConical className="mt-0.5 h-4 w-4 shrink-0 text-amber-300" />
        <div className="text-sm">
          <p className="font-medium text-amber-200">{t('storage.betaTitle')}</p>
          <p className="text-amber-100/70">
            {linked ? t('storage.betaBodyLinked') : t('storage.betaBody')}{' '}
            <button type="button" className="underline underline-offset-2 hover:text-amber-100" onClick={() => setCurrentView('support')}>
              {t('storage.betaFeedback')}
            </button>
          </p>
        </div>
      </div>

      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-xl font-medium tracking-tight text-zinc-100">
            {t('storage.title')}
            <Badge variant="outline" className="border-amber-500/40 text-[10px] uppercase text-amber-300">{t('common.beta')}</Badge>
            <span
              className={cn(
                'rounded-full border px-2 py-0.5 text-[10px] font-normal',
                linked ? 'border-emerald-500/40 text-emerald-300' : 'border-zinc-700 text-zinc-500',
              )}
              title={linked ? t('storage.linkedHint') : t('storage.unlinkedHint')}
            >
              {linked ? t('storage.linked') : t('storage.unlinked')}
            </span>
          </h1>
          <p className="text-meta mt-1 max-w-xl text-zinc-500">{t('storage.subtitle')}</p>
        </div>
        {canManage && !editing && (
          <Button onClick={() => setCreating(true)}>
            <Plus className="mr-2 h-4 w-4" />{t('storage.newRoom')}
          </Button>
        )}
      </div>

      {rooms.isLoading ? (
        <Skeleton className="h-64 w-full" />
      ) : rooms.isError ? (
        <ErrorState error={rooms.error} onRetry={() => void rooms.refetch()} />
      ) : roomList.length === 0 ? (
        <EmptyState
          icon={Warehouse}
          title={t('storage.noRooms')}
          hint={canManage ? t('storage.noRoomsManager') : t('storage.noRoomsMember')}
        />
      ) : (
        <>
          {/* Rooms */}
          <div className="flex flex-wrap items-center gap-1.5" role="tablist" aria-label={t('storage.rooms')}>
            {roomList.map((r) => (
              <button
                key={r.id}
                type="button"
                role="tab"
                aria-selected={r.id === roomId}
                disabled={editing}
                onClick={() => setRoomPick(r.id)}
                className={cn(
                  'flex items-center gap-2 rounded-lg border px-3 py-1.5 text-sm transition-colors disabled:opacity-50',
                  r.id === roomId
                    ? 'border-[var(--brand-color)] bg-[var(--brand-color-light)] text-zinc-100'
                    : 'border-zinc-800 text-zinc-400 hover:text-zinc-200',
                )}
              >
                <Warehouse className="h-3.5 w-3.5" />
                {r.name}
                <span className="text-xs text-zinc-500">{r.containerCount}</span>
              </button>
            ))}
          </div>

          {editing && detail.data ? (
            <RoomEditor factionId={factionId} detail={detail.data} onDone={afterEdit} />
          ) : (
            <>
              {/* Toolbar: search, grid or list, zoom, room actions. */}
              <div className="flex flex-wrap items-center gap-2">
                <div className="relative min-w-[12rem] flex-1 sm:max-w-sm">
                  <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-500" />
                  <Input
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    onKeyDown={(e) => e.key === 'Escape' && setQuery('')}
                    placeholder={t('storage.whereIs')}
                    className="pl-8 pr-8"
                    aria-label={t('storage.whereIs')}
                  />
                  {query && (
                    <button type="button" onClick={() => setQuery('')} className="absolute right-2 top-1/2 -translate-y-1/2 text-zinc-500 hover:text-zinc-300" aria-label={t('common.clear')}>
                      <X className="h-4 w-4" />
                    </button>
                  )}
                </div>
                <Segmented
                  label={t('storage.display')}
                  value={display}
                  onChange={setDisplay}
                  options={[
                    { value: 'grid', label: t('storage.displayGrid'), icon: <LayoutGrid className="h-3.5 w-3.5" /> },
                    { value: 'list', label: t('storage.displayList'), icon: <List className="h-3.5 w-3.5" /> },
                  ]}
                />
                <div className="ml-auto flex items-center gap-2">
                  {room?.mapMarkerId && mapOn && (
                    <Button size="sm" variant="ghost" onClick={() => { setFocusMarkerId(room.mapMarkerId); setCurrentView('map'); }}>
                      <MapPin className="mr-1.5 h-3.5 w-3.5" />{t('storage.showOnMap')}
                    </Button>
                  )}
                  {canManage && (
                    <>
                      <Button size="sm" variant="outline" onClick={() => setSettingsOpen(true)} disabled={!room}>
                        <Settings2 className="mr-1.5 h-3.5 w-3.5" />{t('storage.roomSettings')}
                      </Button>
                      <Button size="sm" onClick={() => { setOpenContainer(null); setEditing(true); }} disabled={!detail.data}>
                        <Pencil className="mr-1.5 h-3.5 w-3.5" />{t('storage.editRoom')}
                      </Button>
                    </>
                  )}
                </div>
              </div>

              {q && (
                <SearchSummary
                  hereCount={hereCount}
                  elsewhere={elsewhere}
                  onJump={(rid, cid) => { setRoomPick(rid); setTimeout(() => setOpenContainer(cid), 0); }}
                />
              )}

              {detail.isLoading ? (
                <Skeleton className="h-64 w-full" />
              ) : detail.isError ? (
                <ErrorState error={detail.error} onRetry={() => void detail.refetch()} />
              ) : !room ? null : containers.length === 0 && display === 'list' ? (
                <EmptyState icon={Warehouse} title={t('storage.emptyRoom')} hint={canManage ? t('storage.emptyRoomManager') : undefined} />
              ) : display === 'grid' ? (
                <div key={roomId} ref={canvasRef} className="animate-fade-in">
                  <RoomGrid
                    width={room.width}
                    height={room.height}
                    tiles={room.tiles}
                    containers={containers.map((c) => ({
                      key: c.id, kind: c.kind, name: c.name, color: c.color,
                      x: c.x, y: c.y, w: c.w, h: c.h,
                      fill: fullness(c.contents, c.capacity),
                      low: isLow(c.contents),
                      dim: !!q && !matches(c),
                      hit: !!q && matches(c),
                      caption: captionFor(c),
                      preview: c.contents.map((line) => ({
                        label: line.label,
                        quantity: plainNumber(line.quantity),
                        low: line.minQuantity !== null && cents(line.quantity) < cents(line.minQuantity),
                      })),
                    }))}
                    cell={cell}
                    editing={false}
                    selectedKey={openContainer}
                    onSelect={setOpenContainer}
                    onZoom={zoom}
                    emptyLabel={t('storage.emptyContainer')}
                    overlay={
                      <>
                        <Legend />
                        <ZoomControls cell={cell} onZoom={zoom} onFit={fit} />
                      </>
                    }
                  />
                </div>
              ) : (
                <ListView containers={containers} q={q} matches={matches} onOpen={setOpenContainer} />
              )}

              <CompareCard factionId={factionId} />
            </>
          )}
        </>
      )}

      {opened && room && (
        <ContainerPanel
          linked={linked}
          factionId={factionId}
          roomId={room.id}
          container={opened}
          containers={containers}
          items={activeItems}
          canUpdate={canUpdate}
          onClose={() => setOpenContainer(null)}
        />
      )}

      {creating && (
        <CreateRoomDialog
          factionId={factionId}
          onClose={() => setCreating(false)}
          onCreated={(id) => { setRoomPick(id); setCreating(false); }}
        />
      )}
      {settingsOpen && room && (
        <RoomSettingsDialog
          factionId={factionId}
          room={room}
          mapOn={mapOn}
          linked={linked}
          setLinked={setLinked}
          onClose={() => setSettingsOpen(false)}
        />
      )}
    </div>
  );
}

function SearchSummary({
  hereCount,
  elsewhere,
  onJump,
}: {
  hereCount: number;
  elsewhere: { roomId: string; roomName: string; containerId: string; containerName: string; label: string; quantity: string }[];
  onJump: (roomId: string, containerId: string) => void;
}) {
  const { t } = useTranslation();
  return (
    <div className="space-y-1.5 text-xs">
      <p className={hereCount > 0 ? 'text-amber-300' : 'text-zinc-500'}>
        {hereCount > 0 ? t('storage.foundHere', { count: hereCount }) : t('storage.notHere')}
      </p>
      {elsewhere.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="text-zinc-500">{t('storage.alsoIn')}</span>
          {elsewhere.slice(0, 12).map((r) => (
            <button
              key={`${r.containerId}-${r.label}`}
              type="button"
              onClick={() => onJump(r.roomId, r.containerId)}
              className="rounded-full border border-zinc-800 px-2 py-0.5 text-zinc-300 hover:border-zinc-600"
            >
              {r.roomName} · {r.containerName} · {plainNumber(r.quantity)} {r.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

/** "45 / 50" when it has a limit, "12 items" when it does not, nothing when empty. */
function captionFor(c: StorageContainer): string | undefined {
  if (c.contents.length === 0) return undefined;
  const total = plainNumber((c.contents.reduce((s, l) => s + cents(l.quantity), 0) / 100).toFixed(2));
  return c.capacity ? `${total} / ${plainNumber(c.capacity)}` : `${total}`;
}

function Legend() {
  const { t } = useTranslation();
  return (
    <div className="absolute bottom-3 left-3 z-10 hidden flex-wrap items-center gap-x-3 gap-y-1 rounded-full border border-zinc-700/70 bg-zinc-900/90 px-3 py-1.5 text-[11px] text-zinc-400 shadow-xl backdrop-blur sm:flex">
      <span className="flex items-center gap-1.5"><span className="inline-block h-1.5 w-3 rounded-full bg-zinc-500" />{t('storage.editor.wall')}</span>
      <span className="flex items-center gap-1.5"><span className="inline-block h-1.5 w-3 rounded-full bg-amber-400" />{t('storage.editor.door')}</span>
      <span className="flex items-center gap-1.5"><span className="inline-block h-1 w-4 rounded-full bg-emerald-400" />{t('storage.legendFill')}</span>
      <span className="flex items-center gap-1.5"><span className="inline-block size-2 rounded-full bg-red-500" />{t('storage.legendLow')}</span>
    </div>
  );
}

/** Every container as a card, grouped by tag: the phone view, and a quick read. */
function ListView({
  containers,
  q,
  matches,
  onOpen,
}: {
  containers: StorageContainer[];
  q: string;
  matches: (c: StorageContainer) => boolean;
  onOpen: (id: string) => void;
}) {
  const { t } = useTranslation();
  const shown = q ? containers.filter(matches) : containers;
  const groups = useMemo(() => {
    const map = new Map<string, StorageContainer[]>();
    for (const c of shown) {
      const keys = c.tags.length > 0 ? c.tags : [''];
      for (const k of keys) map.set(k, [...(map.get(k) ?? []), c]);
    }
    return [...map.entries()].sort(([a], [b]) => (a === '' ? 1 : b === '' ? -1 : a.localeCompare(b)));
  }, [shown]);

  if (shown.length === 0) return <p className="py-6 text-center text-sm text-zinc-500">{t('storage.notHere')}</p>;

  return (
    <div className="space-y-5">
      {groups.map(([tag, list]) => (
        <section key={tag || 'untagged'} className="space-y-2">
          <h2 className="text-xs uppercase tracking-wide text-zinc-500">{tag || t('storage.untagged')}</h2>
          <div className="stagger grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {list.map((c) => {
              const Icon = KIND_ICON[c.kind] ?? Square;
              const fill = fullness(c.contents, c.capacity);
              return (
                <button
                  key={c.id}
                  type="button"
                  onClick={() => onOpen(c.id)}
                  className="lift rounded-lg border border-zinc-800 bg-zinc-900/60 p-3 text-left hover:border-zinc-700"
                  style={c.color ? { borderLeftColor: c.color, borderLeftWidth: 3 } : undefined}
                >
                  <div className="flex items-center gap-2">
                    <Icon className="h-4 w-4 shrink-0" style={c.color ? { color: c.color } : undefined} />
                    <span className="truncate text-sm font-medium text-zinc-100">{c.name}</span>
                    {isLow(c.contents) && <span className="ml-auto size-2 shrink-0 rounded-full bg-red-500" />}
                  </div>
                  {c.contents.length === 0 ? (
                    <p className="mt-2 text-xs text-zinc-600">{t('storage.emptyContainer')}</p>
                  ) : (
                    <ul className="mt-2 space-y-0.5 text-xs">
                      {c.contents.slice(0, 6).map((line) => (
                        <li
                          key={line.id}
                          className={cn('flex justify-between gap-2', q && line.label.toLowerCase().includes(q) ? 'text-amber-300' : 'text-zinc-400')}
                        >
                          <span className="truncate">{line.label}</span>
                          <span className="tabular-nums">{plainNumber(line.quantity)}</span>
                        </li>
                      ))}
                      {c.contents.length > 6 && <li className="text-zinc-600">+{c.contents.length - 6}</li>}
                    </ul>
                  )}
                  {fill !== null && (
                    <div className="mt-2 h-1 overflow-hidden rounded-full bg-zinc-800">
                      <div
                        className={cn('h-full rounded-full', fill >= 0.9 ? 'bg-red-400' : fill >= 0.7 ? 'bg-amber-400' : 'bg-emerald-400')}
                        style={{ width: `${Math.min(1, fill) * 100}%` }}
                      />
                    </div>
                  )}
                </button>
              );
            })}
          </div>
        </section>
      ))}
    </div>
  );
}

/** What the books say next to what is counted in storage. Folded by default. */
function CompareCard({ factionId }: { factionId: string }) {
  const { t } = useTranslation();
  const [open, setOpen] = usePersistedState<boolean>(`storage.compare.${factionId}`, false);
  const compare = useQuery({
    queryKey: ['storage-compare', factionId],
    queryFn: () => storageApi.compare(factionId),
    enabled: open,
  });
  const rows = compare.data?.items ?? [];

  return (
    <Card>
      <CardContent className="py-3">
        <button type="button" onClick={() => setOpen(!open)} className="flex w-full items-center gap-2 text-left" aria-expanded={open}>
          <Scale className="h-4 w-4 text-zinc-400" />
          <span className="text-sm font-medium text-zinc-200">{t('storage.compareTitle')}</span>
          <ChevronDown className={cn('ml-auto h-4 w-4 text-zinc-500 transition-transform', open && 'rotate-180')} />
        </button>
        {open && (
          <div className="mt-3 space-y-2">
            <p className="text-xs text-zinc-500">{t('storage.compareHintLinked')}</p>
            {compare.isLoading ? (
              <Skeleton className="h-24 w-full" />
            ) : rows.length === 0 ? (
              <p className="text-sm text-zinc-500">{t('storage.compareEmpty')}</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="text-xs text-zinc-500">
                    <tr>
                      <th className="py-1.5 text-left font-normal">{t('storage.item')}</th>
                      <th className="py-1.5 text-right font-normal">{t('storage.inBooks')}</th>
                      <th className="py-1.5 text-right font-normal">{t('storage.inStorage')}</th>
                      <th className="py-1.5 text-right font-normal">{t('storage.difference')}</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-zinc-800/70">
                    {rows.map((r) => {
                      const diff = cents(r.inBooks ?? '0') - cents(r.inStorage);
                      const fmt = (v: number) => formatAmount((v / 100).toFixed(2), r.unit, r.isCurrency);
                      return (
                        <tr key={r.itemTypeId}>
                          <td className="py-1.5 text-zinc-200">{r.name}</td>
                          <td className="py-1.5 text-right tabular-nums text-zinc-400">{r.inBooks === null ? '—' : fmt(cents(r.inBooks))}</td>
                          <td className="py-1.5 text-right tabular-nums text-zinc-200">{fmt(cents(r.inStorage))}</td>
                          <td className={cn('py-1.5 text-right tabular-nums', diff === 0 ? 'text-emerald-400' : 'text-amber-300')}>
                            {diff === 0 ? '✓' : diff > 0 ? t('storage.unplaced', { n: fmt(diff) }) : t('storage.extra', { n: fmt(-diff) })}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function CreateRoomDialog({
  factionId,
  onClose,
  onCreated,
}: {
  factionId: string;
  onClose: () => void;
  onCreated: (id: string) => void;
}) {
  const { t } = useTranslation();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [template, setTemplate] = useState('walls');
  const chosen = STORAGE_TEMPLATES.find((tpl) => tpl.key === template) ?? STORAGE_TEMPLATES[0]!;
  const [name, setName] = useState('');
  const [size, setSize] = useState({ w: String(chosen.width), h: String(chosen.height) });

  // A template with containers has a fixed size; an empty one can be any size.
  const fixedSize = chosen.containers.length > 0;
  const w = fixedSize ? chosen.width : Math.round(Number(size.w));
  const h = fixedSize ? chosen.height : Math.round(Number(size.h));
  const sizeOk = w >= MIN_ROOM && w <= MAX_ROOM_W && h >= MIN_ROOM && h <= MAX_ROOM_H;

  const create = useMutation({
    mutationFn: () => {
      // "Walls only" follows whatever size was typed; the others are drawn to theirs.
      const tiles = chosen.key === 'walls' ? wallsFor(w, h) : chosen.tiles();
      return storageApi.createRoom(factionId, { name: name.trim(), width: w, height: h, tiles, containers: chosen.containers });
    },
    onSuccess: (room) => {
      void queryClient.invalidateQueries({ queryKey: ['storage-rooms', factionId] });
      toast({ title: t('storage.roomCreated') });
      onCreated(room.id);
    },
    onError: (err) => toast({ title: t('common.failed'), description: apiErrorMessage(err), variant: 'destructive' }),
  });

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{t('storage.newRoom')}</DialogTitle>
          <DialogDescription>{t('storage.newRoomHint')}</DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="room-name">{t('storage.name')}</Label>
            <Input id="room-name" value={name} maxLength={80} placeholder={t('storage.roomNamePlaceholder')} onChange={(e) => setName(e.target.value)} autoFocus />
          </div>
          <div className="space-y-1.5">
            <Label>{t('storage.template')}</Label>
            <div className="grid gap-2 sm:grid-cols-2">
              {STORAGE_TEMPLATES.map((tpl) => (
                <button
                  key={tpl.key}
                  type="button"
                  onClick={() => { setTemplate(tpl.key); setSize({ w: String(tpl.width), h: String(tpl.height) }); }}
                  className={cn(
                    'rounded-lg border p-2.5 text-left transition-colors',
                    tpl.key === template ? 'border-[var(--brand-color)] bg-[var(--brand-color-light)]' : 'border-zinc-800 hover:border-zinc-700',
                  )}
                >
                  <p className="text-sm text-zinc-100">{t(tpl.label)}</p>
                  <p className="text-[11px] text-zinc-500">{t(tpl.hint)}</p>
                </button>
              ))}
            </div>
          </div>
          {!fixedSize && (
            <div className="flex items-end gap-2">
              <div className="space-y-1.5">
                <Label htmlFor="room-w">{t('storage.width')}</Label>
                <Input id="room-w" className="w-20" inputMode="numeric" value={size.w} onChange={(e) => setSize((s) => ({ ...s, w: e.target.value }))} />
              </div>
              <span className="pb-2 text-zinc-500">×</span>
              <div className="space-y-1.5">
                <Label htmlFor="room-h">{t('storage.height')}</Label>
                <Input id="room-h" className="w-20" inputMode="numeric" value={size.h} onChange={(e) => setSize((s) => ({ ...s, h: e.target.value }))} />
              </div>
              <span className="pb-2 text-[11px] text-zinc-500">{t('storage.cells')}</span>
            </div>
          )}
          {!sizeOk && (
            <p className="text-xs text-red-400">{t('storage.editor.sizeRange', { maxW: MAX_ROOM_W, maxH: MAX_ROOM_H, min: MIN_ROOM })}</p>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>{t('common.cancel')}</Button>
          <Button onClick={() => create.mutate()} disabled={!name.trim() || !sizeOk || create.isPending}>{t('storage.createRoom')}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** Outer walls with a two-cell door in the middle of the bottom wall. */
function wallsFor(w: number, h: number) {
  const mid = Math.floor(w / 2);
  const doors = new Set([`${mid - 1},${h - 1}`, `${mid},${h - 1}`]);
  const tiles: { x: number; y: number; kind: 'wall' | 'door' }[] = [];
  for (let x = 0; x < w; x++) {
    for (const y of [0, h - 1]) tiles.push({ x, y, kind: doors.has(`${x},${y}`) ? 'door' : 'wall' });
  }
  for (let y = 1; y < h - 1; y++) tiles.push({ x: 0, y, kind: 'wall' }, { x: w - 1, y, kind: 'wall' });
  return tiles;
}

function RoomSettingsDialog({
  factionId,
  room,
  mapOn,
  linked,
  setLinked,
  onClose,
}: {
  factionId: string;
  room: { id: string; name: string; mapMarkerId: string | null };
  mapOn: boolean;
  linked: boolean;
  setLinked: { mutate: (next: boolean) => void };
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [name, setName] = useState(room.name);
  const [marker, setMarker] = useState(room.mapMarkerId ?? '');
  const [confirmDelete, setConfirmDelete] = useState(false);
  const NONE = '__none__';

  const markers = useQuery({
    queryKey: ['map-markers', factionId],
    queryFn: () => mapApi.list(factionId),
    enabled: mapOn,
  });

  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: ['storage-rooms', factionId] });
    void queryClient.invalidateQueries({ queryKey: ['storage-room', factionId, room.id] });
  };

  const save = useMutation({
    mutationFn: () => storageApi.updateRoom(factionId, room.id, {
      name: name.trim(),
      ...(mapOn ? { mapMarkerId: marker && marker !== NONE ? marker : null } : {}),
    }),
    onSuccess: () => { refresh(); toast({ title: t('storage.roomSaved') }); onClose(); },
    onError: (err) => toast({ title: t('common.failed'), description: apiErrorMessage(err), variant: 'destructive' }),
  });
  const remove = useMutation({
    mutationFn: () => storageApi.removeRoom(factionId, room.id),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['storage-rooms', factionId] });
      void queryClient.invalidateQueries({ queryKey: ['storage-search', factionId] });
      void queryClient.invalidateQueries({ queryKey: ['storage-compare', factionId] });
      toast({ title: t('storage.roomDeleted') });
      onClose();
    },
    onError: (err) => toast({ title: t('common.failed'), description: apiErrorMessage(err), variant: 'destructive' }),
  });

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{t('storage.roomSettings')}</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="rs-name">{t('storage.name')}</Label>
            <Input id="rs-name" value={name} maxLength={80} onChange={(e) => setName(e.target.value)} />
          </div>
          {mapOn && (
            <div className="space-y-1.5">
              <Label>{t('storage.mapPin')}</Label>
              <SearchableSelect
                value={marker || NONE}
                onValueChange={setMarker}
                options={[
                  { value: NONE, label: t('storage.noMapPin') },
                  ...(markers.data?.markers ?? [])
                    .filter((m) => m.kind === 'point')
                    .map((m) => ({ value: m.id, label: m.name })),
                ]}
                aria-label={t('storage.mapPin')}
              />
              <p className="text-[11px] text-zinc-500">{t('storage.mapPinHint')}</p>
            </div>
          )}
          <div className="flex items-start justify-between gap-3 rounded-md border border-zinc-800 p-3">
            <div>
              <p className="text-sm text-zinc-200">{t('storage.linkSwitch')}</p>
              <p className="text-[11px] text-zinc-500">{t('storage.linkSwitchHint')}</p>
            </div>
            <Switch checked={linked} onCheckedChange={(next) => setLinked.mutate(next)} aria-label={t('storage.linkSwitch')} />
          </div>
          <div className="rounded-md border border-red-500/30 p-3">
            <p className="text-sm text-zinc-200">{t('storage.deleteRoom')}</p>
            <p className="mb-2 text-[11px] text-zinc-500">{t('storage.deleteRoomHint')}</p>
            <Button size="sm" variant="outline" className="border-red-500/40 text-red-300" onClick={() => setConfirmDelete(true)}>
              {t('storage.deleteRoom')}
            </Button>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>{t('common.cancel')}</Button>
          <Button onClick={() => save.mutate()} disabled={!name.trim() || save.isPending}>{t('common.save')}</Button>
        </DialogFooter>

        <AlertDialog open={confirmDelete} onOpenChange={setConfirmDelete}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>{t('storage.deleteRoomTitle', { name: room.name })}</AlertDialogTitle>
              <AlertDialogDescription>{t('storage.deleteRoomBody')}</AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>{t('common.cancel')}</AlertDialogCancel>
              <AlertDialogAction className="bg-red-600 hover:bg-red-500" onClick={() => remove.mutate()} disabled={remove.isPending}>
                {t('storage.deleteRoom')}
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </DialogContent>
    </Dialog>
  );
}
