'use client';

import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { isAxiosError } from 'axios';
import { factionSettingsApi, itemTypesApi, wagesApi, apiErrorMessage } from '@/lib/api-client';
import { usePersistedState } from '@/hooks/use-persisted-state';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { Segmented } from '@/components/ui/segmented';
import { SearchableSelect } from '@/components/ui/searchable-select';
import { EmptyState, ErrorState } from '@/components/ui/empty-state';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { ItemIcon } from '@/components/item-icon';
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
import { cents, convertCents, fromCents, isPercent, isRate, rateUnits, shareCents } from '@/lib/wage-math';
import { cn } from '@/lib/utils';
import { ArrowRight, HandCoins, Percent, Plus, Trash2 } from 'lucide-react';
import type { CommissionRate, ItemType } from '@/lib/api-types';

type Period = 'this-week' | 'last-week' | 'this-month' | 'last-month';

const pad = (n: number) => String(n).padStart(2, '0');
const isoDay = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

/** A period as calendar days, both ends included, Monday-first. */
function daysFor(period: Period): { from: string; to: string } {
  const now = new Date();
  if (period === 'this-month' || period === 'last-month') {
    const offset = period === 'last-month' ? -1 : 0;
    return {
      from: isoDay(new Date(now.getFullYear(), now.getMonth() + offset, 1)),
      to: isoDay(new Date(now.getFullYear(), now.getMonth() + offset + 1, 0)),
    };
  }
  const monday = new Date(now.getFullYear(), now.getMonth(), now.getDate() - ((now.getDay() + 6) % 7));
  if (period === 'last-week') monday.setDate(monday.getDate() - 7);
  const sunday = new Date(monday);
  sunday.setDate(monday.getDate() + 6);
  return { from: isoDay(monday), to: isoDay(sunday) };
}

/** "0.7500" as "0.75", the way somebody would have typed it. */
const trimRate = (rate: string) => (rate.includes('.') ? rate.replace(/\.?0+$/, '') : rate);

const lineKey = (l: { userId: string; itemTypeId: string }) => `${l.userId}:${l.itemTypeId}`;

/**
 * Wages from takings: what each member brought in over a week or a month, the
 * percentage they keep, and what stays with the faction — and paying it.
 *
 * One item at a time. The first version showed every item's lines at once,
 * with per-line checkboxes and a filter wall of every item the faction owns,
 * and it read as a spreadsheet. Now the tabs are only the items somebody
 * actually brought in, and each is three numbers, a short table and a button.
 *
 * The percentages start from the saved table (per rank, per item, with a row
 * for everyone else) and every line can be changed on the spot, so the page
 * also works as a plain calculator. A member at 0% is not paid. Paying sends
 * exactly the lines on screen; if the takings changed meanwhile the server
 * refuses, and the page refreshes rather than paying on numbers nobody saw.
 */
export function WagesView({ factionId, canPayDirect }: { factionId: string; canPayDirect: boolean }) {
  const { t } = useTranslation();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [period, setPeriod] = usePersistedState<Period>(`wages.period.${factionId}`, 'last-week');
  const [pickedItem, setPickedItem] = usePersistedState<string>(`wages.item.${factionId}`, '');
  const [overrides, setOverrides] = useState<Record<string, string>>({});
  const [everyone, setEveryone] = useState('');
  // What each brought item is paid in, as changed on this screen and not yet
  // saved. Kept across periods: it is how the faction pays, not what it owes.
  const [payInEdits, setPayInEdits] = useState<Record<string, { payItemTypeId: string; rate: string }>>({});
  const [ratesOpen, setRatesOpen] = useState(false);
  const [confirming, setConfirming] = useState(false);

  const range = useMemo(() => daysFor(period), [period]);

  const itemsQuery = useQuery({
    queryKey: ['item-types', factionId],
    queryFn: () => itemTypesApi.list(factionId),
  });
  const itemById = useMemo(() => new Map((itemsQuery.data ?? []).map((i: ItemType) => [i.id, i])), [itemsQuery.data]);

  const takings = useQuery({
    queryKey: ['wages', factionId, range.from, range.to],
    queryFn: () => wagesApi.takings(factionId, range.from, range.to, []),
  });

  // What was typed belongs to the period it was typed against.
  useEffect(() => {
    setOverrides({});
    setEveryone('');
  }, [range.from, range.to]);

  const lines = useMemo(() => takings.data?.lines ?? [], [takings.data]);

  // Only the items somebody brought in, biggest haul of members first.
  const presentItems = useMemo(() => {
    const counts = new Map<string, number>();
    for (const l of lines) counts.set(l.itemTypeId, (counts.get(l.itemTypeId) ?? 0) + 1);
    return [...counts.entries()]
      .map(([id, members]) => ({ id, members, item: itemById.get(id) }))
      .sort((a, b) => b.members - a.members || (a.item?.name ?? '').localeCompare(b.item?.name ?? ''));
  }, [lines, itemById]);

  const itemId = presentItems.some((p) => p.id === pickedItem) ? pickedItem : presentItems[0]?.id ?? '';
  const item = itemById.get(itemId);
  const isCurrency = item?.isCurrency ?? true;

  // Paid in: this screen's edit, else the saved default, else the item itself.
  const savedPayIn = takings.data?.payIn.find((p) => p.itemTypeId === itemId);
  const payIn = payInEdits[itemId]
    ?? (savedPayIn ? { payItemTypeId: savedPayIn.payItemTypeId, rate: trimRate(savedPayIn.rate) } : { payItemTypeId: itemId, rate: '1' });
  const payItem = itemById.get(payIn.payItemTypeId) ?? item;
  const payIsCurrency = payItem?.isCurrency ?? true;
  const converts = payIn.payItemTypeId !== itemId || (isRate(payIn.rate) && rateUnits(payIn.rate) !== 10_000);
  const payInChanged = !!payInEdits[itemId] && (
    savedPayIn
      ? savedPayIn.payItemTypeId !== payIn.payItemTypeId || rateUnits(savedPayIn.rate) !== rateUnits(payIn.rate || '0')
      : converts
  );

  const rows = useMemo(() => lines
    .filter((l) => l.itemTypeId === itemId)
    .map((line) => {
      const percent = overrides[lineKey(line)] ?? line.ratePercent ?? '';
      const share = shareCents(line.brought, percent || '0', isCurrency);
      const paid = converts ? convertCents(share, payIn.rate, payIsCurrency) : share;
      return { line, percent, share, paid };
    }), [lines, itemId, overrides, isCurrency, converts, payIn.rate, payIsCurrency]);

  const brought = rows.reduce((sum, r) => sum + cents(r.line.brought), 0);
  const paidTotal = rows.reduce((sum, r) => sum + r.paid, 0);
  const payable = rows.filter((r) => r.paid > 0 && isPercent(r.percent));
  const invalid = rows.some((r) => r.percent !== '' && !isPercent(r.percent)) || !isRate(payIn.rate);
  const missingRates = rows.some((r) => r.line.ratePercent === null && overrides[lineKey(r.line)] === undefined);

  const pay = useMutation({
    mutationFn: () => wagesApi.pay(factionId, range.from, range.to, payable.map((r) => ({
      userId: r.line.userId,
      itemTypeId: r.line.itemTypeId,
      percent: r.percent.trim(),
      brought: r.line.brought,
      ...(converts ? { payItemTypeId: payIn.payItemTypeId, rate: payIn.rate.trim() } : {}),
    }))),
    onSuccess: (result) => {
      setConfirming(false);
      void queryClient.invalidateQueries({ queryKey: ['wages', factionId] });
      void queryClient.invalidateQueries({ queryKey: ['payouts'] });
      void queryClient.invalidateQueries({ queryKey: ['treasury'] });
      void queryClient.invalidateQueries({ queryKey: ['entries', factionId] });
      toast({
        title: result.status === 'completed'
          ? t('wages.paid', { count: result.created })
          : t('wages.requested', { count: result.created }),
      });
    },
    onError: (err) => {
      setConfirming(false);
      if (isAxiosError(err) && err.response?.status === 409) {
        void takings.refetch();
        toast({ title: t('wages.stale'), variant: 'destructive' });
        return;
      }
      toast({ title: t('common.failed'), description: apiErrorMessage(err), variant: 'destructive' });
    },
  });

  const applyToEveryone = () => {
    if (!isPercent(everyone)) return;
    setOverrides((current) => ({
      ...current,
      ...Object.fromEntries(rows.map((r) => [lineKey(r.line), everyone.trim()])),
    }));
  };

  const savePayIn = useMutation({
    mutationFn: () => wagesApi.savePayIn(factionId, itemId, payIn.payItemTypeId, payIn.rate.trim()),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['wages', factionId] });
      setPayInEdits((current) => {
        const next = { ...current };
        delete next[itemId];
        return next;
      });
      toast({ title: t('wages.payInSaved') });
    },
    onError: (err) =>
      toast({ title: t('common.failed'), description: apiErrorMessage(err), variant: 'destructive' }),
  });

  const editPayIn = (patch: Partial<{ payItemTypeId: string; rate: string }>) =>
    setPayInEdits((current) => ({ ...current, [itemId]: { ...payIn, ...patch } }));

  const amount = (value: number) => formatAmount(fromCents(value), item?.unit ?? '', isCurrency);
  const payAmount = (value: number) => formatAmount(fromCents(value), payItem?.unit ?? '', payIsCurrency);
  const payLabel = canPayDirect
    ? t('wages.pay', { count: payable.length })
    : t('wages.request', { count: payable.length });

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold text-zinc-100">{t('wages.title')}</h1>
          <p className="mt-1 max-w-2xl text-sm text-zinc-400">{t('wages.subtitle')}</p>
        </div>
        <Button variant="outline" size="sm" onClick={() => setRatesOpen(true)}>
          <Percent className="mr-1.5 h-3.5 w-3.5" /> {t('wages.rates')}
        </Button>
      </div>

      <Segmented
        label={t('payroll.period')}
        value={period}
        onChange={setPeriod}
        options={[
          { value: 'this-week', label: t('payroll.thisWeek') },
          { value: 'last-week', label: t('payroll.lastWeek') },
          { value: 'this-month', label: t('payroll.thisMonth') },
          { value: 'last-month', label: t('payroll.lastMonth') },
        ]}
      />

      {takings.isLoading ? (
        <div className="space-y-3">
          <Skeleton className="h-10 w-64" />
          <Skeleton className="h-48 w-full" />
        </div>
      ) : takings.isError ? (
        <ErrorState error={takings.error} onRetry={() => void takings.refetch()} />
      ) : presentItems.length === 0 ? (
        <EmptyState icon={HandCoins} title={t('wages.empty')} hint={t('wages.emptyHint')} />
      ) : (
        <>
          {/* One tab per item that was brought in. */}
          {presentItems.length > 1 && (
            <div className="flex flex-wrap gap-1.5" role="tablist" aria-label={t('wages.item')}>
              {presentItems.map((p) => {
                const on = p.id === itemId;
                return (
                  <button
                    key={p.id}
                    type="button"
                    role="tab"
                    aria-selected={on}
                    onClick={() => setPickedItem(p.id)}
                    className={cn(
                      'flex items-center gap-2 rounded-lg border px-3 py-1.5 text-sm transition-colors',
                      on
                        ? 'border-[var(--brand-color)] bg-[var(--brand-color-light)] text-zinc-100'
                        : 'border-zinc-800 text-zinc-400 hover:text-zinc-200',
                    )}
                  >
                    <ItemIcon src={p.item?.imageUrl} icon={p.item?.icon} category={p.item?.category} className="size-5" />
                    {p.item?.name}
                    <span className="text-xs text-zinc-500">{p.members}</span>
                  </button>
                );
              })}
            </div>
          )}

          <Card key={itemId} className="animate-fade-in">
            <CardContent className="space-y-5 py-5">
              {/* The three numbers that matter. */}
              <dl className="grid grid-cols-3 gap-3">
                <div>
                  <dt className="text-xs text-zinc-500">{t('wages.brought')}</dt>
                  <dd className="text-lg font-semibold tabular-nums text-zinc-100 sm:text-2xl">{amount(brought)}</dd>
                </div>
                <div>
                  <dt className="text-xs text-zinc-500">{t('wages.memberGets')}</dt>
                  <dd className="text-lg font-semibold tabular-nums text-emerald-300 sm:text-2xl">{payAmount(paidTotal)}</dd>
                  {converts && (
                    <dd className="text-[11px] text-zinc-500">{t('wages.inItem', { item: payItem?.name ?? '' })}</dd>
                  )}
                </div>
                <div>
                  <dt className="text-xs text-zinc-500">{t('wages.factionKeeps')}</dt>
                  <dd className="text-lg font-semibold tabular-nums text-zinc-100 sm:text-2xl">{amount(payIn.payItemTypeId !== itemId ? brought : brought - paidTotal)}</dd>
                </div>
              </dl>

              {/* What the cut is paid in: the item itself, or another at a value. */}
              <div className="flex flex-wrap items-center gap-2 border-t border-zinc-800 pt-4">
                <span className="text-sm text-zinc-400">{t('wages.paidIn')}</span>
                <SearchableSelect
                  className="w-44"
                  size="sm"
                  value={payIn.payItemTypeId}
                  onValueChange={(payItemTypeId) => editPayIn(
                    payItemTypeId === itemId ? { payItemTypeId, rate: '1' } : { payItemTypeId },
                  )}
                  options={(itemsQuery.data ?? [])
                    .filter((i: ItemType) => i.isActive !== false || i.id === itemId)
                    .map((i: ItemType) => ({
                      value: i.id,
                      label: i.name,
                      icon: <ItemIcon src={i.imageUrl} icon={i.icon} category={i.category} className="size-4" />,
                    }))}
                  aria-label={t('wages.paidIn')}
                />
                {payIn.payItemTypeId !== itemId && (
                  <span className="flex flex-wrap items-center gap-1.5 text-sm text-zinc-400">
                    <span>1 {item?.name}</span>
                    <ArrowRight className="h-3.5 w-3.5 text-zinc-600" />
                    <Input
                      className={cn('h-8 w-20', !isRate(payIn.rate) && 'border-red-500/60')}
                      inputMode="decimal"
                      value={payIn.rate}
                      onChange={(e) => editPayIn({ rate: e.target.value })}
                      placeholder="0.7"
                      aria-label={t('wages.exchange')}
                    />
                    <span>{payItem?.name}</span>
                  </span>
                )}
                {payInChanged && (
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => savePayIn.mutate()}
                    disabled={!isRate(payIn.rate) || savePayIn.isPending}
                  >
                    {t('wages.saveDefault')}
                  </Button>
                )}
              </div>

              <div className="flex flex-wrap items-center gap-2">
                <span className="text-sm text-zinc-400">{t('wages.everyoneGets')}</span>
                <Input
                  className="h-8 w-20"
                  inputMode="decimal"
                  value={everyone}
                  onChange={(e) => setEveryone(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && applyToEveryone()}
                  placeholder="30"
                  aria-label={t('wages.everyoneGets')}
                />
                <span className="text-sm text-zinc-500">%</span>
                <Button size="sm" variant="outline" onClick={applyToEveryone} disabled={!isPercent(everyone)}>
                  {t('wages.apply')}
                </Button>
                {missingRates && (
                  <span className="w-full text-xs text-amber-300 sm:ml-auto sm:w-auto">{t('wages.noRatesHint')}</span>
                )}
              </div>

              <div>
                <div className="hidden grid-cols-[minmax(0,1fr)_8rem_6.5rem_8rem] gap-3 px-2 pb-2 text-xs text-zinc-500 sm:grid">
                  <span>{t('wages.member')}</span>
                  <span className="text-right">{t('wages.brought')}</span>
                  <span>{t('wages.percent')}</span>
                  <span className="text-right">{t('wages.gets')}</span>
                </div>
                <div className="stagger divide-y divide-zinc-800/70">
                  {rows.map((row) => {
                    const key = lineKey(row.line);
                    const bad = row.percent !== '' && !isPercent(row.percent);
                    return (
                      <div
                        key={key}
                        className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-2 px-2 py-2.5 sm:grid-cols-[minmax(0,1fr)_8rem_6.5rem_8rem]"
                      >
                        <span className="flex min-w-0 items-center gap-2">
                          <Avatar className="h-7 w-7">
                            <AvatarImage src={row.line.avatarUrl ?? undefined} alt="" />
                            <AvatarFallback className="text-[9px]">{row.line.userName.slice(0, 2).toUpperCase()}</AvatarFallback>
                          </Avatar>
                          <span className="min-w-0">
                            <span className="block truncate text-sm text-zinc-100">{row.line.userName}</span>
                            {row.line.rank && <span className="block truncate text-[11px] text-zinc-500">{row.line.rank}</span>}
                          </span>
                        </span>
                        <span className="text-right text-sm tabular-nums text-zinc-300">
                          {amount(cents(row.line.brought))}
                        </span>
                        <span className="flex items-center gap-1">
                          <Input
                            className={cn('h-8 w-16', bad && 'border-red-500/60')}
                            inputMode="decimal"
                            value={row.percent}
                            placeholder="0"
                            onChange={(e) => setOverrides((current) => ({ ...current, [key]: e.target.value }))}
                            aria-label={`${t('wages.percent')} — ${row.line.userName}`}
                          />
                          <span className="text-xs text-zinc-500">%</span>
                        </span>
                        <span className={cn(
                          'text-right text-sm font-medium tabular-nums',
                          row.paid > 0 ? 'text-emerald-300' : 'text-zinc-600',
                        )}>
                          {payAmount(row.paid)}
                        </span>
                      </div>
                    );
                  })}
                </div>
              </div>

              <div className="flex flex-wrap items-center justify-end gap-3 border-t border-zinc-800 pt-4">
                <p className="mr-auto text-[11px] text-zinc-500">
                  {t('wages.zeroSkipped')}{!isCurrency && ` ${t('wages.wholeUnits')}`}
                </p>
                <Button onClick={() => setConfirming(true)} disabled={payable.length === 0 || invalid || pay.isPending}>
                  <HandCoins className="mr-2 h-4 w-4" />
                  {payLabel}
                </Button>
              </div>
            </CardContent>
          </Card>
        </>
      )}

      {ratesOpen && (
        <RatesDialog
          factionId={factionId}
          items={(itemsQuery.data ?? []).filter((i: ItemType) => i.isActive !== false)}
          onClose={() => setRatesOpen(false)}
        />
      )}

      <AlertDialog open={confirming} onOpenChange={setConfirming}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {canPayDirect ? t('wages.confirmPayTitle') : t('wages.confirmRequestTitle')}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {canPayDirect
                ? t('wages.confirmPayBody', { count: payable.length, amount: payAmount(paidTotal), item: payItem?.name ?? '' })
                : t('wages.confirmRequestBody', { count: payable.length, amount: payAmount(paidTotal), item: payItem?.name ?? '' })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t('common.cancel')}</AlertDialogCancel>
            <AlertDialogAction onClick={() => pay.mutate()} disabled={pay.isPending}>
              {payLabel}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

/** The saved percentages: a row per rank and item, plus "everyone else". */
function RatesDialog({ factionId, items, onClose }: { factionId: string; items: ItemType[]; onClose: () => void }) {
  const { t } = useTranslation();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [rows, setRows] = useState<CommissionRate[] | null>(null);

  const current = useQuery({
    queryKey: ['wage-rates', factionId],
    queryFn: () => wagesApi.rates(factionId),
  });
  const settings = useQuery({
    queryKey: ['faction-settings', factionId],
    queryFn: () => factionSettingsApi.get(factionId),
  });

  const EVERYONE = '__everyone__';
  const ranks = [...(settings.data?.ranks ?? [])].sort((a, b) => a.level - b.level);
  const editing = rows ?? current.data?.rates ?? null;

  const update = (index: number, patch: Partial<CommissionRate>) =>
    setRows((editing ?? []).map((r, i) => (i === index ? { ...r, ...patch } : r)));

  const save = useMutation({
    mutationFn: () => wagesApi.saveRates(factionId, (editing ?? []).map((r) => ({ ...r, percent: r.percent.trim() }))),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['wage-rates', factionId] });
      void queryClient.invalidateQueries({ queryKey: ['wages', factionId] });
      toast({ title: t('wages.ratesSaved') });
      onClose();
    },
    onError: (err) =>
      toast({ title: t('common.failed'), description: apiErrorMessage(err), variant: 'destructive' }),
  });

  const valid = (editing ?? []).every((r) => r.itemTypeId && isPercent(r.percent));

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle>{t('wages.ratesTitle')}</DialogTitle>
          <DialogDescription>{t('wages.ratesHint')}</DialogDescription>
        </DialogHeader>

        {!editing ? (
          <Skeleton className="h-24 w-full" />
        ) : (
          <div className="max-h-[60vh] space-y-2 overflow-y-auto">
            {editing.map((row, index) => (
              <div key={index} className="flex flex-wrap items-center gap-2">
                <SearchableSelect
                  className="min-w-[8rem] flex-1"
                  size="sm"
                  value={row.rank ?? EVERYONE}
                  onValueChange={(value) => update(index, { rank: value === EVERYONE ? null : value })}
                  options={[
                    { value: EVERYONE, label: t('wages.everyoneElse') },
                    ...ranks.map((r) => ({ value: r.name, label: r.name })),
                  ]}
                  aria-label={t('wages.rank')}
                />
                <SearchableSelect
                  className="min-w-[8rem] flex-1"
                  size="sm"
                  value={row.itemTypeId}
                  onValueChange={(itemTypeId) => update(index, { itemTypeId })}
                  options={items.map((i) => ({ value: i.id, label: i.name }))}
                  aria-label={t('wages.item')}
                />
                <span className="flex items-center gap-1">
                  <Input
                    className="w-20"
                    inputMode="decimal"
                    value={row.percent}
                    onChange={(e) => update(index, { percent: e.target.value })}
                    placeholder="30"
                    aria-label={t('wages.percent')}
                  />
                  <span className="text-xs text-zinc-500">%</span>
                </span>
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label={t('common.remove')}
                  onClick={() => setRows(editing.filter((_, i) => i !== index))}
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>
            ))}
            <Button
              variant="outline"
              size="sm"
              disabled={items.length === 0}
              onClick={() => setRows([...editing, { rank: null, itemTypeId: items[0]?.id ?? '', percent: '' }])}
            >
              <Plus className="mr-1.5 h-3.5 w-3.5" /> {t('wages.addRate')}
            </Button>
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>{t('common.cancel')}</Button>
          <Button onClick={() => save.mutate()} disabled={!editing || !valid || save.isPending}>
            {t('common.save')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
