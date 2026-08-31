'use client';

import { useQuery } from '@tanstack/react-query';
import { treasuryApi } from '@/lib/api-client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Wallet, TrendingDown, Clock, ArrowDownToLine, AlertTriangle } from 'lucide-react';
import { useAppStore } from '@/lib/store';
import { formatAmount, displayName } from '@/lib/format';
import { ItemIcon } from '@/components/item-icon';

interface Props {
  factionId: string;
}

export function TreasuryView({ factionId }: Props) {
  const brandColor = useAppStore((s) => s.brandColor);

  const { data, isLoading, error } = useQuery({
    queryKey: ['treasury', factionId],
    queryFn: () => treasuryApi.get(factionId, 30),
    staleTime: 0,
    refetchOnWindowFocus: true,
  });

  if (isLoading) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-8 w-48" />
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {[...Array(3)].map((_, i) => <Skeleton key={i} className="h-28 w-full" />)}
        </div>
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  if (error || !data) {
    return (
      <Card className="border-red-500/20">
        <CardContent className="p-6 text-center text-red-400">
          Failed to load treasury data. Make sure the backend is running.
        </CardContent>
      </Card>
    );
  }

  const fmt = (n: number) => `$${n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

  const { balances, netBalance, totalInflow, totalOutflow, totals, pending, outflowTrend, recentPayouts } = data;

  // The three headline totals cover currency types only — goods have no shared
  // unit to add up. Say so whenever the faction actually tracks any.
  const totalsNote =
    totals.nonCurrencyTypeCount > 0
      ? `across ${totals.currencyTypeCount} currency ${totals.currencyTypeCount === 1 ? 'type' : 'types'} · ${totals.nonCurrencyTypeCount} non-currency shown below`
      : 'across all item types';

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h2 className="text-xl font-medium tracking-tight text-zinc-100">Treasury</h2>
        <p className="text-zinc-500 text-sm mt-0.5">Faction vault balances — inflow minus completed withdrawals</p>
      </div>

      {/* ══ Summary Cards ══ */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {/* Net Balance */}
        <Card className={`faction-glow border-highlight lg:col-span-1 sm:col-span-2 ${netBalance < 0 ? 'border-red-500/20' : ''}`}>
          <CardHeader className="pb-2">
            <CardTitle className="text-xs font-normal text-zinc-500 uppercase tracking-wider">Net Balance</CardTitle>
          </CardHeader>
          <CardContent className="relative z-10">
            <div className="text-3xl font-medium tabular-nums tracking-tight" style={{ color: netBalance < 0 ? '#ef4444' : brandColor }}>
              {netBalance < 0 ? '-' : ''}{fmt(Math.abs(netBalance))}
            </div>
            <p className="text-xs text-zinc-500 mt-1.5">
              {netBalance < 0 && <span className="text-red-400">⚠ Negative balance</span>}
              {netBalance >= 0 && totalsNote}
            </p>
          </CardContent>
        </Card>

        {/* Total Inflow */}
        <Card className="border-highlight">
          <CardHeader className="pb-2">
            <CardTitle className="text-xs font-normal text-zinc-500 uppercase tracking-wider">Total Inflow</CardTitle>
          </CardHeader>
          <CardContent className="relative z-10">
            <div className="flex items-center gap-2">
              <div className="h-7 w-7 rounded-md bg-emerald-500/10 flex items-center justify-center">
                <TrendingDown className="h-3.5 w-3.5 text-emerald-400 rotate-180" />
              </div>
              <span className="text-2xl font-medium tabular-nums tracking-tight text-emerald-400">
                {fmt(totalInflow)}
              </span>
            </div>
            <p className="text-xs text-zinc-500 mt-1.5">from entries · currency only</p>
          </CardContent>
        </Card>

        {/* Total Outflow */}
        <Card className="border-highlight">
          <CardHeader className="pb-2">
            <CardTitle className="text-xs font-normal text-zinc-500 uppercase tracking-wider">Total Outflow</CardTitle>
          </CardHeader>
          <CardContent className="relative z-10">
            <div className="flex items-center gap-2">
              <div className="h-7 w-7 rounded-md bg-red-500/10 flex items-center justify-center">
                <ArrowDownToLine className="h-3.5 w-3.5 text-red-400" />
              </div>
              <span className="text-2xl font-medium tabular-nums tracking-tight text-red-400">
                {fmt(totalOutflow)}
              </span>
            </div>
            <p className="text-xs text-zinc-500 mt-1.5">completed withdrawals · currency only</p>
          </CardContent>
        </Card>
      </div>

      {/* ══ Pending Payouts Banner ══ */}
      {pending.count > 0 && (
        <Card className="border-amber-500/20 bg-amber-500/[0.03]">
          <CardContent className="py-4">
            <div className="flex items-center gap-3">
              <div className="h-9 w-9 rounded-lg bg-amber-500/10 flex items-center justify-center shrink-0">
                <Clock className="h-4 w-4 text-amber-400" />
              </div>
              <div className="flex-1">
                <p className="text-sm font-medium text-amber-300">
                  {pending.count} Pending Withdrawal{pending.count !== 1 ? 's' : ''}
                </p>
                <p className="text-xs text-zinc-500 mt-0.5">
                  {fmt(pending.total)} waiting for approval or completion
                </p>
              </div>
              <Badge className="bg-amber-500/10 text-amber-400 border border-amber-500/20">
                {fmt(pending.total)}
              </Badge>
            </div>
          </CardContent>
        </Card>
      )}

      {/* ══ Balance Cards per Item Type ══ */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-sm text-zinc-200">
            <Wallet className="h-4 w-4 text-zinc-400" />
            Balances by Item Type
          </CardTitle>
        </CardHeader>
        <CardContent>
          {balances.length === 0 ? (
            <p className="text-zinc-600 text-sm text-center py-8">No balance data yet.</p>
          ) : (
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {balances.map((b) => (
                <div
                  key={b.itemTypeId}
                  className={`rounded-lg border p-4 space-y-3 transition-all duration-150 hover:border-white/[0.1] ${
                    b.balance < 0 ? 'border-red-500/20 bg-red-500/[0.02]' : 'border-white/[0.06]'
                  }`}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="flex items-center gap-2.5 min-w-0">
                      <ItemIcon src={b.imageUrl} className="size-8" />
                      <p className="text-sm font-medium text-zinc-200 truncate">{b.itemTypeName}</p>
                    </span>
                    <Badge
                      variant="outline"
                      className={`text-[11px] ${
                        b.balance < 0
                          ? 'border-red-500/30 text-red-400 bg-red-500/10'
                          : 'border-emerald-500/30 text-emerald-400 bg-emerald-500/10'
                      }`}
                    >
                      {b.balance < 0 ? 'Negative' : 'Positive'}
                    </Badge>
                  </div>
                  <div className="text-2xl font-medium tabular-nums tracking-tight" style={{ color: b.balance < 0 ? '#ef4444' : brandColor }}>
                    {b.balance < 0 ? '-' : ''}{formatAmount(Math.abs(b.balance), b.unit, b.isCurrency)}
                  </div>
                  <div className="flex justify-between text-[11px] text-zinc-500 tabular-nums">
                    <span className="text-emerald-500/80">+{formatAmount(b.inflow, b.unit, b.isCurrency)} in</span>
                    <span className="text-red-500/80">-{formatAmount(b.outflow, b.unit, b.isCurrency)} out</span>
                  </div>
                  {/* Mini outflow trend */}
                  {b.outflowTrend.length > 1 && (
                    <div className="h-8 flex items-end gap-[2px]">
                      {b.outflowTrend.slice(-14).map((pt, i) => {
                        const max = Math.max(...b.outflowTrend.slice(-14).map((p) => p.total), 1);
                        const h = (pt.total / max) * 100;
                        return (
                          <div
                            key={i}
                            className="flex-1 rounded-t-sm min-h-[2px]"
                            style={{
                              height: `${Math.max(h, 4)}%`,
                              backgroundColor: `${brandColor}${i === b.outflowTrend.slice(-14).length - 1 ? 'cc' : '30'}`,
                            }}
                          />
                        );
                      })}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* ══ Outflow Trend ══ */}
      {outflowTrend.length > 1 && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-sm text-zinc-200">
              <TrendingDown className="h-4 w-4 text-zinc-400" />
              Outflow Trend (Last {data.trendDays} Days)
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="h-32 flex items-end gap-[3px]">
              {outflowTrend.map((pt, i) => {
                const max = Math.max(...outflowTrend.map((p) => p.total), 1);
                const h = (pt.total / max) * 100;
                return (
                  <div key={i} className="flex-1 flex flex-col items-center gap-1">
                    <div
                      className="w-full rounded-t-sm min-h-[2px] transition-all duration-200"
                      style={{
                        height: `${Math.max(h, 4)}%`,
                        backgroundColor: i === outflowTrend.length - 1 ? brandColor : `${brandColor}30`,
                      }}
                    />
                  </div>
                );
              })}
            </div>
          </CardContent>
        </Card>
      )}

      {/* ══ Recent Completed Payouts ══ */}
      <Card>
        <CardHeader>
          <CardTitle className="text-sm text-zinc-200">Recent Withdrawals</CardTitle>
        </CardHeader>
        <CardContent>
          {recentPayouts.length === 0 ? (
            <p className="text-zinc-600 text-sm text-center py-8">No completed withdrawals yet.</p>
          ) : (
            <div className="space-y-1">
              {recentPayouts.map((p) => (
                <div key={p.id} className="flex items-center gap-3 py-2 px-2 -mx-2 rounded-md hover:bg-white/[0.02] transition-colors duration-100">
                  <Avatar className="h-7 w-7 shrink-0">
                    <AvatarImage src={p.recipientAvatarUrl ?? undefined} />
                    <AvatarFallback className="text-[10px]">{displayName({ username: p.recipientUsername, inGameName: p.recipientInGameName }).slice(0, 2).toUpperCase()}</AvatarFallback>
                  </Avatar>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm">
                      <span className="text-zinc-300 font-medium">{displayName({ username: p.recipientUsername, inGameName: p.recipientInGameName })}</span>
                      <span className="text-zinc-600"> received </span>
                      <span className="font-medium tabular-nums text-zinc-200">{formatAmount(p.amount, p.itemUnit, p.itemIsCurrency)}</span>
                    </p>
                    <p className="text-[11px] text-zinc-600 flex items-center gap-1.5">
                      <ItemIcon src={p.itemImageUrl} className="size-4" />
                      <span className="truncate">
                        {p.itemTypeName} &middot; {p.payoutDate}
                        {p.description && ` — ${p.description}`}
                      </span>
                    </p>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
