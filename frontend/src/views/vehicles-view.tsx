'use client';

import { useMemo, useState } from 'react';
import { useQuery, useMutation, useQueryClient, keepPreviousData } from '@tanstack/react-query';
import { vehiclesApi, membersApi, apiErrorMessage } from '@/lib/api-client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { EmptyState, ErrorState } from '@/components/ui/empty-state';
import { SearchableSelect } from '@/components/ui/searchable-select';
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table';
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { useToast } from '@/hooks/use-toast';
import { useTranslation } from '@/providers/i18n-provider';
import { formatDateTime, displayName } from '@/lib/format';
import { cn } from '@/lib/utils';
import { Car, Plus, Pencil, Trash2, Search, History, X } from 'lucide-react';
import {
  VEHICLE_STATUSES, VEHICLE_CATEGORIES, VEHICLE_STATUS_KEYS, VEHICLE_CATEGORY_KEYS,
} from '@/lib/api-types';
import type {
  Vehicle, VehicleInput, VehicleStatus, VehicleCategory,
} from '@/lib/api-types';

/**
 * Status colours, chosen so the table can be read down the right-hand edge
 * without reading the words: green is fine, amber is temporary, red is
 * somebody else's problem, grey is history.
 */
const STATUS_TONE: Record<VehicleStatus, string> = {
  in_service: 'border-emerald-500/30 bg-emerald-500/10 text-emerald-200',
  in_repair: 'border-amber-500/30 bg-amber-500/10 text-amber-200',
  impounded: 'border-amber-500/30 bg-amber-500/10 text-amber-200',
  stolen: 'border-red-500/30 bg-red-500/10 text-red-200',
  sold: 'border-[var(--line-2)] text-zinc-400',
  scrapped: 'border-[var(--line-2)] text-zinc-400',
};

const PAGE_SIZE = 50;

/**
 * The faction's vehicle registry.
 *
 * A plate goes in and everything known about the car comes back — the shape of
 * the police registries these servers already run, which is what was asked
 * for. Every member can read it; `manage_vehicles` is what it takes to change
 * anything, because the person who needs to look a plate up is usually the one
 * holding the fewest permissions.
 */
export function VehiclesView({
  factionId,
  canManage,
}: {
  factionId: string;
  canManage: boolean;
}) {
  const { t } = useTranslation();
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const [search, setSearch] = useState('');
  const [status, setStatus] = useState<string>('');
  const [category, setCategory] = useState<string>('');
  const [page, setPage] = useState(1);

  const [editing, setEditing] = useState<Vehicle | 'new' | null>(null);
  const [open, setOpen] = useState<Vehicle | null>(null);
  const [deleting, setDeleting] = useState<Vehicle | null>(null);

  const listQuery = useQuery({
    queryKey: ['vehicles', factionId, search, status, category, page],
    queryFn: () => vehiclesApi.list(factionId, {
      ...(search.trim() ? { q: search.trim() } : {}),
      ...(status ? { status } : {}),
      ...(category ? { category } : {}),
      page,
      page_size: PAGE_SIZE,
    }),
    // Typing in the search box would otherwise blank the table between
    // keystrokes, which reads as the registry being empty.
    placeholderData: keepPreviousData,
  });

  const data = listQuery.data;
  const vehicles = useMemo(() => data?.vehicles ?? [], [data]);
  const filtered = !!search.trim() || !!status || !!category;

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ['vehicles', factionId] });

  const remove = useMutation({
    mutationFn: (id: string) => vehiclesApi.remove(factionId, id),
    onSuccess: () => {
      setDeleting(null);
      setOpen(null);
      invalidate();
    },
    onError: (e) => toast({ title: apiErrorMessage(e), variant: 'destructive' }),
  });

  const clearFilters = () => {
    setSearch('');
    setStatus('');
    setCategory('');
    setPage(1);
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-medium tracking-tight text-zinc-100">{t('vehicle.title')}</h1>
          <p className="text-meta text-zinc-500 mt-1 max-w-xl">{t('vehicle.subtitle')}</p>
        </div>
        {canManage && (
          <Button onClick={() => setEditing('new')} className="shrink-0">
            <Plus className="h-4 w-4" /> {t('vehicle.add')}
          </Button>
        )}
      </div>

      <div className="flex flex-wrap items-end gap-2">
        <div className="relative flex-1 min-w-[220px]">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-500" />
          <Input
            className="pl-9"
            placeholder={t('vehicle.search')}
            value={search}
            onChange={(e) => { setSearch(e.target.value); setPage(1); }}
          />
        </div>
        <div className="w-44">
          <SearchableSelect
            value={status}
            onValueChange={(v) => { setStatus(v); setPage(1); }}
            options={[
              { value: '', label: t('vehicle.allStatuses') },
              ...VEHICLE_STATUSES.map((s) => ({
                value: s,
                label: t(VEHICLE_STATUS_KEYS[s]),
                // Over the whole registry, not the page — a count that meant
                // "on this page" would be worse than none.
                hint: data?.statusCounts?.[s] ? String(data.statusCounts[s]) : undefined,
              })),
            ]}
          />
        </div>
        <div className="w-44">
          <SearchableSelect
            value={category}
            onValueChange={(v) => { setCategory(v); setPage(1); }}
            options={[
              { value: '', label: t('vehicle.allCategories') },
              ...VEHICLE_CATEGORIES.map((c) => ({ value: c, label: t(VEHICLE_CATEGORY_KEYS[c]) })),
            ]}
          />
        </div>
        {filtered && (
          <Button variant="outline" size="sm" onClick={clearFilters}>
            <X className="h-3.5 w-3.5" /> {t('common.clear')}
          </Button>
        )}
      </div>

      {listQuery.isLoading ? (
        <Skeleton className="h-64 w-full" />
      ) : listQuery.isError ? (
        <ErrorState error={listQuery.error} onRetry={() => void listQuery.refetch()} />
      ) : vehicles.length === 0 ? (
        <EmptyState
          icon={Car}
          title={filtered ? t('vehicle.noMatches') : t('vehicle.none')}
          hint={filtered ? t('vehicle.noMatchesHint') : t('vehicle.noneHint')}
        />
      ) : (
        <>
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t('vehicle.plate')}</TableHead>
                  <TableHead>{t('vehicle.makeModel')}</TableHead>
                  <TableHead>{t('vehicle.color')}</TableHead>
                  <TableHead>{t('vehicle.owner')}</TableHead>
                  <TableHead>{t('vehicle.year')}</TableHead>
                  <TableHead>{t('vehicle.statusLabel')}</TableHead>
                  {canManage && <TableHead className="text-right">{t('vehicle.actions')}</TableHead>}
                </TableRow>
              </TableHeader>
              <TableBody>
                {vehicles.map((vehicle) => (
                  <TableRow
                    key={vehicle.id}
                    className="cursor-pointer"
                    onClick={() => setOpen(vehicle)}
                  >
                    <TableCell className="font-medium tracking-wide">{vehicle.plate}</TableCell>
                    <TableCell>
                      {[vehicle.make, vehicle.model].filter(Boolean).join(' ') || t('vehicle.empty')}
                    </TableCell>
                    <TableCell>{vehicle.color || t('vehicle.empty')}</TableCell>
                    <TableCell>{vehicle.ownerDisplay || t('vehicle.ownerNone')}</TableCell>
                    <TableCell className="tabular-nums">{vehicle.year ?? t('vehicle.empty')}</TableCell>
                    <TableCell>
                      <StatusBadge status={vehicle.status} />
                    </TableCell>
                    {canManage && (
                      <TableCell className="text-right">
                        <div
                          className="flex justify-end gap-2"
                          onClick={(e) => e.stopPropagation()}
                        >
                          <Button variant="outline" size="sm" onClick={() => setEditing(vehicle)}>
                            <Pencil className="h-3.5 w-3.5" />
                          </Button>
                          <Button variant="outline" size="sm" onClick={() => setDeleting(vehicle)}>
                            <Trash2 className="h-3.5 w-3.5" />
                          </Button>
                        </div>
                      </TableCell>
                    )}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>

          {(data?.total ?? 0) > PAGE_SIZE && (
            <div className="flex items-center justify-between gap-3">
              <span className="text-meta text-zinc-500">
                {t('vehicle.showing', { shown: String(vehicles.length), total: String(data?.total ?? 0) })}
              </span>
              <div className="flex gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  disabled={page === 1}
                  onClick={() => setPage((p) => p - 1)}
                >
                  {t('vehicle.newer')}
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={page * PAGE_SIZE >= (data?.total ?? 0)}
                  onClick={() => setPage((p) => p + 1)}
                >
                  {t('vehicle.older')}
                </Button>
              </div>
            </div>
          )}
        </>
      )}

      {open && (
        <VehicleCard
          factionId={factionId}
          vehicle={open}
          canManage={canManage}
          onClose={() => setOpen(null)}
          onEdit={() => { setEditing(open); setOpen(null); }}
        />
      )}

      {editing && (
        <VehicleDialog
          factionId={factionId}
          vehicle={editing === 'new' ? null : editing}
          onClose={() => setEditing(null)}
          onSaved={() => { setEditing(null); invalidate(); }}
        />
      )}

      <AlertDialog open={!!deleting} onOpenChange={(o) => !o && setDeleting(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {t('vehicle.deleteConfirm', { plate: deleting?.plate ?? '' })}
            </AlertDialogTitle>
            <AlertDialogDescription>{t('vehicle.deleteBody')}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t('common.cancel')}</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => deleting && remove.mutate(deleting.id)}
              disabled={remove.isPending}
            >
              {t('common.delete')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function StatusBadge({ status }: { status: VehicleStatus }) {
  const { t } = useTranslation();
  return (
    <Badge variant="outline" className={cn('text-micro', STATUS_TONE[status])}>
      {t(VEHICLE_STATUS_KEYS[status])}
    </Badge>
  );
}

/**
 * The full card behind a row.
 *
 * Read-only by default, with the history underneath — which is the part that
 * makes this a registry rather than a list. The history is fetched separately
 * because not everyone who can read the registry may read it.
 */
function VehicleCard({
  factionId, vehicle, canManage, onClose, onEdit,
}: {
  factionId: string;
  vehicle: Vehicle;
  canManage: boolean;
  onClose: () => void;
  onEdit: () => void;
}) {
  const { t } = useTranslation();

  const historyQuery = useQuery({
    queryKey: ['vehicle-history', factionId, vehicle.id],
    queryFn: () => vehiclesApi.history(factionId, vehicle.id),
    // A 403 here is the ordinary answer for a member who may only read the
    // registry, not a failure worth retrying or reporting.
    retry: false,
  });

  const fieldName = (field: string): string => {
    const keys: Record<string, string> = {
      plate: t('vehicle.plate'), make: t('vehicle.make'), model: t('vehicle.model'),
      color: t('vehicle.color'), category: t('vehicle.category'), year: t('vehicle.year'),
      status: t('vehicle.statusLabel'), statusNote: t('vehicle.statusNote'),
      ownerUserId: t('vehicle.owner'), ownerName: t('vehicle.owner'), notes: t('vehicle.notes'),
    };
    return keys[field] ?? field;
  };

  const shown = (field: string, value: unknown): string => {
    if (value === null || value === undefined || value === '') return t('vehicle.empty');
    if (field === 'status') return t(VEHICLE_STATUS_KEYS[value as VehicleStatus] ?? 'vehicle.empty');
    if (field === 'category') return t(VEHICLE_CATEGORY_KEYS[value as VehicleCategory] ?? 'vehicle.empty');
    return String(value);
  };

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-3">
            <span className="tracking-wide">{vehicle.plate}</span>
            <StatusBadge status={vehicle.status} />
          </DialogTitle>
          <DialogDescription>
            {t('vehicle.updatedAt', { when: formatDateTime(vehicle.updatedAt) })}
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-4 sm:grid-cols-2 text-sm">
          <Field label={t('vehicle.make')} value={vehicle.make} />
          <Field label={t('vehicle.model')} value={vehicle.model} />
          <Field label={t('vehicle.color')} value={vehicle.color} />
          <Field label={t('vehicle.year')} value={vehicle.year ? String(vehicle.year) : null} />
          <Field label={t('vehicle.category')} value={t(VEHICLE_CATEGORY_KEYS[vehicle.category])} />
          <Field label={t('vehicle.owner')} value={vehicle.ownerDisplay} />
          {vehicle.statusNote && (
            <div className="sm:col-span-2">
              <Field label={t('vehicle.statusNote')} value={vehicle.statusNote} />
            </div>
          )}
          {vehicle.notes && (
            <div className="sm:col-span-2">
              <Field label={t('vehicle.notes')} value={vehicle.notes} />
            </div>
          )}
        </div>

        {/* Absent for a member who may only read the registry — the endpoint
            refuses, and there is nothing useful to say about that here. */}
        {historyQuery.isSuccess && (
          <div className="space-y-2 border-t border-[var(--line-2)] pt-4">
            <h3 className="text-sm font-medium text-zinc-200 flex items-center gap-2">
              <History className="h-4 w-4" /> {t('vehicle.history')}
            </h3>
            {historyQuery.data.history.length === 0 ? (
              <p className="text-meta text-zinc-500">{t('vehicle.historyNone')}</p>
            ) : (
              <ul className="space-y-2 max-h-56 overflow-y-auto pr-1">
                {historyQuery.data.history.map((row) => (
                  <li key={row.id} className="text-meta">
                    <span className="text-zinc-300">
                      {row.action === 'create'
                        ? t('vehicle.historyCreated', { name: row.actorName })
                        : row.action === 'delete'
                          ? t('vehicle.historyDeleted', { name: row.actorName })
                          : t('vehicle.historyUpdated', {
                            name: row.actorName,
                            fields: Object.keys(row.details?.changes ?? {}).map(fieldName).join(', '),
                          })}
                    </span>
                    <span className="text-zinc-600"> · {formatDateTime(row.createdAt)}</span>
                    {row.details?.changes && (
                      <ul className="mt-0.5 text-zinc-500">
                        {Object.entries(row.details.changes).map(([field, change]) => (
                          <li key={field}>
                            {t('vehicle.changeFrom', {
                              field: fieldName(field),
                              from: shown(field, change.from),
                              to: shown(field, change.to),
                            })}
                          </li>
                        ))}
                      </ul>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>{t('common.close')}</Button>
          {canManage && (
            <Button onClick={onEdit}>
              <Pencil className="h-4 w-4" /> {t('common.edit')}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function Field({ label, value }: { label: string; value: string | null }) {
  const { t } = useTranslation();
  return (
    <div>
      <p className="text-xs uppercase tracking-wide text-zinc-500">{label}</p>
      <p className="mt-0.5 text-zinc-200 break-words">{value || t('vehicle.empty')}</p>
    </div>
  );
}

function VehicleDialog({
  factionId, vehicle, onClose, onSaved,
}: {
  factionId: string;
  vehicle: Vehicle | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const { t } = useTranslation();
  const { toast } = useToast();

  const [plate, setPlate] = useState(vehicle?.plate ?? '');
  const [make, setMake] = useState(vehicle?.make ?? '');
  const [model, setModel] = useState(vehicle?.model ?? '');
  const [color, setColor] = useState(vehicle?.color ?? '');
  const [year, setYear] = useState(vehicle?.year ? String(vehicle.year) : '');
  const [category, setCategory] = useState<VehicleCategory>(vehicle?.category ?? 'car');
  const [status, setStatus] = useState<VehicleStatus>(vehicle?.status ?? 'in_service');
  const [statusNote, setStatusNote] = useState(vehicle?.statusNote ?? '');
  const [notes, setNotes] = useState(vehicle?.notes ?? '');

  // Two ways to name an owner, and only one of them applies at a time: a
  // vehicle belonging to a member and a vehicle belonging to "Marco Vega" are
  // different facts, and storing both would leave the card unable to say which
  // is true.
  const [ownerKind, setOwnerKind] = useState<'member' | 'other'>(
    vehicle?.ownerUserId ? 'member' : 'other',
  );
  const [ownerUserId, setOwnerUserId] = useState(vehicle?.ownerUserId ?? '');
  const [ownerName, setOwnerName] = useState(vehicle?.ownerName ?? '');

  const membersQuery = useQuery({
    queryKey: ['members', factionId],
    queryFn: () => membersApi.list(factionId),
  });

  const save = useMutation({
    mutationFn: () => {
      const body: VehicleInput = {
        plate: plate.trim(),
        make: make.trim() || null,
        model: model.trim() || null,
        color: color.trim() || null,
        category,
        year: year.trim() === '' ? null : Number(year),
        status,
        statusNote: statusNote.trim() || null,
        notes: notes.trim() || null,
        ownerUserId: ownerKind === 'member' ? (ownerUserId || null) : null,
        ownerName: ownerKind === 'other' ? (ownerName.trim() || null) : null,
      };
      return vehicle
        ? vehiclesApi.update(factionId, vehicle.id, body)
        : vehiclesApi.create(factionId, body);
    },
    onSuccess: onSaved,
    onError: (e) => toast({ title: apiErrorMessage(e), variant: 'destructive' }),
  });

  const yearValid = year.trim() === '' || (Number(year) >= 1900 && Number(year) <= 2200);

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>{vehicle ? t('vehicle.edit') : t('vehicle.add')}</DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label>{t('vehicle.plate')}</Label>
              <Input
                value={plate}
                maxLength={16}
                className="tracking-wide"
                onChange={(e) => setPlate(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label>{t('vehicle.category')}</Label>
              <SearchableSelect
                value={category}
                onValueChange={(v) => setCategory(v as VehicleCategory)}
                options={VEHICLE_CATEGORIES.map((c) => ({
                  value: c, label: t(VEHICLE_CATEGORY_KEYS[c]),
                }))}
              />
            </div>
            <div className="space-y-1.5">
              <Label>{t('vehicle.make')}</Label>
              <Input value={make} onChange={(e) => setMake(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label>{t('vehicle.model')}</Label>
              <Input value={model} onChange={(e) => setModel(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label>{t('vehicle.color')}</Label>
              <Input value={color} onChange={(e) => setColor(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label>{t('vehicle.year')}</Label>
              <Input
                inputMode="numeric"
                value={year}
                onChange={(e) => setYear(e.target.value)}
                className={cn(!yearValid && 'border-red-500/50')}
              />
            </div>
          </div>

          <div className="space-y-1.5">
            <Label>{t('vehicle.owner')}</Label>
            <div className="flex flex-wrap gap-2">
              {(['member', 'other'] as const).map((kind) => (
                <button
                  key={kind}
                  type="button"
                  onClick={() => setOwnerKind(kind)}
                  className={cn(
                    'rounded-md border px-3 py-1.5 text-sm transition-colors',
                    ownerKind === kind
                      ? 'border-[var(--brand-color,#6366f1)] bg-[var(--brand-color,#6366f1)]/10 text-brand'
                      : 'border-[var(--line-2)] text-zinc-400 hover:text-zinc-200',
                  )}
                >
                  {kind === 'member' ? t('vehicle.ownerMember') : t('vehicle.ownerOther')}
                </button>
              ))}
            </div>
            {ownerKind === 'member' ? (
              <SearchableSelect
                value={ownerUserId}
                onValueChange={setOwnerUserId}
                options={(membersQuery.data ?? []).map((m) => ({
                  value: m.userId,
                  label: displayName(m),
                  hint: m.rank ?? undefined,
                }))}
              />
            ) : (
              <Input
                value={ownerName}
                placeholder={t('vehicle.ownerNamePlaceholder')}
                onChange={(e) => setOwnerName(e.target.value)}
              />
            )}
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label>{t('vehicle.statusLabel')}</Label>
              <SearchableSelect
                value={status}
                onValueChange={(v) => setStatus(v as VehicleStatus)}
                options={VEHICLE_STATUSES.map((s) => ({
                  value: s, label: t(VEHICLE_STATUS_KEYS[s]),
                }))}
              />
            </div>
            <div className="space-y-1.5">
              <Label>{t('vehicle.statusNote')}</Label>
              <Input
                value={statusNote}
                placeholder={t('vehicle.statusNotePlaceholder')}
                onChange={(e) => setStatusNote(e.target.value)}
              />
            </div>
          </div>

          <div className="space-y-1.5">
            <Label>{t('vehicle.notes')}</Label>
            <Input value={notes} onChange={(e) => setNotes(e.target.value)} />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>{t('common.cancel')}</Button>
          <Button
            disabled={!plate.trim() || !yearValid || save.isPending}
            onClick={() => save.mutate()}
          >
            {t('common.save')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
