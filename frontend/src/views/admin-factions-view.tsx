'use client';

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { factionsApi, adminAnalyticsApi, apiErrorMessage } from '@/lib/api-client';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table';
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Skeleton } from '@/components/ui/skeleton';
import { Plus, Pencil, Trash2, Eye, Search, Shield, ChevronLeft, ChevronRight, BarChart3, Users, List } from 'lucide-react';
import { useAppStore } from '@/lib/store';
import { useToast } from '@/hooks/use-toast';
import type { Faction } from '@/lib/api-types';
import { ProvisionalUsersPanel } from '@/views/provisional-users-panel';
import { formatDate, formatCount, formatNumber } from '@/lib/format';
import { useTranslation } from '@/providers/i18n-provider';

export function AdminFactionsView() {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const setSelectedFactionId = useAppStore((s) => s.setSelectedFactionId);
  const setCurrentView = useAppStore((s) => s.setCurrentView);
  const setAdminDetailFactionId = useAppStore((s) => s.setAdminDetailFactionId);

  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');

  const [createOpen, setCreateOpen] = useState(false);
  const [newName, setNewName] = useState('');
  const [newDesc, setNewDesc] = useState('');
  const [newAdminDiscordId, setNewAdminDiscordId] = useState('');

  const [editOpen, setEditOpen] = useState(false);
  const [editFaction, setEditFaction] = useState<Faction | null>(null);
  const [editName, setEditName] = useState('');
  const [editDesc, setEditDesc] = useState('');
  const [editActive, setEditActive] = useState(true);

  const [deleteTarget, setDeleteTarget] = useState<Faction | null>(null);

  const { data: factionsData, isLoading } = useQuery({
    queryKey: ['admin-factions', page, search],
    queryFn: () => factionsApi.list({ page, page_size: 20, search: search || undefined }),
    staleTime: 30 * 1000,
  });

  const { data: analytics } = useQuery({
    queryKey: ['admin-analytics'],
    queryFn: () => adminAnalyticsApi.get(),
    staleTime: 2 * 60 * 1000,
  });

  const factions = factionsData?.data ?? [];
  const meta = factionsData?.meta;
  const totalPages = meta ? Math.ceil(meta.total_count / meta.page_size) : 1;

  const createMutation = useMutation({
    mutationFn: () => factionsApi.create({ name: newName, description: newDesc || undefined, initialAdminDiscordId: newAdminDiscordId }),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['admin-factions'] }); setCreateOpen(false); setNewName(''); setNewDesc(''); setNewAdminDiscordId(''); toast({ title: t('admin.factionCreated') }); },
    onError: (err: unknown) => { toast({ title: t('admin.factionCreateFailed'), description: apiErrorMessage(err), variant: 'destructive' }); },
  });

  const updateMutation = useMutation({
    mutationFn: () => factionsApi.update(editFaction!.id, { name: editName, description: editDesc || null, isActive: editActive }),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['admin-factions'] }); setEditOpen(false); setEditFaction(null); toast({ title: t('admin.factionUpdated') }); },
    onError: (err: unknown) => { toast({ title: t('common.updateFailed'), description: apiErrorMessage(err), variant: 'destructive' }); },
  });

  const deleteMutation = useMutation({
    mutationFn: () => factionsApi.remove(deleteTarget!.id),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['admin-factions'] }); setDeleteTarget(null); toast({ title: t('admin.factionDeactivated') }); },
    onError: (err: unknown) => { toast({ title: t('admin.factionDeactivateFailed'), description: apiErrorMessage(err), variant: 'destructive' }); },
  });

  const openEdit = (f: Faction) => { setEditFaction(f); setEditName(f.name); setEditDesc(f.description || ''); setEditActive(f.isActive); setEditOpen(true); };
  const viewFaction = (f: Faction) => { setAdminDetailFactionId(f.id); setSelectedFactionId(f.id); setCurrentView('admin-faction-detail'); };

  return (
    <div className="space-y-4">
      <div className="flex flex-col sm:flex-row gap-3 items-start sm:items-end">
        <div className="relative flex-1 max-w-sm">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-zinc-600" />
          <Input placeholder={t('faction.search')} className="pl-9" value={search} onChange={(e) => { setSearch(e.target.value); setPage(1); }} />
        </div>
        <Button onClick={() => setCreateOpen(true)}>
          <Plus className="mr-1.5 h-4 w-4" />{t('admin.createFaction')}
        </Button>
      </div>

      {analytics && (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <Card className="border-highlight"><CardContent className="p-4"><div className="flex items-center gap-2 text-[11px] text-zinc-500 uppercase tracking-wider"><Shield className="h-3.5 w-3.5" />{t('admin.factions')}</div><p className="text-2xl font-medium tabular-nums tracking-tight mt-1 text-zinc-100">{analytics.overview.totalFactions}</p><p className="text-[11px] text-zinc-500">{t('admin.activeCount', { count: analytics.overview.activeFactions })}</p></CardContent></Card>
          <Card><CardContent className="p-4"><div className="flex items-center gap-2 text-[11px] text-zinc-500 uppercase tracking-wider"><Users className="h-3.5 w-3.5" />{t('admin.users')}</div><p className="text-2xl font-medium tabular-nums tracking-tight mt-1 text-zinc-100">{analytics.overview.totalUsers}</p><p className="text-[11px] text-zinc-500">{t('admin.membershipCount', { count: analytics.overview.totalMemberships })}</p></CardContent></Card>
          <Card><CardContent className="p-4"><div className="flex items-center gap-2 text-[11px] text-zinc-500 uppercase tracking-wider"><List className="h-3.5 w-3.5" />{t('admin.totalEntries')}</div><p className="text-2xl font-medium tabular-nums tracking-tight mt-1 text-zinc-100">{formatCount(analytics.overview.totalEntries)}</p><p className="text-[11px] text-zinc-500">{t('admin.entriesLast7d', { count: analytics.overview.entriesLast7d })} &middot; {t('admin.entriesLast30d', { count: analytics.overview.entriesLast30d })}</p></CardContent></Card>
          <Card><CardContent className="p-4"><div className="flex items-center gap-2 text-[11px] text-zinc-500 uppercase tracking-wider"><BarChart3 className="h-3.5 w-3.5" />{t('admin.topFaction')}</div>{analytics.topFactionsByAmount.length > 0 ? (<><p className="text-sm font-medium mt-1 truncate text-zinc-200">{analytics.topFactionsByAmount[0].name}</p><p className="text-[11px] text-zinc-500">{t('admin.totalAmount', { amount: '$' + formatNumber(analytics.topFactionsByAmount[0].totalAmount) })}</p></>) : (<p className="text-sm text-zinc-600 mt-1">{t('common.noDataYet')}</p>)}</CardContent></Card>
        </div>
      )}

      <Card className="py-0 gap-0">
        <CardHeader><CardTitle className="flex items-center gap-2 text-sm text-zinc-200"><Shield className="h-4 w-4 text-zinc-400" />{t('admin.allFactions')}</CardTitle></CardHeader>
        <CardContent className="p-0">
          {isLoading ? (
            <div className="p-6 space-y-3">{[...Array(4)].map((_, i) => (<Skeleton key={i} className="h-12 w-full" />))}</div>
          ) : factions.length === 0 ? (
            <div className="p-12 text-center text-zinc-600"><Shield className="h-8 w-8 mx-auto mb-2 opacity-30" /><p className="text-sm">{t('admin.noFactionsYet')}</p></div>
          ) : (
            <>
              <Table>
                <TableHeader>
                  <TableRow><TableHead>{t('common.name')}</TableHead><TableHead>{t('nav.members')}</TableHead><TableHead>{t('nav.entries')}</TableHead><TableHead>{t('common.status')}</TableHead><TableHead>{t('common.created')}</TableHead><TableHead className="w-[120px]"></TableHead></TableRow>
                </TableHeader>
                <TableBody>
                  {factions.map((f) => (
                    <TableRow key={f.id} className={!f.isActive ? 'opacity-40' : ''}>
                      <TableCell><div><p className="text-sm font-medium text-zinc-300">{f.name}</p>{f.description && (<p className="text-[11px] text-zinc-600 truncate max-w-[200px]">{f.description}</p>)}</div></TableCell>
                      <TableCell className="text-sm text-zinc-400 tabular-nums">{f.memberCount}</TableCell>
                      <TableCell className="text-sm text-zinc-400 tabular-nums">{f.entryCount}</TableCell>
                      <TableCell><span className={`text-[11px] px-2 py-0.5 rounded-md font-medium border ${f.isActive ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20' : 'bg-white/[0.04] text-zinc-500 border-white/[0.06]'}`}>{f.isActive ? t('common.active') : t('common.inactive')}</span></TableCell>
                      <TableCell className="text-[11px] text-zinc-600 tabular-nums">{formatDate(f.createdAt)}</TableCell>
                      <TableCell><div className="flex items-center gap-0.5"><Button variant="ghost" size="icon" className="h-7 w-7 text-zinc-500 hover:text-zinc-200" onClick={() => viewFaction(f)}><Eye className="h-3 w-3" /></Button><Button variant="ghost" size="icon" className="h-7 w-7 text-zinc-500 hover:text-zinc-200" onClick={() => openEdit(f)}><Pencil className="h-3 w-3" /></Button><Button variant="ghost" size="icon" className="h-7 w-7 text-zinc-500 hover:text-red-400" onClick={() => setDeleteTarget(f)} disabled={!f.isActive}><Trash2 className="h-3 w-3" /></Button></div></TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
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

      <ProvisionalUsersPanel />

      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>{t('admin.createFaction')}</DialogTitle><DialogDescription>{t('admin.createFactionHint')}</DialogDescription></DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2"><Label>{t('admin.factionName')}</Label><Input placeholder={t('admin.factionNamePlaceholder')} value={newName} onChange={(e) => setNewName(e.target.value)} /></div>
            <div className="space-y-2"><Label>{t('admin.descriptionOptional')}</Label><Textarea placeholder={t('admin.descriptionPlaceholder')} value={newDesc} onChange={(e) => setNewDesc(e.target.value)} rows={2} /></div>
            <div className="space-y-2"><Label>{t('admin.initialAdminDiscordId')}</Label><Input placeholder={t('admin.initialAdminPlaceholder')} value={newAdminDiscordId} onChange={(e) => setNewAdminDiscordId(e.target.value)} /><p className="text-[11px] text-zinc-600">{t('admin.initialAdminHint')}</p></div>
          </div>
          <DialogFooter><Button variant="outline" onClick={() => setCreateOpen(false)}>{t('common.cancel')}</Button><Button onClick={() => createMutation.mutate()} disabled={!newName.trim() || !newAdminDiscordId.trim() || createMutation.isPending}>{createMutation.isPending ? t('common.creating') : t('admin.createFaction')}</Button></DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={editOpen} onOpenChange={setEditOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>{t('admin.editFaction')}</DialogTitle><DialogDescription>{t('admin.editFactionHint')}</DialogDescription></DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2"><Label>{t('common.name')}</Label><Input value={editName} onChange={(e) => setEditName(e.target.value)} /></div>
            <div className="space-y-2"><Label>{t('common.description')}</Label><Textarea value={editDesc} onChange={(e) => setEditDesc(e.target.value)} rows={2} /></div>
            <div className="flex items-center justify-between rounded-lg border border-white/[0.06] p-3">
              <div><p className="text-sm font-medium text-zinc-200">{t('common.active')}</p><p className="text-[11px] text-zinc-500">{t('admin.inactiveFactionHint')}</p></div>
              <input type="checkbox" checked={editActive} onChange={(e) => setEditActive(e.target.checked)} className="h-4 w-4 rounded border-white/[0.08]" />
            </div>
          </div>
          <DialogFooter><Button variant="outline" onClick={() => setEditOpen(false)}>{t('common.cancel')}</Button><Button onClick={() => updateMutation.mutate()} disabled={!editName.trim() || updateMutation.isPending}>{updateMutation.isPending ? t('common.saving') : t('common.saveChanges')}</Button></DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={!!deleteTarget} onOpenChange={(open) => !open && setDeleteTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader><AlertDialogTitle>{t('admin.deactivateConfirmTitle', { name: deleteTarget?.name ?? '' })}</AlertDialogTitle><AlertDialogDescription>{t('admin.deactivateConfirmBody')}</AlertDialogDescription></AlertDialogHeader>
          <AlertDialogFooter><AlertDialogCancel>{t('common.cancel')}</AlertDialogCancel><AlertDialogAction onClick={() => deleteMutation.mutate()} disabled={deleteMutation.isPending} className="bg-red-500 text-white hover:bg-red-600">{deleteMutation.isPending ? t('admin.deactivating') : t('admin.deactivate')}</AlertDialogAction></AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
