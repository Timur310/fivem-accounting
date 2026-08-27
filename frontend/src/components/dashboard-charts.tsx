'use client';

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer,
  PieChart, Pie, Cell, Legend,
  LineChart, Line, CartesianGrid,
} from 'recharts';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { BarChart3, PieChart as PieIcon, TrendingUp, CalendarDays } from 'lucide-react';
import { chartsApi } from '@/lib/api-client';

interface Props {
  factionId: string;
  brandColor?: string;
}

const RANGE_OPTIONS = [
  { label: '7d', value: '7d' },
  { label: '14d', value: '14d' },
  { label: '30d', value: '30d' },
  { label: '90d', value: '90d' },
];

// Color palette for pie/stacked charts
const COLORS = [
  'hsl(221, 83%, 53%)',   // primary blue
  'hsl(142, 71%, 45%)',   // green
  'hsl(38, 92%, 50%)',    // amber
  'hsl(0, 84%, 60%)',     // red
  'hsl(262, 83%, 58%)',   // purple
  'hsl(199, 89%, 48%)',   // cyan
  'hsl(326, 100%, 74%)',  // pink
  'hsl(47, 96%, 53%)',    // yellow
];

function formatCurrency(value: number): string {
  return new Intl.NumberFormat('en-US', {
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
    notation: 'compact',
  }).format(value);
}

export function DashboardCharts({ factionId, brandColor }: Props) {
  const [range, setRange] = useState('30d');

  // Build a palette that starts with the brand color
  const palette = [
    brandColor || 'hsl(221, 83%, 53%)',
    'hsl(142, 71%, 45%)',
    'hsl(38, 92%, 50%)',
    'hsl(0, 84%, 60%)',
    'hsl(262, 83%, 58%)',
    'hsl(199, 89%, 48%)',
    'hsl(326, 100%, 74%)',
    'hsl(47, 96%, 53%)',
  ];

  const { data, isLoading } = useQuery({
    queryKey: ['charts', factionId, range],
    queryFn: () => chartsApi.get(factionId, range),
    staleTime: 2 * 60 * 1000,
  });

  if (isLoading) {
    return (
      <div className="grid gap-6 lg:grid-cols-2">
        {[...Array(4)].map((_, i) => (
          <Card key={i}>
            <CardHeader className="pb-2"><Skeleton className="h-5 w-40" /></CardHeader>
            <CardContent><Skeleton className="h-64 w-full" /></CardContent>
          </Card>
        ))}
      </div>
    );
  }

  if (!data) return null;

  // Aggregate member-item breakdown into pivot format for stacked bar
  const itemTypes = [...new Set(data.memberItemBreakdown.map((b) => b.itemTypeName))];
  const memberNames = [...new Set(data.memberItemBreakdown.map((b) => b.username))];
  const stackedData = memberNames.map((name) => {
    const row: Record<string, string | number> = { name };
    for (const it of itemTypes) {
      const found = data.memberItemBreakdown.find(
        (b) => b.username === name && b.itemTypeName === it,
      );
      row[it] = found ? found.total : 0;
    }
    return row;
  });

  return (
    <div className="space-y-6">
      {/* Range selector */}
      <div className="flex items-center gap-2">
        <CalendarDays className="h-4 w-4 text-muted-foreground" />
        <span className="text-sm text-muted-foreground">Range:</span>
        <div className="flex gap-1">
          {RANGE_OPTIONS.map((opt) => (
            <Button
              key={opt.value}
              variant={range === opt.value ? 'default' : 'outline'}
              size="sm"
              className="h-7 px-2.5 text-xs"
              onClick={() => setRange(opt.value)}
            >
              {opt.label}
            </Button>
          ))}
        </div>
        <span className="text-xs text-muted-foreground ml-auto">
          {data.range.from} → {data.range.to}
        </span>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        {/* 1. Per-member bar chart */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-base">
              <BarChart3 className="h-4 w-4" />
              Member Contributions
            </CardTitle>
          </CardHeader>
          <CardContent>
            {data.memberContributions.length === 0 ? (
              <p className="text-muted-foreground text-sm text-center py-12">No data in this period.</p>
            ) : (
              <ResponsiveContainer width="100%" height={280}>
                <BarChart data={data.memberContributions} margin={{ top: 5, right: 10, left: 10, bottom: 5 }}>
                  <XAxis
                    dataKey="username"
                    tick={{ fontSize: 12 }}
                    angle={-30}
                    textAnchor="end"
                    height={50}
                  />
                  <YAxis tick={{ fontSize: 12 }} tickFormatter={formatCurrency} />
                  <Tooltip
                    formatter={(value: number) => [value.toLocaleString('en-US', { minimumFractionDigits: 2 }), 'Total']}
                    contentStyle={{ borderRadius: '8px', fontSize: '13px' }}
                  />
                  <Bar dataKey="total" fill={palette[0]} radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            )}
          </CardContent>
        </Card>

        {/* 2. Item type distribution pie */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-base">
              <PieIcon className="h-4 w-4" />
              Item Distribution
            </CardTitle>
          </CardHeader>
          <CardContent>
            {data.itemDistribution.length === 0 ? (
              <p className="text-muted-foreground text-sm text-center py-12">No data in this period.</p>
            ) : (
              <ResponsiveContainer width="100%" height={280}>
                <PieChart>
                  <Pie
                    data={data.itemDistribution}
                    dataKey="total"
                    nameKey="itemTypeName"
                    cx="50%"
                    cy="50%"
                    outerRadius={90}
                    label={({ itemTypeName, percent }) =>
                      `${itemTypeName} ${(percent * 100).toFixed(0)}%`
                    }
                    labelLine={{ strokeWidth: 1 }}
                  >
                    {data.itemDistribution.map((_, index) => (
                      <Cell key={`cell-${index}`} fill={palette[index % palette.length]} />
                    ))}
                  </Pie>
                  <Tooltip
                    formatter={(value: number) => [value.toLocaleString('en-US', { minimumFractionDigits: 2 }), 'Total']}
                    contentStyle={{ borderRadius: '8px', fontSize: '13px' }}
                  />
                </PieChart>
              </ResponsiveContainer>
            )}
          </CardContent>
        </Card>

        {/* 3. Daily trend line */}
        <Card className="lg:col-span-2">
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-base">
              <TrendingUp className="h-4 w-4" />
              Daily Trend
            </CardTitle>
          </CardHeader>
          <CardContent>
            {data.dailyTrend.every((d) => d.total === 0) ? (
              <p className="text-muted-foreground text-sm text-center py-12">No data in this period.</p>
            ) : (
              <ResponsiveContainer width="100%" height={280}>
                <LineChart data={data.dailyTrend} margin={{ top: 5, right: 10, left: 10, bottom: 5 }}>
                  <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                  <XAxis
                    dataKey="date"
                    tick={{ fontSize: 11 }}
                    tickFormatter={(v: string) => {
                      const d = new Date(v + 'T00:00:00');
                      return `${d.getMonth() + 1}/${d.getDate()}`;
                    }}
                  />
                  <YAxis tick={{ fontSize: 12 }} tickFormatter={formatCurrency} />
                  <Tooltip
                    formatter={(value: number) => [value.toLocaleString('en-US', { minimumFractionDigits: 2 }), 'Total']}
                    labelFormatter={(label: string) => `Date: ${label}`}
                    contentStyle={{ borderRadius: '8px', fontSize: '13px' }}
                  />
                  <Line
                    type="monotone"
                    dataKey="total"
                    stroke={palette[0]}
                    strokeWidth={2}
                    dot={data.range.days <= 30}
                    activeDot={{ r: 5 }}
                  />
                </LineChart>
              </ResponsiveContainer>
            )}
          </CardContent>
        </Card>

        {/* 4. Per-member per-item breakdown (stacked bar) */}
        {stackedData.length > 0 && itemTypes.length > 1 && (
          <Card className="lg:col-span-2">
            <CardHeader className="pb-2">
              <CardTitle className="flex items-center gap-2 text-base">
                <BarChart3 className="h-4 w-4" />
                Member Breakdown by Item Type
              </CardTitle>
            </CardHeader>
            <CardContent>
              <ResponsiveContainer width="100%" height={300}>
                <BarChart data={stackedData} margin={{ top: 5, right: 10, left: 10, bottom: 5 }}>
                  <XAxis dataKey="name" tick={{ fontSize: 12 }} />
                  <YAxis tick={{ fontSize: 12 }} tickFormatter={formatCurrency} />
                  <Tooltip
                    formatter={(value: number) => [value.toLocaleString('en-US', { minimumFractionDigits: 2 })]}
                    contentStyle={{ borderRadius: '8px', fontSize: '13px' }}
                  />
                  <Legend wrapperStyle={{ fontSize: '12px' }} />
                  {itemTypes.map((it, i) => (
                    <Bar key={it} dataKey={it} stackId="a" fill={palette[i % palette.length]} />
                  ))}
                </BarChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}
