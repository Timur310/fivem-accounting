'use client';

import { useMemo, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { factionStrikesApi, memberStrikesApi } from '@/lib/api-client';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import {
  SearchableSelect, type SearchableSelectOption,
} from '@/components/ui/searchable-select';
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table';
import { AlertTriangle, Shield, Ban, RotateCcw, MessageSquare } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { useAppStore } from '@/lib/store';
import type { StrikeEffectiveStatus } from '@/lib/api-types';
import { formatDate } from '@/lib/format';
import { useTranslation } from '@/providers/i18n-provider';
import type { TranslationKey } from '@/lib/i18n';

interface Props {
  factionId: string;
  /**
   * Whether the caller may act on other members' strikes. Without it the API
   * answers with their own record only, so the screen turns into a personal
   * discipline history: no roster column, no buttons.
   */
  canManageStrikes?: boolean;
}

const SEVERITY_COLORS: Record<string, string> = {
  warning: 'border-amber-500/30 bg-amber-500/10 text-amber-400',
  minor: 'border-orange-500/30 bg-orange-500/10 text-orange-400',
  major: 'border-red-500/30 bg-red-500/10 text-red-400',
};

const STATUS_COLORS: Record<StrikeEffectiveStatus, string> = {
  active: 'text-amber-400',
  appealed: 'text-blue-400',
  revoked: 'text-zinc-500',
  expired: 'text-zinc-600',
};

const STATUS_KEYS: Record<string, TranslationKey> = {
  active: 'strikes.status.active',
  appealed: 'strikes.status.appealed',
  revoked: 'strikes.status.revoked',
  expired: 'strikes.status.expired',
};

const SEVERITY_KEYS: Record<string, TranslationKey> = {
  warning: 'strikes.severity.warning',
  minor: 'strikes.severity.minor',
  major: 'strikes.severity.major',
};

/** The summary tile above each severity column, which reads as a plural. */
const ACTIVE_SUMMARY_KEYS: Record<string, TranslationKey> = {
  warning: 'strikes.activeWarnings',
  minor: 'strikes.activeMinors',
  major: 'strikes.activeMajors',
};

export function StrikesView({ factionId, canManageStrikes }: Props) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const brandColor = useAppStore((s) => s.brandColor);

  // The backend scopes the list to the caller's own strikes without
  // `manage_strikes`, so the status buttons (Revoke, Reinstate) would only
  // invite a 403 — and the Member column would repeat one name down the page.

  // '' — the API reads a missing status as "what still counts against the
  // member" (active and not past its expiry) — so the page opens on the
  // strikes that matter; revoked and expired history is one filter away.
  const [statusFilter, setStatusFilter] = useState<string>('');
  const [severityFilter, setSeverityFilter] = useState<string>('');
  const [page, setPage] = useState(1);

  const { data, isLoading } = useQuery({
    queryKey: ['faction-strikes', factionId, statusFilter, severityFilter, page],
    queryFn: () => factionStrikesApi.list(factionId, {
      status: statusFilter || undefined,
      severity: severityFilter || undefined,
      page,
      page_size: 20,
    }),
    staleTime: 0,
  });

  const updateMutation = useMutation({
    mutationFn: ({ strikeId, targetUserId, status }: { strikeId: string; targetUserId: string; status: 'appealed' | 'revoked' | 'active' }) =>
      memberStrikesApi.update(factionId, targetUserId, strikeId, status),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['faction-strikes', factionId] });
      toast({ title: t('strikes.updated') });
    },
    onError: (err: unknown) => {
      // Lazy import keeps the bundle from pulling axios types at module
      // load time.
      import('@/lib/api-client').then(({ apiErrorMessage }) => {
        toast({ title: t('common.failed'), description: apiErrorMessage(err), variant: 'destructive' });
      });
    },
  });

  // The empty value is the default — what still counts against the member —
  // so it gets its own label rather than masquerading as a cleared filter.
  const statusOptions = useMemo<SearchableSelectOption[]>(() => [
    { value: '', label: t('strikes.stillCounting') },
    { value: 'all', label: t('strikes.allStatuses') },
    ...Object.entries(STATUS_KEYS).map(([value, key]) => ({ value, label: t(key) })),
  ], [t]);

  const severityOptions = useMemo<SearchableSelectOption[]>(() => [
    { value: '', label: t('strikes.allSeverities') },
    ...Object.entries(SEVERITY_KEYS).map(([value, key]) => ({ value, label: t(key) })),
  ], [t]);

  const strikes = data?.data?.strikes ?? [];
  const summary = data?.data?.activeSummary ?? { warning: 0, minor: 0, major: 0 };
  const meta = data?.meta;
  const totalPages = meta ? Math.ceil(meta.total_count / (meta.page_size || 20)) : 1;

  return (
    <div className="space-y-4">
      {/* Summary Cards */}
      <div className="grid gap-3 sm:grid-cols-3">
        {(['warning', 'minor', 'major'] as const).map((sev) => (
          <Card key={sev} className={summary[sev] > 0 ? SEVERITY_COLORS[sev] + ' border' : ''}>
            <CardContent className="py-4 flex items-center justify-between">
              <div>
                <p className="text-xs text-zinc-500">{t(ACTIVE_SUMMARY_KEYS[sev])}</p>
                <p className="text-2xl font-medium tabular-nums mt-0.5">{summary[sev]}</p>
              </div>
              <AlertTriangle className={`h-5 w-5 ${summary[sev] > 0 ? 'opacity-80' : 'opacity-20'}`} />
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Filters */}
      <div className="flex items-center gap-2">
        <SearchableSelect
          className="w-[140px]"
          triggerClassName="h-8 text-xs"
          aria-label={t('strikes.filterByStatus')}
          value={statusFilter}
          onValueChange={(v) => { setStatusFilter(v); setPage(1); }}
          options={statusOptions}
          placeholder={t('strikes.allStatuses')}
        />
        <SearchableSelect
          className="w-[140px]"
          triggerClassName="h-8 text-xs"
          aria-label={t('strikes.filterBySeverity')}
          value={severityFilter}
          onValueChange={(v) => { setSeverityFilter(v); setPage(1); }}
          options={severityOptions}
          placeholder={t('strikes.allSeverities')}
        />
      </div>

      {/* Table */}
      <Card className="py-0 gap-0">
        <CardContent className="p-0">
          {isLoading ? (
            <div className="p-6 space-y-3">{[...Array(4)].map((_, i) => <Skeleton key={i} className="h-12 w-full" />)}</div>
          ) : strikes.length === 0 ? (
            <div className="p-12 text-center text-zinc-600"><AlertTriangle className="h-8 w-8 mx-auto mb-2 opacity-30" /><p className="text-sm">{t('strikes.none')}</p></div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  {canManageStrikes && <TableHead>{t('role.member')}</TableHead>}
                  <TableHead>{t('strikes.severityColumn')}</TableHead>
                  <TableHead>{t('common.status')}</TableHead>
                  <TableHead className="hidden md:table-cell">{t('strikes.reason')}</TableHead>
                  <TableHead>{t('strikes.issued')}</TableHead>
                  <TableHead className="w-[100px]"></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {strikes.map((s) => (
                  <TableRow key={s.id}>
                    {canManageStrikes && (
                      <TableCell>
                        <div className="flex items-center gap-2">
                          <Avatar className="h-6 w-6">
                            <AvatarImage src={s.targetAvatarUrl ?? undefined} />
                            <AvatarFallback className="text-[8px]">{(s.targetInGameName || s.targetUsername || '?').slice(0, 2).toUpperCase()}</AvatarFallback>
                          </Avatar>
                          <span className="text-sm text-zinc-300">{s.targetInGameName?.trim() || s.targetUsername || t('common.unknown')}</span>
                        </div>
                      </TableCell>
                    )}
                    <TableCell>
                      <Badge className={`text-[10px] border ${SEVERITY_COLORS[s.severity] || ''}`} variant="outline">{SEVERITY_KEYS[s.severity] ? t(SEVERITY_KEYS[s.severity]) : s.severity}</Badge>
                    </TableCell>
                    <TableCell>
                      <span className={`text-xs font-medium ${STATUS_COLORS[s.effectiveStatus] || 'text-zinc-400'}`}>{STATUS_KEYS[s.effectiveStatus] ? t(STATUS_KEYS[s.effectiveStatus]) : s.effectiveStatus}</span>
                      {s.expiresAt && s.effectiveStatus === 'active' && (
                        <p className="text-[10px] text-zinc-600">{t('strikes.expiresOn', { date: formatDate(s.expiresAt) })}</p>
                      )}
                    </TableCell>
                    <TableCell className="hidden md:table-cell">
                      <p className="text-xs text-zinc-400 max-w-[250px] truncate">{s.reason}</p>
                    </TableCell>
                    <TableCell className="text-xs text-zinc-600 tabular-nums">{formatDate(s.createdAt)}</TableCell>
                    <TableCell>
                      {canManageStrikes && s.effectiveStatus === 'active' && s.targetUserId && (
                        <div className="flex gap-0.5">
                          <Button variant="ghost" size="icon" className="h-7 w-7 text-zinc-500 hover:text-amber-400" title={t('strikes.reinstate')} onClick={() => updateMutation.mutate({ strikeId: s.id, targetUserId: s.targetUserId!, status: 'active' })}>
                            <MessageSquare className="h-3 w-3" />
                          </Button>
                          <Button variant="ghost" size="icon" className="h-7 w-7 text-zinc-500 hover:text-zinc-300" title={t('strikes.revoke')} onClick={() => updateMutation.mutate({ strikeId: s.id, targetUserId: s.targetUserId!, status: 'revoked' })}>
                            <Ban className="h-3 w-3" />
                          </Button>
                        </div>
                      )}
                      {canManageStrikes && s.effectiveStatus === 'appealed' && s.targetUserId && (
                        <div className="flex gap-0.5">
                          <Button variant="ghost" size="icon" className="h-7 w-7 text-zinc-500 hover:text-amber-400" title={t('strikes.reinstate')} onClick={() => updateMutation.mutate({ strikeId: s.id, targetUserId: s.targetUserId!, status: 'active' })}>
                            <RotateCcw className="h-3 w-3" />
                          </Button>
                          <Button variant="ghost" size="icon" className="h-7 w-7 text-zinc-500 hover:text-zinc-300" title={t('strikes.revoke')} onClick={() => updateMutation.mutate({ strikeId: s.id, targetUserId: s.targetUserId!, status: 'revoked' })}>
                            <Ban className="h-3 w-3" />
                          </Button>
                        </div>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-center gap-2">
          <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage(page - 1)}>{t('common.previous')}</Button>
          <span className="text-xs text-zinc-500">{t('common.pageOf', { page, pages: totalPages })}</span>
          <Button variant="outline" size="sm" disabled={page >= totalPages} onClick={() => setPage(page + 1)}>{t('common.next')}</Button>
        </div>
      )}
    </div>
  );
}
