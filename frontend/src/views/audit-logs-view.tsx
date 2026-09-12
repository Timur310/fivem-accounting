'use client';

import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { auditLogsApi } from '@/lib/api-client';
import { Card, CardContent } from '@/components/ui/card';
import { EmptyState, ErrorState } from '@/components/ui/empty-state';
import {
  SearchableSelect, type SearchableSelectOption,
} from '@/components/ui/searchable-select';
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table';
import { Skeleton } from '@/components/ui/skeleton';
import { Button } from '@/components/ui/button';
import { ChevronLeft, ChevronRight, ScrollText } from 'lucide-react';
import type { AuditLog } from '@/lib/api-types';
import { formatDateTime } from '@/lib/format';
import { useTranslation } from '@/providers/i18n-provider';
import type { TranslationKey } from '@/lib/i18n';

interface Props { factionId: string; }

const ACTION_STYLES: Record<string, string> = {
  create: 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20',
  update: 'bg-amber-500/10 text-amber-400 border-amber-500/20',
  delete: 'bg-red-500/10 text-red-400 border-red-500/20',
  login: 'bg-blue-500/10 text-blue-400 border-blue-500/20',
  logout: 'bg-white/[0.04] text-zinc-500 border-white/[0.06]',
};

/**
 * The API stores actions and entity types as bare identifiers. These maps give
 * each one a translation key; anything the backend grows later that is not
 * listed falls through to the raw identifier, which is still readable and
 * beats an empty cell.
 */
const ACTION_KEYS: Record<string, TranslationKey> = {
  create: 'audit.action.create',
  update: 'audit.action.update',
  delete: 'audit.action.delete',
  login: 'audit.action.login',
  logout: 'audit.action.logout',
};

const ENTITY_KEYS: Record<string, TranslationKey> = {
  faction: 'audit.entity.faction',
  member: 'audit.entity.member',
  entry: 'audit.entity.entry',
  item_type: 'audit.entity.itemType',
  user: 'audit.entity.user',
};

export function AuditLogsView({ factionId }: Props) {
  const { t } = useTranslation();
  const [page, setPage] = useState(1);
  const [actionFilter, setActionFilter] = useState<string>('all');
  const [entityFilter, setEntityFilter] = useState<string>('all');

  const { data: logsData, isLoading, isError, error, refetch } = useQuery({
    queryKey: ['auditLogs', factionId, page, actionFilter, entityFilter],
    queryFn: () => auditLogsApi.list(factionId, { page, page_size: 25, action: actionFilter === 'all' ? undefined : actionFilter, entity_type: entityFilter === 'all' ? undefined : entityFilter }),
    staleTime: 30 * 1000,
  });

  const actionOptions = useMemo<SearchableSelectOption[]>(() => [
    { value: 'all', label: t('audit.allActions') },
    ...Object.entries(ACTION_KEYS).map(([value, key]) => ({ value, label: t(key) })),
  ], [t]);

  const entityOptions = useMemo<SearchableSelectOption[]>(() => [
    { value: 'all', label: t('audit.allEntities') },
    ...Object.entries(ENTITY_KEYS).map(([value, key]) => ({ value, label: t(key) })),
  ], [t]);

  const logs = logsData?.data ?? [];
  const meta = logsData?.meta;
  const totalPages = meta ? Math.ceil(meta.total_count / meta.page_size) : 1;

  return (
    <div className="space-y-4">
      <Card>
        <CardContent className="p-4">
          <div className="flex flex-col sm:flex-row gap-3 items-start sm:items-end">
            <div className="flex flex-col gap-1.5">
              <label className="text-xs text-zinc-500">{t('audit.action')}</label>
              <SearchableSelect
                className="w-[140px]"
                aria-label={t('audit.filterByAction')}
                value={actionFilter}
                onValueChange={(v) => { setActionFilter(v); setPage(1); }}
                options={actionOptions}
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <label className="text-xs text-zinc-500">{t('audit.entity')}</label>
              <SearchableSelect
                className="w-[140px]"
                aria-label={t('audit.filterByEntity')}
                value={entityFilter}
                onValueChange={(v) => { setEntityFilter(v); setPage(1); }}
                options={entityOptions}
              />
            </div>
          </div>
        </CardContent>
      </Card>

      <Card className="py-0 gap-0">
        <CardContent className="p-0">
          {isLoading ? (
            <div className="p-6 space-y-3">{[...Array(5)].map((_, i) => (<Skeleton key={i} className="h-12 w-full" />))}</div>
          ) : isError ? (
            <ErrorState error={error} onRetry={() => refetch()} />
          ) : logs.length === 0 ? (
            <EmptyState icon={ScrollText} title={t('audit.none')} />
          ) : (
            <>
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>{t('audit.action')}</TableHead>
                      <TableHead>{t('audit.entity')}</TableHead>
                      <TableHead>{t('audit.actor')}</TableHead>
                      <TableHead>{t('audit.details')}</TableHead>
                      <TableHead>{t('audit.ip')}</TableHead>
                      <TableHead>{t('audit.time')}</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {logs.map((log: AuditLog) => (
                      <TableRow key={log.id}>
                        <TableCell>
                          <span className={`inline-flex items-center rounded-md border px-2 py-0.5 text-[11px] font-medium ${ACTION_STYLES[log.action] ?? ''}`}>
                            {ACTION_KEYS[log.action] ? t(ACTION_KEYS[log.action]) : log.action}
                          </span>
                        </TableCell>
                        <TableCell>
                          <span className="text-xs bg-white/[0.04] border border-white/[0.06] px-2 py-0.5 rounded-md text-zinc-400">
                            {ENTITY_KEYS[log.entityType] ? t(ENTITY_KEYS[log.entityType]) : log.entityType}
                          </span>
                        </TableCell>
                        <TableCell>
                          <div className="text-sm text-zinc-300">{log.actorUsername}</div>
                          <div className="text-[11px] text-zinc-600 font-mono tabular-nums">{log.actorDiscordId}</div>
                        </TableCell>
                        <TableCell className="max-w-[200px]">
                          <pre className="text-[11px] text-zinc-500 whitespace-pre-wrap break-all font-mono">{log.details ? JSON.stringify(log.details, null, 2) : '—'}</pre>
                        </TableCell>
                        <TableCell className="text-[11px] text-zinc-600 font-mono tabular-nums">{log.ipAddress || '—'}</TableCell>
                        <TableCell className="text-[11px] text-zinc-500 tabular-nums whitespace-nowrap">{formatDateTime(log.createdAt)}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
              {meta && totalPages > 1 && (
                <div className="flex items-center justify-between px-4 py-3 border-t border-white/[0.06]">
                  <p className="text-xs text-zinc-500 tabular-nums">{t('common.pagination', { page: meta.page, pages: totalPages, total: meta.total_count })}</p>
                  <div className="flex items-center gap-1.5">
                    <Button variant="ghost" size="sm" className="h-7" disabled={page <= 1} onClick={() => setPage(page - 1)}><ChevronLeft className="h-3.5 w-3.5" /></Button>
                    <Button variant="ghost" size="sm" className="h-7" disabled={page >= totalPages} onClick={() => setPage(page + 1)}><ChevronRight className="h-3.5 w-3.5" /></Button>
                  </div>
                </div>
              )}
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
