'use client';

import { useQuery } from '@tanstack/react-query';
import { dashboardApi, quotasApi, exportApi } from '@/lib/api-client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { List, TrendingUp, Target, Download, BarChart3, ArrowUpRight, AlertTriangle, Clock } from 'lucide-react';
import { useAppStore } from '@/lib/store';
import { DashboardCharts } from '@/components/dashboard-charts';
import { formatAmount, displayName, formatNumber, formatCount } from '@/lib/format';
import { ItemIcon } from '@/components/item-icon';
import { useTranslation } from '@/providers/i18n-provider';
import type { TranslationKey } from '@/lib/i18n';

/** Quota period names as the API spells them. */
const QUOTA_PERIOD_KEYS: Record<string, TranslationKey> = {
  daily: 'quota.period.daily',
  weekly: 'quota.period.weekly',
  monthly: 'quota.period.monthly',
};

interface Props {
  factionId: string;
}

export function DashboardView({ factionId }: Props) {
  const { t } = useTranslation();
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
          {t('dashboard.loadFailed')}
        </CardContent>
      </Card>
    );
  }

  const { faction, totalsByType, grandTotal, treasuryBalances, netBalance, memberCount, adminCount, totalEntries, topContributors, recentEntries, inactiveMembers, inactivityThresholdDays } = data;
  const activeQuotas = (quotasList as import('@/lib/api-types').Quota[]).filter(q => q.isActive && q.periodActive);
  // A quota period that ended short of its target used to vanish when the
  // next one began — this is the only trace that it was missed.
  const missedQuotas = (quotasList as import('@/lib/api-types').Quota[]).filter(
    (q) => q.isActive && q.previousPeriod && !q.previousPeriod.met,
  );

  // Currency summaries are prefixed with $; the goods breakdown uses
  // formatAmount() with the type-specific unit instead.
  const fmt = (n: number) => `$${formatNumber(n)}`;

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
            <CardTitle className="text-xs font-normal text-zinc-500 uppercase tracking-wider">{t('dashboard.netTreasuryBalance')}</CardTitle>
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
                  {/* Neutral unless the figure is actually negative: a faction
                      whose accent is green or red would otherwise colour an
                      ordinary balance as if it meant something. */}
                  <div className="text-3xl font-medium tabular-nums tracking-tight" style={{ color: bal < 0 ? '#ef4444' : '#e4e4e7' }}>
                    {fmt(bal)}
                  </div>
                  <p className="text-xs text-zinc-500 mt-1.5">
                    {hasTreasury
                      ? <>
                          {t('dashboard.inflowOutflow', { inflow: fmt(totalIn), outflow: fmt(totalOut) })}
                          {goodsCount > 0 && <> &middot; {t('dashboard.currencyOnly')}</>}
                        </>
                      : t('treasury.totalsNoteAll')
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
            <CardTitle className="text-xs font-normal text-zinc-500 uppercase tracking-wider">{t('nav.entries')}</CardTitle>
          </CardHeader>
          <CardContent className="relative z-10">
            <div className="text-2xl font-medium tabular-nums tracking-tight">{formatCount(totalEntries)}</div>
            <p className="text-xs text-zinc-500 mt-1.5">{t('dashboard.loggedContributions')}</p>
          </CardContent>
        </Card>

        {/* Stat: Members */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-xs font-normal text-zinc-500 uppercase tracking-wider">{t('nav.members')}</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-medium tabular-nums tracking-tight">{memberCount}</div>
            <p className="text-xs text-zinc-500 mt-1.5">{t('dashboard.adminCount', { count: adminCount })}</p>
          </CardContent>
        </Card>

        {/* Stat: Item Types */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-xs font-normal text-zinc-500 uppercase tracking-wider">{t('dashboard.categories')}</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-medium tabular-nums tracking-tight">{totalsByType.length}</div>
            <p className="text-xs text-zinc-500 mt-1.5">{t('dashboard.activeItemTypes')}</p>
          </CardContent>
        </Card>
      </div>

      {/* ══ Quota Progress — Energy Bars ══ */}
      {activeQuotas.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-sm text-zinc-200">
              <Target className="h-4 w-4 text-zinc-400" />
              {t('dashboard.quotaProgress')}
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
                      <div className="flex items-center gap-2.5 min-w-0">
                        <ItemIcon src={q.itemImageUrl} />
                        <div className="min-w-0">
                          <p className="text-sm font-medium text-zinc-200 truncate">{q.itemTypeName}</p>
                          <p className="text-[11px] text-zinc-500">{QUOTA_PERIOD_KEYS[q.periodType] ? t(QUOTA_PERIOD_KEYS[q.periodType]) : q.periodType}</p>
                        </div>
                      </div>
                      {/* Only "met" earns a colour. The percentage used to wear
                          the faction accent, which read as a verdict on the
                          number whenever that accent was green or red. */}
                      <Badge variant="outline" className={met ? 'border-emerald-500/30 text-emerald-400' : 'text-zinc-300'}>
                        {met ? t('quota.met') : `${pct.toFixed(1)}%`}
                      </Badge>
                    </div>
                    {/* Energy bar */}
                    <div className="h-2 bg-white/[0.04] rounded-full overflow-hidden">
                      {/* Met is green, everything short of it is neutral. The
                          unmet bar used to wear the faction accent, which made
                          the two states indistinguishable for a faction whose
                          colour happens to be green — and read as a failure for
                          one whose colour is red. Matches the quota bar in
                          Settings, which was already neutral. */}
                      <div
                        className={`h-full rounded-full energy-bar transition-all duration-500 ${met ? 'bg-emerald-500' : 'bg-primary'}`}
                        style={{ width: `${Math.min(pct, 100)}%` }}
                      />
                    </div>
                    <div className="flex justify-between text-[11px] text-zinc-500 tabular-nums">
                      <span>{formatAmount(q.currentAmount ?? 0, q.itemUnit, q.itemIsCurrency)}</span>
                      <span>{t('quota.ofTarget', { amount: formatAmount(q.targetAmount, q.itemUnit, q.itemIsCurrency) })}</span>
                    </div>
                  </div>
                );
              })}
            </div>
          </CardContent>
        </Card>
      )}

      {/* ══ Quota periods that ended unmet ══ */}
      {missedQuotas.length > 0 && (
        <Card className="border-amber-500/15">
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-sm text-zinc-200">
              <AlertTriangle className="h-4 w-4 text-amber-400" />
              {t('dashboard.missedQuotas')}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-1">
              {missedQuotas.map((q) => {
                const prev = q.previousPeriod!;
                return (
                  <div key={q.id} className="flex items-center gap-3 py-1.5 px-2 -mx-2 rounded-md hover:bg-white/[0.02]">
                    <ItemIcon src={q.itemImageUrl} className="size-5" />
                    <div className="flex-1 min-w-0">
                      <p className="text-sm text-zinc-300 truncate">
                        {q.itemTypeName}
                        <span className="text-zinc-600"> &middot; {QUOTA_PERIOD_KEYS[q.periodType] ? t(QUOTA_PERIOD_KEYS[q.periodType]) : q.periodType}</span>
                      </p>
                      <p className="text-[11px] text-zinc-600 tabular-nums">{prev.periodStart} – {prev.periodEnd}</p>
                    </div>
                    <span className="text-xs text-amber-400 tabular-nums">
                      {t('quota.lastPeriodNotMet', {
                        current: formatAmount(prev.currentAmount, q.itemUnit, q.itemIsCurrency),
                        target: formatAmount(prev.targetAmount, q.itemUnit, q.itemIsCurrency),
                      })}
                    </span>
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
              {t('dashboard.topContributors')}
            </CardTitle>
          </CardHeader>
          <CardContent>
            {topContributors.length === 0 ? (
              <p className="text-zinc-600 text-sm text-center py-8">{t('dashboard.noContributions')}</p>
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
                      <p className="text-[11px] text-zinc-600">{t('entries.count', { count: c.entryCount })}</p>
                    </div>
                    <span className="text-sm font-medium tabular-nums text-zinc-200">{fmt(c.totalContributed)}</span>
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
                {t('dashboard.recentActivity')}
              </span>
              <Button
                onClick={() => setCurrentView('entries')}
                className="text-[11px] font-medium flex items-center gap-1 transition-colors duration-100 hover:opacity-80"
                style={{ color: brandColor }}
              >
                {t('dashboard.viewAll')} <ArrowUpRight className="h-3 w-3" />
              </Button>
            </CardTitle>
          </CardHeader>
          <CardContent>
            {recentEntries.length === 0 ? (
              <p className="text-zinc-600 text-sm text-center py-8">{t('entries.noneYet')}</p>
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
                        <span className="text-zinc-600"> {t('dashboard.logged')} </span>
                        <span className="font-medium tabular-nums text-zinc-200">{formatAmount(e.amount, e.itemUnit, e.itemIsCurrency)}</span>
                      </p>
                      <p className="text-[11px] text-zinc-600 flex items-center gap-1.5">
                        <ItemIcon src={e.itemImageUrl} className="size-4" />
                        <span className="truncate">
                          {e.itemTypeName} &middot; {e.entryDate}
                          {e.description && ` — ${e.description}`}
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

      {/* ══ Totals by Type — compact grid (with treasury balance if available) ══ */}
      {totalsByType.length > 0 && (
        <Card>
          <CardHeader className="flex flex-row items-center justify-between">
            <CardTitle className="text-sm text-zinc-200">{t('dashboard.treasuryByItemType')}</CardTitle>
            {(treasuryBalances?.length ?? 0) > 0 && (
              <Button
                onClick={() => setCurrentView('treasury')}
                className="text-[11px] font-medium flex items-center gap-1 transition-colors duration-100 hover:opacity-80"
                style={{ color: brandColor }}
              >
                {t('dashboard.fullView')} <ArrowUpRight className="h-3 w-3" />
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
                    <div className="flex items-center gap-2.5 min-w-0">
                      <ItemIcon src={b.imageUrl} className="size-8" />
                      <div className="min-w-0">
                        <p className="text-sm font-medium text-zinc-300 truncate">{b.itemTypeName}</p>
                        <p className="text-xs text-zinc-600">{t('dashboard.inOut', { inflow: formatAmount(b.inflow, b.unit, b.isCurrency), outflow: formatAmount(b.outflow, b.unit, b.isCurrency) })}</p>
                      </div>
                    </div>
                    <div className="text-right">
                      <p className="text-lg font-medium tabular-nums" style={{ color: b.balance < 0 ? '#ef4444' : '#e4e4e7' }}>
                        {b.balance < 0 ? '-' : ''}{formatAmount(Math.abs(b.balance), b.unit, b.isCurrency)}
                      </p>
                    </div>
                  </div>
                ))
                : totalsByType.map((row) => (
                  <div
                    key={row.itemTypeId}
                    className="flex items-center justify-between rounded-lg border border-white/[0.06] p-3.5 transition-all duration-150 hover:border-white/[0.1]"
                  >
                    <div className="flex items-center gap-2.5 min-w-0">
                      <ItemIcon src={row.imageUrl} className="size-8" />
                      <div className="min-w-0">
                        <p className="text-sm font-medium text-zinc-300 truncate">{row.itemTypeName}</p>
                        <p className="text-xs text-zinc-600">{row.unit}</p>
                      </div>
                    </div>
                    <div className="text-right">
                      <p className="text-lg font-medium tabular-nums text-zinc-100">
                        {formatAmount(row.total, row.unit, row.isCurrency)}
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
                {t('dashboard.inactiveMembers')}
              </span>
              <Badge variant="outline" className="text-[11px] border-amber-500/20 text-amber-400 bg-amber-500/5">
                {t('dashboard.inactiveThreshold', { count: inactiveMembers.length, days: inactivityThresholdDays ?? 7 })}
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
                  <span className="text-xs text-amber-400 tabular-nums">{m.daysInactive === null ? t('dashboard.never') : t('dashboard.daysShort', { days: m.daysInactive })}</span>
                </div>
              ))}
              {inactiveMembers.length > 5 && (
                <p className="text-[11px] text-zinc-600 text-center pt-1">{t('common.andMore', { count: inactiveMembers.length - 5 })}</p>
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
            <span className="text-sm text-zinc-400">{t('common.export')}</span>
            <div className="flex gap-2 ml-auto">
              <Button
                variant="outline"
                size="sm"
                onClick={() => window.open(exportApi.entriesUrl(factionId), '_blank', 'noopener,noreferrer')}
              >
                {t('dashboard.exportEntries')}
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => window.open(exportApi.quotaReportUrl(factionId), '_blank', 'noopener,noreferrer')}
              >
                {t('dashboard.exportQuotaReport')}
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
            {t('dashboard.analytics')}
          </CardTitle>
        </CardHeader>
        <CardContent>
          <DashboardCharts factionId={factionId} brandColor={brandColor} />
        </CardContent>
      </Card>
    </div>
  );
}
