'use client';

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { factionsApi, adminAnalyticsApi } from '@/lib/api-client';
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
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Plus, Pencil, Trash2, Eye, Search, Shield, ChevronLeft, ChevronRight, BarChart3, TrendingUp, Users, List } from 'lucide-react';
import { useAppStore } from '@/lib/store';
import { useToast } from '@/hooks/use-toast';
import type { Faction } from '@/lib/api-types';

export function AdminFactionsView() {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const setSelectedFactionId = useAppStore((s) => s.setSelectedFactionId);
  const setCurrentView = useAppStore((s) => s.setCurrentView);
  const setAdminDetailFactionId = useAppStore((s) => s.setAdminDetailFactionId);

  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');

  // Create dialog
  const [createOpen, setCreateOpen] = useState(false);
  const [newName, setNewName] = useState('');
  const [newDesc, setNewDesc] = useState('');
  const [newAdminDiscordId, setNewAdminDiscordId] = useState('');

  // Edit dialog
  const [editOpen, setEditOpen] = useState(false);
  const [editFaction, setEditFaction] = useState<Faction | null>(null);
  const [editName, setEditName] = useState('');
  const [editDesc, setEditDesc] = useState('');
  const [editActive, setEditActive] = useState(true);

  // Delete
  const [deleteTarget, setDeleteTarget] = useState<Faction | null>(null);

  const { data: factionsData, isLoading } = useQuery({
    queryKey: ['admin-factions', page, search],
    queryFn: () =>
      factionsApi.list({ page, page_size: 20, search: search || undefined }),
    staleTime: 30 * 1000,
  });

  // Superadmin analytics
  const { data: analytics } = useQuery({
    queryKey: ['admin-analytics'],
    queryFn: () => adminAnalyticsApi.get(),
    staleTime: 2 * 60 * 1000,
  });

  const factions = factionsData?.data ?? [];
  const meta = factionsData?.meta;
  const totalPages = meta ? Math.ceil(meta.total_count / meta.page_size) : 1;

  const createMutation = useMutation({
    mutationFn: () =>
      factionsApi.create({
        name: newName,
        description: newDesc || undefined,
        initialAdminDiscordId: newAdminDiscordId,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin-factions'] });
      setCreateOpen(false);
      setNewName('');
      setNewDesc('');
      setNewAdminDiscordId('');
      toast({ title: 'Faction created' });
    },
    onError: (err: any) => {
      toast({
        title: 'Failed to create faction',
        description: err.response?.data?.error?.message || 'Unknown error',
        variant: 'destructive',
      });
    },
  });

  const updateMutation = useMutation({
    mutationFn: () =>
      factionsApi.update(editFaction!.id, {
        name: editName,
        description: editDesc || null,
        isActive: editActive,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin-factions'] });
      setEditOpen(false);
      setEditFaction(null);
      toast({ title: 'Faction updated' });
    },
    onError: (err: any) => {
      toast({
        title: 'Update failed',
        description: err.response?.data?.error?.message || 'Unknown error',
        variant: 'destructive',
      });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: () => factionsApi.remove(deleteTarget!.id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin-factions'] });
      setDeleteTarget(null);
      toast({ title: 'Faction deactivated' });
    },
    onError: (err: any) => {
      toast({
        title: 'Failed to deactivate',
        description: err.response?.data?.error?.message || 'Unknown error',
        variant: 'destructive',
      });
    },
  });

  const openEdit = (f: Faction) => {
    setEditFaction(f);
    setEditName(f.name);
    setEditDesc(f.description || '');
    setEditActive(f.isActive);
    setEditOpen(true);
  };

  const viewFaction = (f: Faction) => {
    setAdminDetailFactionId(f.id);
    setSelectedFactionId(f.id);
    setCurrentView('admin-faction-detail');
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-col sm:flex-row gap-3 items-start sm:items-end">
        <div className="relative flex-1 max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search factions..."
            className="pl-9"
            value={search}
            onChange={(e) => { setSearch(e.target.value); setPage(1); }}
          />
        </div>
        <Button onClick={() => setCreateOpen(true)}>
          <Plus className="mr-2 h-4 w-4" />
          Create Faction
        </Button>
      </div>

      {/* System Analytics Overview */}
      {analytics && (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <Card>
            <CardContent className="p-4">
              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                <Shield className="h-3.5 w-3.5" /> Factions
              </div>
              <p className="text-2xl font-bold mt-1">{analytics.overview.totalFactions}</p>
              <p className="text-xs text-muted-foreground">{analytics.overview.activeFactions} active</p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-4">
              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                <Users className="h-3.5 w-3.5" /> Users
              </div>
              <p className="text-2xl font-bold mt-1">{analytics.overview.totalUsers}</p>
              <p className="text-xs text-muted-foreground">{analytics.overview.totalMemberships} memberships</p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-4">
              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                <List className="h-3.5 w-3.5" /> Total Entries
              </div>
              <p className="text-2xl font-bold mt-1">{analytics.overview.totalEntries.toLocaleString()}</p>
              <p className="text-xs text-muted-foreground">{analytics.overview.entriesLast7d} last 7d &middot; {analytics.overview.entriesLast30d} last 30d</p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-4">
              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                <BarChart3 className="h-3.5 w-3.5" /> Top Faction
              </div>
              {analytics.topFactionsByAmount.length > 0 ? (
                <>
                  <p className="text-sm font-bold mt-1 truncate">{analytics.topFactionsByAmount[0].name}</p>
                  <p className="text-xs text-muted-foreground">{analytics.topFactionsByAmount[0].totalAmount.toLocaleString('en-US', { minimumFractionDigits: 2 })} total</p>
                </>
              ) : (
                <p className="text-sm text-muted-foreground mt-1">No data yet</p>
              )}
            </CardContent>
          </Card>
        </div>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Shield className="h-4 w-4" />
            All Factions
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {isLoading ? (
            <div className="p-6 space-y-3">
              {[...Array(4)].map((_, i) => (
                <Skeleton key={i} className="h-12 w-full" />
              ))}
            </div>
          ) : factions.length === 0 ? (
            <div className="p-12 text-center text-muted-foreground">
              <Shield className="h-8 w-8 mx-auto mb-2 opacity-50" />
              <p>No factions yet. Create one to get started.</p>
            </div>
          ) : (
            <>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Name</TableHead>
                    <TableHead>Members</TableHead>
                    <TableHead>Entries</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Created</TableHead>
                    <TableHead className="w-[140px]">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {factions.map((f) => (
                    <TableRow key={f.id} className={!f.isActive ? 'opacity-50' : ''}>
                      <TableCell>
                        <div>
                          <p className="font-medium">{f.name}</p>
                          {f.description && (
                            <p className="text-xs text-muted-foreground truncate max-w-[200px]">
                              {f.description}
                            </p>
                          )}
                        </div>
                      </TableCell>
                      <TableCell>{f.memberCount}</TableCell>
                      <TableCell>{f.entryCount}</TableCell>
                      <TableCell>
                        <Badge variant={f.isActive ? 'default' : 'secondary'}>
                          {f.isActive ? 'Active' : 'Inactive'}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground">
                        {new Date(f.createdAt).toLocaleDateString()}
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center gap-1">
                          <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => viewFaction(f)}>
                            <Eye className="h-3.5 w-3.5" />
                          </Button>
                          <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => openEdit(f)}>
                            <Pencil className="h-3.5 w-3.5" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-8 w-8 text-destructive"
                            onClick={() => setDeleteTarget(f)}
                            disabled={!f.isActive}
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>

              {meta && totalPages > 1 && (
                <div className="flex items-center justify-between px-4 py-3 border-t">
                  <p className="text-sm text-muted-foreground">
                    Page {meta.page} of {totalPages} ({meta.total_count} total)
                  </p>
                  <div className="flex items-center gap-2">
                    <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage(page - 1)}>
                      <ChevronLeft className="h-4 w-4" />
                    </Button>
                    <Button variant="outline" size="sm" disabled={page >= totalPages} onClick={() => setPage(page + 1)}>
                      <ChevronRight className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
              )}
            </>
          )}
        </CardContent>
      </Card>

      {/* Create Dialog */}
      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Create Faction</DialogTitle>
            <DialogDescription>
              Set up a new faction and appoint its first admin.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label>Faction Name</Label>
              <Input
                placeholder="e.g. The Lost MC"
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label>Description (optional)</Label>
              <Textarea
                placeholder="Brief faction description..."
                value={newDesc}
                onChange={(e) => setNewDesc(e.target.value)}
                rows={2}
              />
            </div>
            <div className="space-y-2">
              <Label>Initial Admin Discord ID</Label>
              <Input
                placeholder="The Discord ID of the faction leader"
                value={newAdminDiscordId}
                onChange={(e) => setNewAdminDiscordId(e.target.value)}
              />
              <p className="text-xs text-muted-foreground">
                This user must have already logged into the system. Default item types (Dirty Money, Clean Money) will be created automatically.
              </p>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCreateOpen(false)}>Cancel</Button>
            <Button
              onClick={() => createMutation.mutate()}
              disabled={!newName.trim() || !newAdminDiscordId.trim() || createMutation.isPending}
            >
              {createMutation.isPending ? 'Creating...' : 'Create Faction'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Edit Dialog */}
      <Dialog open={editOpen} onOpenChange={setEditOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Edit Faction</DialogTitle>
            <DialogDescription>Update faction settings.</DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label>Name</Label>
              <Input value={editName} onChange={(e) => setEditName(e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label>Description</Label>
              <Textarea value={editDesc} onChange={(e) => setEditDesc(e.target.value)} rows={2} />
            </div>
            <div className="flex items-center justify-between rounded-lg border p-3">
              <div>
                <p className="text-sm font-medium">Active</p>
                <p className="text-xs text-muted-foreground">Inactive factions are hidden from members.</p>
              </div>
              <input
                type="checkbox"
                checked={editActive}
                onChange={(e) => setEditActive(e.target.checked)}
                className="h-4 w-4 rounded border-gray-300"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditOpen(false)}>Cancel</Button>
            <Button
              onClick={() => updateMutation.mutate()}
              disabled={!editName.trim() || updateMutation.isPending}
            >
              {updateMutation.isPending ? 'Saving...' : 'Save Changes'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete Confirmation */}
      <AlertDialog open={!!deleteTarget} onOpenChange={(open) => !open && setDeleteTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Deactivate &ldquo;{deleteTarget?.name}&rdquo;?</AlertDialogTitle>
            <AlertDialogDescription>
              This will deactivate the faction. It can be reactivated later.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => deleteMutation.mutate()}
              disabled={deleteMutation.isPending}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {deleteMutation.isPending ? 'Deactivating...' : 'Deactivate'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
