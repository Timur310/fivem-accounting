'use client';

import { useMemo, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { adminUsersApi, provisionalUsersApi, apiErrorMessage } from '@/lib/api-client';
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
import { UserPlus, Pencil, Trash2, UserCog, Search , Users} from 'lucide-react';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { EmptyState, ErrorState } from '@/components/ui/empty-state';
import { useToast } from '@/hooks/use-toast';
import type { AdminUser } from '@/lib/api-types';
import { displayName, formatDate } from '@/lib/format';
import { useTranslation } from '@/providers/i18n-provider';
import type { TranslationKey } from '@/lib/i18n';

const ROLE_KEYS: Record<string, TranslationKey> = {
  superadmin: 'role.superadmin',
  faction_admin: 'role.factionAdmin',
  member: 'role.member',
};

/**
 * Every player the system knows about, in one list.
 *
 * A registration and the account it becomes are the same row: registering
 * someone by Discord ID creates a full user, and the first time they sign in
 * with that ID the OAuth callback lands on it and everything they had carries
 * over. Showing registrations in a table of their own made that look like two
 * populations, so they sit here with everyone else — pinned to the top, where
 * they are the rows still needing something done about them, and the only ones
 * whose names are still ours to fix.
 */
export function UsersPanel() {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const [createOpen, setCreateOpen] = useState(false);
  const [discordId, setDiscordId] = useState('');
  const [username, setUsername] = useState('');
  const [inGameName, setInGameName] = useState('');

  const [editTarget, setEditTarget] = useState<AdminUser | null>(null);
  const [editUsername, setEditUsername] = useState('');
  const [editInGameName, setEditInGameName] = useState('');

  const [deleteTarget, setDeleteTarget] = useState<AdminUser | null>(null);

  const [search, setSearch] = useState('');

  const { data: allUsers = [], isLoading, isError, error, refetch } = useQuery({
    queryKey: ['admin-users'],
    queryFn: () => adminUsersApi.list(),
    staleTime: 30 * 1000,
  });

  // The roster is every account on the server, so it outgrows a screen quickly.
  // Matching the Discord ID as well as the names matters: an admin is usually
  // holding an ID handed to them in Discord, not a name they can spell.
  const users = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return allUsers;
    return allUsers.filter((u) =>
      u.username.toLowerCase().includes(q)
      || (u.inGameName ?? '').toLowerCase().includes(q)
      || u.discordId.includes(q),
    );
  }, [allUsers, search]);

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ['admin-users'] });
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

  const openEdit = (u: AdminUser) => {
    setEditTarget(u);
    setEditUsername(u.username);
    setEditInGameName(u.inGameName ?? '');
  };

  return (
    <>
      <Card className="py-0 gap-0">
        <CardHeader className="flex-row flex-wrap items-center justify-between gap-3 py-4">
          <div>
            <CardTitle className="flex items-center gap-2 text-sm text-zinc-200">
              <UserCog className="h-4 w-4 text-zinc-400" />
              {t('users.title')}
            </CardTitle>
            <p className="text-meta text-zinc-500 mt-1">{t('users.description')}</p>
          </div>
          <div className="flex items-center gap-2">
            {allUsers.length > 0 && (
              <div className="relative">
                <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-zinc-600" />
                <Input
                  size="sm"
                  className="w-[200px] pl-8"
                  placeholder={t('users.search')}
                  aria-label={t('users.search')}
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                />
              </div>
            )}
            <Button size="sm" onClick={() => setCreateOpen(true)}>
              <UserPlus className="mr-1.5 h-4 w-4" />{t('provisional.registerPlayer')}
            </Button>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          {isLoading ? (
            <div className="p-6 space-y-3">{[...Array(3)].map((_, i) => <Skeleton key={i} className="h-10 w-full" />)}</div>
          ) : isError ? (
            <ErrorState error={error} onRetry={() => refetch()} />
          ) : allUsers.length === 0 ? (
            <EmptyState icon={Users} title={t('users.none')}
              hint={t('users.noneHint')} />
          ) : users.length === 0 ? (
            <EmptyState icon={Search} title={t('members.noneMatch')} hint={t('members.noneMatchHint')} />
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t('provisional.player')}</TableHead>
                  <TableHead className="hidden sm:table-cell">{t('members.discordId')}</TableHead>
                  <TableHead className="hidden md:table-cell">{t('members.role')}</TableHead>
                  <TableHead className="hidden lg:table-cell">{t('users.lastLogin')}</TableHead>
                  <TableHead className="text-right">{t('admin.factions')}</TableHead>
                  <TableHead className="text-right">{t('nav.entries')}</TableHead>
                  <TableHead className="w-[90px]"></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {users.map((u) => (
                  <TableRow key={u.id}>
                    <TableCell>
                      <div className="flex items-center gap-2.5">
                        <Avatar className="h-7 w-7">
                          <AvatarImage src={u.avatarUrl ?? undefined} />
                          <AvatarFallback className="text-micro">{displayName(u).slice(0, 2).toUpperCase()}</AvatarFallback>
                        </Avatar>
                        <div className="min-w-0">
                          <span className="text-sm text-zinc-200">{displayName(u)}</span>
                          {u.inGameName?.trim() && (
                            <span className="ml-1.5 text-xs text-zinc-500">({u.username})</span>
                          )}
                          {/* The one thing that separates these rows from the
                              rest: nobody is behind them yet. */}
                          {u.isProvisional && (
                            <Badge variant="outline" className="ml-2 text-micro border-amber-500/20 text-amber-400 bg-amber-500/5">
                              {t('users.awaitingFirstLogin')}
                            </Badge>
                          )}
                        </div>
                      </div>
                    </TableCell>
                    <TableCell className="hidden sm:table-cell text-xs text-zinc-500 tabular-nums">{u.discordId}</TableCell>
                    <TableCell className="hidden md:table-cell text-xs text-zinc-400">{ROLE_KEYS[u.role] ? t(ROLE_KEYS[u.role]) : u.role}</TableCell>
                    <TableCell className="hidden lg:table-cell text-xs text-zinc-500 tabular-nums">
                      {u.lastLogin ? formatDate(u.lastLogin) : <span className="text-zinc-700">{t('dashboard.never')}</span>}
                    </TableCell>
                    <TableCell className="text-sm text-zinc-400 tabular-nums text-right">{u.factionCount}</TableCell>
                    <TableCell className="text-sm text-zinc-400 tabular-nums text-right">{u.entryCount}</TableCell>
                    <TableCell>
                      {/* Renaming and removing only ever applied to a row nobody
                          has signed into — after that the Discord name is
                          Discord's and the character name is theirs. The API
                          refuses both for anyone else, so the buttons go. */}
                      {u.isProvisional && (
                        <div className="flex justify-end gap-0.5">
                          <Button variant="ghost" size="icon-xs" className="text-zinc-500 hover:text-zinc-200" title={t('common.edit')} onClick={() => openEdit(u)}>
                            <Pencil className="h-3 w-3" />
                          </Button>
                          <Button variant="ghost" size="icon-xs" className="text-zinc-500 hover:text-red-400" title={t('common.remove')} onClick={() => setDeleteTarget(u)}>
                            <Trash2 className="h-3 w-3" />
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
