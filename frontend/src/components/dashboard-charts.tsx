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
import { useTranslation } from '@/providers/i18n-provider';
import type { TranslationKey } from '@/lib/i18n';
import { NUMBER_LOCALE } from '@/lib/format';

interface Props {
  factionId: string;
  brandColor?: string;
}

const RANGE_OPTIONS: { label: TranslationKey; value: string }[] = [
  { label: 'range.7d', value: '7d' },
  { label: 'range.14d', value: '14d' },
  { label: 'range.30d', value: '30d' },
  { label: 'range.90d', value: '90d' },
];

function formatCurrency(value: number): string {
  return new Intl.NumberFormat(NUMBER_LOCALE, {
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
    notation: 'compact',
  }).format(value);
}

const tooltipStyle = {
  backgroundColor: '#101114',
  border: '1px solid rgba(255,255,255,0.08)',
  borderRadius: '8px',
  fontSize: '13px',
  color: '#e4e4e7',
  boxShadow: '0 8px 32px rgba(0,0,0,0.4)',
};

export function DashboardCharts({ factionId, brandColor }: Props) {
  const { t } = useTranslation();
  const [range, setRange] = useState('30d');

  const palette = [
    brandColor || '#6366f1',
    '#22c55e',
    '#f59e0b',
    '#ef4444',
    '#8b5cf6',
    '#06b6d4',
    '#ec4899',
    '#eab308',
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
          <Card key={i}><CardHeader className="pb-2"><Skeleton className="h-5 w-40" /></CardHeader><CardContent><Skeleton className="h-64 w-full" /></CardContent></Card>
        ))}
      </div>
    );
  }

  if (!data) return null;

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
      <div className="flex items-center gap-2">
        <CalendarDays className="h-4 w-4 text-zinc-500" />
        <span className="text-xs text-zinc-500">{t('charts.range')}</span>
        <div className="flex gap-1">
          {RANGE_OPTIONS.map((opt) => (
            <Button
              key={opt.value}
              variant={range === opt.value ? 'default' : 'outline'}
              size="xs" className="px-2.5"
              onClick={() => setRange(opt.value)}
            >
              {t(opt.label)}
            </Button>
          ))}
        </div>
        <span className="text-[11px] text-zinc-600 ml-auto tabular-nums">
          {data.range.from} → {data.range.to}
        </span>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-sm text-zinc-200"><BarChart3 className="h-4 w-4 text-zinc-400" />{t('charts.memberContributions')}</CardTitle>
          </CardHeader>
          <CardContent>
            {data.memberContributions.length === 0 ? (
              <p className="text-zinc-600 text-sm text-center py-12">{t('charts.noDataInPeriod')}</p>
            ) : (
              <ResponsiveContainer width="100%" height={280}>
                <BarChart data={data.memberContributions} margin={{ top: 5, right: 10, left: 10, bottom: 5 }}>
                  <XAxis dataKey="username" tick={{ fontSize: 12, fill: '#71717a' }} angle={-30} textAnchor="end" height={50} axisLine={{ stroke: 'rgba(255,255,255,0.06)' }} tickLine={false} />
                  <YAxis tick={{ fontSize: 12, fill: '#71717a' }} tickFormatter={formatCurrency} axisLine={false} tickLine={false} />
                  <Tooltip formatter={(value: number) => [value.toLocaleString(NUMBER_LOCALE, { minimumFractionDigits: 2 }), t('common.total')]} contentStyle={tooltipStyle} />
                  <Bar dataKey="total" fill={palette[0]} radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-sm text-zinc-200"><PieIcon className="h-4 w-4 text-zinc-400" />{t('charts.itemDistribution')}</CardTitle>
          </CardHeader>
          <CardContent>
            {data.itemDistribution.length === 0 ? (
              <p className="text-zinc-600 text-sm text-center py-12">{t('charts.noDataInPeriod')}</p>
            ) : (
              <ResponsiveContainer width="100%" height={280}>
                <PieChart>
                  <Pie data={data.itemDistribution} dataKey="total" nameKey="itemTypeName" cx="50%" cy="50%" outerRadius={90} label={({ itemTypeName, percent }) => `${itemTypeName} ${(percent * 100).toFixed(0)}%`} labelLine={{ strokeWidth: 1, stroke: '#3f3f46' }}>
                    {data.itemDistribution.map((_, index) => (<Cell key={`cell-${index}`} fill={palette[index % palette.length]} />))}
                  </Pie>
                  <Tooltip formatter={(value: number) => [value.toLocaleString(NUMBER_LOCALE, { minimumFractionDigits: 2 }), t('common.total')]} contentStyle={tooltipStyle} />
                </PieChart>
              </ResponsiveContainer>
            )}
          </CardContent>
        </Card>

        <Card className="lg:col-span-2">
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-sm text-zinc-200"><TrendingUp className="h-4 w-4 text-zinc-400" />{t('charts.dailyTrend')}</CardTitle>
          </CardHeader>
          <CardContent>
            {data.dailyTrend.every((d) => d.total === 0) ? (
              <p className="text-zinc-600 text-sm text-center py-12">{t('charts.noDataInPeriod')}</p>
            ) : (
              <ResponsiveContainer width="100%" height={280}>
                <LineChart data={data.dailyTrend} margin={{ top: 5, right: 10, left: 10, bottom: 5 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.04)" />
                  <XAxis dataKey="date" tick={{ fontSize: 11, fill: '#71717a' }} tickFormatter={(v: string) => { const d = new Date(v + 'T00:00:00'); return `${d.getMonth() + 1}/${d.getDate()}`; }} axisLine={{ stroke: 'rgba(255,255,255,0.06)' }} tickLine={false} />
                  <YAxis tick={{ fontSize: 12, fill: '#71717a' }} tickFormatter={formatCurrency} axisLine={false} tickLine={false} />
                  <Tooltip formatter={(value: number) => [value.toLocaleString(NUMBER_LOCALE, { minimumFractionDigits: 2 }), t('common.total')]} labelFormatter={(label: string) => `${t('common.date')}: ${label}`} contentStyle={tooltipStyle} />
                  <Line type="monotone" dataKey="total" stroke={palette[0]} strokeWidth={2} dot={data.range.days <= 30} activeDot={{ r: 5, fill: palette[0] }} />
                </LineChart>
              </ResponsiveContainer>
            )}
          </CardContent>
        </Card>

        {stackedData.length > 0 && itemTypes.length > 1 && (
          <Card className="lg:col-span-2">
            <CardHeader className="pb-2">
              <CardTitle className="flex items-center gap-2 text-sm text-zinc-200"><BarChart3 className="h-4 w-4 text-zinc-400" />{t('charts.memberBreakdown')}</CardTitle>
            </CardHeader>
            <CardContent>
              <ResponsiveContainer width="100%" height={300}>
                <BarChart data={stackedData} margin={{ top: 5, right: 10, left: 10, bottom: 5 }}>
                  <XAxis dataKey="name" tick={{ fontSize: 12, fill: '#71717a' }} axisLine={{ stroke: 'rgba(255,255,255,0.06)' }} tickLine={false} />
                  <YAxis tick={{ fontSize: 12, fill: '#71717a' }} tickFormatter={formatCurrency} axisLine={false} tickLine={false} />
                  <Tooltip formatter={(value: number) => [value.toLocaleString(NUMBER_LOCALE, { minimumFractionDigits: 2 })]} contentStyle={tooltipStyle} />
                  <Legend wrapperStyle={{ fontSize: '12px', color: '#a1a1aa' }} />
                  {itemTypes.map((it, i) => (<Bar key={it} dataKey={it} stackId="a" fill={palette[i % palette.length]} />))}
                </BarChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}
