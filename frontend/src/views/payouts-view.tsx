'use client';

import { useMemo, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  payoutsApi,
  membersApi,
  itemTypesApi,
} from '@/lib/api-client';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
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
import {
  SearchableSelect, type SearchableSelectOption,
} from '@/components/ui/searchable-select';
import { Label } from '@/components/ui/label';
import {
  Plus, ArrowDownToLine, Pencil, Trash2, Check, X, Split, Filter,
} from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { useAppStore } from '@/lib/store';
import type { Payout, PayoutStatus } from '@/lib/api-types';
import { formatAmount, displayName, fullDisplayName, formatNumber } from '@/lib/format';
import { ItemIcon } from '@/components/item-icon';
import { useTranslation } from '@/providers/i18n-provider';
import type { TranslationKey } from '@/lib/i18n';

// ── Status config ──
const STATUS_CONFIG: Record<PayoutStatus, { label: TranslationKey; color: string; bg: string }> = {
  pending:  { label: 'payouts.status.pending',  color: 'text-amber-400',  bg: 'bg-amber-500/10 border-amber-500/20' },
  approved: { label: 'payouts.status.approved', color: 'text-blue-400',   bg: 'bg-blue-500/10 border-blue-500/20' },
  rejected: { label: 'payouts.status.rejected', color: 'text-red-400',    bg: 'bg-red-500/10 border-red-500/20' },
  completed: { label: 'payouts.status.completed', color: 'text-emerald-400', bg: 'bg-emerald-500/10 border-emerald-500/20' },
};

// Allowed status transitions (mirrors backend)
const ALLOWED_TRANSITIONS: Record<PayoutStatus, PayoutStatus[]> = {
  pending: ['approved', 'rejected', 'completed'],
  approved: ['completed', 'rejected'],
  rejected: [],
  completed: [],
};

const TERMINAL_STATUSES: PayoutStatus[] = ['completed', 'rejected'];

/** Filter order deliberately differs from STATUS_CONFIG: it follows the
 *  lifecycle a withdrawal moves through rather than the colour table. */
const FILTERABLE_STATUSES: PayoutStatus[] = ['pending', 'approved', 'completed', 'rejected'];

interface Props {
  factionId: string;
  /** Superadmins may also remove a payout that has already been settled. */
  isSuperadmin?: boolean;
  /**
   * Whether the caller may act on other people's withdrawals. Without it this
   * screen is a request form and a list of what they asked for; the API scopes
   * it the same way, so nothing here hides something it would have allowed.
   */
  canManagePayouts?: boolean;
}

export function PayoutsView({ factionId, isSuperadmin, canManagePayouts = true }: Props) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const user = useAppStore((s) => s.user);
  const brandColor = useAppStore((s) => s.brandColor);

  // ── Filters ──
  const [filterStatus, setFilterStatus] = useState<string>('');
  const [filterItemTypeId, setFilterItemTypeId] = useState<string>('');
  const [filterDateFrom, setFilterDateFrom] = useState('');
  const [filterDateTo, setFilterDateTo] = useState('');
  const [page, setPage] = useState(1);

  // ── Dialogs ──
  const [createOpen, setCreateOpen] = useState(false);
  const [editPayout, setEditPayout] = useState<Payout | null>(null);
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [evenSplitOpen, setEvenSplitOpen] = useState(false);

  // ── Create form ──
  const [formRecipient, setFormRecipient] = useState('');
  const [formItemType, setFormItemType] = useState('');
  const [formAmount, setFormAmount] = useState('');
  const [formDescription, setFormDescription] = useState('');
  const [formDate, setFormDate] = useState(new Date().toISOString().slice(0, 10));

  // ── Edit form ──
  const [editAmount, setEditAmount] = useState('');
  const [editDescription, setEditDescription] = useState('');
  const [editDate, setEditDate] = useState('');

  // ── Even split form ──
  const [splitItemType, setSplitItemType] = useState('');
  const [splitTotal, setSplitTotal] = useState('');
  const [splitDescription, setSplitDescription] = useState('');
  const [splitDate, setSplitDate] = useState(new Date().toISOString().slice(0, 10));

  // ── Data ──
  const { data: payoutsData, isLoading } = useQuery({
    queryKey: ['payouts', factionId, filterStatus, filterItemTypeId, filterDateFrom, filterDateTo, page],
    queryFn: () => payoutsApi.list(factionId, {
      status: filterStatus || undefined,
      item_type_id: filterItemTypeId || undefined,
      date_from: filterDateFrom || undefined,
      date_to: filterDateTo || undefined,
      page,
      page_size: 20,
    }),
    staleTime: 0,
  });

  const { data: members = [] } = useQuery({
    queryKey: ['members', factionId],
    queryFn: () => membersApi.list(factionId),
    staleTime: 30 * 1000,
  });

  const { data: itemTypes = [] } = useQuery({
    queryKey: ['item-types', factionId],
    queryFn: () => itemTypesApi.list(factionId),
    staleTime: 30 * 1000,
  });

  // ── Dropdown options ──
  // Members read as "in-game name (Discord name)" so a payout can be traced to
  // the character it was paid to and the account that owns it; searching by
  // either name finds the row, since the hint is matched too.
  const memberOptions = useMemo<SearchableSelectOption[]>(() => members.map((m) => ({
    value: m.userId,
    label: displayName(m),
    hint: m.inGameName?.trim() ? `(${m.username})` : undefined,
    icon: (
      <Avatar className="size-5">
        <AvatarImage src={m.avatarUrl ?? undefined} />
        <AvatarFallback className="text-[9px]">{displayName(m).slice(0, 2).toUpperCase()}</AvatarFallback>
      </Avatar>
    ),
  })), [members]);

  const itemTypeOptions = useMemo<SearchableSelectOption[]>(() => itemTypes.map((item) => ({
    value: item.id,
    label: item.name,
    hint: item.unit ? `(${item.unit})` : undefined,
    icon: <ItemIcon src={item.imageUrl} className="size-5" />,
  })), [itemTypes]);

  const itemTypeFilterOptions = useMemo<SearchableSelectOption[]>(
    () => [{ value: '', label: t('entries.allTypes') }, ...itemTypeOptions],
    [itemTypeOptions, t],
  );

  // The empty value is the unfiltered case, so it doubles as a way to clear.
  const statusFilterOptions = useMemo<SearchableSelectOption[]>(() => [
    { value: '', label: t('payouts.allStatuses') },
    ...FILTERABLE_STATUSES.map((status) => ({ value: status, label: t(STATUS_CONFIG[status].label) })),
  ], [t]);

  const payouts = payoutsData?.data ?? [];
  const meta = payoutsData?.meta;
  const totalPages = meta ? Math.ceil(meta.total_count / meta.page_size) : 1;

  const fmt = formatNumber;

  const resetCreateForm = () => {
    setFormRecipient('');
    setFormItemType('');
    setFormAmount('');
    setFormDescription('');
    setFormDate(new Date().toISOString().slice(0, 10));
  };

  // ── Mutations ──
  const createMutation = useMutation({
    mutationFn: () => payoutsApi.create(factionId, {
      // Without reach over other names the recipient is never chosen, so it is
      // never in the form. The API applies the same rule and refuses anything
      // else, which is what makes this safe to fill in here.
      recipientUserId: canManagePayouts ? formRecipient : (user?.id ?? ''),
      itemTypeId: formItemType,
      amount: formAmount,
      description: formDescription || undefined,
      payoutDate: formDate || undefined,
    }),
    onSuccess: () => {
      toast({ title: t('payouts.created') });
      setCreateOpen(false);
      resetCreateForm();
      queryClient.invalidateQueries({ queryKey: ['payouts', factionId] });
      queryClient.invalidateQueries({ queryKey: ['dashboard', factionId] });
      queryClient.invalidateQueries({ queryKey: ['treasury', factionId] });
    },
    onError: (err: any) => {
      toast({ title: t('common.createFailed'), description: err.response?.data?.error?.message || t('common.unknownError'), variant: 'destructive' });
    },
  });

  const updateMutation = useMutation({
    mutationFn: ({ payoutId, input }: { payoutId: string; input: Record<string, unknown> }) =>
      payoutsApi.update(factionId, payoutId, input as any),
    onSuccess: () => {
      toast({ title: t('payouts.updated') });
      setEditPayout(null);
      queryClient.invalidateQueries({ queryKey: ['payouts', factionId] });
      queryClient.invalidateQueries({ queryKey: ['dashboard', factionId] });
      queryClient.invalidateQueries({ queryKey: ['treasury', factionId] });
    },
    onError: (err: any) => {
      toast({ title: t('common.updateFailed'), description: err.response?.data?.error?.message || t('common.unknownError'), variant: 'destructive' });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (payoutId: string) => payoutsApi.remove(factionId, payoutId),
    onSuccess: () => {
      toast({ title: t('payouts.deleted') });
      setDeleteId(null);
      queryClient.invalidateQueries({ queryKey: ['payouts', factionId] });
      queryClient.invalidateQueries({ queryKey: ['dashboard', factionId] });
      queryClient.invalidateQueries({ queryKey: ['treasury', factionId] });
    },
    onError: (err: any) => {
      toast({ title: t('common.deleteFailed'), description: err.response?.data?.error?.message || t('common.unknownError'), variant: 'destructive' });
    },
  });

  const evenSplitMutation = useMutation({
    mutationFn: () => payoutsApi.evenSplit(factionId, {
      itemTypeId: splitItemType,
      totalAmount: splitTotal,
      description: splitDescription || undefined,
      payoutDate: splitDate || undefined,
    }),
    onSuccess: (result) => {
      toast({
        title: t('payouts.splitCreated', { count: result.created }),
        description: t('payouts.splitBreakdown', { perMember: result.perMember.toFixed(2), remainder: result.remainder.toFixed(2) }),
      });
      setEvenSplitOpen(false);
      setSplitItemType('');
      setSplitTotal('');
      setSplitDescription('');
      setSplitDate(new Date().toISOString().slice(0, 10));
      queryClient.invalidateQueries({ queryKey: ['payouts', factionId] });
      queryClient.invalidateQueries({ queryKey: ['dashboard', factionId] });
      queryClient.invalidateQueries({ queryKey: ['treasury', factionId] });
    },
    onError: (err: any) => {
      toast({ title: t('payouts.splitFailed'), description: err.response?.data?.error?.message || t('common.unknownError'), variant: 'destructive' });
    },
  });

  const handleStatusChange = (payout: Payout, newStatus: PayoutStatus) => {
    updateMutation.mutate({ payoutId: payout.id, input: { status: newStatus } });
  };

  const openEdit = (p: Payout) => {
    setEditPayout(p);
    setEditAmount(p.amount);
    setEditDescription(p.description ?? '');
    setEditDate(p.payoutDate);
  };

  const handleEditSave = () => {
    if (!editPayout) return;
    const updates: Record<string, unknown> = {};
    if (editAmount !== editPayout.amount) updates.amount = editAmount;
    if (editDescription !== (editPayout.description ?? '')) updates.description = editDescription || null;
    if (editDate !== editPayout.payoutDate) updates.payoutDate = editDate;
    if (Object.keys(updates).length === 0) { setEditPayout(null); return; }
    updateMutation.mutate({ payoutId: editPayout.id, input: updates });
  };

  const canTransition = (payout: Payout, targetStatus: PayoutStatus) => {
    if (TERMINAL_STATUSES.includes(payout.status)) return false;
    return ALLOWED_TRANSITIONS[payout.status]?.includes(targetStatus) ?? false;
  };

  // Four-eyes rule: creator cannot approve own payout
  // Holding manage_payouts is the whole qualification — the API stopped
  // refusing a payout raised by the same person who settles it, so hiding the
  // button here would only hide something the server would have allowed.
  const canApprove = (payout: Payout) => canTransition(payout, 'approved');

  if (isLoading) {
    return <div className="space-y-4"><Skeleton className="h-10 w-full" /><Skeleton className="h-64 w-full" /></div>;
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h2 className="text-xl font-medium tracking-tight text-zinc-100">{t('nav.withdrawals')}</h2>
          <p className="text-zinc-500 text-sm mt-0.5">
            {canManagePayouts ? t('payouts.intro') : t('payouts.introMember')}
          </p>
        </div>
        <div className="flex gap-2">
          {/* Splitting a pot across the roster is reach over other people's
              names — the same thing the permission governs everywhere else. */}
          {canManagePayouts && (
            <Button variant="outline" size="sm" onClick={() => setEvenSplitOpen(true)}>
              <Split className="h-4 w-4 mr-1.5" />
              {t('payouts.evenSplit')}
            </Button>
          )}
          <Button size="sm" onClick={() => setCreateOpen(true)} style={{ backgroundColor: brandColor }}>
            <Plus className="h-4 w-4 mr-1.5" />
            {canManagePayouts ? t('payouts.new') : t('payouts.request')}
          </Button>
        </div>
      </div>

      {/* Filters */}
      <Card>
        <CardContent className="py-3">
          <div className="flex flex-wrap items-center gap-3">
            <Filter className="h-4 w-4 text-zinc-500 shrink-0" />
            <SearchableSelect
              className="w-[140px]"
              triggerClassName="h-8 text-xs"
              aria-label={t('payouts.filterByStatus')}
              value={filterStatus}
              onValueChange={(v) => { setFilterStatus(v); setPage(1); }}
              options={statusFilterOptions}
              placeholder={t('payouts.allStatuses')}
              searchPlaceholder={t('payouts.searchStatuses')}
              emptyMessage={t('payouts.noStatusesMatch')}
            />
            <SearchableSelect
              className="w-[150px]"
              triggerClassName="h-8 text-xs"
              aria-label={t('itemTypes.filterBy')}
              value={filterItemTypeId}
              onValueChange={(v) => { setFilterItemTypeId(v); setPage(1); }}
              options={itemTypeFilterOptions}
              placeholder={t('entries.allTypes')}
              searchPlaceholder={t('itemTypes.search')}
              emptyMessage={t('itemTypes.noneMatch')}
            />
            <Input type="date" value={filterDateFrom} onChange={(e) => { setFilterDateFrom(e.target.value); setPage(1); }} className="w-[140px] h-8 text-xs" />
            <Input type="date" value={filterDateTo} onChange={(e) => { setFilterDateTo(e.target.value); setPage(1); }} className="w-[140px] h-8 text-xs" />
            {(filterStatus || filterItemTypeId || filterDateFrom || filterDateTo) && (
              <Button variant="ghost" size="sm" className="h-8 text-xs" onClick={() => { setFilterStatus(''); setFilterItemTypeId(''); setFilterDateFrom(''); setFilterDateTo(''); setPage(1); }}>
                {t('common.clear')}
              </Button>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Table */}
      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow className="border-white/[0.06] hover:bg-transparent">
                <TableHead className="text-zinc-500">{t('payouts.recipient')}</TableHead>
                <TableHead className="text-zinc-500">{t('entries.type')}</TableHead>
                <TableHead className="text-zinc-500 text-right">{t('common.amount')}</TableHead>
                <TableHead className="text-zinc-500">{t('common.date')}</TableHead>
                <TableHead className="text-zinc-500">{t('common.status')}</TableHead>
                <TableHead className="text-zinc-500 text-right">{t('common.actions')}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {payouts.length === 0 ? (
                <TableRow><TableCell colSpan={6} className="text-center text-zinc-600 py-10">{canManagePayouts ? t('payouts.none') : t('payouts.noneOfYours')}</TableCell></TableRow>
              ) : payouts.map((p) => {
                const sc = STATUS_CONFIG[p.status];
                const isTerminal = TERMINAL_STATUSES.includes(p.status);
                return (
                  <TableRow key={p.id} className="border-white/[0.04]">
                    <TableCell>
                      <div className="flex items-center gap-2.5">
                        <Avatar className="h-7 w-7">
                          <AvatarImage src={p.recipientAvatarUrl ?? undefined} />
                          <AvatarFallback className="text-[10px]">
                            {displayName({ username: p.recipientUsername, inGameName: p.recipientInGameName }).slice(0, 2).toUpperCase()}
                          </AvatarFallback>
                        </Avatar>
                        <span className="text-sm text-zinc-300">
                          {displayName({ username: p.recipientUsername, inGameName: p.recipientInGameName })}
                          {p.recipientInGameName?.trim() && (
                            <span className="ml-1.5 text-xs text-zinc-500">({p.recipientUsername})</span>
                          )}
                        </span>
                      </div>
                    </TableCell>
                    <TableCell className="text-sm text-zinc-400">
                      <span className="inline-flex items-center gap-2">
                        <ItemIcon src={p.itemImageUrl} className="size-5" />
                        {p.itemTypeName}
                      </span>
                    </TableCell>
                    <TableCell className="text-sm text-zinc-200 tabular-nums text-right font-medium">
                      {formatAmount(p.amount, p.itemUnit, p.itemIsCurrency)}
                    </TableCell>
                    <TableCell className="text-sm text-zinc-500">{p.payoutDate}</TableCell>
                    <TableCell>
                      <Badge variant="outline" className={`${sc.bg} ${sc.color} border text-[11px]`}>
                        {t(sc.label)}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-right">
                      {/* Approving, completing, rejecting, editing and deleting are
                          all reach over a row someone else has to answer for. A
                          requester watches; they do not settle their own ask. */}
                      <div className="flex items-center justify-end gap-1">
                        {/* Status transitions */
                        canManagePayouts && !isTerminal && (
                          <>
                            {canApprove(p) && (
                              <Button
                                variant="ghost"
                                size="icon"
                                className="h-7 w-7 text-emerald-400 hover:text-emerald-300 hover:bg-emerald-500/10"
                                title={t('payouts.approve')}
                                onClick={() => handleStatusChange(p, 'approved')}
                              >
                                <Check className="h-3.5 w-3.5" />
                              </Button>
                            )}
                            {canTransition(p, 'completed') && (
                              <Button
                                variant="ghost"
                                size="icon"
                                className="h-7 w-7 text-blue-400 hover:text-blue-300 hover:bg-blue-500/10"
                                title={t('payouts.complete')}
                                onClick={() => handleStatusChange(p, 'completed')}
                              >
                                <ArrowDownToLine className="h-3.5 w-3.5" />
                              </Button>
                            )}
                            {canTransition(p, 'rejected') && (
                              <Button
                                variant="ghost"
                                size="icon"
                                className="h-7 w-7 text-red-400 hover:text-red-300 hover:bg-red-500/10"
                                title={t('payouts.reject')}
                                onClick={() => handleStatusChange(p, 'rejected')}
                              >
                                <X className="h-3.5 w-3.5" />
                              </Button>
                            )}
                          </>
                        )}
                        {/* Edit (non-terminal) */}
                        {canManagePayouts && !isTerminal && (
                          <Button variant="ghost" size="icon" className="h-7 w-7 text-zinc-400 hover:text-zinc-200" onClick={() => openEdit(p)}>
                            <Pencil className="h-3.5 w-3.5" />
                          </Button>
                        )}
                        {/* Delete. Settled payouts stay closed to faction admins —
                            the amount has already moved through the treasury — but a
                            superadmin needs a way to take out one that should never
                            have been recorded. */}
                        {canManagePayouts && (!isTerminal || isSuperadmin) && (
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-7 w-7 text-destructive hover:text-red-300"
                            title={isTerminal ? t('payouts.deleteSuperadmin') : t('common.delete')}
                            onClick={() => setDeleteId(p.id)}
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </Button>
                        )}
                      </div>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-center gap-2">
          <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage(page - 1)}>{t('common.previous')}</Button>
          <span className="text-xs text-zinc-500">{t('common.pageOf', { page, pages: totalPages })}</span>
          <Button variant="outline" size="sm" disabled={page >= totalPages} onClick={() => setPage(page + 1)}>{t('common.next')}</Button>
        </div>
      )}

      {/* ═══ Create Dialog ═══ */}
      <Dialog open={createOpen} onOpenChange={(open) => { setCreateOpen(open); if (!open) resetCreateForm(); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{canManagePayouts ? t('payouts.new') : t('payouts.request')}</DialogTitle>
            <DialogDescription>
              {canManagePayouts ? t('payouts.newHint') : t('payouts.requestHint')}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            {/* With no reach over other names there is nothing to choose here,
                so the field goes and the request simply carries yours. */}
            {canManagePayouts ? (
              <div className="space-y-2">
                <Label>{t('payouts.recipientRequired')}</Label>
                <SearchableSelect
                  value={formRecipient}
                  onValueChange={setFormRecipient}
                  options={memberOptions}
                  placeholder={t('members.select')}
                  searchPlaceholder={t('members.search')}
                  emptyMessage={t('members.noneMatch')}
                />
              </div>
            ) : (
              <p className="text-xs text-zinc-500">{t('payouts.forYou')}</p>
            )}
            <div className="space-y-2">
              <Label>{t('payouts.itemTypeRequired')}</Label>
              <SearchableSelect
                value={formItemType}
                onValueChange={setFormItemType}
                options={itemTypeOptions}
                placeholder={t('itemTypes.select')}
                searchPlaceholder={t('itemTypes.search')}
                emptyMessage={t('itemTypes.noneMatch')}
              />
            </div>
            <div className="space-y-2">
              <Label>{t('payouts.amountRequired')}</Label>
              <Input
                type="number"
                step="0.01"
                min="0.01"
                placeholder="0.00"
                value={formAmount}
                onChange={(e) => setFormAmount(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label>{t('common.description')}</Label>
              <Input
                placeholder={t('payouts.descriptionPlaceholder')}
                value={formDescription}
                onChange={(e) => setFormDescription(e.target.value)}
                maxLength={500}
              />
            </div>
            <div className="space-y-2">
              <Label>{t('common.date')}</Label>
              <Input
                type="date"
                value={formDate}
                onChange={(e) => setFormDate(e.target.value)}
                max={new Date().toISOString().slice(0, 10)}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => { setCreateOpen(false); resetCreateForm(); }}>{t('common.cancel')}</Button>
            <Button
              disabled={(canManagePayouts && !formRecipient) || !formItemType || !formAmount || Number(formAmount) <= 0 || createMutation.isPending}
              onClick={() => createMutation.mutate()}
              style={{ backgroundColor: brandColor }}
            >
              {createMutation.isPending ? t('common.creating') : (canManagePayouts ? t('payouts.create') : t('payouts.request'))}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ═══ Edit Dialog ═══ */}
      <Dialog open={!!editPayout} onOpenChange={(open) => { if (!open) setEditPayout(null); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t('payouts.edit')}</DialogTitle>
            <DialogDescription>
              {t('payouts.editHint', {
                name: editPayout ? fullDisplayName({ username: editPayout.recipientUsername, inGameName: editPayout.recipientInGameName }) : '',
                itemType: editPayout?.itemTypeName ?? '',
              })}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-2">
              <Label>{t('common.amount')}</Label>
              <Input
                type="number"
                step="0.01"
                min="0.01"
                value={editAmount}
                onChange={(e) => setEditAmount(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label>{t('common.description')}</Label>
              <Input
                value={editDescription}
                onChange={(e) => setEditDescription(e.target.value)}
                maxLength={500}
              />
            </div>
            <div className="space-y-2">
              <Label>{t('common.date')}</Label>
              <Input
                type="date"
                value={editDate}
                onChange={(e) => setEditDate(e.target.value)}
                max={new Date().toISOString().slice(0, 10)}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditPayout(null)}>{t('common.cancel')}</Button>
            <Button
              disabled={updateMutation.isPending || Number(editAmount) <= 0}
              onClick={handleEditSave}
              style={{ backgroundColor: brandColor }}
            >
              {updateMutation.isPending ? t('common.saving') : t('common.save')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ═══ Even Split Dialog ═══ */}
      <Dialog open={evenSplitOpen} onOpenChange={setEvenSplitOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t('payouts.evenSplitTitle')}</DialogTitle>
            <DialogDescription>{t('payouts.evenSplitHint')}</DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="rounded-lg border border-amber-500/20 bg-amber-500/5 p-3 text-sm text-amber-300">
              {t('payouts.evenSplitWarning', { count: members.length })}
            </div>
            <div className="space-y-2">
              <Label>{t('payouts.itemTypeRequired')}</Label>
              <SearchableSelect
                value={splitItemType}
                onValueChange={setSplitItemType}
                options={itemTypeOptions}
                placeholder={t('itemTypes.select')}
                searchPlaceholder={t('itemTypes.search')}
                emptyMessage={t('itemTypes.noneMatch')}
              />
            </div>
            <div className="space-y-2">
              <Label>{t('payouts.totalAmountRequired')}</Label>
              <Input
                type="number"
                step="0.01"
                min="0.01"
                placeholder="0.00"
                value={splitTotal}
                onChange={(e) => setSplitTotal(e.target.value)}
              />
              {splitTotal && Number(splitTotal) > 0 && members.length > 0 && (
                <p className="text-xs text-zinc-500">
                  {t('payouts.splitPreview', {
                    count: members.length,
                    each: fmt(Math.floor(Number(splitTotal) * 100 / members.length) / 100),
                    distributed: fmt(Math.floor(Number(splitTotal) * 100 / members.length) / 100 * members.length),
                  })}
                  {(() => {
                    const rem = (Number(splitTotal) * 100 - Math.floor(Number(splitTotal) * 100 / members.length) * members.length) / 100;
                    return rem > 0 ? <>{t('payouts.splitRemainder', { remainder: fmt(rem) })}</> : null;
                  })()}
                </p>
              )}
            </div>
            <div className="space-y-2">
              <Label>{t('common.description')}</Label>
              <Input
                placeholder={t('payouts.evenSplitTitle')}
                value={splitDescription}
                onChange={(e) => setSplitDescription(e.target.value)}
                maxLength={500}
              />
            </div>
            <div className="space-y-2">
              <Label>{t('common.date')}</Label>
              <Input
                type="date"
                value={splitDate}
                onChange={(e) => setSplitDate(e.target.value)}
                max={new Date().toISOString().slice(0, 10)}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEvenSplitOpen(false)}>{t('common.cancel')}</Button>
            <Button
              disabled={!splitItemType || !splitTotal || Number(splitTotal) <= 0 || evenSplitMutation.isPending}
              onClick={() => evenSplitMutation.mutate()}
              style={{ backgroundColor: brandColor }}
            >
              {evenSplitMutation.isPending
                ? t('payouts.distributing')
                : t('payouts.splitAction', { amount: splitTotal || '0', count: members.length })}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ═══ Delete Confirmation ═══ */}
      <AlertDialog open={!!deleteId} onOpenChange={(open) => { if (!open) setDeleteId(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t('payouts.deleteTitle')}</AlertDialogTitle>
            <AlertDialogDescription>{t('payouts.deleteConfirm')}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t('common.cancel')}</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              disabled={deleteMutation.isPending}
              onClick={() => { if (deleteId) deleteMutation.mutate(deleteId); }}
            >
              {deleteMutation.isPending ? t('common.deleting') : t('common.delete')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
