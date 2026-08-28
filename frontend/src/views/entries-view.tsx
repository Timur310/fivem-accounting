'use client';

import { useState, useEffect, useRef } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { entriesApi, itemTypesApi, exportApi, factionsApi } from '@/lib/api-client';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
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
import { Plus, Pencil, Trash2, Search, ChevronLeft, ChevronRight, Download } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { useAppStore } from '@/lib/store';
import type { ItemType } from '@/lib/api-types';

interface Props {
  factionId: string;
  isAdmin: boolean;
  canLogEntries: boolean;
}

export function EntriesView({ factionId, isAdmin, canLogEntries }: Props) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const brandColor = useAppStore((s) => s.brandColor);

  const [page, setPage] = useState(1);
  const [itemTypeIdFilter, setItemTypeIdFilter] = useState<string>('all');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [searchInput, setSearchInput] = useState('');
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      setSearchQuery(searchInput);
      setPage(1);
    }, 350);
    return () => { if (debounceRef.current) clearTimeout(debounceRef.current); };
  }, [searchInput]);

  const { data: factionDetail } = useQuery({
    queryKey: ['faction-detail', factionId],
    queryFn: () => factionsApi.get(factionId),
    staleTime: 30 * 1000,
  });
  const customFields = factionDetail?.customFields ?? [];

  const [createOpen, setCreateOpen] = useState(false);
  const [newItemTypeId, setNewItemTypeId] = useState('');
  const [newAmount, setNewAmount] = useState('');
  const [newDescription, setNewDescription] = useState('');
  const [newDate, setNewDate] = useState(new Date().toISOString().split('T')[0]);
  const [newCustomValues, setNewCustomValues] = useState<Record<string, string>>({});

  const [editOpen, setEditOpen] = useState(false);
  const [editEntryId, setEditEntryId] = useState<string | null>(null);
  const [editAmount, setEditAmount] = useState('');
  const [editDescription, setEditDescription] = useState('');
  const [editDate, setEditDate] = useState('');
  const [editCustomValues, setEditCustomValues] = useState<Record<string, string>>({});

  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleteEntryId, setDeleteEntryId] = useState<string | null>(null);

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
    staleTime: 0,
  });

  const { data: itemTypes = [] } = useQuery({
    queryKey: ['itemTypes', factionId],
    queryFn: () => itemTypesApi.list(factionId),
    staleTime: 5 * 60 * 1000,
  });

  const activeItemTypes = itemTypes.filter((t: ItemType) => t.isActive);

  const createMutation = useMutation({
    mutationFn: () =>
      entriesApi.create(factionId, {
        itemTypeId: newItemTypeId,
        amount: newAmount,
        description: newDescription || undefined,
        entryDate: newDate || undefined,
        customValues: Object.keys(newCustomValues).length > 0 ? newCustomValues : undefined,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['entries', factionId] });
      queryClient.invalidateQueries({ queryKey: ['dashboard', factionId] });
      queryClient.invalidateQueries({ queryKey: ['quotas', factionId] });
      queryClient.invalidateQueries({ queryKey: ['charts', factionId] });
      setCreateOpen(false);
      resetCreateForm();
      toast({ title: 'Entry logged successfully' });
    },
    onError: (err: any) => {
      toast({ title: 'Failed to log entry', description: err.response?.data?.error?.message || 'Unknown error', variant: 'destructive' });
    },
  });

  const updateMutation = useMutation({
    mutationFn: () =>
      entriesApi.update(factionId, editEntryId!, {
        amount: editAmount,
        description: editDescription || null,
        entryDate: editDate || undefined,
        customValues: editCustomValues,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['entries', factionId] });
      queryClient.invalidateQueries({ queryKey: ['dashboard', factionId] });
      queryClient.invalidateQueries({ queryKey: ['quotas', factionId] });
      queryClient.invalidateQueries({ queryKey: ['charts', factionId] });
      setEditOpen(false);
      toast({ title: 'Entry updated' });
    },
    onError: (err: any) => {
      toast({ title: 'Update failed', description: err.response?.data?.error?.message || 'Unknown error', variant: 'destructive' });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: () => entriesApi.remove(factionId, deleteEntryId!),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['entries', factionId] });
      queryClient.invalidateQueries({ queryKey: ['dashboard', factionId] });
      queryClient.invalidateQueries({ queryKey: ['quotas', factionId] });
      queryClient.invalidateQueries({ queryKey: ['charts', factionId] });
      setDeleteOpen(false);
      toast({ title: 'Entry deleted' });
    },
    onError: (err: any) => {
      toast({ title: 'Delete failed', description: err.response?.data?.error?.message || 'Unknown error', variant: 'destructive' });
    },
  });

  const resetCreateForm = () => {
    setNewItemTypeId('');
    setNewAmount('');
    setNewDescription('');
    setNewDate(new Date().toISOString().split('T')[0]);
    setNewCustomValues({});
  };

  const openEditDialog = (entry: any) => {
    setEditEntryId(entry.id);
    setEditAmount(entry.amount);
    setEditDescription(entry.description || '');
    setEditDate(entry.entryDate);
    setEditCustomValues(entry.customValues ?? {});
    setEditOpen(true);
  };

  const entries = entriesData?.data ?? [];
  const meta = entriesData?.meta;
  const totalPages = meta ? Math.ceil(meta.total_count / meta.page_size) : 1;

  return (
    <div className="space-y-4">
      {/* Filters + CTA */}
      <Card>
        <CardContent className="p-4">
          <div className="flex flex-col sm:flex-row gap-3 items-start sm:items-end">
            <div className="flex flex-col gap-1.5 flex-1 min-w-[200px]">
              <Label className="text-xs text-zinc-500">Search</Label>
              <div className="relative">
                <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-zinc-600" />
                <Input placeholder="Search descriptions..." value={searchInput} onChange={(e) => setSearchInput(e.target.value)} className="pl-9" />
              </div>
            </div>
            <div className="flex flex-col gap-1.5">
              <Label className="text-xs text-zinc-500">Item Type</Label>
              <Select value={itemTypeIdFilter} onValueChange={(v) => { setItemTypeIdFilter(v); setPage(1); }}>
                <SelectTrigger className="w-[160px]"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Types</SelectItem>
                  {activeItemTypes.map((t: ItemType) => (<SelectItem key={t.id} value={t.id}>{t.name}</SelectItem>))}
                </SelectContent>
              </Select>
            </div>
            <div className="flex flex-col gap-1.5">
              <Label className="text-xs text-zinc-500">From</Label>
              <Input type="date" value={dateFrom} onChange={(e) => { setDateFrom(e.target.value); setPage(1); }} className="w-[150px]" />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label className="text-xs text-zinc-500">To</Label>
              <Input type="date" value={dateTo} onChange={(e) => { setDateTo(e.target.value); setPage(1); }} className="w-[150px]" />
            </div>
            <div className="flex-1" />
            <Button variant="outline" size="sm" onClick={() => {
              const url = exportApi.entriesUrl(factionId, { date_from: dateFrom || undefined, date_to: dateTo || undefined, item_type_id: itemTypeIdFilter === 'all' ? undefined : itemTypeIdFilter });
              window.open(url, '_blank');
            }}>
              <Download className="mr-1.5 h-3.5 w-3.5" />CSV
            </Button>
            {canLogEntries && (
              <Button onClick={() => setCreateOpen(true)}>
                <Plus className="mr-1.5 h-3.5 w-3.5" />
                Log Entry
              </Button>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Table */}
      <Card className="py-0 gap-0">
        <CardContent className="p-0">
          {isLoading ? (
            <div className="p-6 space-y-3">{[...Array(5)].map((_, i) => (<Skeleton key={i} className="h-12 w-full" />))}</div>
          ) : entries.length === 0 ? (
            <div className="p-12 text-center text-zinc-600">
              <Search className="h-8 w-8 mx-auto mb-2 opacity-30" />
              <p className="text-sm">No entries found.</p>
            </div>
          ) : (
            <>
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Member</TableHead>
                      <TableHead>Type</TableHead>
                      <TableHead className="text-right">Amount</TableHead>
                      <TableHead>Description</TableHead>
                      {customFields.length > 0 && <TableHead>Custom</TableHead>}
                      <TableHead>Date</TableHead>
                      {isAdmin && <TableHead className="w-[80px]"></TableHead>}
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {entries.map((entry) => (
                      <TableRow key={entry.id}>
                        <TableCell>
                          <div className="flex items-center gap-2">
                            <Avatar className="h-6 w-6">
                              <AvatarImage src={entry.avatarUrl ?? undefined} />
                              <AvatarFallback className="text-[9px]">{entry.username.slice(0, 2).toUpperCase()}</AvatarFallback>
                            </Avatar>
                            <span className="text-sm text-zinc-300">{entry.username}</span>
                          </div>
                        </TableCell>
                        <TableCell>
                          <span className="text-xs bg-white/[0.04] border border-white/[0.06] px-2 py-0.5 rounded-md text-zinc-400">
                            {entry.itemTypeName}
                          </span>
                        </TableCell>
                        <TableCell className="text-right font-mono text-sm text-zinc-200 tabular-nums">
                          {entry.itemUnit}{Number(entry.amount).toLocaleString('en-US', { minimumFractionDigits: 2 })}
                        </TableCell>
                        <TableCell className="max-w-[200px] truncate text-zinc-500 text-sm">
                          {entry.description || '—'}
                        </TableCell>
                        {customFields.length > 0 && (
                          <TableCell className="max-w-[180px]">
                            {entry.customValues && Object.keys(entry.customValues).length > 0 ? (
                              <div className="flex flex-wrap gap-1">
                                {Object.entries(entry.customValues).map(([k, v]) => (
                                  <span key={k} className="text-[11px] bg-white/[0.04] border border-white/[0.06] px-1.5 py-0.5 rounded text-zinc-400" title={`${k}: ${v}`}>
                                    {v.length > 15 ? v.slice(0, 15) + '...' : v}
                                  </span>
                                ))}
                              </div>
                            ) : (<span className="text-zinc-600 text-xs">—</span>)}
                          </TableCell>
                        )}
                        <TableCell className="text-sm text-zinc-500 tabular-nums">{entry.entryDate}</TableCell>
                        {isAdmin && (
                          <TableCell>
                            <div className="flex items-center gap-0.5">
                              <Button variant="ghost" size="icon" className="h-7 w-7 text-zinc-500 hover:text-zinc-200" onClick={() => openEditDialog(entry)}>
                                <Pencil className="h-3 w-3" />
                              </Button>
                              <Button variant="ghost" size="icon" className="h-7 w-7 text-zinc-500 hover:text-red-400" onClick={() => { setDeleteEntryId(entry.id); setDeleteOpen(true); }}>
                                <Trash2 className="h-3 w-3" />
                              </Button>
                            </div>
                          </TableCell>
                        )}
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>

              {meta && totalPages > 1 && (
                <div className="flex items-center justify-between px-4 py-3 border-t border-white/[0.06]">
                  <p className="text-xs text-zinc-500 tabular-nums">
                    Page {meta.page} of {totalPages} ({meta.total_count} total)
                  </p>
                  <div className="flex items-center gap-1.5">
                    <Button variant="ghost" size="sm" className="h-7" disabled={page <= 1} onClick={() => setPage(page - 1)}>
                      <ChevronLeft className="h-3.5 w-3.5" />
                    </Button>
                    <Button variant="ghost" size="sm" className="h-7" disabled={page >= totalPages} onClick={() => setPage(page + 1)}>
                      <ChevronRight className="h-3.5 w-3.5" />
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
            <DialogTitle>Log New Entry</DialogTitle>
            <DialogDescription>Record a contribution to the faction.</DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label>Item Type</Label>
              <Select value={newItemTypeId} onValueChange={setNewItemTypeId}>
                <SelectTrigger className="w-full"><SelectValue placeholder="Select item type" /></SelectTrigger>
                <SelectContent>
                  {activeItemTypes.map((t: ItemType) => (<SelectItem key={t.id} value={t.id}>{t.name} ({t.unit})</SelectItem>))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Amount</Label>
              <Input type="number" step="0.01" min="0.01" placeholder="0.00" value={newAmount} onChange={(e) => setNewAmount(e.target.value)} className="tabular-nums" />
            </div>
            <div className="space-y-2">
              <Label>Date</Label>
              <Input type="date" value={newDate} max={new Date().toISOString().split('T')[0]} onChange={(e) => setNewDate(e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label>Description (optional)</Label>
              <Textarea placeholder="Optional note..." value={newDescription} onChange={(e) => setNewDescription(e.target.value)} rows={2} />
            </div>
            {customFields.length > 0 && (
              <div className="space-y-3">
                <Label className="text-sm">Custom Fields</Label>
                {customFields.map((field) => (
                  <div key={field.name} className="space-y-1">
                    <Label className="text-xs text-zinc-500">
                      {field.name}{field.required && <span className="text-red-400 ml-1">*</span>}
                    </Label>
                    <Input placeholder={field.required ? 'Required' : 'Optional'} value={newCustomValues[field.name] ?? ''} onChange={(e) => setNewCustomValues((prev) => ({ ...prev, [field.name]: e.target.value }))} maxLength={500} />
                  </div>
                ))}
              </div>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCreateOpen(false)}>Cancel</Button>
            <Button onClick={() => createMutation.mutate()} disabled={!newItemTypeId || !newAmount || Number(newAmount) <= 0 || createMutation.isPending || customFields.some((f) => f.required && !(newCustomValues[f.name] ?? '').trim())}>
              {createMutation.isPending ? 'Logging...' : 'Log Entry'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Edit Dialog */}
      <Dialog open={editOpen} onOpenChange={setEditOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Edit Entry</DialogTitle>
            <DialogDescription>Modify entry details.</DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label>Amount</Label>
              <Input type="number" step="0.01" min="0.01" value={editAmount} onChange={(e) => setEditAmount(e.target.value)} className="tabular-nums" />
            </div>
            <div className="space-y-2">
              <Label>Date</Label>
              <Input type="date" value={editDate} max={new Date().toISOString().split('T')[0]} onChange={(e) => setEditDate(e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label>Description</Label>
              <Textarea value={editDescription} onChange={(e) => setEditDescription(e.target.value)} rows={2} />
            </div>
            {customFields.length > 0 && (
              <div className="space-y-3">
                <Label className="text-sm">Custom Fields</Label>
                {customFields.map((field) => (
                  <div key={field.name} className="space-y-1">
                    <Label className="text-xs text-zinc-500">{field.name}{field.required && <span className="text-red-400 ml-1">*</span>}</Label>
                    <Input value={editCustomValues[field.name] ?? ''} onChange={(e) => setEditCustomValues((prev) => ({ ...prev, [field.name]: e.target.value }))} maxLength={500} />
                  </div>
                ))}
              </div>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditOpen(false)}>Cancel</Button>
            <Button onClick={() => updateMutation.mutate()} disabled={!editAmount || Number(editAmount) <= 0 || updateMutation.isPending}>
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
            <AlertDialogDescription>This action will soft-delete this entry. It can be restored from the database if needed.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={() => deleteMutation.mutate()} disabled={deleteMutation.isPending} className="bg-red-500 text-white hover:bg-red-600">
              {deleteMutation.isPending ? 'Deleting...' : 'Delete'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
