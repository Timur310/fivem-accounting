'use client';

import { useMemo, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { itemTypesApi, shiftsApi, apiErrorMessage } from '@/lib/api-client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { Segmented } from '@/components/ui/segmented';
import { SearchableSelect } from '@/components/ui/searchable-select';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
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
import { hoursAndMinutes } from '@/components/shift-clock';
import { Banknote, Plus, Trash2 } from 'lucide-react';
import type { ItemType, ShiftRate } from '@/lib/api-types';

type Period = 'this-week' | 'last-week' | 'this-month' | 'last-month';

/** A period as exact instants in the viewer's own timezone, Monday-first. */
function windowFor(period: Period): { from: string; to: string } {
  const now = new Date();
  if (period === 'this-month' || period === 'last-month') {
    const offset = period === 'last-month' ? -1 : 0;
    return {
      from: new Date(now.getFullYear(), now.getMonth() + offset, 1).toISOString(),
      to: new Date(now.getFullYear(), now.getMonth() + offset + 1, 1).toISOString(),
    };
  }
  const monday = new Date(now.getFullYear(), now.getMonth(), now.getDate() - ((now.getDay() + 6) % 7));
  if (period === 'last-week') monday.setDate(monday.getDate() - 7);
  const next = new Date(monday);
  next.setDate(monday.getDate() + 7);
  return { from: monday.toISOString(), to: next.toISOString() };
}

/**
 * Payroll: what the rota comes to in wages, and paying it.
 *
 * For the people who run the rota (`manage_shifts`). Rates are optional — a
 * faction without any sees a single line saying so and a button to set them,
 * and nothing about its timesheet changes.
 *
 * Paying creates one payout per member per currency. Whether it leaves the
 * treasury now or waits as a request is the payouts rule, not this screen's:
 * `canPayDirect` is whether the person pressing the button may settle payouts.
 */
export function ShiftPayroll({ factionId, canPayDirect }: { factionId: string; canPayDirect: boolean }) {
  const { t } = useTranslation();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [period, setPeriod] = useState<Period>('last-week');
  const [ratesOpen, setRatesOpen] = useState(false);
  const [confirming, setConfirming] = useState(false);

  const range = useMemo(() => windowFor(period), [period]);
  const payroll = useQuery({
    queryKey: ['shift-payroll', factionId, range.from, range.to],
    queryFn: () => shiftsApi.payroll(factionId, range.from, range.to),
  });

  const run = useMutation({
    mutationFn: () => shiftsApi.runPayroll(factionId, range.from, range.to),
    onSuccess: (result) => {
      setConfirming(false);
      void queryClient.invalidateQueries({ queryKey: ['shift-payroll', factionId] });
      void queryClient.invalidateQueries({ queryKey: ['shifts', factionId] });
      void queryClient.invalidateQueries({ queryKey: ['payouts'] });
      void queryClient.invalidateQueries({ queryKey: ['treasury'] });
      toast({
        title: result.status === 'completed'
          ? t('payroll.paid', { count: result.created })
          : t('payroll.requested', { count: result.created }),
      });
    },
    onError: (err) =>
      toast({ title: t('shifts.failed'), description: apiErrorMessage(err), variant: 'destructive' }),
  });

  const data = payroll.data;
  const lines = data?.lines ?? [];

  return (
    <Card>
      <CardContent className="space-y-3 py-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="flex items-center gap-2 text-xs uppercase tracking-wide text-zinc-500">
            <Banknote className="h-3.5 w-3.5" />
            {t('payroll.title')}
          </p>
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
            <Button size="sm" variant="outline" onClick={() => setRatesOpen(true)}>
              {t('payroll.rates')}
            </Button>
          </div>
        </div>

        {payroll.isLoading ? (
          <Skeleton className="h-20 w-full" />
        ) : !data?.hasRates ? (
          <p className="text-sm text-zinc-500">{t('payroll.noRates')}</p>
        ) : lines.length === 0 && (data?.unrated.length ?? 0) === 0 ? (
          <p className="text-sm text-zinc-500">{t('payroll.nothingOwed')}</p>
        ) : (
          <>
            <div className="stagger space-y-2">
              {lines.map((line) => (
                <div key={`${line.userId}:${line.itemTypeId}`} className="flex items-center gap-3">
                  <Avatar className="h-6 w-6">
                    <AvatarImage src={line.avatarUrl ?? undefined} alt="" />
                    <AvatarFallback className="text-[8px]">{line.userName.slice(0, 2).toUpperCase()}</AvatarFallback>
                  </Avatar>
                  <span className="min-w-0 flex-1 truncate text-sm text-zinc-200">{line.userName}</span>
                  <span className="text-xs text-zinc-500">
                    {hoursAndMinutes(line.minutes)} · {t('shifts.shiftCount').replace('{count}', String(line.shiftCount))}
                  </span>
                  <span className="w-28 text-right text-sm font-medium tabular-nums text-zinc-100">
                    {formatAmount(line.amount, line.unit, line.isCurrency)}
                  </span>
                </div>
              ))}
            </div>

            {/* Worked, recorded, and paid for by nobody — said out loud, so
                a missing rate is noticed rather than silently costing
                somebody their wages. */}
            {(data?.unrated.length ?? 0) > 0 && (
              <p className="rounded-md border border-amber-500/30 bg-amber-500/5 px-3 py-2 text-xs text-amber-300">
                {t('payroll.unrated', {
                  names: data!.unrated
                    .map((u) => `${u.userName} (${hoursAndMinutes(u.minutes)})`)
                    .join(', '),
                })}
              </p>
            )}

            {lines.length > 0 && (
              <div className="flex justify-end">
                <Button onClick={() => setConfirming(true)} disabled={run.isPending}>
                  {canPayDirect ? t('payroll.pay') : t('payroll.request')}
                </Button>
              </div>
            )}
          </>
        )}
      </CardContent>

      {ratesOpen && <RatesDialog factionId={factionId} onClose={() => setRatesOpen(false)} />}

      <AlertDialog open={confirming} onOpenChange={setConfirming}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {canPayDirect ? t('payroll.confirmPayTitle') : t('payroll.confirmRequestTitle')}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {canPayDirect
                ? t('payroll.confirmPayBody', { count: lines.length })
                : t('payroll.confirmRequestBody', { count: lines.length })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t('common.cancel')}</AlertDialogCancel>
            <AlertDialogAction onClick={() => run.mutate()} disabled={run.isPending}>
              {canPayDirect ? t('payroll.pay') : t('payroll.request')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Card>
  );
}

/** The rate table: a row per position, and one for everybody else. */
function RatesDialog({ factionId, onClose }: { factionId: string; onClose: () => void }) {
  const { t } = useTranslation();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [rows, setRows] = useState<ShiftRate[] | null>(null);

  const current = useQuery({
    queryKey: ['shift-rates', factionId],
    queryFn: () => shiftsApi.rates(factionId),
  });
  const items = useQuery({
    queryKey: ['item-types', factionId],
    queryFn: () => itemTypesApi.list(factionId),
  });
  const positions = useQuery({
    queryKey: ['shift-positions', factionId],
    queryFn: () => shiftsApi.positions(factionId),
  });

  const currencies = (items.data ?? []).filter((i: ItemType) => i.isCurrency);
  const firstCurrency = currencies[0]?.id ?? '';
  // Edited as a copy, seeded from the server once it has answered.
  const editing = rows ?? current.data?.rates ?? null;

  const update = (index: number, patch: Partial<ShiftRate>) =>
    setRows((editing ?? []).map((r, i) => (i === index ? { ...r, ...patch } : r)));

  const save = useMutation({
    mutationFn: () => shiftsApi.saveRates(factionId, (editing ?? []).map((r) => ({
      ...r,
      position: r.position?.trim() ? r.position.trim() : null,
    }))),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['shift-rates', factionId] });
      void queryClient.invalidateQueries({ queryKey: ['shift-payroll', factionId] });
      toast({ title: t('payroll.ratesSaved') });
      onClose();
    },
    onError: (err) =>
      toast({ title: t('shifts.failed'), description: apiErrorMessage(err), variant: 'destructive' }),
  });

  const valid = (editing ?? []).every((r) => r.itemTypeId && /^\d+(\.\d{1,2})?$/.test(r.hourlyRate));

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle>{t('payroll.ratesTitle')}</DialogTitle>
          <DialogDescription>{t('payroll.ratesHint')}</DialogDescription>
        </DialogHeader>

        {!editing ? (
          <Skeleton className="h-24 w-full" />
        ) : currencies.length === 0 ? (
          <p className="text-sm text-zinc-500">{t('payroll.noCurrency')}</p>
        ) : (
          <div className="space-y-2">
            <datalist id="rate-positions">
              {(positions.data?.positions ?? []).map((p) => <option key={p} value={p} />)}
            </datalist>
            {editing.map((row, index) => (
              <div key={index} className="flex flex-wrap items-center gap-2">
                <Input
                  list="rate-positions"
                  className="min-w-[9rem] flex-1"
                  value={row.position ?? ''}
                  onChange={(e) => update(index, { position: e.target.value })}
                  placeholder={t('payroll.everyoneElse')}
                  aria-label={t('shifts.position')}
                />
                <Input
                  className="w-28"
                  inputMode="decimal"
                  value={row.hourlyRate}
                  onChange={(e) => update(index, { hourlyRate: e.target.value })}
                  placeholder="150"
                  aria-label={t('payroll.perHour')}
                />
                <SearchableSelect
                  className="w-36"
                  size="sm"
                  value={row.itemTypeId}
                  onValueChange={(itemTypeId) => update(index, { itemTypeId })}
                  options={currencies.map((c) => ({ value: c.id, label: c.name }))}
                  aria-label={t('payroll.paidIn')}
                />
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
              onClick={() => setRows([...editing, { position: '', itemTypeId: firstCurrency, hourlyRate: '' }])}
            >
              <Plus className="mr-1.5 h-3.5 w-3.5" /> {t('payroll.addRate')}
            </Button>
            <p className="text-[11px] text-zinc-500">{t('payroll.blankIsDefault')}</p>
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
