'use client';

import { useQuery } from '@tanstack/react-query';
import { dashboardApi, quotasApi, exportApi } from '@/lib/api-client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { Coins, Users, List, TrendingUp, DollarSign, Target, Download, BarChart3 } from 'lucide-react';
import { useAppStore } from '@/lib/store';
import { DashboardCharts } from '@/components/dashboard-charts';

interface Props {
  factionId: string;
}

export function DashboardView({ factionId }: Props) {
  const setCurrentView = useAppStore((s) => s.setCurrentView);

  const { data, isLoading, error } = useQuery({
    queryKey: ['dashboard', factionId],
    queryFn: () => dashboardApi.get(factionId),
    staleTime: 5 * 60 * 1000,
    refetchOnWindowFocus: true,
  });

  // Fetch quotas for progress display (always called, never conditional)
  const { data: quotasList = [] } = useQuery({
    queryKey: ['quotas', factionId],
    queryFn: () => quotasApi.list(factionId),
    staleTime: 60 * 1000,
  });

  if (isLoading) {
    return (
      <div className="space-y-6">
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {[...Array(4)].map((_, i) => (
            <Card key={i}>
              <CardHeader className="pb-2">
                <Skeleton className="h-4 w-24" />
              </CardHeader>
              <CardContent>
                <Skeleton className="h-8 w-20" />
              </CardContent>
            </Card>
          ))}
        </div>
        <div className="grid gap-6 lg:grid-cols-2">
          <Card><CardContent className="p-6"><Skeleton className="h-64 w-full" /></CardContent></Card>
          <Card><CardContent className="p-6"><Skeleton className="h-64 w-full" /></CardContent></Card>
        </div>
      </div>
    );
  }

  if (error || !data) {
    return (
      <Card className="border-destructive">
        <CardContent className="p-6 text-center text-destructive">
          Failed to load dashboard. Make sure the backend is running.
        </CardContent>
      </Card>
    );
  }

  const { faction, totalsByType, grandTotal, memberCount, adminCount, totalEntries, topContributors, recentEntries } = data;
  const activeQuotas = (quotasList as import('@/lib/api-types').Quota[]).filter(q => q.isActive && q.periodActive);

  return (
    <div className="space-y-6">
      {/* Faction Header */}
      <div>
        <h2 className="text-2xl font-bold">{faction.name}</h2>
        {faction.description && (
          <p className="text-muted-foreground mt-1">{faction.description}</p>
        )}
      </div>

      {/* Stat Cards */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Grand Total</CardTitle>
            <DollarSign className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              {grandTotal.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
            </div>
            <p className="text-xs text-muted-foreground mt-1">across all item types</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Total Entries</CardTitle>
            <List className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{totalEntries.toLocaleString()}</div>
            <p className="text-xs text-muted-foreground mt-1">logged contributions</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Members</CardTitle>
            <Users className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{memberCount}</div>
            <p className="text-xs text-muted-foreground mt-1">{adminCount} admin{adminCount !== 1 ? 's' : ''}</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Item Types</CardTitle>
            <Coins className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{totalsByType.length}</div>
            <p className="text-xs text-muted-foreground mt-1">active categories</p>
          </CardContent>
        </Card>
      </div>

      {/* Quota Progress */}
      {activeQuotas.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <Target className="h-4 w-4" />
              Quota Progress
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {activeQuotas.map((q) => {
                const pct = q.percentage ?? 0;
                const met = pct >= 100;
                return (
                  <div key={q.id} className="rounded-lg border p-4 space-y-3">
                    <div className="flex items-center justify-between">
                      <div>
                        <p className="font-medium">{q.itemTypeName}</p>
                        <p className="text-xs text-muted-foreground capitalize">{q.periodType}</p>
                      </div>
                      <Badge variant={met ? 'default' : 'outline'} className={met ? 'bg-green-600' : ''}>
                        {met ? 'Met' : `${pct.toFixed(1)}%`}
                      </Badge>
                    </div>
                    <div className="h-3 bg-muted rounded-full overflow-hidden">
                      <div
                        className={`h-full rounded-full transition-all ${met ? 'bg-green-500' : 'bg-primary'}`}
                        style={{ width: `${Math.min(pct, 100)}%` }}
                      />
                    </div>
                    <div className="flex justify-between text-xs text-muted-foreground">
                      <span>{q.itemUnit}{(q.currentAmount ?? 0).toLocaleString('en-US', { minimumFractionDigits: 2 })}</span>
                      <span>of {q.itemUnit}{Number(q.targetAmount).toLocaleString('en-US', { minimumFractionDigits: 2 })}</span>
                    </div>
                  </div>
                );
              })}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Export & Charts Toggle */}
      <Card>
        <CardHeader className="pb-2">
          <div className="flex items-center justify-between">
            <CardTitle className="flex items-center gap-2 text-base">
              <Download className="h-4 w-4" />
              Export Data
            </CardTitle>
          </div>
        </CardHeader>
        <CardContent>
          <div className="flex flex-wrap gap-3">
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                const url = exportApi.entriesUrl(factionId);
                window.open(url, '_blank');
              }}
            >
              <Download className="mr-2 h-3.5 w-3.5" />
              Export Entries CSV
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                const url = exportApi.quotaReportUrl(factionId);
                window.open(url, '_blank');
              }}
            >
              <Target className="mr-2 h-3.5 w-3.5" />
              Export Quota Report CSV
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Totals by Type */}
      {totalsByType.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Totals by Item Type</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {totalsByType.map((t) => (
                <div
                  key={t.itemTypeId}
                  className="flex items-center justify-between rounded-lg border p-4"
                >
                  <div>
                    <p className="font-medium">{t.itemTypeName}</p>
                    <p className="text-sm text-muted-foreground">{t.unit}</p>
                  </div>
                  <div className="text-right">
                    <p className="text-lg font-bold">
                      {t.total.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      <div className="grid gap-6 lg:grid-cols-2">
        {/* Top Contributors */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <TrendingUp className="h-4 w-4" />
              Top Contributors
            </CardTitle>
          </CardHeader>
          <CardContent>
            {topContributors.length === 0 ? (
              <p className="text-muted-foreground text-sm text-center py-8">No contributions yet.</p>
            ) : (
              <div className="space-y-3">
                {topContributors.map((c, i) => (
                  <div key={c.userId} className="flex items-center gap-3">
                    <span className="text-sm font-bold text-muted-foreground w-5">#{i + 1}</span>
                    <Avatar className="h-8 w-8">
                      <AvatarImage src={c.avatarUrl ?? undefined} />
                      <AvatarFallback>{c.username.slice(0, 2).toUpperCase()}</AvatarFallback>
                    </Avatar>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium truncate">{c.username}</p>
                      <p className="text-xs text-muted-foreground">{c.entryCount} entries</p>
                    </div>
                    <span className="text-sm font-bold">{c.totalContributed.toLocaleString('en-US', { minimumFractionDigits: 2 })}</span>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Recent Entries */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center justify-between text-base">
              <span>Recent Activity</span>
              <Badge
                variant="outline"
                className="cursor-pointer"
                onClick={() => setCurrentView('entries')}
              >
                View All
              </Badge>
            </CardTitle>
          </CardHeader>
          <CardContent>
            {recentEntries.length === 0 ? (
              <p className="text-muted-foreground text-sm text-center py-8">No entries yet.</p>
            ) : (
              <div className="space-y-3 max-h-96 overflow-y-auto">
                {recentEntries.map((e) => (
                  <div key={e.id} className="flex items-center gap-3 rounded-lg border p-3">
                    <Avatar className="h-8 w-8 shrink-0">
                      <AvatarImage src={e.avatarUrl ?? undefined} />
                      <AvatarFallback>{e.username.slice(0, 2).toUpperCase()}</AvatarFallback>
                    </Avatar>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm">
                        <span className="font-medium">{e.username}</span>
                        <span className="text-muted-foreground"> logged </span>
                        <span className="font-bold">{e.itemUnit}{Number(e.amount).toLocaleString('en-US', { minimumFractionDigits: 2 })}</span>
                      </p>
                      <p className="text-xs text-muted-foreground">
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

      {/* Charts Section */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <BarChart3 className="h-4 w-4" />
            Analytics
          </CardTitle>
        </CardHeader>
        <CardContent>
          <DashboardCharts factionId={factionId} />
        </CardContent>
      </Card>
    </div>
  );
}
