'use client';

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { reportsApi } from '@/lib/api-client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Skeleton } from '@/components/ui/skeleton';
import { FileBarChart, ArrowUpRight, ArrowDownRight, Minus, Users, TrendingUp, Printer } from 'lucide-react';
import { formatAmount, displayName, formatNumber, formatCount } from '@/lib/format';
import { ItemIcon } from '@/components/item-icon';
import { EmptyState, ErrorState } from '@/components/ui/empty-state';
import { useTranslation } from '@/providers/i18n-provider';
import type { TranslationKey } from '@/lib/i18n';

interface Props { factionId: string; }

type Tab = 'summary' | 'comparison';

const PERIOD_KEYS: Record<string, TranslationKey> = {
  this_week: 'period.thisWeek',
  last_week: 'period.lastWeek',
  this_month: 'period.thisMonth',
  last_month: 'period.lastMonth',
  last_30d: 'period.last30d',
  last_90d: 'period.last90d',
  all: 'period.allTime',
};

/** The two periods the comparison tab lets you set against each other. */
const COMPARISON_PERIODS = ['this_week', 'last_week', 'this_month', 'last_month'] as const;

export function ReportsView({ factionId }: Props) {
  const { t } = useTranslation();
  const [tab, setTab] = useState<Tab>('summary');
  const [period, setPeriod] = useState('this_month');
  const [periodA, setPeriodA] = useState('this_month');
  const [periodB, setPeriodB] = useState('last_month');

  const { data: summary, isLoading: summaryLoading, isError: summaryIsError, error: summaryError, refetch: summaryRefetch } = useQuery({
    queryKey: ['reports-summary', factionId, period],
    queryFn: () => reportsApi.summary(factionId, period),
    staleTime: 2 * 60 * 1000,
  });

  const { data: comparison, isLoading: compLoading, isError: compIsError, error: compError, refetch: compRefetch } = useQuery({
    queryKey: ['reports-comparison', factionId, periodA, periodB],
    queryFn: () => reportsApi.comparison(factionId, periodA, periodB),
    staleTime: 2 * 60 * 1000,
    enabled: tab === 'comparison',
  });

  const fmt = (n: number) => `$${formatNumber(n)}`;
  const fmtItems = (n: number) => `${formatCount(n)} ${t('common.pieces')}`;

  // A null percentage means the earlier period was zero — no baseline to
  // compare against, which is not the same as no change.
  const pctLabel = (pct: number | null) =>
    pct === null ? t('reports.noBaseline') : `${pct >= 0 ? '+' : ''}${pct}%`;

  return (
    <div className="space-y-4">
      {/* Tab switcher */}
      <div className="flex gap-2">
        <Button variant={tab === 'summary' ? 'default' : 'outline'} size="sm" onClick={() => setTab('summary')}>
          <FileBarChart className="mr-1.5 h-4 w-4" />
          {t('reports.periodSummary')}
        </Button>
        <Button variant={tab === 'comparison' ? 'default' : 'outline'} size="sm" onClick={() => setTab('comparison')}>
          <TrendingUp className="mr-1.5 h-4 w-4" />
          {t('reports.periodComparison')}
        </Button>
      </div>

      <Button variant="outline" size="sm" className="print:hidden self-start" onClick={() => window.print()}>
        <Printer className="mr-1.5 h-4 w-4" />
        {t('reports.print')}
      </Button>

      {tab === 'summary' && (
        <>
          <div className="flex flex-wrap gap-1.5">
            {Object.entries(PERIOD_KEYS).map(([value, key]) => (
              <Button
                key={value}
                variant={period === value ? 'default' : 'outline'}
                size="sm"
                className="h-7 px-2.5 text-xs"
                onClick={() => setPeriod(value)}
              >
                {t(key)}
              </Button>
            ))}
          </div>

          {summaryLoading ? (
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              {[...Array(4)].map((_, i) => (<Card key={i}><CardContent className="p-4"><Skeleton className="h-16 w-full" /></CardContent></Card>))}
            </div>
          ) : summary ? (
            <>
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
                <Card className="border-highlight">
                  <CardContent className="p-4">
                    <p className="text-[11px] text-zinc-500 uppercase tracking-wider">{t('reports.currencyTotal')}</p>
                    <p className="text-xl font-medium tabular-nums tracking-tight mt-1 text-zinc-100">{fmt(summary.overview.currencyTotal)}</p>
                    <p className="text-[11px] text-zinc-600 mt-1 tabular-nums">
                      {t('entries.count', { count: summary.overview.currencyEntryCount })} &middot; {t('reports.avg', { amount: fmt(summary.overview.avgPerCurrencyEntry) })}
                    </p>
                  </CardContent>
                </Card>
                <Card>
                  <CardContent className="p-4">
                    <p className="text-[11px] text-zinc-500 uppercase tracking-wider">{t('reports.itemTotal')}</p>
                    <p className="text-xl font-medium tabular-nums tracking-tight mt-1 text-zinc-100">{fmtItems(summary.overview.itemTotal)}</p>
                    <p className="text-[11px] text-zinc-600 mt-1 tabular-nums">
                      {t('entries.count', { count: summary.overview.itemEntryCount })} &middot; {t('reports.avg', { amount: fmtItems(summary.overview.avgPerItemEntry) })}
                    </p>
                  </CardContent>
                </Card>
                <Card>
                  <CardContent className="p-4">
                    <p className="text-[11px] text-zinc-500 uppercase tracking-wider">{t('nav.entries')}</p>
                    <p className="text-xl font-medium tabular-nums tracking-tight mt-1 text-zinc-100">{summary.overview.entryCount}</p>
                    <p className="text-[11px] text-zinc-600 mt-1 tabular-nums">{summary.from} → {summary.to}</p>
                  </CardContent>
                </Card>
                <Card>
                  <CardContent className="p-4">
                    <p className="text-[11px] text-zinc-500 uppercase tracking-wider">{t('reports.uniqueMembers')}</p>
                    <p className="text-xl font-medium tabular-nums tracking-tight mt-1 text-zinc-100">{summary.overview.uniqueMembers}</p>
                  </CardContent>
                </Card>
              </div>

              <div className="grid gap-4 lg:grid-cols-2">
                <Card>
                  <CardHeader className="pb-2"><CardTitle className="text-sm text-zinc-200">{t('reports.byItemType')}</CardTitle></CardHeader>
                  <CardContent>
                    {summary.byType.length === 0 ? (
                      <EmptyState icon={FileBarChart} title={t('common.noData')} compact />
                    ) : (
                      <div className="space-y-2">
                        {summary.byType.map((row) => (
                          <div key={row.itemTypeName} className="flex items-center justify-between rounded-lg border border-white/[0.06] p-3 transition-all duration-150 hover:border-white/[0.1]">
                            <div className="flex items-center gap-2.5 min-w-0">
                              <ItemIcon src={row.imageUrl} icon={row.icon} category={row.category} className="size-8" />
                              <div className="min-w-0">
                                <p className="text-sm font-medium text-zinc-300 truncate">{row.itemTypeName}</p>
                                <p className="text-[11px] text-zinc-600">{t('entries.count', { count: row.count })} &middot; {t('reports.avg', { amount: fmt(row.avg) })} &middot; {t('reports.max', { amount: fmt(row.max) })}</p>
                              </div>
                            </div>
                            <span className="text-sm font-medium tabular-nums text-zinc-200">{formatAmount(row.total, row.unit, row.isCurrency)}</span>
                          </div>
                        ))}
                      </div>
                    )}
                  </CardContent>
                </Card>

                <Card>
                  <CardHeader className="pb-2"><CardTitle className="text-sm text-zinc-200 flex items-center gap-2"><Users className="h-4 w-4 text-zinc-400" /> {t('reports.memberRanking')}</CardTitle></CardHeader>
                  <CardContent>
                    {summary.memberRanking.length === 0 ? (
                      <EmptyState icon={FileBarChart} title={t('common.noData')} compact />
                    ) : (
                      <div className="space-y-1 max-h-[400px] overflow-y-auto">
                        {summary.memberRanking.map((m, i) => (
                          <div key={m.username} className="flex items-center gap-3 py-1.5 px-2 -mx-2 rounded-md hover:bg-white/[0.02] transition-colors duration-100">
                            <span className="text-xs font-medium text-zinc-600 w-4 tabular-nums">#{i + 1}</span>
                            <Avatar className="h-6 w-6">
                              <AvatarImage src={m.avatarUrl ?? undefined} />
                              <AvatarFallback className="text-[9px]">{displayName({ username: m.username, inGameName: m.inGameName }).slice(0, 2).toUpperCase()}</AvatarFallback>
                            </Avatar>
                            <div className="flex-1 min-w-0">
                              <p className="text-sm text-zinc-300 truncate">{displayName({ username: m.username, inGameName: m.inGameName })}</p>
                              <p className="text-[11px] text-zinc-600">{t('entries.count', { count: m.count })}</p>
                            </div>
                            <span className="text-sm font-medium tabular-nums text-zinc-200">
                              {fmt(m.currencyTotal)}
                              {m.itemTotal > 0 && (
                                <span className="text-zinc-500 font-normal"> &middot; {fmtItems(m.itemTotal)}</span>
                              )}
                            </span>
                          </div>
                        ))}
                      </div>
                    )}
                  </CardContent>
                </Card>
              </div>
            </>
          ) : summaryIsError ? (
            <ErrorState error={summaryError} onRetry={() => summaryRefetch()} />
          ) : null}
        </>
      )}

      {tab === 'comparison' && (
        <>
          <div className="flex flex-wrap gap-2 items-center">
            <span className="text-xs text-zinc-500">{t('reports.periodA')}</span>
            <select className="h-8 rounded-md border border-white/[0.08] bg-white/[0.03] text-zinc-300 px-2 text-sm" value={periodA} onChange={(e) => setPeriodA(e.target.value)} aria-label={t('reports.periodA')}>
              {COMPARISON_PERIODS.map((value) => (
                <option key={value} value={value}>{t(PERIOD_KEYS[value])}</option>
              ))}
            </select>
            <span className="text-xs text-zinc-600">{t('reports.vs')}</span>
            <span className="text-xs text-zinc-500">{t('reports.periodB')}</span>
            <select className="h-8 rounded-md border border-white/[0.08] bg-white/[0.03] text-zinc-300 px-2 text-sm" value={periodB} onChange={(e) => setPeriodB(e.target.value)} aria-label={t('reports.periodB')}>
              {COMPARISON_PERIODS.map((value) => (
                <option key={value} value={value}>{t(PERIOD_KEYS[value])}</option>
              ))}
            </select>
          </div>

          {compLoading ? (
            <Card><CardContent className="p-6"><Skeleton className="h-48 w-full" /></CardContent></Card>
          ) : comparison ? (
            <>
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
                <Card>
                  <CardContent className="p-4">
                    <p className="text-[11px] text-zinc-500 uppercase tracking-wider">{t('reports.currencyChange')}</p>
                    <div className="flex items-center gap-2 mt-1">
                      <p className="text-xl font-medium tabular-nums tracking-tight text-zinc-100">{fmt(Math.abs(comparison.deltas.currencyTotal))}</p>
                      {comparison.deltas.currencyTotal > 0 ? <ArrowUpRight className="h-4 w-4 text-emerald-400" /> : comparison.deltas.currencyTotal < 0 ? <ArrowDownRight className="h-4 w-4 text-red-400" /> : <Minus className="h-4 w-4 text-zinc-600" />}
                    </div>
                    <p className="text-[11px] text-zinc-500 mt-1 tabular-nums">{pctLabel(comparison.deltas.currencyTotalPercent)}</p>
                  </CardContent>
                </Card>
                <Card>
                  <CardContent className="p-4">
                    <p className="text-[11px] text-zinc-500 uppercase tracking-wider">{t('reports.itemChange')}</p>
                    <div className="flex items-center gap-2 mt-1">
                      <p className="text-xl font-medium tabular-nums tracking-tight text-zinc-100">{fmt(Math.abs(comparison.deltas.itemTotal))}</p>
                      {comparison.deltas.itemTotal > 0 ? <ArrowUpRight className="h-4 w-4 text-emerald-400" /> : comparison.deltas.itemTotal < 0 ? <ArrowDownRight className="h-4 w-4 text-red-400" /> : <Minus className="h-4 w-4 text-zinc-600" />}
                    </div>
                    <p className="text-[11px] text-zinc-500 mt-1 tabular-nums">{pctLabel(comparison.deltas.itemTotalPercent)}</p>
                  </CardContent>
                </Card>
                <Card>
                  <CardContent className="p-4">
                    <p className="text-[11px] text-zinc-500 uppercase tracking-wider">{t('reports.entryCount')}</p>
                    <div className="flex items-center gap-2 mt-1">
                      <p className="text-xl font-medium tabular-nums tracking-tight text-zinc-100">{comparison.deltas.entryCount >= 0 ? '+' : ''}{comparison.deltas.entryCount}</p>
                      {comparison.deltas.entryCount > 0 ? <ArrowUpRight className="h-4 w-4 text-emerald-400" /> : comparison.deltas.entryCount < 0 ? <ArrowDownRight className="h-4 w-4 text-red-400" /> : <Minus className="h-4 w-4 text-zinc-600" />}
                    </div>
                  </CardContent>
                </Card>
                <Card>
                  <CardContent className="p-4">
                    <p className="text-[11px] text-zinc-500 uppercase tracking-wider">{t('reports.memberActivity')}</p>
                    <div className="flex items-center gap-2 mt-1">
                      <p className="text-xl font-medium tabular-nums tracking-tight text-zinc-100">{comparison.deltas.memberActivity >= 0 ? '+' : ''}{comparison.deltas.memberActivity}</p>
                      {comparison.deltas.memberActivity > 0 ? <ArrowUpRight className="h-4 w-4 text-emerald-400" /> : comparison.deltas.memberActivity < 0 ? <ArrowDownRight className="h-4 w-4 text-red-400" /> : <Minus className="h-4 w-4 text-zinc-600" />}
                    </div>
                  </CardContent>
                </Card>
              </div>

              <div className="grid gap-4 lg:grid-cols-2">
                {([comparison.periodA, comparison.periodB] as const).map((p, idx) => (
                  <Card key={idx}>
                    <CardHeader className="pb-2">
                      <CardTitle className="text-sm text-zinc-200">
                        <span className="text-[11px] bg-white/[0.04] border border-white/[0.06] px-2 py-0.5 rounded-md text-zinc-400 mr-2">{PERIOD_KEYS[p.label] ? t(PERIOD_KEYS[p.label]) : p.label.replace('_', ' ')}</span>
                        <span className="text-zinc-500 tabular-nums text-xs">{p.from} → {p.to}</span>
                      </CardTitle>
                    </CardHeader>
                    <CardContent className="space-y-2">
                      <div className="flex justify-between text-sm"><span className="text-zinc-500">{t('reports.currency')}</span><span className="font-medium tabular-nums text-zinc-200">{fmt(p.currencyTotal)}</span></div>
                      <div className="flex justify-between text-sm"><span className="text-zinc-500">{t('reports.items')}</span><span className="font-medium tabular-nums text-zinc-200">{fmtItems(p.itemTotal)}</span></div>
                      <div className="flex justify-between text-sm"><span className="text-zinc-500">{t('nav.entries')}</span><span className="font-medium tabular-nums text-zinc-200">{p.count}</span></div>
                      <div className="flex justify-between text-sm"><span className="text-zinc-500">{t('reports.activeMembers')}</span><span className="font-medium tabular-nums text-zinc-200">{p.members}</span></div>
                      {p.byType.map((row) => (
                        <div key={row.itemTypeName} className="flex justify-between text-sm border-t border-white/[0.06] pt-2">
                          <span className="text-zinc-500 flex items-center gap-1.5">
                            <ItemIcon src={row.imageUrl} icon={row.icon} category={row.category} className="size-4" />
                            {row.itemTypeName}
                          </span>
                          <span className="tabular-nums text-zinc-300">{formatAmount(row.total, row.unit, row.isCurrency)} ({row.count})</span>
                        </div>
                      ))}
                    </CardContent>
                  </Card>
                ))}
              </div>
            </>
          ) : compIsError ? (
            <ErrorState error={compError} onRetry={() => compRefetch()} />
          ) : null}
        </>
      )}
    </div>
  );
}
