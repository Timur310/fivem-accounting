'use client';

import { useMemo, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { launderingApi, apiErrorMessage } from '@/lib/api-client';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import {
  SearchableSelect, type SearchableSelectOption,
} from '@/components/ui/searchable-select';
import { ArrowRight, WashingMachine } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { useAppStore } from '@/lib/store';
import { formatAmount, todayLocalDateString } from '@/lib/format';

interface Props {
  factionId: string;
}

/**
 * Turns one of the faction's currencies into another.
 *
 * The rate is not configured anywhere: whoever runs the wash enters what went
 * in and what came back, because the cut depends on who did it and how much
 * they took. The screen's job is to show what the vault holds, to say plainly
 * what the conversion costs, and to make the treasury match reality afterwards.
 */
export function LaunderingView({ factionId }: Props) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const brandColor = useAppStore((s) => s.brandColor);

  const [fromId, setFromId] = useState('');
  const [toId, setToId] = useState('');
  const [amountIn, setAmountIn] = useState('');
  const [amountOut, setAmountOut] = useState('');
  const [description, setDescription] = useState('');
  const [date, setDate] = useState(todayLocalDateString());

  const { data, isLoading } = useQuery({
    queryKey: ['laundering', factionId],
    queryFn: () => launderingApi.get(factionId),
    staleTime: 0,
  });

  const currencies = data?.currencies ?? [];
  const from = currencies.find((c) => c.itemTypeId === fromId);
  const to = currencies.find((c) => c.itemTypeId === toId);

  const options = useMemo<SearchableSelectOption[]>(() => currencies.map((c) => ({
    value: c.itemTypeId,
    label: c.itemTypeName,
    hint: formatAmount(c.balance, c.unit, true),
  })), [currencies]);

  const inNum = Number(amountIn);
  const outNum = Number(amountOut);
  const ratio = inNum > 0 && outNum > 0 ? outNum / inNum : null;
  const overBalance = !!from && inNum > 0 && inNum > from.balance;

  const reset = () => {
    setAmountIn('');
    setAmountOut('');
    setDescription('');
    setDate(todayLocalDateString());
  };

  const launderMutation = useMutation({
    mutationFn: () => launderingApi.launder(factionId, {
      fromItemTypeId: fromId,
      amountIn,
      toItemTypeId: toId,
      amountOut,
      description: description || undefined,
      date: date || undefined,
    }),
    onSuccess: (result) => {
      toast({
        title: 'Laundered',
        description: `${formatAmount(result.from.amount, result.from.unit, true)} ${result.from.itemTypeName} → ${formatAmount(result.to.amount, result.to.unit, true)} ${result.to.itemTypeName}`,
      });
      reset();
      // The vault moved on both sides, and so did the ledgers it is derived
      // from — the payout and entry lists carry the two halves.
      queryClient.invalidateQueries({ queryKey: ['laundering', factionId] });
      queryClient.invalidateQueries({ queryKey: ['treasury', factionId] });
      queryClient.invalidateQueries({ queryKey: ['dashboard', factionId] });
      queryClient.invalidateQueries({ queryKey: ['payouts', factionId] });
      queryClient.invalidateQueries({ queryKey: ['entries', factionId] });
    },
    onError: (err: unknown) => {
      toast({ title: 'Laundering failed', description: apiErrorMessage(err), variant: 'destructive' });
    },
  });

  const canSubmit = !!fromId && !!toId && fromId !== toId
    && inNum > 0 && outNum > 0 && !overBalance && !launderMutation.isPending;

  if (isLoading) {
    return <div className="space-y-4"><Skeleton className="h-24 w-full" /><Skeleton className="h-72 w-full" /></div>;
  }

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-medium tracking-tight text-zinc-100">Laundering</h2>
        <p className="text-zinc-500 text-sm mt-0.5">
          Convert one faction currency into another. The dirty side leaves the treasury and the
          clean side comes back, both under the anonymous placeholder — no member is charged or
          credited.
        </p>
      </div>

      {/* What there is to work with */}
      {currencies.length > 0 && (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {currencies.map((c) => (
            <Card key={c.itemTypeId}>
              <CardContent className="py-3">
                <p className="text-xs text-zinc-500">{c.itemTypeName}</p>
                <p className="text-lg font-medium tabular-nums text-zinc-100 mt-0.5">
                  {formatAmount(c.balance, c.unit, true)}
                </p>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {currencies.length < 2 ? (
        <Card>
          <CardContent className="py-10 text-center text-sm text-zinc-500">
            <WashingMachine className="h-8 w-8 mx-auto mb-2 opacity-30" />
            Laundering needs at least two active currency item types. Add one in
            Settings &rarr; Item Types.
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardContent className="py-5 space-y-5">
            <div className="grid gap-4 sm:grid-cols-[1fr_auto_1fr] sm:items-end">
              <div className="space-y-2">
                <Label>From *</Label>
                <SearchableSelect
                  value={fromId}
                  onValueChange={setFromId}
                  options={options}
                  placeholder="Currency to wash"
                  searchPlaceholder="Search currencies..."
                  emptyMessage="No currencies match."
                />
                <Input
                  type="number"
                  step="0.01"
                  min="0.01"
                  placeholder="0.00"
                  value={amountIn}
                  onChange={(e) => setAmountIn(e.target.value)}
                  className="tabular-nums"
                  aria-invalid={overBalance || undefined}
                />
                {overBalance && from && (
                  <p className="text-xs text-red-400">
                    The treasury holds {formatAmount(from.balance, from.unit, true)}.
                  </p>
                )}
              </div>

              <div className="hidden sm:flex h-9 items-center justify-center text-zinc-600">
                <ArrowRight className="h-4 w-4" />
              </div>

              <div className="space-y-2">
                <Label>To *</Label>
                <SearchableSelect
                  value={toId}
                  onValueChange={setToId}
                  options={options.filter((o) => o.value !== fromId)}
                  placeholder="Currency to receive"
                  searchPlaceholder="Search currencies..."
                  emptyMessage="No currencies match."
                />
                <Input
                  type="number"
                  step="0.01"
                  min="0.01"
                  placeholder="0.00"
                  value={amountOut}
                  onChange={(e) => setAmountOut(e.target.value)}
                  className="tabular-nums"
                />
              </div>
            </div>

            {ratio !== null && from && to && (
              <p className="text-xs text-zinc-500">
                {formatAmount(inNum, from.unit, true)} {from.itemTypeName} becomes{' '}
                {formatAmount(outNum, to.unit, true)} {to.itemTypeName} —{' '}
                <span className="text-zinc-300">{(ratio * 100).toFixed(1)}%</span> comes back,{' '}
                {formatAmount(inNum - outNum, from.unit, true)} is the cut.
              </p>
            )}

            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label>Note</Label>
                <Input
                  placeholder="Who washed it, where, anything worth remembering"
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  maxLength={500}
                />
              </div>
              <div className="space-y-2">
                <Label>Date</Label>
                <Input
                  type="date"
                  value={date}
                  onChange={(e) => setDate(e.target.value)}
                  max={todayLocalDateString()}
                />
              </div>
            </div>

            <div className="flex justify-end">
              <Button
                disabled={!canSubmit}
                onClick={() => launderMutation.mutate()}
                style={{ backgroundColor: brandColor }}
              >
                {launderMutation.isPending ? 'Washing...' : 'Launder'}
              </Button>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
