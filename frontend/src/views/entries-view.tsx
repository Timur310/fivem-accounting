'use client';

import { useMemo, useState, useEffect, useRef } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { entriesApi, itemTypesApi, exportApi, factionsApi, membersApi } from '@/lib/api-client';
import { useAppStore } from '@/lib/store';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { EmptyState, ErrorState, ListSkeleton } from '@/components/ui/empty-state';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Switch } from '@/components/ui/switch';
import {
  SearchableSelect, type SearchableSelectOption,
} from '@/components/ui/searchable-select';
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
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Skeleton } from '@/components/ui/skeleton';
import { Plus, Pencil, Trash2, Search, ChevronLeft, ChevronRight, Download } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import type { ItemType, Entry } from '@/lib/api-types';
import { formatAmount, displayName, todayLocalDateString } from '@/lib/format';
import { AmountPreview } from '@/components/ui/amount-preview';
import { ItemIcon } from '@/components/item-icon';
import { useTranslation } from '@/providers/i18n-provider';

interface Props {
  /** Whether the caller may credit an entry to the faction instead of themselves. */
  /**
   * `manage_entries`: lets the caller credit the faction (anonymous) or another
   * member instead of themselves — the same authority either way, since both
   * decide who gets credit for faction income.
   */
  canManageEntries?: boolean;
  factionId: string;
  isAdmin: boolean;
  canLogEntries: boolean;
  /**
   * Whether the caller is on this faction's roster. A superadmin browsing a
   * faction they never joined is not, so "Me" is not somewhere an entry can
   * land — they have to name a member or mark it anonymous.
   */
  canCreditSelf?: boolean;
}

export function EntriesView({ factionId, isAdmin, canLogEntries, canCreditSelf = true, canManageEntries }: Props) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const [page, setPage] = useState(1);
  const [itemTypeIdFilter, setItemTypeIdFilter] = useState<string>('all');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [searchInput, setSearchInput] = useState('');
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      setSearchQuery(searchInput);
      setPage(1);
    }, 350);
    return () => { if (debounceRef.current) clearTimeout(debounceRef.current); };
  }, [searchInput]);

  const { data: factionDetail } = useQuery({
    queryKey: ['faction-detail', factionId],
    queryFn: () => factionsApi.get(factionId),
    staleTime: 30 * 1000,
  });
  const customFields = factionDetail?.customFields ?? [];

  const [createOpen, setCreateOpen] = useState(false);
  // The id of an entry created in this session: its row pulses once, so the
  // user sees the ledger accept it.
  const [justCreatedId, setJustCreatedId] = useState<string | null>(null);
  const [newItemTypeId, setNewItemTypeId] = useState('');
  const [newAmount, setNewAmount] = useState('');
  const [newDescription, setNewDescription] = useState('');
  const [newAnonymous, setNewAnonymous] = useState(false);
  // Empty means "me" — the ordinary case, and what everyone without
  // `manage_entries` is limited to.
  const [newOwnerId, setNewOwnerId] = useState('');
  const [newDate, setNewDate] = useState(todayLocalDateString());
  const [newCustomValues, setNewCustomValues] = useState<Record<string, string>>({});

  const [editOpen, setEditOpen] = useState(false);
  const [editEntryId, setEditEntryId] = useState<string | null>(null);
  const [editAmount, setEditAmount] = useState('');
  const [editDescription, setEditDescription] = useState('');
  const [editDate, setEditDate] = useState('');
  const [editCustomValues, setEditCustomValues] = useState<Record<string, string>>({});

  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleteEntryId, setDeleteEntryId] = useState<string | null>(null);

  const { data: entriesData, isLoading, isError, error: entriesError, refetch: refetchEntries } = useQuery({
    queryKey: ['entries', factionId, page, itemTypeIdFilter, dateFrom, dateTo, searchQuery],
    queryFn: () =>
      entriesApi.list(factionId, {
        page,
        page_size: 20,
        item_type_id: itemTypeIdFilter === 'all' ? undefined : itemTypeIdFilter,
        date_from: dateFrom || undefined,
        date_to: dateTo || undefined,
        search: searchQuery || undefined,
      }),
    staleTime: 0,
  });

  const { data: itemTypes = [] } = useQuery({
    queryKey: ['itemTypes', factionId],
    queryFn: () => itemTypesApi.list(factionId),
    staleTime: 5 * 60 * 1000,
  });

  const activeItemTypes = useMemo(() => itemTypes.filter((t: ItemType) => t.isActive), [itemTypes]);

  const { data: members = [] } = useQuery({
    queryKey: ['members', factionId],
    queryFn: () => membersApi.list(factionId),
    enabled: !!canManageEntries,
    staleTime: 30 * 1000,
  });

  const memberOptions = useMemo<SearchableSelectOption[]>(() => [
    ...(canCreditSelf ? [{ value: '', label: t('entries.me') }] : []),
    ...members.map((m) => ({
      value: m.userId,
      label: displayName(m),
      hint: m.inGameName?.trim() ? `(${m.username})` : undefined,
      icon: (
        <Avatar className="size-5">
          <AvatarImage src={m.avatarUrl ?? undefined} />
          <AvatarFallback className="text-[9px]">{displayName(m).slice(0, 2).toUpperCase()}</AvatarFallback>
        </Avatar>
      ),
    })),
  ], [members, canCreditSelf, t]);

  const itemTypeOptions = useMemo<SearchableSelectOption[]>(() => activeItemTypes.map((item: ItemType) => ({
    value: item.id,
    label: item.name,
    hint: item.unit ? `(${item.unit})` : undefined,
    icon: <ItemIcon src={item.imageUrl} className="size-5" />,
  })), [activeItemTypes]);

  const itemTypeFilterOptions = useMemo<SearchableSelectOption[]>(
    () => [{ value: 'all', label: t('entries.allTypes') }, ...itemTypeOptions],
    [itemTypeOptions, t],
  );

  const createMutation = useMutation({
    mutationFn: () =>
      entriesApi.create(factionId, {
        itemTypeId: newItemTypeId,
        amount: newAmount,
        description: newDescription || undefined,
        entryDate: newDate || undefined,
        customValues: Object.keys(newCustomValues).length > 0 ? newCustomValues : undefined,
        ...(newAnonymous ? { anonymous: true } : {}),
        ...(newOwnerId && !newAnonymous ? { userId: newOwnerId } : {}),
      }),
    onSuccess: (created) => {
      setJustCreatedId(created.id);
      // The pulse class is removed after the animation so a refetch rerender
      // doesn't restart it.
      setTimeout(() => setJustCreatedId((id) => (id === created.id ? null : id)), 1200);
      queryClient.invalidateQueries({ queryKey: ['entries', factionId] });
      queryClient.invalidateQueries({ queryKey: ['dashboard', factionId] });
      queryClient.invalidateQueries({ queryKey: ['quotas', factionId] });
      queryClient.invalidateQueries({ queryKey: ['charts', factionId] });
      setCreateOpen(false);
      resetCreateForm();
      toast({ title: t('entries.logged') });
    },
    onError: (err: any) => {
      toast({ title: t('entries.logFailed'), description: err.response?.data?.error?.message || t('common.unknownError'), variant: 'destructive' });
    },
  });

  const updateMutation = useMutation({
    mutationFn: () =>
      entriesApi.update(factionId, editEntryId!, {
        amount: editAmount,
        description: editDescription || null,
        entryDate: editDate || undefined,
        customValues: editCustomValues,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['entries', factionId] });
      queryClient.invalidateQueries({ queryKey: ['dashboard', factionId] });
      queryClient.invalidateQueries({ queryKey: ['quotas', factionId] });
      queryClient.invalidateQueries({ queryKey: ['charts', factionId] });
      setEditOpen(false);
      toast({ title: t('entries.updated') });
    },
    onError: (err: any) => {
      toast({ title: t('common.updateFailed'), description: err.response?.data?.error?.message || t('common.unknownError'), variant: 'destructive' });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: () => entriesApi.remove(factionId, deleteEntryId!),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['entries', factionId] });
      queryClient.invalidateQueries({ queryKey: ['dashboard', factionId] });
      queryClient.invalidateQueries({ queryKey: ['quotas', factionId] });
      queryClient.invalidateQueries({ queryKey: ['charts', factionId] });
      setDeleteOpen(false);
      toast({ title: t('entries.deleted') });
    },
    onError: (err: any) => {
      toast({ title: t('common.deleteFailed'), description: err.response?.data?.error?.message || t('common.unknownError'), variant: 'destructive' });
    },
  });

  const resetCreateForm = () => {
    setNewItemTypeId('');
    setNewAmount('');
    setNewDescription('');
    setNewDate(todayLocalDateString());
    setNewCustomValues({});
    setNewAnonymous(false);
    setNewOwnerId('');
  };

  const openEditDialog = (entry: any) => {
    setEditEntryId(entry.id);
    setEditAmount(entry.amount);
    setEditDescription(entry.description || '');
    setEditDate(entry.entryDate);
    setEditCustomValues(entry.customValues ?? {});
    setEditOpen(true);
  };

  const entries = entriesData?.data ?? [];

  const user = useAppStore((s) => s.user);
  // Mid-roleplay friction is the enemy: the dialog opens pre-filled with the
  // member's own last entry, so logging the same haul again is two clicks.
  const myLastEntry = useMemo(
    () => entries.find((e) => e.userId === user?.id),
    [entries, user?.id],
  );
  // Date presets: today / this week / this month, in local calendar time.
  const [activePreset, setActivePreset] = useState<'today' | 'week' | 'month' | null>(null);
  const applyPreset = (preset: 'today' | 'week' | 'month') => {
    const now = new Date();
    const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    const day = now.getDay();
    const monday = new Date(now);
    monday.setDate(now.getDate() - (day === 0 ? 6 : day - 1));
    if (preset === 'today') {
      setDateFrom(iso(now));
      setDateTo(iso(now));
    } else if (preset === 'week') {
      setDateFrom(iso(monday));
      setDateTo(iso(now));
    } else {
      setDateFrom(iso(new Date(now.getFullYear(), now.getMonth(), 1)));
      setDateTo(iso(now));
    }
    setActivePreset(preset);
    setPage(1);
  };

  // Five-minute self-service undo, mirroring the API rule.
  const isUndoable = (entry: Entry) =>
    entry.userId === user?.id &&
    Date.now() - new Date(entry.createdAt).getTime() <= 5 * 60 * 1000;

  // The member's three most recent item types, for one-tap re-logging.
  const recentTypeNames = useMemo(() => {
    const seen: string[] = [];
    for (const e of entries) {
      if (e.userId === user?.id && !seen.includes(e.itemTypeName)) seen.push(e.itemTypeName);
      if (seen.length === 3) break;
    }
    return seen;
  }, [entries, user?.id]);
  const recentTypeIds = recentTypeNames
    .map((name) => activeItemTypes.find((it: ItemType) => it.name === name))
    .filter((it): it is ItemType => !!it);

  const openCreate = () => {
    // The list does not carry item ids, so the type resolves by name.
    const lastType = myLastEntry
      ? activeItemTypes.find((it: ItemType) => it.name === myLastEntry.itemTypeName)
      : undefined;
    if (newItemTypeId === '' && lastType) setNewItemTypeId(lastType.id);
    if (newAmount === '' && myLastEntry) setNewAmount(myLastEntry.amount);
    setCreateOpen(true);
  };
  const meta = entriesData?.meta;
  const totalPages = meta ? Math.ceil(meta.total_count / meta.page_size) : 1;

  // One predicate for the create dialog, read by both the submit button and
  // the form's onSubmit. Pressing Enter must be able to do exactly what
  // clicking can and no more.
  const canCreateEntry =
    !!newItemTypeId &&
    !!newAmount &&
    Number(newAmount) > 0 &&
    !createMutation.isPending &&
    (canCreditSelf || newAnonymous || !!newOwnerId) &&
    !customFields.some((f) => f.required && !(newCustomValues[f.name] ?? '').trim());

  const canSaveEdit =
    !!editAmount && Number(editAmount) > 0 && !updateMutation.isPending;

  // Unit for the edit dialog's echo, taken from the row being edited.
  const editingEntry = entries.find((e) => e.id === editEntryId);
  const editUnit = editingEntry?.itemUnit;
  const editIsCurrency = editingEntry?.itemIsCurrency;

  return (
    <div className="space-y-4">
      {/* Filters + CTA */}
      <Card className="sticky top-14 z-20 backdrop-blur-md bg-background/85">
        <CardContent className="p-4">
          <div className="flex flex-col lg:flex-row lg:flex-wrap gap-3 items-start lg:items-end">
            <div className="flex flex-col gap-1.5 flex-1 min-w-[200px]">
              <Label className="text-xs text-zinc-500">{t('common.search')}</Label>
              <div className="relative">
                <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-zinc-600" />
                <Input placeholder={t('entries.searchPlaceholder')} value={searchInput} onChange={(e) => setSearchInput(e.target.value)} className="pl-9" />
              </div>
            </div>
            <div className="flex flex-col gap-1.5 w-full lg:w-auto">
              <Label className="text-xs text-zinc-500">{t('entries.itemType')}</Label>
              <SearchableSelect
                className="w-full lg:w-[160px]"
                aria-label={t('itemTypes.filterBy')}
                value={itemTypeIdFilter}
                onValueChange={(v) => { setItemTypeIdFilter(v); setPage(1); }}
                options={itemTypeFilterOptions}
                placeholder={t('entries.allTypes')}
                searchPlaceholder={t('itemTypes.search')}
                emptyMessage={t('itemTypes.noneMatch')}
              />
            </div>
            {/* Phone-first presets: "did I log yesterday?" is two taps. */}
            <div className="flex flex-col gap-1.5 w-full lg:w-auto">
              <Label className="text-xs text-zinc-500">{t('entries.quickRange')}</Label>
              <div className="flex flex-wrap gap-1">
                {([
                  ['today', 'entries.today'],
                  ['week', 'entries.thisWeek'],
                  ['month', 'entries.thisMonth'],
                ] as const).map(([preset, key]) => (
                  <Button
                    key={preset}
                    variant={activePreset === preset ? 'default' : 'outline'}
                    size="sm"
                    className="h-8 text-xs"
                    onClick={() => applyPreset(preset)}
                  >
                    {t(key)}
                  </Button>
                ))}
              </div>
            </div>
            <div className="flex flex-col gap-1.5 w-full lg:w-auto">
              <Input type="date" value={dateFrom} onChange={(e) => { setDateFrom(e.target.value); setDateTo(''); setPage(1); }} className="w-full sm:w-[140px]" />
            </div>
            <div className="flex flex-col gap-1.5 w-full lg:w-auto">
              <Input type="date" value={dateTo} onChange={(e) => { setDateTo(e.target.value); setActivePreset(null); setPage(1); }} className="w-full sm:w-[140px]" />
            </div>
            <div className="flex gap-2 flex-wrap lg:ml-auto">
            {user && (
              <Button
                variant="outline"
                size="sm"
                title={t('entries.exportMine')}
                onClick={() => window.open(exportApi.entriesUrl(factionId, { user_id: user.id }), '_blank')}
              >
                <Download className="mr-1.5 h-3.5 w-3.5" />{t('entries.exportMine')}
              </Button>
            )}
            <Button variant="outline" size="sm" onClick={() => {
              const url = exportApi.entriesUrl(factionId, { date_from: dateFrom || undefined, date_to: dateTo || undefined, item_type_id: itemTypeIdFilter === 'all' ? undefined : itemTypeIdFilter });
              window.open(url, '_blank');
            }}>
              <Download className="mr-1.5 h-3.5 w-3.5" />{t('entries.csv')}
            </Button>
            {canLogEntries && (
              <Button onClick={openCreate}>
                <Plus className="mr-1.5 h-3.5 w-3.5" />
                {t('entries.logEntry')}
              </Button>
            )}
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Table */}
      <Card className="py-0 gap-0">
        <CardContent className="p-0">
          {isLoading ? (
            <ListSkeleton rows={5} />
          ) : isError ? (
            <ErrorState error={entriesError} onRetry={() => refetchEntries()} />
          ) : entries.length === 0 ? (
            <EmptyState icon={Search} title={t('entries.noneFound')} />
          ) : (
            <>
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>{t('role.member')}</TableHead>
                      <TableHead>{t('entries.type')}</TableHead>
                      <TableHead className="text-right">{t('common.amount')}</TableHead>
                      <TableHead>{t('common.description')}</TableHead>
                      {customFields.length > 0 && <TableHead>{t('entries.custom')}</TableHead>}
                      <TableHead>{t('common.date')}</TableHead>
                      {(isAdmin || entries.some((e) => isUndoable(e))) && <TableHead className="w-[80px]"></TableHead>}
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {entries.map((entry) => (
                      <TableRow key={entry.id} className={entry.id === justCreatedId ? 'row-flash' : ''}>
                        <TableCell>
                          <div className="flex items-center gap-2">
                            <Avatar className="h-6 w-6">
                              <AvatarImage src={entry.avatarUrl ?? undefined} />
                              <AvatarFallback className="text-[9px]">{displayName(entry).slice(0, 2).toUpperCase()}</AvatarFallback>
                            </Avatar>
                            <span className="text-sm text-zinc-300">{displayName(entry)}</span>
                          </div>
                        </TableCell>
                        <TableCell>
                          <span className="inline-flex items-center gap-1.5 text-xs bg-white/[0.04] border border-white/[0.06] pl-1 pr-2 py-0.5 rounded-md text-zinc-400">
                            <ItemIcon src={entry.itemImageUrl} className="size-4" />
                            {entry.itemTypeName}
                          </span>
                        </TableCell>
                        <TableCell className="text-right font-mono text-sm text-zinc-200 tabular-nums">
                          {formatAmount(entry.amount, entry.itemUnit, entry.itemIsCurrency)}
                        </TableCell>
                        <TableCell className="max-w-[200px] truncate text-zinc-500 text-sm">
                          {entry.description || '—'}
                        </TableCell>
                        {customFields.length > 0 && (
                          <TableCell className="max-w-[180px]">
                            {entry.customValues && Object.keys(entry.customValues).length > 0 ? (
                              <div className="flex flex-wrap gap-1">
                                {Object.entries(entry.customValues).map(([k, v]) => (
                                  <span key={k} className="text-[11px] bg-white/[0.04] border border-white/[0.06] px-1.5 py-0.5 rounded text-zinc-400" title={`${k}: ${v}`}>
                                    {v.length > 15 ? v.slice(0, 15) + '...' : v}
                                  </span>
                                ))}
                              </div>
                            ) : (<span className="text-zinc-600 text-xs">—</span>)}
                          </TableCell>
                        )}
                        <TableCell className="text-sm text-zinc-500 tabular-nums">{entry.entryDate}</TableCell>
                        {(isAdmin || isUndoable(entry)) && (
                          <TableCell>
                            <div className="flex items-center gap-0.5">
                              {isAdmin && (
                                <Button variant="ghost" size="icon" className="h-7 w-7 text-zinc-500 hover:text-zinc-200" onClick={() => openEditDialog(entry)}>
                                  <Pencil className="h-3 w-3" />
                                </Button>
                              )}
                              {/* Admins delete anything; a member gets a five-minute undo on their own rows. */}
                              {(isAdmin || isUndoable(entry)) && (
                                <Button
                                  variant="ghost" size="icon"
                                  className="h-7 w-7 text-zinc-500 hover:text-red-400"
                                  title={isAdmin ? undefined : t('entries.undo')}
                                  onClick={() => { setDeleteEntryId(entry.id); setDeleteOpen(true); }}
                                >
                                  <Trash2 className="h-3 w-3" />
                                </Button>
                              )}
                            </div>
                          </TableCell>
                        )}
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>

              {meta && totalPages > 1 && (
                <div className="flex items-center justify-between px-4 py-3 border-t border-white/[0.06]">
                  <p className="text-xs text-zinc-500 tabular-nums">
                    {t('common.pagination', { page: meta.page, pages: totalPages, total: meta.total_count })}
                  </p>
                  <div className="flex items-center gap-1.5">
                    <Button variant="ghost" size="sm" className="h-7" disabled={page <= 1} onClick={() => setPage(page - 1)}>
                      <ChevronLeft className="h-3.5 w-3.5" />
                    </Button>
                    <Button variant="ghost" size="sm" className="h-7" disabled={page >= totalPages} onClick={() => setPage(page + 1)}>
                      <ChevronRight className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                </div>
              )}
            </>
          )}
        </CardContent>
      </Card>

      {/* Create Dialog */}
      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t('entries.logNew')}</DialogTitle>
            <DialogDescription>{t('entries.logNewHint')}</DialogDescription>
          </DialogHeader>
          {/* A real form, so Enter in any single-line field logs the entry —
              and Enter in the description textarea still inserts a newline,
              which is the behaviour a hand-rolled key handler gets wrong. */}
          <form
            onSubmit={(e) => { e.preventDefault(); if (canCreateEntry) createMutation.mutate(); }}
          >
          <div className="space-y-4">
            <div className="space-y-2">
              <Label>{t('entries.itemType')}</Label>
              {recentTypeIds.length > 0 && (
                <div className="flex flex-wrap gap-1.5">
                  {recentTypeIds.map((it) => (
                    <button
                      key={it.id}
                      type="button"
                      onClick={() => setNewItemTypeId(it.id)}
                      className={`inline-flex items-center gap-1 text-xs px-2 py-1 rounded-md border transition-colors ${newItemTypeId === it.id ? 'border-primary text-primary' : 'border-white/[0.08] text-zinc-400 hover:text-zinc-200'}`}
                    >
                      <ItemIcon src={it.imageUrl} className="size-3.5" />
                      {it.name}
                    </button>
                  ))}
                </div>
              )}
              <SearchableSelect
                value={newItemTypeId}
                onValueChange={setNewItemTypeId}
                options={itemTypeOptions}
                placeholder={t('itemTypes.select')}
                searchPlaceholder={t('itemTypes.search')}
                emptyMessage={t('itemTypes.noneMatch')}
              />
            </div>
            <div className="space-y-2">
              <Label>{t('common.amount')}</Label>
              {(() => {
                const selectedType = activeItemTypes.find((it: ItemType) => it.id === newItemTypeId);
                const step = selectedType?.isCurrency ? 1000 : 1;
                const bump = (dir: number) => {
                  const current = Number(newAmount);
                  setNewAmount(String(isNaN(current) || newAmount === '' ? Math.max(step, 0) : Math.max(current + dir * step, 0)));
                };
                return (
                  <div className="flex items-center gap-2">
                    <Button type="button" variant="outline" size="icon" className="h-9 w-9 shrink-0" title={t('entries.decrease')} onClick={() => bump(-1)}>
                      −
                    </Button>
                    <Input type="number" step="0.01" min="0.01" placeholder="0.00" value={newAmount} onChange={(e) => setNewAmount(e.target.value)} className="tabular-nums" />
                    <Button type="button" variant="outline" size="icon" className="h-9 w-9 shrink-0" title={t('entries.increase')} onClick={() => bump(1)}>
                      +
                    </Button>
                  </div>
                );
              })()}
              <AmountPreview
                value={newAmount}
                unit={activeItemTypes.find((it: ItemType) => it.id === newItemTypeId)?.unit}
                isCurrency={activeItemTypes.find((it: ItemType) => it.id === newItemTypeId)?.isCurrency}
              />
            </div>
            <div className="space-y-2">
              <Label>{t('common.date')}</Label>
              <Input type="date" value={newDate} max={todayLocalDateString()} onChange={(e) => setNewDate(e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label>{t('entries.descriptionOptional')}</Label>
              <Textarea placeholder={t('entries.notePlaceholder')} value={newDescription} onChange={(e) => setNewDescription(e.target.value)} rows={2} />
            </div>
            {customFields.length > 0 && (
              <div className="space-y-3">
                <Label className="text-sm">{t('settings.customFields')}</Label>
                {customFields.map((field) => (
                  <div key={field.name} className="space-y-1">
                    <Label className="text-xs text-zinc-500">
                      {field.name}{field.required && <span className="text-red-400 ml-1">*</span>}
                    </Label>
                    <Input placeholder={field.required ? t('common.required') : t('common.optional')} value={newCustomValues[field.name] ?? ''} onChange={(e) => setNewCustomValues((prev) => ({ ...prev, [field.name]: e.target.value }))} maxLength={500} />
                  </div>
                ))}
              </div>
            )}
            {canManageEntries && (
              <div className="space-y-2">
                <Label>{t('entries.creditTo')}</Label>
                <SearchableSelect
                  value={newOwnerId}
                  onValueChange={setNewOwnerId}
                  options={memberOptions}
                  disabled={newAnonymous}
                  placeholder={canCreditSelf ? t('entries.me') : t('members.select')}
                  searchPlaceholder={t('members.search')}
                  emptyMessage={t('members.noneMatch')}
                />
                {/* Without a membership the Save button stays shut until the
                    entry has an owner, so say why rather than leaving a dead
                    control. */}
                <p className="text-xs text-zinc-500">
                  {canCreditSelf ? t('entries.creditToHint') : t('entries.creditToRequired')}
                </p>
              </div>
            )}
            {canManageEntries && (
              <div className="flex items-center justify-between rounded-lg border p-3">
                <div className="pr-3">
                  <p className="text-sm font-medium">{t('entries.anonymous')}</p>
                  <p className="text-xs text-zinc-500">{t('entries.anonymousHint')}</p>
                </div>
                <Switch
                  checked={newAnonymous}
                  onCheckedChange={(on) => { setNewAnonymous(on); if (on) setNewOwnerId(''); }}
                />
              </div>
            )}
          </div>
          <DialogFooter className="mt-4">
            <Button variant="outline" onClick={() => setCreateOpen(false)}>{t('common.cancel')}</Button>
            <Button type="submit" disabled={!canCreateEntry}>
              {createMutation.isPending ? t('entries.logging') : newAnonymous ? t('entries.logAnonymously') : t('entries.logEntry')}
            </Button>
          </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Edit Dialog */}
      <Dialog open={editOpen} onOpenChange={setEditOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t('entries.editEntry')}</DialogTitle>
            <DialogDescription>{t('entries.editHint')}</DialogDescription>
          </DialogHeader>
          <form onSubmit={(e) => { e.preventDefault(); if (canSaveEdit) updateMutation.mutate(); }}>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label>{t('common.amount')}</Label>
              <Input type="number" step="0.01" min="0.01" value={editAmount} onChange={(e) => setEditAmount(e.target.value)} className="tabular-nums" />
              <AmountPreview value={editAmount} unit={editUnit} isCurrency={editIsCurrency} />
            </div>
            <div className="space-y-2">
              <Label>{t('common.date')}</Label>
              <Input type="date" value={editDate} max={todayLocalDateString()} onChange={(e) => setEditDate(e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label>{t('common.description')}</Label>
              <Textarea value={editDescription} onChange={(e) => setEditDescription(e.target.value)} rows={2} />
            </div>
            {customFields.length > 0 && (
              <div className="space-y-3">
                <Label className="text-sm">{t('settings.customFields')}</Label>
                {customFields.map((field) => (
                  <div key={field.name} className="space-y-1">
                    <Label className="text-xs text-zinc-500">{field.name}{field.required && <span className="text-red-400 ml-1">*</span>}</Label>
                    <Input value={editCustomValues[field.name] ?? ''} onChange={(e) => setEditCustomValues((prev) => ({ ...prev, [field.name]: e.target.value }))} maxLength={500} />
                  </div>
                ))}
              </div>
            )}
          </div>
          <DialogFooter className="mt-4">
            <Button variant="outline" onClick={() => setEditOpen(false)}>{t('common.cancel')}</Button>
            <Button type="submit" disabled={!canSaveEdit}>
              {updateMutation.isPending ? t('common.saving') : t('common.saveChanges')}
            </Button>
          </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Delete Confirmation */}
      <AlertDialog open={deleteOpen} onOpenChange={setDeleteOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t('entries.deleteEntry')}</AlertDialogTitle>
            <AlertDialogDescription>{t('entries.deleteConfirm')}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t('common.cancel')}</AlertDialogCancel>
            <AlertDialogAction onClick={() => deleteMutation.mutate()} disabled={deleteMutation.isPending} className="bg-red-500 text-white hover:bg-red-600">
              {deleteMutation.isPending ? t('common.deleting') : t('common.delete')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
