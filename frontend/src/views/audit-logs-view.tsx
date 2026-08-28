'use client';

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { auditLogsApi } from '@/lib/api-client';
import { Card, CardContent } from '@/components/ui/card';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table';
import { Skeleton } from '@/components/ui/skeleton';
import { Button } from '@/components/ui/button';
import { ChevronLeft, ChevronRight, ScrollText } from 'lucide-react';
import type { AuditLog } from '@/lib/api-types';

interface Props { factionId: string; }

const ACTION_STYLES: Record<string, string> = {
  create: 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20',
  update: 'bg-amber-500/10 text-amber-400 border-amber-500/20',
  delete: 'bg-red-500/10 text-red-400 border-red-500/20',
  login: 'bg-blue-500/10 text-blue-400 border-blue-500/20',
  logout: 'bg-white/[0.04] text-zinc-500 border-white/[0.06]',
};

export function AuditLogsView({ factionId }: Props) {
  const [page, setPage] = useState(1);
  const [actionFilter, setActionFilter] = useState<string>('all');
  const [entityFilter, setEntityFilter] = useState<string>('all');

  const { data: logsData, isLoading } = useQuery({
    queryKey: ['auditLogs', factionId, page, actionFilter, entityFilter],
    queryFn: () => auditLogsApi.list(factionId, { page, page_size: 25, action: actionFilter === 'all' ? undefined : actionFilter, entity_type: entityFilter === 'all' ? undefined : entityFilter }),
    staleTime: 30 * 1000,
  });

  const logs = logsData?.data ?? [];
  const meta = logsData?.meta;
  const totalPages = meta ? Math.ceil(meta.total_count / meta.page_size) : 1;

  return (
    <div className="space-y-4">
      <Card>
        <CardContent className="p-4">
          <div className="flex flex-col sm:flex-row gap-3 items-start sm:items-end">
            <div className="flex flex-col gap-1.5">
              <label className="text-xs text-zinc-500">Action</label>
              <Select value={actionFilter} onValueChange={(v) => { setActionFilter(v); setPage(1); }}>
                <SelectTrigger className="w-[140px]"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Actions</SelectItem>
                  <SelectItem value="create">Create</SelectItem>
                  <SelectItem value="update">Update</SelectItem>
                  <SelectItem value="delete">Delete</SelectItem>
                  <SelectItem value="login">Login</SelectItem>
                  <SelectItem value="logout">Logout</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="flex flex-col gap-1.5">
              <label className="text-xs text-zinc-500">Entity</label>
              <Select value={entityFilter} onValueChange={(v) => { setEntityFilter(v); setPage(1); }}>
                <SelectTrigger className="w-[140px]"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Entities</SelectItem>
                  <SelectItem value="faction">Faction</SelectItem>
                  <SelectItem value="member">Member</SelectItem>
                  <SelectItem value="entry">Entry</SelectItem>
                  <SelectItem value="item_type">Item Type</SelectItem>
                  <SelectItem value="user">User</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
        </CardContent>
      </Card>

      <Card className="py-0 gap-0">
        <CardContent className="p-0">
          {isLoading ? (
            <div className="p-6 space-y-3">{[...Array(5)].map((_, i) => (<Skeleton key={i} className="h-12 w-full" />))}</div>
          ) : logs.length === 0 ? (
            <div className="p-12 text-center text-zinc-600">
              <ScrollText className="h-8 w-8 mx-auto mb-2 opacity-30" />
              <p className="text-sm">No audit logs found.</p>
            </div>
          ) : (
            <>
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Action</TableHead>
                      <TableHead>Entity</TableHead>
                      <TableHead>Actor</TableHead>
                      <TableHead>Details</TableHead>
                      <TableHead>IP</TableHead>
                      <TableHead>Time</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {logs.map((log: AuditLog) => (
                      <TableRow key={log.id}>
                        <TableCell>
                          <span className={`inline-flex items-center rounded-md border px-2 py-0.5 text-[11px] font-medium ${ACTION_STYLES[log.action] ?? ''}`}>
                            {log.action}
                          </span>
                        </TableCell>
                        <TableCell>
                          <span className="text-xs bg-white/[0.04] border border-white/[0.06] px-2 py-0.5 rounded-md text-zinc-400">
                            {log.entityType}
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
                        <TableCell className="text-[11px] text-zinc-500 tabular-nums whitespace-nowrap">{new Date(log.createdAt).toLocaleString()}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
              {meta && totalPages > 1 && (
                <div className="flex items-center justify-between px-4 py-3 border-t border-white/[0.06]">
                  <p className="text-xs text-zinc-500 tabular-nums">Page {meta.page} of {totalPages} ({meta.total_count} total)</p>
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
