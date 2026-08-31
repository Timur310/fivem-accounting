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
      toast({ title: 'Player registered' });
    },
    onError: (err: unknown) => {
      toast({ title: 'Failed to register', description: apiErrorMessage(err), variant: 'destructive' });
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
      toast({ title: 'Player updated' });
    },
    onError: (err: unknown) => {
      toast({ title: 'Update failed', description: apiErrorMessage(err), variant: 'destructive' });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: () => provisionalUsersApi.remove(deleteTarget!.id),
    onSuccess: () => {
      invalidate();
      setDeleteTarget(null);
      toast({ title: 'Registration removed' });
    },
    onError: (err: unknown) => {
      toast({ title: 'Could not remove', description: apiErrorMessage(err), variant: 'destructive' });
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
              Registered Players
            </CardTitle>
            <p className="text-[11px] text-zinc-500 mt-1">
              People added by Discord ID who have never signed in. They can join factions and
              have entries booked for them; the first time they log in, this becomes their own
              account with everything it already holds.
            </p>
          </div>
          <Button size="sm" onClick={() => setCreateOpen(true)}>
            <UserPlus className="mr-1.5 h-4 w-4" />Register Player
          </Button>
        </CardHeader>
        <CardContent className="p-0">
          {isLoading ? (
            <div className="p-6 space-y-3">{[...Array(3)].map((_, i) => <Skeleton key={i} className="h-10 w-full" />)}</div>
          ) : pending.length === 0 ? (
            <p className="px-6 py-10 text-center text-sm text-zinc-600">
              Nobody registered yet.
            </p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Player</TableHead>
                  <TableHead>Discord ID</TableHead>
                  <TableHead className="text-right">Factions</TableHead>
                  <TableHead className="text-right">Entries</TableHead>
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
                        <Button variant="ghost" size="icon" className="h-7 w-7 text-zinc-500 hover:text-zinc-200" title="Edit" onClick={() => openEdit(u)}>
                          <Pencil className="h-3 w-3" />
                        </Button>
                        <Button variant="ghost" size="icon" className="h-7 w-7 text-zinc-500 hover:text-red-400" title="Remove" onClick={() => setDeleteTarget(u)}>
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
            <DialogTitle>Register Player</DialogTitle>
            <DialogDescription>
              Add someone by their Discord ID so they can be managed before they ever log in.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label>Discord ID *</Label>
              <Input
                placeholder="123456789012345678"
                value={discordId}
                onChange={(e) => setDiscordId(e.target.value)}
                className="tabular-nums"
              />
              <p className="text-xs text-zinc-500">
                Has to be the real one — it is what links this record to their account when
                they sign in. Discord: Settings &rarr; Advanced &rarr; Developer Mode, then
                right-click the user &rarr; Copy User ID.
              </p>
            </div>
            <div className="space-y-2">
              <Label>Discord Name *</Label>
              <Input placeholder="How Discord shows them" value={username} onChange={(e) => setUsername(e.target.value)} maxLength={32} />
            </div>
            <div className="space-y-2">
              <Label>In-Game Name</Label>
              <Input placeholder="Their character" value={inGameName} onChange={(e) => setInGameName(e.target.value)} maxLength={50} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCreateOpen(false)}>Cancel</Button>
            <Button
              onClick={() => createMutation.mutate()}
              disabled={!/^\d{17,20}$/.test(discordId.trim()) || !username.trim() || createMutation.isPending}
            >
              {createMutation.isPending ? 'Registering...' : 'Register'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ═══ Edit ═══ */}
      <Dialog open={!!editTarget} onOpenChange={(open) => { if (!open) setEditTarget(null); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Edit Registration</DialogTitle>
            <DialogDescription>
              Both names are editable only until they sign in — after that, Discord owns the
              username and they own their in-game name.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label>Discord Name</Label>
              <Input value={editUsername} onChange={(e) => setEditUsername(e.target.value)} maxLength={32} />
            </div>
            <div className="space-y-2">
              <Label>In-Game Name</Label>
              <Input value={editInGameName} onChange={(e) => setEditInGameName(e.target.value)} maxLength={50} />
            </div>
            <p className="text-xs text-zinc-500">Discord ID: {editTarget?.discordId}</p>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditTarget(null)}>Cancel</Button>
            <Button onClick={() => updateMutation.mutate()} disabled={!editUsername.trim() || updateMutation.isPending}>
              {updateMutation.isPending ? 'Saving...' : 'Save Changes'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ═══ Remove ═══ */}
      <AlertDialog open={!!deleteTarget} onOpenChange={(open) => { if (!open) setDeleteTarget(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remove &ldquo;{deleteTarget?.inGameName?.trim() || deleteTarget?.username}&rdquo;?</AlertDialogTitle>
            <AlertDialogDescription>
              This deletes the registration and any faction memberships it has. It is refused
              if the player already carries entries, payouts or strikes — those are real
              records, so clear them first.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => deleteMutation.mutate()}
              disabled={deleteMutation.isPending}
              className="bg-red-500 text-white hover:bg-red-600"
            >
              {deleteMutation.isPending ? 'Removing...' : 'Remove'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
