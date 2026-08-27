'use client';

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { reportsApi } from '@/lib/api-client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Skeleton } from '@/components/ui/skeleton';
import { FileBarChart, ArrowUpRight, ArrowDownRight, Minus, Users, TrendingUp } from 'lucide-react';

interface Props {
  factionId: string;
}

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
          <FileBarChart className="mr-2 h-4 w-4" />
          Period Summary
        </Button>
        <Button variant={tab === 'comparison' ? 'default' : 'outline'} size="sm" onClick={() => setTab('comparison')}>
          <TrendingUp className="mr-2 h-4 w-4" />
          Period Comparison
        </Button>
      </div>

      {tab === 'summary' && (
        <>
          {/* Period selector */}
          <div className="flex flex-wrap gap-2">
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
              {[...Array(4)].map((_, i) => (
                <Card key={i}><CardContent className="p-4"><Skeleton className="h-16 w-full" /></CardContent></Card>
              ))}
            </div>
          ) : summary ? (
            <>
              {/* Overview cards */}
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
                <Card>
                  <CardContent className="p-4">
                    <p className="text-xs text-muted-foreground">Total Amount</p>
                    <p className="text-xl font-bold">{fmt(summary.overview.totalAmount)}</p>
                    <p className="text-xs text-muted-foreground">{summary.from} → {summary.to}</p>
                  </CardContent>
                </Card>
                <Card>
                  <CardContent className="p-4">
                    <p className="text-xs text-muted-foreground">Entries</p>
                    <p className="text-xl font-bold">{summary.overview.entryCount}</p>
                  </CardContent>
                </Card>
                <Card>
                  <CardContent className="p-4">
                    <p className="text-xs text-muted-foreground">Unique Members</p>
                    <p className="text-xl font-bold">{summary.overview.uniqueMembers}</p>
                  </CardContent>
                </Card>
                <Card>
                  <CardContent className="p-4">
                    <p className="text-xs text-muted-foreground">Avg per Entry</p>
                    <p className="text-xl font-bold">{fmt(summary.overview.avgPerEntry)}</p>
                  </CardContent>
                </Card>
              </div>

              <div className="grid gap-6 lg:grid-cols-2">
                {/* By type */}
                <Card>
                  <CardHeader className="pb-2"><CardTitle className="text-base">By Item Type</CardTitle></CardHeader>
                  <CardContent>
                    {summary.byType.length === 0 ? (
                      <p className="text-muted-foreground text-sm text-center py-8">No data.</p>
                    ) : (
                      <div className="space-y-3">
                        {summary.byType.map((t) => (
                          <div key={t.itemTypeName} className="flex items-center justify-between rounded-lg border p-3">
                            <div>
                              <p className="font-medium text-sm">{t.itemTypeName}</p>
                              <p className="text-xs text-muted-foreground">{t.count} entries &middot; avg {fmt(t.avg)} &middot; max {fmt(t.max)}</p>
                            </div>
                            <span className="font-bold">{t.unit}{fmt(t.total)}</span>
                          </div>
                        ))}
                      </div>
                    )}
                  </CardContent>
                </Card>

                {/* Member ranking */}
                <Card>
                  <CardHeader className="pb-2"><CardTitle className="text-base flex items-center gap-2"><Users className="h-4 w-4" /> Member Ranking</CardTitle></CardHeader>
                  <CardContent>
                    {summary.memberRanking.length === 0 ? (
                      <p className="text-muted-foreground text-sm text-center py-8">No data.</p>
                    ) : (
                      <div className="space-y-2 max-h-[400px] overflow-y-auto">
                        {summary.memberRanking.map((m, i) => (
                          <div key={m.username} className="flex items-center gap-3">
                            <span className="text-sm font-bold text-muted-foreground w-5">#{i + 1}</span>
                            <Avatar className="h-7 w-7">
                              <AvatarImage src={m.avatarUrl ?? undefined} />
                              <AvatarFallback>{m.username.slice(0, 2).toUpperCase()}</AvatarFallback>
                            </Avatar>
                            <div className="flex-1 min-w-0">
                              <p className="text-sm font-medium truncate">{m.username}</p>
                              <p className="text-xs text-muted-foreground">{m.count} entries &middot; avg {fmt(m.avg)}</p>
                            </div>
                            <span className="text-sm font-bold">{fmt(m.total)}</span>
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
            <span className="text-sm text-muted-foreground">Period A:</span>
            <select className="h-8 rounded-md border bg-background px-2 text-sm" value={periodA} onChange={(e) => setPeriodA(e.target.value)}>
              <option value="this_week">This Week</option>
              <option value="last_week">Last Week</option>
              <option value="this_month">This Month</option>
              <option value="last_month">Last Month</option>
            </select>
            <span className="text-sm text-muted-foreground">vs</span>
            <span className="text-sm text-muted-foreground">Period B:</span>
            <select className="h-8 rounded-md border bg-background px-2 text-sm" value={periodB} onChange={(e) => setPeriodB(e.target.value)}>
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
              {/* Delta cards */}
              <div className="grid gap-4 sm:grid-cols-3">
                <Card>
                  <CardContent className="p-4">
                    <p className="text-xs text-muted-foreground">Amount Change</p>
                    <div className="flex items-center gap-2">
                      <p className="text-xl font-bold">{fmt(Math.abs(comparison.deltas.totalAmount))}</p>
                      {comparison.deltas.totalAmount > 0 ? <ArrowUpRight className="h-4 w-4 text-green-500" /> : comparison.deltas.totalAmount < 0 ? <ArrowDownRight className="h-4 w-4 text-red-500" /> : <Minus className="h-4 w-4 text-muted-foreground" />}
                    </div>
                    <p className="text-xs text-muted-foreground">
                      {comparison.deltas.totalAmountPercent >= 0 ? '+' : ''}{comparison.deltas.totalAmountPercent}%
                    </p>
                  </CardContent>
                </Card>
                <Card>
                  <CardContent className="p-4">
                    <p className="text-xs text-muted-foreground">Entry Count Change</p>
                    <div className="flex items-center gap-2">
                      <p className="text-xl font-bold">{comparison.deltas.entryCount >= 0 ? '+' : ''}{comparison.deltas.entryCount}</p>
                      {comparison.deltas.entryCount > 0 ? <ArrowUpRight className="h-4 w-4 text-green-500" /> : comparison.deltas.entryCount < 0 ? <ArrowDownRight className="h-4 w-4 text-red-500" /> : <Minus className="h-4 w-4 text-muted-foreground" />}
                    </div>
                  </CardContent>
                </Card>
                <Card>
                  <CardContent className="p-4">
                    <p className="text-xs text-muted-foreground">Member Activity Change</p>
                    <div className="flex items-center gap-2">
                      <p className="text-xl font-bold">{comparison.deltas.memberActivity >= 0 ? '+' : ''}{comparison.deltas.memberActivity}</p>
                      {comparison.deltas.memberActivity > 0 ? <ArrowUpRight className="h-4 w-4 text-green-500" /> : comparison.deltas.memberActivity < 0 ? <ArrowDownRight className="h-4 w-4 text-red-500" /> : <Minus className="h-4 w-4 text-muted-foreground" />}
                    </div>
                  </CardContent>
                </Card>
              </div>

              {/* Side by side */}
              <div className="grid gap-6 lg:grid-cols-2">
                {([comparison.periodA, comparison.periodB] as const).map((p, idx) => (
                  <Card key={idx}>
                    <CardHeader className="pb-2">
                      <CardTitle className="text-base">
                        <Badge variant="outline" className="mr-2 text-xs">{p.label.replace('_', ' ')}</Badge>
                        {p.from} → {p.to}
                      </CardTitle>
                    </CardHeader>
                    <CardContent className="space-y-2">
                      <div className="flex justify-between text-sm"><span className="text-muted-foreground">Total</span><span className="font-bold">{fmt(p.total)}</span></div>
                      <div className="flex justify-between text-sm"><span className="text-muted-foreground">Entries</span><span className="font-bold">{p.count}</span></div>
                      <div className="flex justify-between text-sm"><span className="text-muted-foreground">Active Members</span><span className="font-bold">{p.members}</span></div>
                      {p.byType.map((t) => (
                        <div key={t.itemTypeName} className="flex justify-between text-sm border-t pt-2">
                          <span className="text-muted-foreground">{t.itemTypeName}</span>
                          <span>{fmt(t.total)} ({t.count})</span>
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
