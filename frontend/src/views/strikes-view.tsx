'use client';

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { factionStrikesApi, memberStrikesApi } from '@/lib/api-client';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table';
import { AlertTriangle, Shield, Ban, RotateCcw, MessageSquare } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { useAppStore } from '@/lib/store';
import type { StrikeEffectiveStatus } from '@/lib/api-types';

interface Props {
  factionId: string;
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

export function StrikesView({ factionId }: Props) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const brandColor = useAppStore((s) => s.brandColor);
  // Need the current user to determine admin status — members only see their
  // own strikes (the backend filters), and the action buttons (Revoke /
  // Reinstate) are admin-only.
  const user = useAppStore((s) => s.user);
  const isAdmin = user?.role === 'superadmin' || (user?.factions.some((f) => f.factionId === factionId && f.role === 'admin') ?? false);

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
      toast({ title: 'Strike updated' });
    },
    onError: (err: any) => {
      toast({ title: 'Failed', description: err.response?.data?.error?.message || 'Unknown error', variant: 'destructive' });
    },
  });

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
                <p className="text-xs text-zinc-500 capitalize">Active {sev}s</p>
                <p className="text-2xl font-medium tabular-nums mt-0.5">{summary[sev]}</p>
              </div>
              <AlertTriangle className={`h-5 w-5 ${summary[sev] > 0 ? 'opacity-80' : 'opacity-20'}`} />
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Filters */}
      <div className="flex items-center gap-2">
        <Select value={statusFilter || '_all'} onValueChange={(v) => { setStatusFilter(v === '_all' ? '' : v); setPage(1); }}>
          <SelectTrigger className="w-[140px] h-8 text-xs"><SelectValue placeholder="Status" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="_all">All Statuses</SelectItem>
            <SelectItem value="active">Active</SelectItem>
            <SelectItem value="appealed">Appealed</SelectItem>
            <SelectItem value="revoked">Revoked</SelectItem>
            <SelectItem value="expired">Expired</SelectItem>
          </SelectContent>
        </Select>
        <Select value={severityFilter || '_all'} onValueChange={(v) => { setSeverityFilter(v === '_all' ? '' : v); setPage(1); }}>
          <SelectTrigger className="w-[140px] h-8 text-xs"><SelectValue placeholder="Severity" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="_all">All Severities</SelectItem>
            <SelectItem value="warning">Warning</SelectItem>
            <SelectItem value="minor">Minor</SelectItem>
            <SelectItem value="major">Major</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {/* Table */}
      <Card className="py-0 gap-0">
        <CardContent className="p-0">
          {isLoading ? (
            <div className="p-6 space-y-3">{[...Array(4)].map((_, i) => <Skeleton key={i} className="h-12 w-full" />)}</div>
          ) : strikes.length === 0 ? (
            <div className="p-12 text-center text-zinc-600"><AlertTriangle className="h-8 w-8 mx-auto mb-2 opacity-30" /><p className="text-sm">No strikes found.</p></div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Member</TableHead>
                  <TableHead>Severity</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="hidden md:table-cell">Reason</TableHead>
                  <TableHead>Issued</TableHead>
                  <TableHead className="w-[100px]"></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {strikes.map((s) => (
                  <TableRow key={s.id}>
                    <TableCell>
                      <div className="flex items-center gap-2">
                        <Avatar className="h-6 w-6">
                          <AvatarImage src={s.targetAvatarUrl ?? undefined} />
                          <AvatarFallback className="text-[8px]">{(s.targetUsername || '?').slice(0, 2).toUpperCase()}</AvatarFallback>
                        </Avatar>
                        <span className="text-sm text-zinc-300">{s.targetUsername || 'Unknown'}</span>
                      </div>
                    </TableCell>
                    <TableCell>
                      <Badge className={`text-[10px] border ${SEVERITY_COLORS[s.severity] || ''}`} variant="outline">{s.severity}</Badge>
                    </TableCell>
                    <TableCell>
                      <span className={`text-xs font-medium ${STATUS_COLORS[s.effectiveStatus] || 'text-zinc-400'}`}>{s.effectiveStatus}</span>
                      {s.expiresAt && s.effectiveStatus === 'active' && (
                        <p className="text-[10px] text-zinc-600">exp {new Date(s.expiresAt).toLocaleDateString()}</p>
                      )}
                    </TableCell>
                    <TableCell className="hidden md:table-cell">
                      <p className="text-xs text-zinc-400 max-w-[250px] truncate">{s.reason}</p>
                    </TableCell>
                    <TableCell className="text-xs text-zinc-600 tabular-nums">{new Date(s.createdAt).toLocaleDateString()}</TableCell>
                    <TableCell>
                      {isAdmin && s.effectiveStatus === 'active' && s.targetUserId && (
                        <div className="flex gap-0.5">
                          <Button variant="ghost" size="icon" className="h-7 w-7 text-zinc-500 hover:text-amber-400" title="Reinstate" onClick={() => updateMutation.mutate({ strikeId: s.id, targetUserId: s.targetUserId!, status: 'active' })}>
                            <MessageSquare className="h-3 w-3" />
                          </Button>
                          <Button variant="ghost" size="icon" className="h-7 w-7 text-zinc-500 hover:text-zinc-300" title="Revoke" onClick={() => updateMutation.mutate({ strikeId: s.id, targetUserId: s.targetUserId!, status: 'revoked' })}>
                            <Ban className="h-3 w-3" />
                          </Button>
                        </div>
                      )}
                      {isAdmin && s.effectiveStatus === 'appealed' && s.targetUserId && (
                        <div className="flex gap-0.5">
                          <Button variant="ghost" size="icon" className="h-7 w-7 text-zinc-500 hover:text-amber-400" title="Reinstate" onClick={() => updateMutation.mutate({ strikeId: s.id, targetUserId: s.targetUserId!, status: 'active' })}>
                            <RotateCcw className="h-3 w-3" />
                          </Button>
                          <Button variant="ghost" size="icon" className="h-7 w-7 text-zinc-500 hover:text-zinc-300" title="Revoke" onClick={() => updateMutation.mutate({ strikeId: s.id, targetUserId: s.targetUserId!, status: 'revoked' })}>
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
          <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage(page - 1)}>Previous</Button>
          <span className="text-xs text-zinc-500">Page {page} of {totalPages}</span>
          <Button variant="outline" size="sm" disabled={page >= totalPages} onClick={() => setPage(page + 1)}>Next</Button>
        </div>
      )}
    </div>
  );
}
