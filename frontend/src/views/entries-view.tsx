'use client';

import { useState, useCallback, useEffect, useRef } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { entriesApi, itemTypesApi, exportApi } from '@/lib/api-client';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Plus, Pencil, Trash2, Search, ChevronLeft, ChevronRight, Download } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import type { ItemType } from '@/lib/api-types';

interface Props {
  factionId: string;
  isAdmin: boolean;
  canLogEntries: boolean;
}

export function EntriesView({ factionId, isAdmin, canLogEntries }: Props) {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  // Filters
  const [page, setPage] = useState(1);
  const [itemTypeIdFilter, setItemTypeIdFilter] = useState<string>('all');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [searchInput, setSearchInput] = useState('');
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Debounce search input → searchQuery
  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      setSearchQuery(searchInput);
      setPage(1);
    }, 350);
    return () => { if (debounceRef.current) clearTimeout(debounceRef.current); };
  }, [searchInput]);

  // Create dialog
  const [createOpen, setCreateOpen] = useState(false);
  const [newItemTypeId, setNewItemTypeId] = useState('');
  const [newAmount, setNewAmount] = useState('');
  const [newDescription, setNewDescription] = useState('');
  const [newDate, setNewDate] = useState(new Date().toISOString().split('T')[0]);

  // Edit dialog
  const [editOpen, setEditOpen] = useState(false);
  const [editEntryId, setEditEntryId] = useState<string | null>(null);
  const [editAmount, setEditAmount] = useState('');
  const [editDescription, setEditDescription] = useState('');
  const [editDate, setEditDate] = useState('');

  // Delete dialog
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleteEntryId, setDeleteEntryId] = useState<string | null>(null);

  // Fetch entries
  const { data: entriesData, isLoading } = useQuery({
    queryKey: ['entries', factionId, page, itemTypeIdFilter, dateFrom, dateTo, searchQuery],
    queryFn: () =>
      entriesApi.list(factionId, {
        page,
        page_size: 20,
        item_type_id: itemTypeIdFilter === 'all' ? undefined : itemTypeIdFilter,
        date_from: dateFrom || undefined,
        date_to: dateTo || undefined,
        search: searchQuery || undefined,
      }),
    staleTime: 30 * 1000,
  });

  // Fetch item types for filter + form
  const { data: itemTypes = [] } = useQuery({
    queryKey: ['itemTypes', factionId],
    queryFn: () => itemTypesApi.list(factionId),
    staleTime: 5 * 60 * 1000,
  });

  const activeItemTypes = itemTypes.filter((t: ItemType) => t.isActive);

  // Create mutation
  const createMutation = useMutation({
    mutationFn: () =>
      entriesApi.create(factionId, {
        itemTypeId: newItemTypeId,
        amount: newAmount,
        description: newDescription || undefined,
        entryDate: newDate || undefined,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['entries', factionId] });
      queryClient.invalidateQueries({ queryKey: ['dashboard', factionId] });
      setCreateOpen(false);
      resetCreateForm();
      toast({ title: 'Entry logged successfully' });
    },
    onError: (err: any) => {
      toast({
        title: 'Failed to log entry',
        description: err.response?.data?.error?.message || 'Unknown error',
        variant: 'destructive',
      });
    },
  });

  // Update mutation
  const updateMutation = useMutation({
    mutationFn: () =>
      entriesApi.update(factionId, editEntryId!, {
        amount: editAmount,
        description: editDescription || null,
        entryDate: editDate || undefined,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['entries', factionId] });
      queryClient.invalidateQueries({ queryKey: ['dashboard', factionId] });
      setEditOpen(false);
      toast({ title: 'Entry updated' });
    },
    onError: (err: any) => {
      toast({
        title: 'Update failed',
        description: err.response?.data?.error?.message || 'Unknown error',
        variant: 'destructive',
      });
    },
  });

  // Delete mutation
  const deleteMutation = useMutation({
    mutationFn: () => entriesApi.remove(factionId, deleteEntryId!),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['entries', factionId] });
      queryClient.invalidateQueries({ queryKey: ['dashboard', factionId] });
      setDeleteOpen(false);
      toast({ title: 'Entry deleted' });
    },
    onError: (err: any) => {
      toast({
        title: 'Delete failed',
        description: err.response?.data?.error?.message || 'Unknown error',
        variant: 'destructive',
      });
    },
  });

  const resetCreateForm = () => {
    setNewItemTypeId('');
    setNewAmount('');
    setNewDescription('');
    setNewDate(new Date().toISOString().split('T')[0]);
  };

  const openEditDialog = (entry: any) => {
    setEditEntryId(entry.id);
    setEditAmount(entry.amount);
    setEditDescription(entry.description || '');
    setEditDate(entry.entryDate);
    setEditOpen(true);
  };

  const openDeleteDialog = (entryId: string) => {
    setDeleteEntryId(entryId);
    setDeleteOpen(true);
  };

  const entries = entriesData?.data ?? [];
  const meta = entriesData?.meta;
  const totalPages = meta ? Math.ceil(meta.total_count / meta.page_size) : 1;

  return (
    <div className="space-y-4">
      {/* Header with filters and create button */}
      <Card>
        <CardContent className="p-4">
          <div className="flex flex-col sm:flex-row gap-3 items-start sm:items-end">
            <div className="flex flex-col gap-1.5 flex-1 min-w-[200px]">
              <Label className="text-xs">Search</Label>
              <div className="relative">
                <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input
                  placeholder="Search descriptions..."
                  value={searchInput}
                  onChange={(e) => setSearchInput(e.target.value)}
                  className="pl-9"
                />
              </div>
            </div>
            <div className="flex flex-col gap-1.5">
              <Label className="text-xs">Item Type</Label>
              <Select value={itemTypeIdFilter} onValueChange={(v) => { setItemTypeIdFilter(v); setPage(1); }}>
                <SelectTrigger className="w-[160px]">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Types</SelectItem>
                  {activeItemTypes.map((t: ItemType) => (
                    <SelectItem key={t.id} value={t.id}>{t.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="flex flex-col gap-1.5">
              <Label className="text-xs">From</Label>
              <Input
                type="date"
                value={dateFrom}
                onChange={(e) => { setDateFrom(e.target.value); setPage(1); }}
                className="w-[150px]"
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label className="text-xs">To</Label>
              <Input
                type="date"
                value={dateTo}
                onChange={(e) => { setDateTo(e.target.value); setPage(1); }}
                className="w-[150px]"
              />
            </div>
            <div className="flex-1" />
            <Button
              variant="outline"
              onClick={() => {
                const url = exportApi.entriesUrl(factionId, {
                  date_from: dateFrom || undefined,
                  date_to: dateTo || undefined,
                  item_type_id: itemTypeIdFilter === 'all' ? undefined : itemTypeIdFilter,
                });
                window.open(url, '_blank');
              }}
            >
              <Download className="mr-2 h-4 w-4" />
              CSV
            </Button>
            {canLogEntries && (
              <Button onClick={() => setCreateOpen(true)}>
                <Plus className="mr-2 h-4 w-4" />
                Log Entry
              </Button>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Entries Table */}
      <Card>
        <CardContent className="p-0">
          {isLoading ? (
            <div className="p-6 space-y-3">
              {[...Array(5)].map((_, i) => (
                <Skeleton key={i} className="h-12 w-full" />
              ))}
            </div>
          ) : entries.length === 0 ? (
            <div className="p-12 text-center text-muted-foreground">
              <Search className="h-8 w-8 mx-auto mb-2 opacity-50" />
              <p>No entries found.</p>
            </div>
          ) : (
            <>
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Member</TableHead>
                      <TableHead>Item Type</TableHead>
                      <TableHead className="text-right">Amount</TableHead>
                      <TableHead>Description</TableHead>
                      <TableHead>Date</TableHead>
                      {isAdmin && <TableHead className="w-[100px]">Actions</TableHead>}
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {entries.map((entry) => (
                      <TableRow key={entry.id}>
                        <TableCell>
                          <div className="flex items-center gap-2">
                            <Avatar className="h-7 w-7">
                              <AvatarImage src={entry.avatarUrl ?? undefined} />
                              <AvatarFallback>{entry.username.slice(0, 2).toUpperCase()}</AvatarFallback>
                            </Avatar>
                            <span className="text-sm font-medium">{entry.username}</span>
                          </div>
                        </TableCell>
                        <TableCell>
                          <Badge variant="secondary" className="text-xs">
                            {entry.itemTypeName}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-right font-mono font-medium">
                          {entry.itemUnit}{Number(entry.amount).toLocaleString('en-US', { minimumFractionDigits: 2 })}
                        </TableCell>
                        <TableCell className="max-w-[200px] truncate text-muted-foreground text-sm">
                          {entry.description || '—'}
                        </TableCell>
                        <TableCell className="text-sm text-muted-foreground">{entry.entryDate}</TableCell>
                        {isAdmin && (
                          <TableCell>
                            <div className="flex items-center gap-1">
                              <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => openEditDialog(entry)}>
                                <Pencil className="h-3.5 w-3.5" />
                              </Button>
                              <Button variant="ghost" size="icon" className="h-8 w-8 text-destructive" onClick={() => openDeleteDialog(entry.id)}>
                                <Trash2 className="h-3.5 w-3.5" />
                              </Button>
                            </div>
                          </TableCell>
                        )}
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>

              {/* Pagination */}
              {meta && totalPages > 1 && (
                <div className="flex items-center justify-between px-4 py-3 border-t">
                  <p className="text-sm text-muted-foreground">
                    Page {meta.page} of {totalPages} ({meta.total_count} total)
                  </p>
                  <div className="flex items-center gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={page <= 1}
                      onClick={() => setPage(page - 1)}
                    >
                      <ChevronLeft className="h-4 w-4" />
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={page >= totalPages}
                      onClick={() => setPage(page + 1)}
                    >
                      <ChevronRight className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
              )}
            </>
          )}
        </CardContent>
      </Card>

      {/* Create Entry Dialog */}
      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Log New Entry</DialogTitle>
            <DialogDescription>Record a contribution to the faction.</DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label>Item Type</Label>
              <Select value={newItemTypeId} onValueChange={setNewItemTypeId}>
                <SelectTrigger><SelectValue placeholder="Select item type" /></SelectTrigger>
                <SelectContent>
                  {activeItemTypes.map((t: ItemType) => (
                    <SelectItem key={t.id} value={t.id}>{t.name} ({t.unit})</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Amount</Label>
              <Input
                type="number"
                step="0.01"
                min="0.01"
                placeholder="0.00"
                value={newAmount}
                onChange={(e) => setNewAmount(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label>Date</Label>
              <Input
                type="date"
                value={newDate}
                max={new Date().toISOString().split('T')[0]}
                onChange={(e) => setNewDate(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label>Description (optional)</Label>
              <Textarea
                placeholder="Optional note..."
                value={newDescription}
                onChange={(e) => setNewDescription(e.target.value)}
                rows={2}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCreateOpen(false)}>Cancel</Button>
            <Button
              onClick={() => createMutation.mutate()}
              disabled={!newItemTypeId || !newAmount || Number(newAmount) <= 0 || createMutation.isPending}
            >
              {createMutation.isPending ? 'Logging...' : 'Log Entry'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Edit Entry Dialog */}
      <Dialog open={editOpen} onOpenChange={setEditOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Edit Entry</DialogTitle>
            <DialogDescription>Modify entry details.</DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label>Amount</Label>
              <Input
                type="number"
                step="0.01"
                min="0.01"
                value={editAmount}
                onChange={(e) => setEditAmount(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label>Date</Label>
              <Input
                type="date"
                value={editDate}
                max={new Date().toISOString().split('T')[0]}
                onChange={(e) => setEditDate(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label>Description</Label>
              <Textarea
                value={editDescription}
                onChange={(e) => setEditDescription(e.target.value)}
                rows={2}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditOpen(false)}>Cancel</Button>
            <Button
              onClick={() => updateMutation.mutate()}
              disabled={!editAmount || Number(editAmount) <= 0 || updateMutation.isPending}
            >
              {updateMutation.isPending ? 'Saving...' : 'Save Changes'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete Confirmation */}
      <AlertDialog open={deleteOpen} onOpenChange={setDeleteOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Entry</AlertDialogTitle>
            <AlertDialogDescription>
              This action will soft-delete this entry. It can be restored from the database if needed.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => deleteMutation.mutate()}
              disabled={deleteMutation.isPending}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {deleteMutation.isPending ? 'Deleting...' : 'Delete'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
