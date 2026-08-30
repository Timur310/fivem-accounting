'use client';

import { useQuery } from '@tanstack/react-query';
import { dashboardApi, quotasApi, exportApi } from '@/lib/api-client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { Coins, Users, List, TrendingUp, DollarSign, Target, Download, BarChart3, ArrowUpRight, AlertTriangle, Clock } from 'lucide-react';
import { useAppStore } from '@/lib/store';
import { DashboardCharts } from '@/components/dashboard-charts';
import { formatAmount, displayName } from '@/lib/format';

interface Props {
  factionId: string;
}

export function DashboardView({ factionId }: Props) {
  const setCurrentView = useAppStore((s) => s.setCurrentView);
  const brandColor = useAppStore((s) => s.brandColor);

  const { data, isLoading, error } = useQuery({
    queryKey: ['dashboard', factionId],
    queryFn: () => dashboardApi.get(factionId),
    staleTime: 0,
    refetchOnWindowFocus: true,
  });

  const { data: quotasList = [] } = useQuery({
    queryKey: ['quotas', factionId],
    queryFn: () => quotasApi.list(factionId),
    staleTime: 0,
  });

  if (isLoading) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-8 w-48" />
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {[...Array(4)].map((_, i) => (
            <Skeleton key={i} className="h-24 w-full" />
          ))}
        </div>
      </div>
    );
  }

  if (error || !data) {
    return (
      <Card className="border-red-500/20">
        <CardContent className="p-6 text-center text-red-400">
          Failed to load dashboard. Make sure the backend is running.
        </CardContent>
      </Card>
    );
  }

  const { faction, totalsByType, grandTotal, treasuryBalances, netBalance, memberCount, adminCount, totalEntries, topContributors, recentEntries, inactiveMembers, inactivityThresholdDays } = data;
  const activeQuotas = (quotasList as import('@/lib/api-types').Quota[]).filter(q => q.isActive && q.periodActive);

  // Currency summaries are prefixed with $; the goods breakdown uses
  // formatAmount() with the type-specific unit instead.
  const fmt = (n: number) => `$${n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

  return (
    <div className="space-y-6">
      {/* Faction Header */}
      <div>
        <h2 className="text-xl font-medium tracking-tight text-zinc-100">{faction.name}</h2>
        {faction.description && (
          <p className="text-zinc-500 mt-1 text-sm">{faction.description}</p>
        )}
      </div>

      {/* ══ Bento Grid: Hero + 3 Stats ══ */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {/* Hero Card — Grand Total with Glow */}
        <Card className="faction-glow border-highlight lg:col-span-1 sm:col-span-2">
          <CardHeader className="pb-2">
            <CardTitle className="text-xs font-normal text-zinc-500 uppercase tracking-wider">Net Treasury Balance</CardTitle>
          </CardHeader>
          <CardContent className="relative z-10">
            {(() => {
              const bal = netBalance ?? grandTotal;
              // Money only: adding currency to kilograms and piece counts gives
              // a figure with no unit. Goods are listed per type further down.
              const currencyBalances = (treasuryBalances ?? []).filter((b) => b.isCurrency);
              const goodsCount = (treasuryBalances ?? []).length - currencyBalances.length;
              const hasTreasury = currencyBalances.length > 0;
              const totalIn = hasTreasury ? currencyBalances.reduce((s, b) => s + b.inflow, 0) : grandTotal;
              const totalOut = hasTreasury ? currencyBalances.reduce((s, b) => s + b.outflow, 0) : 0;
              return (
                <>
                  <div className="text-3xl font-medium tabular-nums tracking-tight" style={{ color: bal < 0 ? '#ef4444' : brandColor }}>
                    {fmt(bal)}
                  </div>
                  <p className="text-xs text-zinc-500 mt-1.5">
                    {hasTreasury
                      ? <>
                          inflow {fmt(totalIn)} &middot; outflow {fmt(totalOut)}
                          {goodsCount > 0 && <> &middot; currency only</>}
                        </>
                      : 'across all item types'
                    }
                  </p>
                </>
              );
            })()}
          </CardContent>
        </Card>

        {/* Stat: Total Entries */}
        <Card className="border-highlight">
          <CardHeader className="pb-2">
            <CardTitle className="text-xs font-normal text-zinc-500 uppercase tracking-wider">Entries</CardTitle>
          </CardHeader>
          <CardContent className="relative z-10">
            <div className="text-2xl font-medium tabular-nums tracking-tight">{totalEntries.toLocaleString()}</div>
            <p className="text-xs text-zinc-500 mt-1.5">logged contributions</p>
          </CardContent>
        </Card>

        {/* Stat: Members */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-xs font-normal text-zinc-500 uppercase tracking-wider">Members</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-medium tabular-nums tracking-tight">{memberCount}</div>
            <p className="text-xs text-zinc-500 mt-1.5">{adminCount} admin{adminCount !== 1 ? 's' : ''}</p>
          </CardContent>
        </Card>

        {/* Stat: Item Types */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-xs font-normal text-zinc-500 uppercase tracking-wider">Categories</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-medium tabular-nums tracking-tight">{totalsByType.length}</div>
            <p className="text-xs text-zinc-500 mt-1.5">active item types</p>
          </CardContent>
        </Card>
      </div>

      {/* ══ Quota Progress — Energy Bars ══ */}
      {activeQuotas.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-sm text-zinc-200">
              <Target className="h-4 w-4 text-zinc-400" />
              Quota Progress
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {activeQuotas.map((q) => {
                const pct = q.percentage ?? 0;
                const met = pct >= 100;
                return (
                  <div key={q.id} className="rounded-lg border border-white/[0.06] p-4 space-y-3 transition-all duration-150 hover:border-white/[0.1]">
                    <div className="flex items-center justify-between">
                      <div>
                        <p className="text-sm font-medium text-zinc-200">{q.itemTypeName}</p>
                        <p className="text-[11px] text-zinc-500 capitalize">{q.periodType}</p>
                      </div>
                      <Badge variant={met ? 'outline' : 'default'} className={met ? 'border-emerald-500/30 text-emerald-400' : ''}>
                        {met ? 'Met' : `${pct.toFixed(1)}%`}
                      </Badge>
                    </div>
                    {/* Energy bar */}
                    <div className="h-2 bg-white/[0.04] rounded-full overflow-hidden">
                      <div
                        className={`h-full rounded-full energy-bar transition-all duration-500 ${met ? 'bg-emerald-500' : ''}`}
                        style={{ width: `${Math.min(pct, 100)}%`, ...(!met ? { backgroundColor: brandColor } : {}) }}
                      />
                    </div>
                    <div className="flex justify-between text-[11px] text-zinc-500 tabular-nums">
                      <span>{formatAmount(q.currentAmount ?? 0, q.itemUnit, q.itemIsCurrency)}</span>
                      <span>of {formatAmount(q.targetAmount, q.itemUnit, q.itemIsCurrency)}</span>
                    </div>
                  </div>
                );
              })}
            </div>
          </CardContent>
        </Card>
      )}

      {/* ══ Two Column: Top Contributors + Recent Activity ══ */}
      <div className="grid gap-4 lg:grid-cols-2">
        {/* Top Contributors */}
        <Card>
          <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-sm text-zinc-200">
              <TrendingUp className="h-4 w-4 text-zinc-400" />
              Top Contributors
            </CardTitle>
          </CardHeader>
          <CardContent>
            {topContributors.length === 0 ? (
              <p className="text-zinc-600 text-sm text-center py-8">No contributions yet.</p>
            ) : (
              <div className="space-y-1">
                {topContributors.slice(0, 7).map((c, i) => (
                  <div key={c.userId} className="flex items-center gap-3 py-2 px-2 -mx-2 rounded-md hover:bg-white/[0.02] transition-colors duration-100">
                    <span className="text-xs font-medium text-zinc-600 w-4 tabular-nums">{i + 1}</span>
                    <Avatar className="h-7 w-7">
                      <AvatarImage src={c.avatarUrl ?? undefined} />
                      <AvatarFallback className="text-[10px]">{displayName(c).slice(0, 2).toUpperCase()}</AvatarFallback>
                    </Avatar>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm text-zinc-300 truncate">{displayName(c)}</p>
                      <p className="text-[11px] text-zinc-600">{c.entryCount} entries</p>
                    </div>
                    <span className="text-sm font-medium tabular-nums text-zinc-200">{`$${c.totalContributed.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`}</span>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Recent Activity */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center justify-between text-sm text-zinc-200">
              <span className="flex items-center gap-2">
                <List className="h-4 w-4 text-zinc-400" />
                Recent Activity
              </span>
              <Button
                onClick={() => setCurrentView('entries')}
                className="text-[11px] font-medium flex items-center gap-1 transition-colors duration-100 hover:opacity-80"
                style={{ color: brandColor }}
              >
                View All <ArrowUpRight className="h-3 w-3" />
              </Button>
            </CardTitle>
          </CardHeader>
          <CardContent>
            {recentEntries.length === 0 ? (
              <p className="text-zinc-600 text-sm text-center py-8">No entries yet.</p>
            ) : (
              <div className="space-y-1 max-h-[320px] overflow-y-auto">
                {recentEntries.map((e) => (
                  <div key={e.id} className="flex items-center gap-3 py-2 px-2 -mx-2 rounded-md hover:bg-white/[0.02] transition-colors duration-100">
                    <Avatar className="h-7 w-7 shrink-0">
                      <AvatarImage src={e.avatarUrl ?? undefined} />
                      <AvatarFallback className="text-[10px]">{displayName(e).slice(0, 2).toUpperCase()}</AvatarFallback>
                    </Avatar>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm">
                        <span className="text-zinc-300 font-medium">{displayName(e)}</span>
                        <span className="text-zinc-600"> logged </span>
                        <span className="font-medium tabular-nums text-zinc-200">{formatAmount(e.amount, e.itemUnit, e.itemIsCurrency)}</span>
                      </p>
                      <p className="text-[11px] text-zinc-600">
                        {e.itemTypeName} &middot; {e.entryDate}
                        {e.description && ` — ${e.description}`}
                      </p>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* ══ Totals by Type — compact grid (with treasury balance if available) ══ */}
      {totalsByType.length > 0 && (
        <Card>
          <CardHeader className="flex flex-row items-center justify-between">
            <CardTitle className="text-sm text-zinc-200">Treasury by Item Type</CardTitle>
            {(treasuryBalances?.length ?? 0) > 0 && (
              <Button
                onClick={() => setCurrentView('treasury')}
                className="text-[11px] font-medium flex items-center gap-1 transition-colors duration-100 hover:opacity-80"
                style={{ color: brandColor }}
              >
                Full View <ArrowUpRight className="h-3 w-3" />
              </Button>
            )}
          </CardHeader>
          <CardContent>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {(treasuryBalances?.length ?? 0) > 0
                ? treasuryBalances.map((b) => (
                  <div
                    key={b.itemTypeId}
                    className="flex items-center justify-between rounded-lg border border-white/[0.06] p-3.5 transition-all duration-150 hover:border-white/[0.1]"
                  >
                    <div>
                      <p className="text-sm font-medium text-zinc-300">{b.itemTypeName}</p>
                      <p className="text-xs text-zinc-600">in {formatAmount(b.inflow, b.unit, b.isCurrency)} &middot; out {formatAmount(b.outflow, b.unit, b.isCurrency)}</p>
                    </div>
                    <div className="text-right">
                      <p className="text-lg font-medium tabular-nums" style={{ color: b.balance < 0 ? '#ef4444' : '#e4e4e7' }}>
                        {b.balance < 0 ? '-' : ''}{formatAmount(Math.abs(b.balance), b.unit, b.isCurrency)}
                      </p>
                    </div>
                  </div>
                ))
                : totalsByType.map((t) => (
                  <div
                    key={t.itemTypeId}
                    className="flex items-center justify-between rounded-lg border border-white/[0.06] p-3.5 transition-all duration-150 hover:border-white/[0.1]"
                  >
                    <div>
                      <p className="text-sm font-medium text-zinc-300">{t.itemTypeName}</p>
                      <p className="text-xs text-zinc-600">{t.unit}</p>
                    </div>
                    <div className="text-right">
                      <p className="text-lg font-medium tabular-nums text-zinc-100">
                        {formatAmount(t.total, t.unit, t.isCurrency)}
                      </p>
                    </div>
                  </div>
                ))
              }
            </div>
          </CardContent>
        </Card>
      )}

      {/* ══ Inactive Members (admin only, data only sent by backend to admins) ══ */}
      {inactiveMembers && inactiveMembers.length > 0 && (
        <Card className="border-amber-500/15">
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center justify-between text-sm text-zinc-200">
              <span className="flex items-center gap-2">
                <Clock className="h-4 w-4 text-amber-400" />
                Inactive Members
              </span>
              <Badge variant="outline" className="text-[11px] border-amber-500/20 text-amber-400 bg-amber-500/5">
                {inactiveMembers.length} &middot; {inactivityThresholdDays ?? 7}d threshold
              </Badge>
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-1">
              {inactiveMembers.slice(0, 5).map((m) => (
                <div key={m.userId} className="flex items-center gap-3 py-1.5 px-2 -mx-2 rounded-md hover:bg-white/[0.02]">
                  <Avatar className="h-6 w-6">
                    <AvatarImage src={m.avatarUrl ?? undefined} />
                    <AvatarFallback className="text-[9px]">{displayName(m).slice(0, 2).toUpperCase()}</AvatarFallback>
                  </Avatar>
                  <span className="text-sm text-zinc-300 flex-1 truncate">{displayName(m)}</span>
                  <span className="text-xs text-amber-400 tabular-nums">{m.daysInactive === null ? 'Never' : `${m.daysInactive}d`}</span>
                </div>
              ))}
              {inactiveMembers.length > 5 && (
                <p className="text-[11px] text-zinc-600 text-center pt-1">+{inactiveMembers.length - 5} more</p>
              )}
            </div>
          </CardContent>
        </Card>
      )}

      {/* ══ Export ══ */}
      <Card>
        <CardContent className="py-4">
          <div className="flex items-center gap-3">
            <Download className="h-4 w-4 text-zinc-500" />
            <span className="text-sm text-zinc-400">Export</span>
            <div className="flex gap-2 ml-auto">
              <Button
                variant="outline"
                size="sm"
                onClick={() => window.open(exportApi.entriesUrl(factionId), '_blank', 'noopener,noreferrer')}
              >
                Entries CSV
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => window.open(exportApi.quotaReportUrl(factionId), '_blank', 'noopener,noreferrer')}
              >
                Quota Report
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* ══ Charts ══ */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-sm text-zinc-200">
            <BarChart3 className="h-4 w-4 text-zinc-400" />
            Analytics
          </CardTitle>
        </CardHeader>
        <CardContent>
          <DashboardCharts factionId={factionId} brandColor={brandColor} />
        </CardContent>
      </Card>
    </div>
  );
}
