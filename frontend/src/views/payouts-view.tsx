'use client';

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  payoutsApi,
  membersApi,
  itemTypesApi,
} from '@/lib/api-client';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
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
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { Label } from '@/components/ui/label';
import {
  Plus, ArrowDownToLine, Pencil, Trash2, Check, X, Split, Filter,
} from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { useAppStore } from '@/lib/store';
import type { Payout, PayoutStatus, Member, ItemType } from '@/lib/api-types';

// ── Status config ──
const STATUS_CONFIG: Record<PayoutStatus, { label: string; color: string; bg: string }> = {
  pending:  { label: 'Pending',  color: 'text-amber-400',  bg: 'bg-amber-500/10 border-amber-500/20' },
  approved: { label: 'Approved', color: 'text-blue-400',   bg: 'bg-blue-500/10 border-blue-500/20' },
  rejected: { label: 'Rejected', color: 'text-red-400',    bg: 'bg-red-500/10 border-red-500/20' },
  completed: { label: 'Completed', color: 'text-emerald-400', bg: 'bg-emerald-500/10 border-emerald-500/20' },
};

// Allowed status transitions (mirrors backend)
const ALLOWED_TRANSITIONS: Record<PayoutStatus, PayoutStatus[]> = {
  pending: ['approved', 'rejected', 'completed'],
  approved: ['completed', 'rejected'],
  rejected: [],
  completed: [],
};

const TERMINAL_STATUSES: PayoutStatus[] = ['completed', 'rejected'];

interface Props {
  factionId: string;
}

export function PayoutsView({ factionId }: Props) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const user = useAppStore((s) => s.user);
  const brandColor = useAppStore((s) => s.brandColor);

  // ── Filters ──
  const [filterStatus, setFilterStatus] = useState<string>('');
  const [filterItemTypeId, setFilterItemTypeId] = useState<string>('');
  const [filterDateFrom, setFilterDateFrom] = useState('');
  const [filterDateTo, setFilterDateTo] = useState('');
  const [page, setPage] = useState(1);

  // ── Dialogs ──
  const [createOpen, setCreateOpen] = useState(false);
  const [editPayout, setEditPayout] = useState<Payout | null>(null);
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [evenSplitOpen, setEvenSplitOpen] = useState(false);

  // ── Create form ──
  const [formRecipient, setFormRecipient] = useState('');
  const [formItemType, setFormItemType] = useState('');
  const [formAmount, setFormAmount] = useState('');
  const [formDescription, setFormDescription] = useState('');
  const [formDate, setFormDate] = useState(new Date().toISOString().slice(0, 10));

  // ── Edit form ──
  const [editAmount, setEditAmount] = useState('');
  const [editDescription, setEditDescription] = useState('');
  const [editDate, setEditDate] = useState('');

  // ── Even split form ──
  const [splitItemType, setSplitItemType] = useState('');
  const [splitTotal, setSplitTotal] = useState('');
  const [splitDescription, setSplitDescription] = useState('');
  const [splitDate, setSplitDate] = useState(new Date().toISOString().slice(0, 10));

  // ── Data ──
  const { data: payoutsData, isLoading } = useQuery({
    queryKey: ['payouts', factionId, filterStatus, filterItemTypeId, filterDateFrom, filterDateTo, page],
    queryFn: () => payoutsApi.list(factionId, {
      status: filterStatus || undefined,
      item_type_id: filterItemTypeId || undefined,
      date_from: filterDateFrom || undefined,
      date_to: filterDateTo || undefined,
      page,
      page_size: 20,
    }),
    staleTime: 0,
  });

  const { data: members = [] } = useQuery({
    queryKey: ['members', factionId],
    queryFn: () => membersApi.list(factionId),
    staleTime: 30 * 1000,
  });

  const { data: itemTypes = [] } = useQuery({
    queryKey: ['item-types', factionId],
    queryFn: () => itemTypesApi.list(factionId),
    staleTime: 30 * 1000,
  });

  const payouts = payoutsData?.data ?? [];
  const meta = payoutsData?.meta;
  const totalPages = meta ? Math.ceil(meta.total_count / meta.page_size) : 1;

  const fmt = (n: number) => n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

  const resetCreateForm = () => {
    setFormRecipient('');
    setFormItemType('');
    setFormAmount('');
    setFormDescription('');
    setFormDate(new Date().toISOString().slice(0, 10));
  };

  // ── Mutations ──
  const createMutation = useMutation({
    mutationFn: () => payoutsApi.create(factionId, {
      recipientUserId: formRecipient,
      itemTypeId: formItemType,
      amount: formAmount,
      description: formDescription || undefined,
      payoutDate: formDate || undefined,
    }),
    onSuccess: () => {
      toast({ title: 'Payout created' });
      setCreateOpen(false);
      resetCreateForm();
      queryClient.invalidateQueries({ queryKey: ['payouts', factionId] });
      queryClient.invalidateQueries({ queryKey: ['dashboard', factionId] });
      queryClient.invalidateQueries({ queryKey: ['treasury', factionId] });
    },
    onError: (err: any) => {
      toast({ title: 'Create failed', description: err.response?.data?.error?.message || 'Unknown error', variant: 'destructive' });
    },
  });

  const updateMutation = useMutation({
    mutationFn: ({ payoutId, input }: { payoutId: string; input: Record<string, unknown> }) =>
      payoutsApi.update(factionId, payoutId, input as any),
    onSuccess: () => {
      toast({ title: 'Payout updated' });
      setEditPayout(null);
      queryClient.invalidateQueries({ queryKey: ['payouts', factionId] });
      queryClient.invalidateQueries({ queryKey: ['dashboard', factionId] });
      queryClient.invalidateQueries({ queryKey: ['treasury', factionId] });
    },
    onError: (err: any) => {
      toast({ title: 'Update failed', description: err.response?.data?.error?.message || 'Unknown error', variant: 'destructive' });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (payoutId: string) => payoutsApi.remove(factionId, payoutId),
    onSuccess: () => {
      toast({ title: 'Payout deleted' });
      setDeleteId(null);
      queryClient.invalidateQueries({ queryKey: ['payouts', factionId] });
      queryClient.invalidateQueries({ queryKey: ['dashboard', factionId] });
      queryClient.invalidateQueries({ queryKey: ['treasury', factionId] });
    },
    onError: (err: any) => {
      toast({ title: 'Delete failed', description: err.response?.data?.error?.message || 'Unknown error', variant: 'destructive' });
    },
  });

  const evenSplitMutation = useMutation({
    mutationFn: () => payoutsApi.evenSplit(factionId, {
      itemTypeId: splitItemType,
      totalAmount: splitTotal,
      description: splitDescription || undefined,
      payoutDate: splitDate || undefined,
    }),
    onSuccess: (result) => {
      toast({ title: `Even split created: ${result.created} payouts`, description: `${result.perMember.toFixed(2)} per member, ${result.remainder.toFixed(2)} remainder stays in vault` });
      setEvenSplitOpen(false);
      setSplitItemType('');
      setSplitTotal('');
      setSplitDescription('');
      setSplitDate(new Date().toISOString().slice(0, 10));
      queryClient.invalidateQueries({ queryKey: ['payouts', factionId] });
      queryClient.invalidateQueries({ queryKey: ['dashboard', factionId] });
      queryClient.invalidateQueries({ queryKey: ['treasury', factionId] });
    },
    onError: (err: any) => {
      toast({ title: 'Even split failed', description: err.response?.data?.error?.message || 'Unknown error', variant: 'destructive' });
    },
  });

  const handleStatusChange = (payout: Payout, newStatus: PayoutStatus) => {
    updateMutation.mutate({ payoutId: payout.id, input: { status: newStatus } });
  };

  const openEdit = (p: Payout) => {
    setEditPayout(p);
    setEditAmount(p.amount);
    setEditDescription(p.description ?? '');
    setEditDate(p.payoutDate);
  };

  const handleEditSave = () => {
    if (!editPayout) return;
    const updates: Record<string, unknown> = {};
    if (editAmount !== editPayout.amount) updates.amount = editAmount;
    if (editDescription !== (editPayout.description ?? '')) updates.description = editDescription || null;
    if (editDate !== editPayout.payoutDate) updates.payoutDate = editDate;
    if (Object.keys(updates).length === 0) { setEditPayout(null); return; }
    updateMutation.mutate({ payoutId: editPayout.id, input: updates });
  };

  const canTransition = (payout: Payout, targetStatus: PayoutStatus) => {
    if (TERMINAL_STATUSES.includes(payout.status)) return false;
    return ALLOWED_TRANSITIONS[payout.status]?.includes(targetStatus) ?? false;
  };

  // Four-eyes rule: creator cannot approve own payout
  const canApprove = (payout: Payout) => {
    return payout.createdBy !== user?.id && canTransition(payout, 'approved');
  };

  if (isLoading) {
    return <div className="space-y-4"><Skeleton className="h-10 w-full" /><Skeleton className="h-64 w-full" /></div>;
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h2 className="text-xl font-medium tracking-tight text-zinc-100">Payouts</h2>
          <p className="text-zinc-500 text-sm mt-0.5">Manage money going out of the faction treasury</p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={() => setEvenSplitOpen(true)}>
            <Split className="h-4 w-4 mr-1.5" />
            Even Split
          </Button>
          <Button size="sm" onClick={() => setCreateOpen(true)} style={{ backgroundColor: brandColor }}>
            <Plus className="h-4 w-4 mr-1.5" />
            New Payout
          </Button>
        </div>
      </div>

      {/* Filters */}
      <Card>
        <CardContent className="py-3">
          <div className="flex flex-wrap items-center gap-3">
            <Filter className="h-4 w-4 text-zinc-500 shrink-0" />
            <Select value={filterStatus} onValueChange={(v) => { setFilterStatus(v === '_all' ? '' : v); setPage(1); }}>
              <SelectTrigger className="w-[140px] h-8 text-xs"><SelectValue placeholder="All Statuses" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="_all">All Statuses</SelectItem>
                <SelectItem value="pending">Pending</SelectItem>
                <SelectItem value="approved">Approved</SelectItem>
                <SelectItem value="completed">Completed</SelectItem>
                <SelectItem value="rejected">Rejected</SelectItem>
              </SelectContent>
            </Select>
            <Select value={filterItemTypeId} onValueChange={(v) => { setFilterItemTypeId(v === '_all' ? '' : v); setPage(1); }}>
              <SelectTrigger className="w-[150px] h-8 text-xs"><SelectValue placeholder="All Types" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="_all">All Types</SelectItem>
                {itemTypes.map((t) => <SelectItem key={t.id} value={t.id}>{t.name}</SelectItem>)}
              </SelectContent>
            </Select>
            <Input type="date" value={filterDateFrom} onChange={(e) => { setFilterDateFrom(e.target.value); setPage(1); }} className="w-[140px] h-8 text-xs" />
            <Input type="date" value={filterDateTo} onChange={(e) => { setFilterDateTo(e.target.value); setPage(1); }} className="w-[140px] h-8 text-xs" />
            {(filterStatus || filterItemTypeId || filterDateFrom || filterDateTo) && (
              <Button variant="ghost" size="sm" className="h-8 text-xs" onClick={() => { setFilterStatus(''); setFilterItemTypeId(''); setFilterDateFrom(''); setFilterDateTo(''); setPage(1); }}>
                Clear
              </Button>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Table */}
      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow className="border-white/[0.06] hover:bg-transparent">
                <TableHead className="text-zinc-500">Recipient</TableHead>
                <TableHead className="text-zinc-500">Type</TableHead>
                <TableHead className="text-zinc-500 text-right">Amount</TableHead>
                <TableHead className="text-zinc-500">Date</TableHead>
                <TableHead className="text-zinc-500">Status</TableHead>
                <TableHead className="text-zinc-500 text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {payouts.length === 0 ? (
                <TableRow><TableCell colSpan={6} className="text-center text-zinc-600 py-10">No payouts found.</TableCell></TableRow>
              ) : payouts.map((p) => {
                const sc = STATUS_CONFIG[p.status];
                const isTerminal = TERMINAL_STATUSES.includes(p.status);
                return (
                  <TableRow key={p.id} className="border-white/[0.04]">
                    <TableCell>
                      <div className="flex items-center gap-2.5">
                        <Avatar className="h-7 w-7">
                          <AvatarImage src={p.recipientAvatarUrl ?? undefined} />
                          <AvatarFallback className="text-[10px]">{p.recipientUsername.slice(0, 2).toUpperCase()}</AvatarFallback>
                        </Avatar>
                        <span className="text-sm text-zinc-300">{p.recipientUsername}</span>
                      </div>
                    </TableCell>
                    <TableCell className="text-sm text-zinc-400">{p.itemTypeName}</TableCell>
                    <TableCell className="text-sm text-zinc-200 tabular-nums text-right font-medium">
                      {p.itemUnit}{fmt(Number(p.amount))}
                    </TableCell>
                    <TableCell className="text-sm text-zinc-500">{p.payoutDate}</TableCell>
                    <TableCell>
                      <Badge variant="outline" className={`${sc.bg} ${sc.color} border text-[11px]`}>
                        {sc.label}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex items-center justify-end gap-1">
                        {/* Status transitions */
                        !isTerminal && (
                          <>
                            {canApprove(p) && (
                              <Button
                                variant="ghost"
                                size="icon"
                                className="h-7 w-7 text-emerald-400 hover:text-emerald-300 hover:bg-emerald-500/10"
                                title="Approve"
                                onClick={() => handleStatusChange(p, 'approved')}
                              >
                                <Check className="h-3.5 w-3.5" />
                              </Button>
                            )}
                            {canTransition(p, 'completed') && (
                              <Button
                                variant="ghost"
                                size="icon"
                                className="h-7 w-7 text-blue-400 hover:text-blue-300 hover:bg-blue-500/10"
                                title="Complete"
                                onClick={() => handleStatusChange(p, 'completed')}
                              >
                                <ArrowDownToLine className="h-3.5 w-3.5" />
                              </Button>
                            )}
                            {canTransition(p, 'rejected') && (
                              <Button
                                variant="ghost"
                                size="icon"
                                className="h-7 w-7 text-red-400 hover:text-red-300 hover:bg-red-500/10"
                                title="Reject"
                                onClick={() => handleStatusChange(p, 'rejected')}
                              >
                                <X className="h-3.5 w-3.5" />
                              </Button>
                            )}
                          </>
                        )}
                        {/* Edit (non-terminal) */}
                        {!isTerminal && (
                          <Button variant="ghost" size="icon" className="h-7 w-7 text-zinc-400 hover:text-zinc-200" onClick={() => openEdit(p)}>
                            <Pencil className="h-3.5 w-3.5" />
                          </Button>
                        )}
                        {/* Delete (non-terminal) */}
                        {!isTerminal && (
                          <Button variant="ghost" size="icon" className="h-7 w-7 text-destructive hover:text-red-300" onClick={() => setDeleteId(p.id)}>
                            <Trash2 className="h-3.5 w-3.5" />
                          </Button>
                        )}
                      </div>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-center gap-2">
          <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage(page - 1)}>Prev</Button>
          <span className="text-xs text-zinc-500">Page {page} of {totalPages}</span>
          <Button variant="outline" size="sm" disabled={page >= totalPages} onClick={() => setPage(page + 1)}>Next</Button>
        </div>
      )}

      {/* ═══ Create Dialog ═══ */}
      <Dialog open={createOpen} onOpenChange={(open) => { setCreateOpen(open); if (!open) resetCreateForm(); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>New Payout</DialogTitle>
            <DialogDescription>Record a payout from the faction treasury to a member.</DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-2">
              <Label>Recipient *</Label>
              <Select value={formRecipient} onValueChange={setFormRecipient}>
                <SelectTrigger><SelectValue placeholder="Select member" /></SelectTrigger>
                <SelectContent>
                  {members.map((m) => (
                    <SelectItem key={m.userId} value={m.userId}>{m.username}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Item Type *</Label>
              <Select value={formItemType} onValueChange={setFormItemType}>
                <SelectTrigger><SelectValue placeholder="Select type" /></SelectTrigger>
                <SelectContent>
                  {itemTypes.map((t) => (
                    <SelectItem key={t.id} value={t.id}>{t.name} ({t.unit})</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Amount *</Label>
              <Input
                type="number"
                step="0.01"
                min="0.01"
                placeholder="0.00"
                value={formAmount}
                onChange={(e) => setFormAmount(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label>Description</Label>
              <Input
                placeholder="Weekly cut, equipment, etc."
                value={formDescription}
                onChange={(e) => setFormDescription(e.target.value)}
                maxLength={500}
              />
            </div>
            <div className="space-y-2">
              <Label>Date</Label>
              <Input
                type="date"
                value={formDate}
                onChange={(e) => setFormDate(e.target.value)}
                max={new Date().toISOString().slice(0, 10)}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => { setCreateOpen(false); resetCreateForm(); }}>Cancel</Button>
            <Button
              disabled={!formRecipient || !formItemType || !formAmount || Number(formAmount) <= 0 || createMutation.isPending}
              onClick={() => createMutation.mutate()}
              style={{ backgroundColor: brandColor }}
            >
              {createMutation.isPending ? 'Creating...' : 'Create Payout'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ═══ Edit Dialog ═══ */}
      <Dialog open={!!editPayout} onOpenChange={(open) => { if (!open) setEditPayout(null); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Edit Payout</DialogTitle>
            <DialogDescription>
              Editing payout for {editPayout?.recipientUsername} · {editPayout?.itemTypeName}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
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
              <Label>Description</Label>
              <Input
                value={editDescription}
                onChange={(e) => setEditDescription(e.target.value)}
                maxLength={500}
              />
            </div>
            <div className="space-y-2">
              <Label>Date</Label>
              <Input
                type="date"
                value={editDate}
                onChange={(e) => setEditDate(e.target.value)}
                max={new Date().toISOString().slice(0, 10)}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditPayout(null)}>Cancel</Button>
            <Button
              disabled={updateMutation.isPending || Number(editAmount) <= 0}
              onClick={handleEditSave}
              style={{ backgroundColor: brandColor }}
            >
              {updateMutation.isPending ? 'Saving...' : 'Save'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ═══ Even Split Dialog ═══ */}
      <Dialog open={evenSplitOpen} onOpenChange={setEvenSplitOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Even Split Distribution</DialogTitle>
            <DialogDescription>
              Distribute an amount equally across all faction members. Remainder stays in the vault.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="rounded-lg border border-amber-500/20 bg-amber-500/5 p-3 text-sm text-amber-300">
              This will create individual payout records for each of the {members.length} member{members.length !== 1 ? 's' : ''} in this faction.
            </div>
            <div className="space-y-2">
              <Label>Item Type *</Label>
              <Select value={splitItemType} onValueChange={setSplitItemType}>
                <SelectTrigger><SelectValue placeholder="Select type" /></SelectTrigger>
                <SelectContent>
                  {itemTypes.map((t) => (
                    <SelectItem key={t.id} value={t.id}>{t.name} ({t.unit})</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Total Amount *</Label>
              <Input
                type="number"
                step="0.01"
                min="0.01"
                placeholder="0.00"
                value={splitTotal}
                onChange={(e) => setSplitTotal(e.target.value)}
              />
              {splitTotal && Number(splitTotal) > 0 && members.length > 0 && (
                <p className="text-xs text-zinc-500">
                  {members.length} members × {fmt(Math.floor(Number(splitTotal) * 100 / members.length) / 100)} each = {fmt(Math.floor(Number(splitTotal) * 100 / members.length) / 100 * members.length)} distributed
                  {(() => {
                    const rem = (Number(splitTotal) * 100 - Math.floor(Number(splitTotal) * 100 / members.length) * members.length) / 100;
                    return rem > 0 ? <>, {fmt(rem)} remainder</> : null;
                  })()}
                </p>
              )}
            </div>
            <div className="space-y-2">
              <Label>Description</Label>
              <Input
                placeholder="Even split distribution"
                value={splitDescription}
                onChange={(e) => setSplitDescription(e.target.value)}
                maxLength={500}
              />
            </div>
            <div className="space-y-2">
              <Label>Date</Label>
              <Input
                type="date"
                value={splitDate}
                onChange={(e) => setSplitDate(e.target.value)}
                max={new Date().toISOString().slice(0, 10)}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEvenSplitOpen(false)}>Cancel</Button>
            <Button
              disabled={!splitItemType || !splitTotal || Number(splitTotal) <= 0 || evenSplitMutation.isPending}
              onClick={() => evenSplitMutation.mutate()}
              style={{ backgroundColor: brandColor }}
            >
              {evenSplitMutation.isPending ? 'Distributing...' : `Split ${splitTotal || '0'} to ${members.length} Members`}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ═══ Delete Confirmation ═══ */}
      <AlertDialog open={!!deleteId} onOpenChange={(open) => { if (!open) setDeleteId(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Payout</AlertDialogTitle>
            <AlertDialogDescription>
              This will soft-delete this payout. If it was completed, the treasury balance will be adjusted accordingly.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              disabled={deleteMutation.isPending}
              onClick={() => { if (deleteId) deleteMutation.mutate(deleteId); }}
            >
              {deleteMutation.isPending ? 'Deleting...' : 'Delete'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
