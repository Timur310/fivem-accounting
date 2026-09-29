'use client';

import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { isAxiosError } from 'axios';
import { factionSettingsApi, itemTypesApi, wagesApi, apiErrorMessage } from '@/lib/api-client';
import { usePersistedState } from '@/hooks/use-persisted-state';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
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
import { cents, fromCents, isPercent, shareCents } from '@/lib/wage-math';
import { cn } from '@/lib/utils';
import { HandCoins, Percent, Plus, Trash2 } from 'lucide-react';
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

const lineKey = (l: { userId: string; itemTypeId: string }) => `${l.userId}:${l.itemTypeId}`;

/**
 * Wages from takings: what each member brought in over a week or a month, the
 * percentage they keep, and what stays with the faction — and paying it.
 *
 * The percentages start from the saved table (per rank, per item, with a row
 * for everyone else) and every line can be changed on the spot, so the page
 * also works as a plain calculator for a faction that never saves any. Paying
 * sends exactly the lines on screen; if the takings changed meanwhile the
 * server refuses, and the page refreshes rather than paying on numbers nobody
 * looked at.
 */
export function WagesView({ factionId, canPayDirect }: { factionId: string; canPayDirect: boolean }) {
  const { t } = useTranslation();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [period, setPeriod] = usePersistedState<Period>(`wages.period.${factionId}`, 'last-week');
  const [itemFilter, setItemFilter] = usePersistedState<string[]>(`wages.items.${factionId}`, []);
  const [overrides, setOverrides] = useState<Record<string, string>>({});
  const [excluded, setExcluded] = useState<ReadonlySet<string>>(new Set());
  const [setAll, setSetAll] = useState('');
  const [ratesOpen, setRatesOpen] = useState(false);
  const [confirming, setConfirming] = useState(false);

  const range = useMemo(() => daysFor(period), [period]);

  const itemsQuery = useQuery({
    queryKey: ['item-types', factionId],
    queryFn: () => itemTypesApi.list(factionId),
  });
  const items = useMemo(() => (itemsQuery.data ?? []).filter((i: ItemType) => i.isActive !== false), [itemsQuery.data]);
  const itemById = useMemo(() => new Map((itemsQuery.data ?? []).map((i: ItemType) => [i.id, i])), [itemsQuery.data]);
  // Items that were removed since they were picked are simply not asked for.
  const chosen = useMemo(() => itemFilter.filter((id) => itemById.has(id)), [itemFilter, itemById]);

  const takings = useQuery({
    queryKey: ['wages', factionId, range.from, range.to, chosen.join(',')],
    queryFn: () => wagesApi.takings(factionId, range.from, range.to, chosen),
  });

  // What was typed belongs to the numbers it was typed against.
  const scope = `${range.from}|${range.to}|${chosen.join(',')}`;
  useEffect(() => {
    setOverrides({});
    setExcluded(new Set());
  }, [scope]);

  const lines = useMemo(() => takings.data?.lines ?? [], [takings.data]);

  const rows = useMemo(() => lines.map((line) => {
    const item = itemById.get(line.itemTypeId);
    const isCurrency = item?.isCurrency ?? true;
    const percent = overrides[lineKey(line)] ?? line.ratePercent ?? '';
    const share = shareCents(line.brought, percent || '0', isCurrency);
    return { line, item, isCurrency, percent, share, keeps: cents(line.brought) - share, included: !excluded.has(lineKey(line)) };
  }), [lines, itemById, overrides, excluded]);

  const byMember = useMemo(() => {
    const groups = new Map<string, typeof rows>();
    for (const row of rows) groups.set(row.line.userId, [...(groups.get(row.line.userId) ?? []), row]);
    return [...groups.values()];
  }, [rows]);

  const totals = useMemo(() => {
    const perItem = new Map<string, { brought: number; share: number }>();
    for (const row of rows) {
      if (!row.included) continue;
      const total = perItem.get(row.line.itemTypeId) ?? { brought: 0, share: 0 };
      total.brought += cents(row.line.brought);
      total.share += row.share;
      perItem.set(row.line.itemTypeId, total);
    }
    return [...perItem.entries()];
  }, [rows]);

  const payable = rows.filter((r) => r.included && r.share > 0 && isPercent(r.percent));
  const invalid = rows.some((r) => r.included && r.percent !== '' && !isPercent(r.percent));

  const pay = useMutation({
    mutationFn: () => wagesApi.pay(factionId, range.from, range.to, payable.map((r) => ({
      userId: r.line.userId,
      itemTypeId: r.line.itemTypeId,
      percent: r.percent.trim(),
      brought: r.line.brought,
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

  const toggleItem = (id: string) =>
    setItemFilter((current) => (current.includes(id) ? current.filter((i) => i !== id) : [...current, id]));

  const applyToAll = () => {
    if (!isPercent(setAll)) return;
    setOverrides(Object.fromEntries(lines.map((l) => [lineKey(l), setAll.trim()])));
  };

  const amount = (value: number, itemTypeId: string) => {
    const item = itemById.get(itemTypeId);
    return formatAmount(fromCents(value), item?.unit ?? '', item?.isCurrency ?? true);
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold text-zinc-100">{t('wages.title')}</h1>
          <p className="mt-1 max-w-2xl text-sm text-zinc-400">{t('wages.subtitle')}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
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
          <Button variant="outline" size="sm" onClick={() => setRatesOpen(true)}>
            <Percent className="mr-1.5 h-3.5 w-3.5" /> {t('wages.rates')}
          </Button>
        </div>
      </div>

      {/* Which items count. None picked is every item. */}
      <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label={t('wages.items')}>
        <button
          type="button"
          onClick={() => setItemFilter([])}
          className={cn(
            'rounded-full border px-3 py-1 text-xs transition-colors',
            chosen.length === 0
              ? 'border-[var(--brand-color)] bg-[var(--brand-color-light)] text-zinc-100'
              : 'border-zinc-800 text-zinc-400 hover:text-zinc-200',
          )}
          aria-pressed={chosen.length === 0}
        >
          {t('wages.allItems')}
        </button>
        {items.map((item: ItemType) => {
          const on = chosen.includes(item.id);
          return (
            <button
              key={item.id}
              type="button"
              onClick={() => toggleItem(item.id)}
              aria-pressed={on}
              className={cn(
                'flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs transition-colors',
                on
                  ? 'border-[var(--brand-color)] bg-[var(--brand-color-light)] text-zinc-100'
                  : 'border-zinc-800 text-zinc-400 hover:text-zinc-200',
              )}
            >
              <ItemIcon src={item.imageUrl} icon={item.icon} category={item.category} className="size-4" />
              {item.name}
            </button>
          );
        })}
      </div>

      {takings.isLoading ? (
        <div className="space-y-3">
          <Skeleton className="h-20 w-full" />
          <Skeleton className="h-32 w-full" />
        </div>
      ) : takings.isError ? (
        <ErrorState error={takings.error} onRetry={() => void takings.refetch()} />
      ) : lines.length === 0 ? (
        <EmptyState icon={HandCoins} title={t('wages.empty')} hint={t('wages.emptyHint')} />
      ) : (
        <>
          {/* What it comes to, per item. */}
          <div className="stagger grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {totals.map(([itemTypeId, total]) => {
              const item = itemById.get(itemTypeId);
              return (
                <Card key={itemTypeId}>
                  <CardContent className="space-y-2 py-4">
                    <p className="flex items-center gap-2 text-sm font-medium text-zinc-200">
                      <ItemIcon src={item?.imageUrl} icon={item?.icon} category={item?.category} className="size-5" />
                      {item?.name}
                    </p>
                    <dl className="grid grid-cols-3 gap-2 text-xs">
                      <div>
                        <dt className="text-zinc-500">{t('wages.brought')}</dt>
                        <dd className="tabular-nums text-zinc-200">{amount(total.brought, itemTypeId)}</dd>
                      </div>
                      <div>
                        <dt className="text-zinc-500">{t('wages.memberGets')}</dt>
                        <dd className="tabular-nums text-emerald-300">{amount(total.share, itemTypeId)}</dd>
                      </div>
                      <div>
                        <dt className="text-zinc-500">{t('wages.factionKeeps')}</dt>
                        <dd className="tabular-nums text-zinc-200">{amount(total.brought - total.share, itemTypeId)}</dd>
                      </div>
                    </dl>
                  </CardContent>
                </Card>
              );
            })}
          </div>

          <div className="flex flex-wrap items-center justify-between gap-2">
            {!takings.data?.hasRates ? (
              <p className="text-xs text-amber-300">{t('wages.noRatesHint')}</p>
            ) : <span />}
            <div className="flex items-center gap-2">
              <span className="text-xs text-zinc-500">{t('wages.setAll')}</span>
              <Input
                className="w-20"
                inputMode="decimal"
                value={setAll}
                onChange={(e) => setSetAll(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && applyToAll()}
                placeholder="30"
                aria-label={t('wages.setAll')}
              />
              <span className="text-xs text-zinc-500">%</span>
              <Button size="sm" variant="outline" onClick={applyToAll} disabled={!isPercent(setAll)}>
                {t('wages.apply')}
              </Button>
            </div>
          </div>

          <div className="stagger space-y-3">
            {byMember.map((group) => {
              const first = group[0]!.line;
              return (
                <Card key={first.userId}>
                  <CardContent className="space-y-2 py-3">
                    <div className="flex items-center gap-2">
                      <Avatar className="h-7 w-7">
                        <AvatarImage src={first.avatarUrl ?? undefined} alt="" />
                        <AvatarFallback className="text-[9px]">{first.userName.slice(0, 2).toUpperCase()}</AvatarFallback>
                      </Avatar>
                      <span className="truncate text-sm font-medium text-zinc-100">{first.userName}</span>
                      {first.rank && <Badge variant="outline" className="text-[10px]">{first.rank}</Badge>}
                    </div>

                    {group.map((row) => {
                      const key = lineKey(row.line);
                      const bad = row.percent !== '' && !isPercent(row.percent);
                      return (
                        <div
                          key={key}
                          className={cn(
                            'grid grid-cols-[auto_1fr_auto] items-center gap-x-3 gap-y-1 rounded-md border border-zinc-800/60 px-3 py-2 sm:grid-cols-[auto_minmax(0,1fr)_7rem_6rem_8rem_8rem]',
                            !row.included && 'opacity-50',
                          )}
                        >
                          <input
                            type="checkbox"
                            className="size-4 accent-[var(--brand-color)]"
                            checked={row.included}
                            onChange={() => setExcluded((current) => {
                              const next = new Set(current);
                              if (next.has(key)) next.delete(key); else next.add(key);
                              return next;
                            })}
                            aria-label={t('wages.include')}
                          />
                          <span className="flex min-w-0 items-center gap-2 text-sm text-zinc-300">
                            <ItemIcon src={row.item?.imageUrl} icon={row.item?.icon} category={row.item?.category} className="size-5" />
                            <span className="truncate">{row.item?.name}</span>
                            <span className="hidden text-[11px] text-zinc-500 md:inline">
                              {t('wages.entries', { count: row.line.entryCount })}
                            </span>
                          </span>
                          <span className="text-right text-sm tabular-nums text-zinc-200 sm:text-left">
                            {amount(cents(row.line.brought), row.line.itemTypeId)}
                          </span>
                          <span className="col-span-3 flex items-center gap-1 sm:col-span-1">
                            <Input
                              className={cn('h-8 w-20', bad && 'border-red-500/60')}
                              inputMode="decimal"
                              value={row.percent}
                              placeholder="0"
                              title={row.line.ratePercent === null ? t('wages.noRate') : undefined}
                              onChange={(e) => setOverrides((current) => ({ ...current, [key]: e.target.value }))}
                              aria-label={t('wages.percent')}
                            />
                            <span className="text-xs text-zinc-500">%</span>
                          </span>
                          <span className="col-span-2 text-sm tabular-nums text-emerald-300 sm:col-span-1 sm:text-right">
                            <span className="mr-1 text-[11px] text-zinc-500 sm:hidden">{t('wages.keeps')}</span>
                            {amount(row.share, row.line.itemTypeId)}
                          </span>
                          <span className="text-right text-sm tabular-nums text-zinc-400">
                            <span className="mr-1 text-[11px] text-zinc-500 sm:hidden">{t('wages.faction')}</span>
                            {amount(row.keeps, row.line.itemTypeId)}
                          </span>
                        </div>
                      );
                    })}
                  </CardContent>
                </Card>
              );
            })}
          </div>

          <div className="flex flex-wrap items-center justify-end gap-3">
            {rows.some((r) => !r.isCurrency) && (
              <p className="text-[11px] text-zinc-500">{t('wages.wholeUnits')}</p>
            )}
            <Button onClick={() => setConfirming(true)} disabled={payable.length === 0 || invalid || pay.isPending}>
              <HandCoins className="mr-2 h-4 w-4" />
              {canPayDirect
                ? t('wages.pay', { count: payable.length })
                : t('wages.request', { count: payable.length })}
            </Button>
          </div>
        </>
      )}

      {ratesOpen && <RatesDialog factionId={factionId} items={items} onClose={() => setRatesOpen(false)} />}

      <AlertDialog open={confirming} onOpenChange={setConfirming}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {canPayDirect ? t('wages.confirmPayTitle') : t('wages.confirmRequestTitle')}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {canPayDirect
                ? t('wages.confirmPayBody', { count: payable.length })
                : t('wages.confirmRequestBody', { count: payable.length })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t('common.cancel')}</AlertDialogCancel>
            <AlertDialogAction onClick={() => pay.mutate()} disabled={pay.isPending}>
              {canPayDirect
                ? t('wages.pay', { count: payable.length })
                : t('wages.request', { count: payable.length })}
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
