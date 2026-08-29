'use client';

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { reportsApi } from '@/lib/api-client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Skeleton } from '@/components/ui/skeleton';
import { FileBarChart, ArrowUpRight, ArrowDownRight, Minus, Users, TrendingUp } from 'lucide-react';
import { formatAmount } from '@/lib/format';

interface Props { factionId: string; }

type Tab = 'summary' | 'comparison';

const PERIOD_OPTIONS = [
  { label: 'This Week', value: 'this_week' },
  { label: 'Last Week', value: 'last_week' },
  { label: 'This Month', value: 'this_month' },
  { label: 'Last Month', value: 'last_month' },
  { label: 'Last 30d', value: 'last_30d' },
  { label: 'Last 90d', value: 'last_90d' },
  { label: 'All Time', value: 'all' },
];

export function ReportsView({ factionId }: Props) {
  const [tab, setTab] = useState<Tab>('summary');
  const [period, setPeriod] = useState('this_month');
  const [periodA, setPeriodA] = useState('this_month');
  const [periodB, setPeriodB] = useState('last_month');

  const { data: summary, isLoading: summaryLoading } = useQuery({
    queryKey: ['reports-summary', factionId, period],
    queryFn: () => reportsApi.summary(factionId, period),
    staleTime: 2 * 60 * 1000,
  });

  const { data: comparison, isLoading: compLoading } = useQuery({
    queryKey: ['reports-comparison', factionId, periodA, periodB],
    queryFn: () => reportsApi.comparison(factionId, periodA, periodB),
    staleTime: 2 * 60 * 1000,
    enabled: tab === 'comparison',
  });

  const fmt = (n: number) => n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

  return (
    <div className="space-y-4">
      {/* Tab switcher */}
      <div className="flex gap-2">
        <Button variant={tab === 'summary' ? 'default' : 'outline'} size="sm" onClick={() => setTab('summary')}>
          <FileBarChart className="mr-1.5 h-4 w-4" />
          Period Summary
        </Button>
        <Button variant={tab === 'comparison' ? 'default' : 'outline'} size="sm" onClick={() => setTab('comparison')}>
          <TrendingUp className="mr-1.5 h-4 w-4" />
          Period Comparison
        </Button>
      </div>

      {tab === 'summary' && (
        <>
          <div className="flex flex-wrap gap-1.5">
            {PERIOD_OPTIONS.map((opt) => (
              <Button
                key={opt.value}
                variant={period === opt.value ? 'default' : 'outline'}
                size="sm"
                className="h-7 px-2.5 text-xs"
                onClick={() => setPeriod(opt.value)}
              >
                {opt.label}
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
                    <p className="text-[11px] text-zinc-500 uppercase tracking-wider">Total Amount</p>
                    <p className="text-xl font-medium tabular-nums tracking-tight mt-1 text-zinc-100">{fmt(summary.overview.totalAmount)}</p>
                    <p className="text-[11px] text-zinc-600 mt-1 tabular-nums">{summary.from} → {summary.to}</p>
                  </CardContent>
                </Card>
                <Card>
                  <CardContent className="p-4">
                    <p className="text-[11px] text-zinc-500 uppercase tracking-wider">Entries</p>
                    <p className="text-xl font-medium tabular-nums tracking-tight mt-1 text-zinc-100">{summary.overview.entryCount}</p>
                  </CardContent>
                </Card>
                <Card>
                  <CardContent className="p-4">
                    <p className="text-[11px] text-zinc-500 uppercase tracking-wider">Unique Members</p>
                    <p className="text-xl font-medium tabular-nums tracking-tight mt-1 text-zinc-100">{summary.overview.uniqueMembers}</p>
                  </CardContent>
                </Card>
                <Card>
                  <CardContent className="p-4">
                    <p className="text-[11px] text-zinc-500 uppercase tracking-wider">Avg per Entry</p>
                    <p className="text-xl font-medium tabular-nums tracking-tight mt-1 text-zinc-100">{fmt(summary.overview.avgPerEntry)}</p>
                  </CardContent>
                </Card>
              </div>

              <div className="grid gap-4 lg:grid-cols-2">
                <Card>
                  <CardHeader className="pb-2"><CardTitle className="text-sm text-zinc-200">By Item Type</CardTitle></CardHeader>
                  <CardContent>
                    {summary.byType.length === 0 ? (
                      <p className="text-zinc-600 text-sm text-center py-8">No data.</p>
                    ) : (
                      <div className="space-y-2">
                        {summary.byType.map((t) => (
                          <div key={t.itemTypeName} className="flex items-center justify-between rounded-lg border border-white/[0.06] p-3 transition-all duration-150 hover:border-white/[0.1]">
                            <div>
                              <p className="text-sm font-medium text-zinc-300">{t.itemTypeName}</p>
                              <p className="text-[11px] text-zinc-600">{t.count} entries &middot; avg {fmt(t.avg)} &middot; max {fmt(t.max)}</p>
                            </div>
                            <span className="text-sm font-medium tabular-nums text-zinc-200">{formatAmount(t.total, t.unit, t.isCurrency)}</span>
                          </div>
                        ))}
                      </div>
                    )}
                  </CardContent>
                </Card>

                <Card>
                  <CardHeader className="pb-2"><CardTitle className="text-sm text-zinc-200 flex items-center gap-2"><Users className="h-4 w-4 text-zinc-400" /> Member Ranking</CardTitle></CardHeader>
                  <CardContent>
                    {summary.memberRanking.length === 0 ? (
                      <p className="text-zinc-600 text-sm text-center py-8">No data.</p>
                    ) : (
                      <div className="space-y-1 max-h-[400px] overflow-y-auto">
                        {summary.memberRanking.map((m, i) => (
                          <div key={m.username} className="flex items-center gap-3 py-1.5 px-2 -mx-2 rounded-md hover:bg-white/[0.02] transition-colors duration-100">
                            <span className="text-xs font-medium text-zinc-600 w-4 tabular-nums">#{i + 1}</span>
                            <Avatar className="h-6 w-6">
                              <AvatarImage src={m.avatarUrl ?? undefined} />
                              <AvatarFallback className="text-[9px]">{m.username.slice(0, 2).toUpperCase()}</AvatarFallback>
                            </Avatar>
                            <div className="flex-1 min-w-0">
                              <p className="text-sm text-zinc-300 truncate">{m.username}</p>
                              <p className="text-[11px] text-zinc-600">{m.count} entries &middot; avg {fmt(m.avg)}</p>
                            </div>
                            <span className="text-sm font-medium tabular-nums text-zinc-200">{fmt(m.total)}</span>
                          </div>
                        ))}
                      </div>
                    )}
                  </CardContent>
                </Card>
              </div>
            </>
          ) : null}
        </>
      )}

      {tab === 'comparison' && (
        <>
          <div className="flex flex-wrap gap-2 items-center">
            <span className="text-xs text-zinc-500">Period A:</span>
            <select className="h-8 rounded-md border border-white/[0.08] bg-white/[0.03] text-zinc-300 px-2 text-sm" value={periodA} onChange={(e) => setPeriodA(e.target.value)}>
              <option value="this_week">This Week</option>
              <option value="last_week">Last Week</option>
              <option value="this_month">This Month</option>
              <option value="last_month">Last Month</option>
            </select>
            <span className="text-xs text-zinc-600">vs</span>
            <span className="text-xs text-zinc-500">Period B:</span>
            <select className="h-8 rounded-md border border-white/[0.08] bg-white/[0.03] text-zinc-300 px-2 text-sm" value={periodB} onChange={(e) => setPeriodB(e.target.value)}>
              <option value="this_week">This Week</option>
              <option value="last_week">Last Week</option>
              <option value="this_month">This Month</option>
              <option value="last_month">Last Month</option>
            </select>
          </div>

          {compLoading ? (
            <Card><CardContent className="p-6"><Skeleton className="h-48 w-full" /></CardContent></Card>
          ) : comparison ? (
            <>
              <div className="grid gap-4 sm:grid-cols-3">
                <Card>
                  <CardContent className="p-4">
                    <p className="text-[11px] text-zinc-500 uppercase tracking-wider">Amount Change</p>
                    <div className="flex items-center gap-2 mt-1">
                      <p className="text-xl font-medium tabular-nums tracking-tight text-zinc-100">{fmt(Math.abs(comparison.deltas.totalAmount))}</p>
                      {comparison.deltas.totalAmount > 0 ? <ArrowUpRight className="h-4 w-4 text-emerald-400" /> : comparison.deltas.totalAmount < 0 ? <ArrowDownRight className="h-4 w-4 text-red-400" /> : <Minus className="h-4 w-4 text-zinc-600" />}
                    </div>
                    <p className="text-[11px] text-zinc-500 mt-1 tabular-nums">{comparison.deltas.totalAmountPercent >= 0 ? '+' : ''}{comparison.deltas.totalAmountPercent}%</p>
                  </CardContent>
                </Card>
                <Card>
                  <CardContent className="p-4">
                    <p className="text-[11px] text-zinc-500 uppercase tracking-wider">Entry Count</p>
                    <div className="flex items-center gap-2 mt-1">
                      <p className="text-xl font-medium tabular-nums tracking-tight text-zinc-100">{comparison.deltas.entryCount >= 0 ? '+' : ''}{comparison.deltas.entryCount}</p>
                      {comparison.deltas.entryCount > 0 ? <ArrowUpRight className="h-4 w-4 text-emerald-400" /> : comparison.deltas.entryCount < 0 ? <ArrowDownRight className="h-4 w-4 text-red-400" /> : <Minus className="h-4 w-4 text-zinc-600" />}
                    </div>
                  </CardContent>
                </Card>
                <Card>
                  <CardContent className="p-4">
                    <p className="text-[11px] text-zinc-500 uppercase tracking-wider">Member Activity</p>
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
                        <span className="text-[11px] bg-white/[0.04] border border-white/[0.06] px-2 py-0.5 rounded-md text-zinc-400 mr-2">{p.label.replace('_', ' ')}</span>
                        <span className="text-zinc-500 tabular-nums text-xs">{p.from} → {p.to}</span>
                      </CardTitle>
                    </CardHeader>
                    <CardContent className="space-y-2">
                      <div className="flex justify-between text-sm"><span className="text-zinc-500">Total</span><span className="font-medium tabular-nums text-zinc-200">{fmt(p.total)}</span></div>
                      <div className="flex justify-between text-sm"><span className="text-zinc-500">Entries</span><span className="font-medium tabular-nums text-zinc-200">{p.count}</span></div>
                      <div className="flex justify-between text-sm"><span className="text-zinc-500">Active Members</span><span className="font-medium tabular-nums text-zinc-200">{p.members}</span></div>
                      {p.byType.map((t) => (
                        <div key={t.itemTypeName} className="flex justify-between text-sm border-t border-white/[0.06] pt-2">
                          <span className="text-zinc-500">{t.itemTypeName}</span>
                          <span className="tabular-nums text-zinc-300">{fmt(t.total)} ({t.count})</span>
                        </div>
                      ))}
                    </CardContent>
                  </Card>
                ))}
              </div>
            </>
          ) : null}
        </>
      )}
    </div>
  );
}
