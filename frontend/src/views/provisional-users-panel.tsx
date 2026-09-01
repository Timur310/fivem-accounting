'use client';

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { provisionalUsersApi, apiErrorMessage } from '@/lib/api-client';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
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
import { UserPlus, Pencil, Trash2, UserCog } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import type { ProvisionalUser } from '@/lib/api-types';
import { useTranslation } from '@/providers/i18n-provider';

/**
 * Players a superadmin registered by Discord ID before they ever signed in.
 *
 * The row is a full user from the start, so it can join factions, hold entries
 * and take strikes; when the person finally logs in with that Discord ID they
 * land on this row and keep all of it. Until then there is nobody behind it,
 * which is why they carry no inactivity and why the names here are still ours
 * to fix.
 */
export function ProvisionalUsersPanel() {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const [createOpen, setCreateOpen] = useState(false);
  const [discordId, setDiscordId] = useState('');
  const [username, setUsername] = useState('');
  const [inGameName, setInGameName] = useState('');

  const [editTarget, setEditTarget] = useState<ProvisionalUser | null>(null);
  const [editUsername, setEditUsername] = useState('');
  const [editInGameName, setEditInGameName] = useState('');

  const [deleteTarget, setDeleteTarget] = useState<ProvisionalUser | null>(null);

  const { data: pending = [], isLoading } = useQuery({
    queryKey: ['provisional-users'],
    queryFn: () => provisionalUsersApi.list(),
    staleTime: 30 * 1000,
  });

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ['provisional-users'] });
    queryClient.invalidateQueries({ queryKey: ['admin-analytics'] });
  };

  const createMutation = useMutation({
    mutationFn: () => provisionalUsersApi.create({
      discordId: discordId.trim(),
      username: username.trim(),
      inGameName: inGameName.trim() || undefined,
    }),
    onSuccess: () => {
      invalidate();
      setCreateOpen(false);
      setDiscordId('');
      setUsername('');
      setInGameName('');
      toast({ title: t('provisional.registered') });
    },
    onError: (err: unknown) => {
      toast({ title: t('provisional.registerFailed'), description: apiErrorMessage(err), variant: 'destructive' });
    },
  });

  const updateMutation = useMutation({
    mutationFn: () => provisionalUsersApi.update(editTarget!.id, {
      username: editUsername.trim(),
      inGameName: editInGameName.trim() || null,
    }),
    onSuccess: () => {
      invalidate();
      setEditTarget(null);
      toast({ title: t('provisional.updated') });
    },
    onError: (err: unknown) => {
      toast({ title: t('common.updateFailed'), description: apiErrorMessage(err), variant: 'destructive' });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: () => provisionalUsersApi.remove(deleteTarget!.id),
    onSuccess: () => {
      invalidate();
      setDeleteTarget(null);
      toast({ title: t('provisional.removed') });
    },
    onError: (err: unknown) => {
      toast({ title: t('provisional.removeFailed'), description: apiErrorMessage(err), variant: 'destructive' });
    },
  });

  const openEdit = (u: ProvisionalUser) => {
    setEditTarget(u);
    setEditUsername(u.username);
    setEditInGameName(u.inGameName ?? '');
  };

  return (
    <>
      <Card className="py-0 gap-0">
        <CardHeader className="flex-row items-center justify-between py-4">
          <div>
            <CardTitle className="flex items-center gap-2 text-sm text-zinc-200">
              <UserCog className="h-4 w-4 text-zinc-400" />
              {t('provisional.title')}
            </CardTitle>
            <p className="text-[11px] text-zinc-500 mt-1">{t('provisional.description')}</p>
          </div>
          <Button size="sm" onClick={() => setCreateOpen(true)}>
            <UserPlus className="mr-1.5 h-4 w-4" />{t('provisional.registerPlayer')}
          </Button>
        </CardHeader>
        <CardContent className="p-0">
          {isLoading ? (
            <div className="p-6 space-y-3">{[...Array(3)].map((_, i) => <Skeleton key={i} className="h-10 w-full" />)}</div>
          ) : pending.length === 0 ? (
            <p className="px-6 py-10 text-center text-sm text-zinc-600">
              {t('provisional.none')}
            </p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t('provisional.player')}</TableHead>
                  <TableHead>{t('members.discordId')}</TableHead>
                  <TableHead className="text-right">{t('admin.factions')}</TableHead>
                  <TableHead className="text-right">{t('nav.entries')}</TableHead>
                  <TableHead className="w-[90px]"></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {pending.map((u) => (
                  <TableRow key={u.id}>
                    <TableCell>
                      <span className="text-sm text-zinc-200">{u.inGameName?.trim() || u.username}</span>
                      {u.inGameName?.trim() && (
                        <span className="ml-1.5 text-xs text-zinc-500">({u.username})</span>
                      )}
                    </TableCell>
                    <TableCell className="text-xs text-zinc-500 tabular-nums">{u.discordId}</TableCell>
                    <TableCell className="text-sm text-zinc-400 tabular-nums text-right">{u.factionCount}</TableCell>
                    <TableCell className="text-sm text-zinc-400 tabular-nums text-right">{u.entryCount}</TableCell>
                    <TableCell>
                      <div className="flex justify-end gap-0.5">
                        <Button variant="ghost" size="icon" className="h-7 w-7 text-zinc-500 hover:text-zinc-200" title={t('common.edit')} onClick={() => openEdit(u)}>
                          <Pencil className="h-3 w-3" />
                        </Button>
                        <Button variant="ghost" size="icon" className="h-7 w-7 text-zinc-500 hover:text-red-400" title={t('common.remove')} onClick={() => setDeleteTarget(u)}>
                          <Trash2 className="h-3 w-3" />
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {/* ═══ Register ═══ */}
      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t('provisional.registerPlayer')}</DialogTitle>
            <DialogDescription>{t('provisional.registerHint')}</DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label>{t('provisional.discordIdRequired')}</Label>
              <Input
                placeholder="123456789012345678"
                value={discordId}
                onChange={(e) => setDiscordId(e.target.value)}
                className="tabular-nums"
              />
              <p className="text-xs text-zinc-500">{t('provisional.discordIdHint')}</p>
            </div>
            <div className="space-y-2">
              <Label>{t('provisional.discordNameRequired')}</Label>
              <Input placeholder={t('provisional.discordNamePlaceholder')} value={username} onChange={(e) => setUsername(e.target.value)} maxLength={32} />
            </div>
            <div className="space-y-2">
              <Label>{t('inGameName.label')}</Label>
              <Input placeholder={t('provisional.inGameNamePlaceholder')} value={inGameName} onChange={(e) => setInGameName(e.target.value)} maxLength={50} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCreateOpen(false)}>{t('common.cancel')}</Button>
            <Button
              onClick={() => createMutation.mutate()}
              disabled={!/^\d{17,20}$/.test(discordId.trim()) || !username.trim() || createMutation.isPending}
            >
              {createMutation.isPending ? t('provisional.registering') : t('provisional.register')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ═══ Edit ═══ */}
      <Dialog open={!!editTarget} onOpenChange={(open) => { if (!open) setEditTarget(null); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t('provisional.editTitle')}</DialogTitle>
            <DialogDescription>{t('provisional.editHint')}</DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label>{t('provisional.discordName')}</Label>
              <Input value={editUsername} onChange={(e) => setEditUsername(e.target.value)} maxLength={32} />
            </div>
            <div className="space-y-2">
              <Label>{t('inGameName.label')}</Label>
              <Input value={editInGameName} onChange={(e) => setEditInGameName(e.target.value)} maxLength={50} />
            </div>
            <p className="text-xs text-zinc-500">{t('members.discordId')}: {editTarget?.discordId}</p>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditTarget(null)}>{t('common.cancel')}</Button>
            <Button onClick={() => updateMutation.mutate()} disabled={!editUsername.trim() || updateMutation.isPending}>
              {updateMutation.isPending ? t('common.saving') : t('common.saveChanges')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ═══ Remove ═══ */}
      <AlertDialog open={!!deleteTarget} onOpenChange={(open) => { if (!open) setDeleteTarget(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t('provisional.removeConfirmTitle', { name: deleteTarget?.inGameName?.trim() || deleteTarget?.username || '' })}</AlertDialogTitle>
            <AlertDialogDescription>{t('provisional.removeConfirmBody')}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t('common.cancel')}</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => deleteMutation.mutate()}
              disabled={deleteMutation.isPending}
              className="bg-red-500 text-white hover:bg-red-600"
            >
              {deleteMutation.isPending ? t('common.removing') : t('common.remove')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
