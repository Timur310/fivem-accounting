'use client';

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { membersApi, factionSettingsApi, apiErrorMessage } from '@/lib/api-client';
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
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { UserPlus, Shield, UserMinus, Pencil, Eye, Clock, AlertTriangle, ChevronsUp, Search, X } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { useAppStore } from '@/lib/store';
import type { FactionSettings } from '@/lib/api-types';
import { displayName } from '@/lib/format';

interface Props {
  factionId: string;
}

export function MembersView({ factionId }: Props) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const brandColor = useAppStore((s) => s.brandColor);
  const setCurrentView = useAppStore((s) => s.setCurrentView);
  const setSelectedMemberUserId = useAppStore((s) => s.setSelectedMemberUserId);

  const [addOpen, setAddOpen] = useState(false);
  const [discordId, setDiscordId] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<{ id: string; username: string; avatarUrl: string | null; discordId: string }[]>([]);
  const [selectedUser, setSelectedUser] = useState<{ id: string; username: string; avatarUrl: string | null; discordId: string } | null>(null);
  const [roleDialogOpen, setRoleDialogOpen] = useState(false);
  const [roleTarget, setRoleTarget] = useState<{ userId: string; currentRole: string; username: string } | null>(null);
  const [newRole, setNewRole] = useState<'admin' | 'member'>('member');
  const [removeTarget, setRemoveTarget] = useState<{ userId: string; username: string } | null>(null);
  // Rank dialog
  const [rankDialogOpen, setRankDialogOpen] = useState(false);
  const [rankTarget, setRankTarget] = useState<{ userId: string; username: string; currentRank: string | null } | null>(null);
  const [newRank, setNewRank] = useState<string>('');

  const { data: members = [], isLoading } = useQuery({
    queryKey: ['members', factionId],
    queryFn: () => membersApi.list(factionId),
    staleTime: 30 * 1000,
  });

  // Fetch faction settings for rank list + inactivity threshold
  const { data: settings } = useQuery({
    queryKey: ['faction-settings', factionId],
    queryFn: () => factionSettingsApi.get(factionId),
    staleTime: 5 * 60 * 1000,
  });

  const sortedRanks = (settings?.ranks ?? []).sort((a, b) => a.level - b.level);

  const addMutation = useMutation({
    mutationFn: () => membersApi.add(factionId, selectedUser ? selectedUser.id : discordId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['members', factionId] });
      queryClient.invalidateQueries({ queryKey: ['dashboard', factionId] });
      setAddOpen(false);
      setDiscordId('');
      setSelectedUser(null);
      setSearchQuery('');
      setSearchResults([]);
      toast({ title: 'Member added' });
    },
    onError: (err: unknown) => {
      toast({ title: 'Failed to add member', description: apiErrorMessage(err), variant: 'destructive' });
    },
  });

  // Debounced search of any user the backend knows about (whether or not
  // they're already a faction member — the backend validates on add).
  const handleSearch = async (q: string) => {
    setSearchQuery(q);
    if (q.trim().length < 2) {
      setSearchResults([]);
      return;
    }
    try {
      const results = await membersApi.search(factionId, q);
      setSearchResults(results);
    } catch {
      setSearchResults([]);
    }
  };

  const roleMutation = useMutation({
    mutationFn: () => membersApi.updateRole(factionId, roleTarget!.userId, newRole),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['members', factionId] });
      setRoleDialogOpen(false);
      setRoleTarget(null);
      toast({ title: 'Role updated' });
    },
    onError: (err: unknown) => {
      toast({ title: 'Failed to update role', description: apiErrorMessage(err), variant: 'destructive' });
    },
  });

  const rankMutation = useMutation({
    mutationFn: () => membersApi.updateRank(factionId, rankTarget!.userId, newRank || null),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['members', factionId] });
      setRankDialogOpen(false);
      setRankTarget(null);
      toast({ title: 'Rank updated' });
    },
    onError: (err: unknown) => {
      toast({ title: 'Failed to update rank', description: apiErrorMessage(err), variant: 'destructive' });
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
    onError: (err: unknown) => {
      toast({ title: 'Failed to remove member', description: apiErrorMessage(err), variant: 'destructive' });
    },
  });

  const handleOpenProfile = (userId: string) => {
    setSelectedMemberUserId(userId);
    setCurrentView('member-profile');
  };

  const inactivityThreshold = settings?.inactivityThresholdDays ?? 7;

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-lg font-medium text-zinc-200">Faction Members</h3>
          <p className="text-sm text-zinc-500">{members.length} member{members.length !== 1 ? 's' : ''}</p>
        </div>
        <Button onClick={() => setAddOpen(true)}>
          <UserPlus className="mr-1.5 h-4 w-4" />
          Add Member
        </Button>
      </div>

      {/* Table */}
      <Card className="py-0 gap-0">
        <CardContent className="p-0">
          {isLoading ? (
            <div className="p-6 space-y-3">{[...Array(4)].map((_, i) => (<Skeleton key={i} className="h-12 w-full" />))}</div>
          ) : members.length === 0 ? (
            <div className="p-12 text-center text-zinc-600">
              <UserPlus className="h-8 w-8 mx-auto mb-2 opacity-30" />
              <p className="text-sm">No members yet. Add someone by their Discord ID.</p>
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Member</TableHead>
                  <TableHead className="hidden sm:table-cell">Discord ID</TableHead>
                  <TableHead>Role</TableHead>
                  <TableHead className="hidden md:table-cell">Rank</TableHead>
                  <TableHead className="text-right hidden sm:table-cell">Entries</TableHead>
                  <TableHead className="hidden lg:table-cell">Status</TableHead>
                  <TableHead className="hidden lg:table-cell">Joined</TableHead>
                  <TableHead className="w-[120px]"></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {members.map((m) => {
                  const isInactive = m.daysInactive !== null && m.daysInactive >= inactivityThreshold;
                  return (
                    <TableRow key={m.id}>
                      <TableCell>
                        <div className="flex items-center gap-2.5">
                          <Avatar className="h-7 w-7">
                            <AvatarImage src={m.avatarUrl ?? undefined} />
                            <AvatarFallback className="text-[10px]">{displayName(m).slice(0, 2).toUpperCase()}</AvatarFallback>
                          </Avatar>
                          <div>
                            <button
                              onClick={() => handleOpenProfile(m.userId)}
                              className="text-sm text-zinc-300 font-medium hover:underline underline-offset-2 transition-colors"
                              style={{ textDecorationColor: `${brandColor}60` }}
                            >
                              {displayName(m)}
                            </button>
                            {/* Mobile: show strike badge inline */}
                            {(m.activeStrikeCount ?? 0) > 0 && (
                              <Badge className="lg:hidden text-[9px] bg-amber-500/15 text-amber-400 border-amber-500/20 ml-1" variant="outline">{(m.activeStrikeCount ?? 0)}</Badge>
                            )}
                          </div>
                        </div>
                      </TableCell>
                      <TableCell className="text-xs text-zinc-600 font-mono tabular-nums hidden sm:table-cell">{m.discordId}</TableCell>
                      <TableCell>
                        {m.role === 'admin' ? (
                          <span
                            className="text-[11px] px-2 py-0.5 rounded-md font-medium border"
                            style={{
                              backgroundColor: `${brandColor}10`,
                              borderColor: `${brandColor}25`,
                              color: brandColor,
                            }}
                          >
                            Admin
                          </span>
                        ) : (
                          <span className="text-[11px] px-2 py-0.5 rounded-md font-medium border border-white/[0.06] bg-white/[0.03] text-zinc-500">
                            Member
                          </span>
                        )}
                      </TableCell>
                      <TableCell className="hidden md:table-cell">
                        {m.rank ? (
                          <Badge variant="outline" className="text-[11px]" style={{ borderColor: `${brandColor}30`, color: brandColor }}>{m.rank}</Badge>
                        ) : (
                          <span className="text-xs text-zinc-700">—</span>
                        )}
                      </TableCell>
                      <TableCell className="text-sm text-zinc-400 text-right tabular-nums hidden sm:table-cell">{m.entryCount}</TableCell>
                      <TableCell className="hidden lg:table-cell">
                        <div className="flex items-center gap-1.5">
                          {isInactive && (
                            <Badge variant="outline" className="text-[10px] border-amber-500/20 text-amber-400 bg-amber-500/5">
                              <Clock className="h-2.5 w-2.5 mr-0.5" />
                              {m.daysInactive}d
                            </Badge>
                          )}
                          {(m.activeStrikeCount ?? 0) > 0 && (
                            <Badge variant="outline" className="text-[10px] border-red-500/20 text-red-400 bg-red-500/5">
                              <AlertTriangle className="h-2.5 w-2.5 mr-0.5" />
                              {(m.activeStrikeCount ?? 0)}
                            </Badge>
                          )}
                          {!isInactive && (m.activeStrikeCount ?? 0) === 0 && m.daysInactive !== null && m.daysInactive === 0 && (
                            <span className="text-[10px] text-emerald-500">active today</span>
                          )}
                        </div>
                      </TableCell>
                      <TableCell className="text-xs text-zinc-600 tabular-nums hidden lg:table-cell">
                        {new Date(m.joinedAt).toLocaleDateString()}
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center gap-0.5">
                          <Button variant="ghost" size="icon" className="h-7 w-7 text-zinc-500 hover:text-zinc-200" onClick={() => handleOpenProfile(m.userId)} title="View Profile">
                            <Eye className="h-3 w-3" />
                          </Button>
                          <Button variant="ghost" size="icon" className="h-7 w-7 text-zinc-500 hover:text-zinc-200" onClick={() => {
                            setRoleTarget({ userId: m.userId, currentRole: m.role, username: m.username });
                            // Start on the role they hold, so the highlighted
                            // button always says what is true right now.
                            setNewRole(m.role === 'admin' ? 'admin' : 'member');
                            setRoleDialogOpen(true);
                          }} title="Change Role">
                            <Pencil className="h-3 w-3" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-7 w-7 text-zinc-500 hover:text-zinc-200 disabled:opacity-30"
                            disabled={sortedRanks.length === 0}
                            title={sortedRanks.length === 0 ? 'No ranks defined — add them in Settings' : 'Change Rank'}
                            onClick={() => {
                              setRankTarget({ userId: m.userId, username: m.username, currentRank: m.rank ?? null });
                              setNewRank(m.rank ?? '');
                              setRankDialogOpen(true);
                            }}
                          >
                            <ChevronsUp className="h-3 w-3" />
                          </Button>
                          <Button variant="ghost" size="icon" className="h-7 w-7 text-zinc-500 hover:text-red-400" onClick={() => setRemoveTarget({ userId: m.userId, username: m.username })} title="Remove">
                            <UserMinus className="h-3 w-3" />
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

                      {/* Add Member Dialog */}
      <Dialog open={addOpen} onOpenChange={(o) => { setAddOpen(o); if (!o) { setSearchQuery(''); setSearchResults([]); setSelectedUser(null); setDiscordId(''); } }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Add Member</DialogTitle>
            <DialogDescription>Search for a user by Discord username or ID, or paste a Discord ID manually below.</DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            {/* Search input + dropdown */}
            <div className="space-y-2">
              <Label>Search users</Label>
              <div className="relative">
                <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-zinc-600" />
                <Input
                  placeholder="Type at least 2 characters..."
                  value={searchQuery}
                  onChange={(e) => handleSearch(e.target.value)}
                  className="pl-9"
                  disabled={!!selectedUser}
                />
                {searchQuery && !selectedUser && (
                  <button
                    type="button"
                    onClick={() => { setSearchQuery(''); setSearchResults([]); }}
                    className="absolute right-2 top-1/2 -translate-y-1/2 text-zinc-500 hover:text-zinc-300"
                    aria-label="Clear search"
                  >
                    <X className="h-3.5 w-3.5" />
                  </button>
                )}
              </div>
              {/* Selected user chip */}
              {selectedUser ? (
                <div className="flex items-center justify-between gap-2 rounded-md border border-white/[0.08] p-2.5">
                  <div className="flex items-center gap-2.5 min-w-0">
                    <Avatar className="h-7 w-7">
                      <AvatarImage src={selectedUser.avatarUrl ?? undefined} />
                      <AvatarFallback className="text-[10px]">{selectedUser.username.slice(0, 2).toUpperCase()}</AvatarFallback>
                    </Avatar>
                    <div className="min-w-0">
                      <p className="text-sm text-zinc-200 truncate">{selectedUser.username}</p>
                      <p className="text-[11px] text-zinc-600 font-mono tabular-nums truncate">{selectedUser.discordId}</p>
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => { setSelectedUser(null); setSearchQuery(''); setSearchResults([]); }}
                    className="text-zinc-500 hover:text-zinc-300 shrink-0"
                    aria-label="Clear selection"
                  >
                    <X className="h-4 w-4" />
                  </button>
                </div>
              ) : (
                searchResults.length > 0 && (
                  <div className="max-h-56 overflow-y-auto rounded-md border border-white/[0.08]">
                    {searchResults.map((u) => (
                      <button
                        key={u.id}
                        type="button"
                        onClick={() => { setSelectedUser(u); setSearchQuery(''); setSearchResults([]); }}
                        className="w-full flex items-center gap-2.5 px-3 py-2 text-left hover:bg-white/[0.04] transition-colors"
                      >
                        <Avatar className="h-6 w-6">
                          <AvatarImage src={u.avatarUrl ?? undefined} />
                          <AvatarFallback className="text-[10px]">{u.username.slice(0, 2).toUpperCase()}</AvatarFallback>
                        </Avatar>
                        <div className="min-w-0">
                          <p className="text-sm text-zinc-200 truncate">{u.username}</p>
                          <p className="text-[11px] text-zinc-600 font-mono tabular-nums truncate">{u.discordId}</p>
                        </div>
                      </button>
                    ))}
                  </div>
                )
              )}
            </div>

            {/* Manual fallback */}
            <div className="space-y-2">
              <Label>Or enter Discord User ID manually</Label>
              <Input placeholder="e.g. 123456789012345678" value={discordId} onChange={(e) => setDiscordId(e.target.value)} className="font-mono tabular-nums" disabled={!!selectedUser} />
              <p className="text-xs text-zinc-600">Used when the user has logged in but search doesn’t find them.</p>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setAddOpen(false)}>Cancel</Button>
            <Button onClick={() => addMutation.mutate()} disabled={(!selectedUser && !discordId.trim()) || addMutation.isPending}>
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
            <DialogDescription>Update {roleTarget ? displayName(roleTarget) : ''}&apos;s role in this faction.</DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="flex gap-3">
              <Button variant={newRole === 'member' ? 'default' : 'outline'} className="flex-1" onClick={() => setNewRole('member')}>Member</Button>
              <Button variant={newRole === 'admin' ? 'default' : 'outline'} className="flex-1" onClick={() => setNewRole('admin')}>
                <Shield className="mr-1.5 h-4 w-4" /> Admin
              </Button>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setRoleDialogOpen(false)}>Cancel</Button>
            <Button onClick={() => roleMutation.mutate()} disabled={roleMutation.isPending}>{roleMutation.isPending ? 'Saving...' : 'Update Role'}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Rank Change Dialog */}
      <Dialog open={rankDialogOpen} onOpenChange={setRankDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Set Rank</DialogTitle>
            <DialogDescription>Update {rankTarget ? displayName(rankTarget) : ''}&apos;s display rank. This is separate from their admin role.</DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label>Rank</Label>
              <Select value={newRank || '_none'} onValueChange={(v) => setNewRank(v === '_none' ? '' : v)}>
                <SelectTrigger><SelectValue placeholder="No rank" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="_none">No rank (clear)</SelectItem>
                  {sortedRanks.map((r) => (
                    <SelectItem key={r.name} value={r.name}>{r.name} (Level {r.level})</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-xs text-zinc-600">Ranks are display-only. Configure them in Settings &rarr; Faction Settings.</p>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setRankDialogOpen(false)}>Cancel</Button>
            <Button onClick={() => rankMutation.mutate()} disabled={rankMutation.isPending}>{rankMutation.isPending ? 'Saving...' : 'Update Rank'}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Remove Confirmation */}
      <AlertDialog open={!!removeTarget} onOpenChange={(open) => !open && setRemoveTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remove {removeTarget ? displayName(removeTarget) : ''}?</AlertDialogTitle>
            <AlertDialogDescription>This will remove the member from the faction. Their entries will be preserved.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={() => removeMutation.mutate()} disabled={removeMutation.isPending} className="bg-red-500 text-white hover:bg-red-600">
              {removeMutation.isPending ? 'Removing...' : 'Remove'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
