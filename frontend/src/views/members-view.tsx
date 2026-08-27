'use client';

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { membersApi } from '@/lib/api-client';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
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
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { UserPlus, Shield, UserMinus, Pencil } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';

interface Props {
  factionId: string;
}

export function MembersView({ factionId }: Props) {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const [addOpen, setAddOpen] = useState(false);
  const [discordId, setDiscordId] = useState('');
  const [roleDialogOpen, setRoleDialogOpen] = useState(false);
  const [roleTarget, setRoleTarget] = useState<{ userId: string; currentRole: string; username: string } | null>(null);
  const [newRole, setNewRole] = useState<'admin' | 'member'>('member');
  const [removeTarget, setRemoveTarget] = useState<{ userId: string; username: string } | null>(null);

  const { data: members = [], isLoading } = useQuery({
    queryKey: ['members', factionId],
    queryFn: () => membersApi.list(factionId),
    staleTime: 30 * 1000,
  });

  const addMutation = useMutation({
    mutationFn: () => membersApi.add(factionId, discordId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['members', factionId] });
      queryClient.invalidateQueries({ queryKey: ['dashboard', factionId] });
      setAddOpen(false);
      setDiscordId('');
      toast({ title: 'Member added' });
    },
    onError: (err: any) => {
      toast({
        title: 'Failed to add member',
        description: err.response?.data?.error?.message || 'Unknown error',
        variant: 'destructive',
      });
    },
  });

  const roleMutation = useMutation({
    mutationFn: () => membersApi.updateRole(factionId, roleTarget!.userId, newRole),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['members', factionId] });
      setRoleDialogOpen(false);
      setRoleTarget(null);
      toast({ title: 'Role updated' });
    },
    onError: (err: any) => {
      toast({
        title: 'Failed to update role',
        description: err.response?.data?.error?.message || 'Unknown error',
        variant: 'destructive',
      });
    },
  });

  const removeMutation = useMutation({
    mutationFn: () => membersApi.remove(factionId, removeTarget!.userId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['members', factionId] });
      queryClient.invalidateQueries({ queryKey: ['dashboard', factionId] });
      setRemoveTarget(null);
      toast({ title: 'Member removed' });
    },
    onError: (err: any) => {
      toast({
        title: 'Failed to remove member',
        description: err.response?.data?.error?.message || 'Unknown error',
        variant: 'destructive',
      });
    },
  });

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-lg font-semibold">Faction Members</h3>
          <p className="text-sm text-muted-foreground">{members.length} member{members.length !== 1 ? 's' : ''}</p>
        </div>
        <Button onClick={() => setAddOpen(true)}>
          <UserPlus className="mr-2 h-4 w-4" />
          Add Member
        </Button>
      </div>

      {/* Members Table */}
      <Card>
        <CardContent className="p-0">
          {isLoading ? (
            <div className="p-6 space-y-3">
              {[...Array(4)].map((_, i) => (
                <Skeleton key={i} className="h-12 w-full" />
              ))}
            </div>
          ) : members.length === 0 ? (
            <div className="p-12 text-center text-muted-foreground">
              <UserPlus className="h-8 w-8 mx-auto mb-2 opacity-50" />
              <p>No members yet. Add someone by their Discord ID.</p>
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Member</TableHead>
                  <TableHead>Discord ID</TableHead>
                  <TableHead>Role</TableHead>
                  <TableHead>Entries</TableHead>
                  <TableHead>Joined</TableHead>
                  <TableHead className="w-[120px]">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {members.map((m) => (
                  <TableRow key={m.id}>
                    <TableCell>
                      <div className="flex items-center gap-2">
                        <Avatar className="h-8 w-8">
                          <AvatarImage src={m.avatarUrl ?? undefined} />
                          <AvatarFallback>{m.username.slice(0, 2).toUpperCase()}</AvatarFallback>
                        </Avatar>
                        <span className="font-medium">{m.username}</span>
                      </div>
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground font-mono">{m.discordId}</TableCell>
                    <TableCell>
                      <Badge variant={m.role === 'admin' ? 'default' : 'secondary'}>
                        {m.role === 'admin' ? 'Admin' : 'Member'}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-sm">{m.entryCount ?? 0}</TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {new Date(m.joinedAt).toLocaleDateString()}
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-1">
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-8 w-8"
                          onClick={() => {
                            setRoleTarget({ userId: m.userId, currentRole: m.role, username: m.username });
                            setNewRole(m.role === 'admin' ? 'member' : 'admin');
                            setRoleDialogOpen(true);
                          }}
                        >
                          <Pencil className="h-3.5 w-3.5" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-8 w-8 text-destructive"
                          onClick={() => setRemoveTarget({ userId: m.userId, username: m.username })}
                        >
                          <UserMinus className="h-3.5 w-3.5" />
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

      {/* Add Member Dialog */}
      <Dialog open={addOpen} onOpenChange={setAddOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Add Member</DialogTitle>
            <DialogDescription>
              Enter the Discord ID of the user you want to add. They must have logged in to the system at least once.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label>Discord User ID</Label>
              <Input
                placeholder="e.g. 123456789012345678"
                value={discordId}
                onChange={(e) => setDiscordId(e.target.value)}
              />
              <p className="text-xs text-muted-foreground">
                Right-click a user in Discord and copy their User ID.
              </p>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setAddOpen(false)}>Cancel</Button>
            <Button
              onClick={() => addMutation.mutate()}
              disabled={!discordId.trim() || addMutation.isPending}
            >
              {addMutation.isPending ? 'Adding...' : 'Add Member'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Role Change Dialog */}
      <Dialog open={roleDialogOpen} onOpenChange={setRoleDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Change Role</DialogTitle>
            <DialogDescription>
              Update {roleTarget?.username}&apos;s role in this faction.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="flex gap-4">
              <Button
                variant={newRole === 'member' ? 'outline' : 'default'}
                className="flex-1"
                onClick={() => setNewRole('member')}
              >
                Member
              </Button>
              <Button
                variant={newRole === 'admin' ? 'default' : 'outline'}
                className="flex-1"
                onClick={() => setNewRole('admin')}
              >
                <Shield className="mr-2 h-4 w-4" />
                Admin
              </Button>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setRoleDialogOpen(false)}>Cancel</Button>
            <Button
              onClick={() => roleMutation.mutate()}
              disabled={roleMutation.isPending}
            >
              {roleMutation.isPending ? 'Saving...' : 'Update Role'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Remove Confirmation */}
      <AlertDialog open={!!removeTarget} onOpenChange={(open) => !open && setRemoveTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remove {removeTarget?.username}?</AlertDialogTitle>
            <AlertDialogDescription>
              This will remove the member from the faction. Their entries will be preserved.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => removeMutation.mutate()}
              disabled={removeMutation.isPending}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {removeMutation.isPending ? 'Removing...' : 'Remove'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
