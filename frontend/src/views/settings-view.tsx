'use client';

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { itemTypesApi, quotasApi, factionSettingsApi, membersApi, apiErrorMessage } from '@/lib/api-client';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
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
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Plus, Pencil, Trash2, Package, Target, Palette, X, Shield } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { useAppStore } from '@/lib/store';
import type { ItemType, Quota, Member, FactionRank } from '@/lib/api-types';
import {
  FACTION_PERMISSIONS,
  PERMISSION_LABELS,
  type FactionPermission,
} from '@/lib/api-types';
import { useEffect, useRef } from 'react';
import { formatAmount } from '@/lib/format';
import { ItemIcon } from '@/components/item-icon';

interface Props {
  factionId: string;
  /**
   * Whether the caller runs this faction. Delegates with manage_settings may
   * shape the rank list, but who holds which permission is an admin decision —
   * the API refuses it, so the screen must not offer it.
   */
  isFactionAdmin?: boolean;
}

type SettingsTab = 'item-types' | 'quotas' | 'customization' | 'faction-settings';

export function SettingsView({ factionId, isFactionAdmin }: Props) {
  const [activeTab, setActiveTab] = useState<SettingsTab>('item-types');

  return (
    <div className="space-y-4">
      {/* Tab Switcher */}
      <div className="flex gap-2 overflow-x-auto">
        <Button
          variant={activeTab === 'item-types' ? 'default' : 'outline'}
          onClick={() => setActiveTab('item-types')}
        >
          <Package className="mr-2 h-4 w-4" />
          Item Types
        </Button>
        <Button
          variant={activeTab === 'quotas' ? 'default' : 'outline'}
          onClick={() => setActiveTab('quotas')}
        >
          <Target className="mr-2 h-4 w-4" />
          Quotas
        </Button>
        <Button
          variant={activeTab === 'customization' ? 'default' : 'outline'}
          onClick={() => setActiveTab('customization')}
        >
          <Palette className="mr-2 h-4 w-4" />
          Customization
        </Button>
        <Button
          variant={activeTab === 'faction-settings' ? 'default' : 'outline'}
          onClick={() => setActiveTab('faction-settings')}
        >
          <Shield className="mr-2 h-4 w-4" />
          Faction Settings
        </Button>
      </div>

      {activeTab === 'item-types' && <ItemTypesSection factionId={factionId} />}
      {activeTab === 'quotas' && <QuotasSection factionId={factionId} />}
      {activeTab === 'customization' && <CustomizationSection factionId={factionId} />}
      {activeTab === 'faction-settings' && (
        <FactionSettingsSection factionId={factionId} isFactionAdmin={!!isFactionAdmin} />
      )}
    </div>
  );
}

// ══════════════════════════════════════════════════════
// Item Types Section
// ══════════════════════════════════════════════════════

function ItemTypesSection({ factionId }: { factionId: string }) {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const [createOpen, setCreateOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<ItemType | null>(null);

  // Unit is auto-derived: `$` for currency, `pcs` for goods. We don't ask
  // the user — the previous free-text field was a frequent source of typos
  // like "$" vs "$ " that broke formatting downstream.
  const [newName, setNewName] = useState('');
  const [newIsCurrency, setNewIsCurrency] = useState(false);
  const [newImageUrl, setNewImageUrl] = useState('');
  const [editTarget, setEditTarget] = useState<ItemType | null>(null);
  const [editName, setEditName] = useState('');
  const [editIsCurrency, setEditIsCurrency] = useState(false);
  const [editImageUrl, setEditImageUrl] = useState('');
  const [editActive, setEditActive] = useState(true);

  const { data: itemTypes = [], isLoading } = useQuery({
    queryKey: ['itemTypes', factionId],
    queryFn: () => itemTypesApi.list(factionId),
    staleTime: 30 * 1000,
  });

  const createMutation = useMutation({
    mutationFn: () =>
      itemTypesApi.create(factionId, {
        name: newName,
        unit: newIsCurrency ? '$' : 'pcs',
        isCurrency: newIsCurrency,
        // Omitted rather than sent empty: the API only accepts a real URL.
        ...(newImageUrl.trim() ? { imageUrl: newImageUrl.trim() } : {}),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['itemTypes', factionId] });
      setCreateOpen(false);
      setNewName('');
      setNewIsCurrency(false);
      setNewImageUrl('');
      toast({ title: 'Item type created' });
    },
    onError: (err: unknown) => {
      toast({
        title: 'Failed to create item type',
        description: apiErrorMessage(err),
        variant: 'destructive',
      });
    },
  });

  const updateMutation = useMutation({
    mutationFn: () =>
      itemTypesApi.update(factionId, editTarget!.id, {
        name: editName,
        unit: editIsCurrency ? '$' : 'pcs',
        isCurrency: editIsCurrency,
        isActive: editActive,
        // An emptied field means "remove the image", which the API spells null.
        imageUrl: editImageUrl.trim() || null,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['itemTypes', factionId] });
      setEditOpen(false);
      setEditTarget(null);
      toast({ title: 'Item type updated' });
    },
    onError: (err: unknown) => {
      toast({
        title: 'Update failed',
        description: apiErrorMessage(err),
        variant: 'destructive',
      });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: () => itemTypesApi.remove(factionId, deleteTarget!.id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['itemTypes', factionId] });
      setDeleteTarget(null);
      toast({ title: 'Item type disabled' });
    },
    onError: (err: unknown) => {
      toast({
        title: 'Failed to disable',
        description: apiErrorMessage(err),
        variant: 'destructive',
      });
    },
  });

  const openEdit = (t: ItemType) => {
    setEditTarget(t);
    setEditName(t.name);
    setEditIsCurrency(t.isCurrency);
    setEditImageUrl(t.imageUrl ?? '');
    setEditActive(t.isActive);
    setEditOpen(true);
  };

  return (
    <>
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-lg font-semibold">Item Types</h3>
          <p className="text-sm text-zinc-500">
            Manage the types of contributions members can log.
          </p>
        </div>
        <Button onClick={() => setCreateOpen(true)}>
          <Plus className="mr-2 h-4 w-4" />
          Add Type
        </Button>
      </div>

      <Card>
        <CardContent className="p-0">
          {isLoading ? (
            <div className="p-6 space-y-3">
              {[...Array(3)].map((_, i) => (
                <Skeleton key={i} className="h-12 w-full" />
              ))}
            </div>
          ) : itemTypes.length === 0 ? (
            <div className="p-12 text-center text-zinc-500">
              <Package className="h-8 w-8 mx-auto mb-2 opacity-50" />
              <p>No item types configured.</p>
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-[52px]"></TableHead>
                  <TableHead>Name</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead>Entries</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="w-[100px]">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {itemTypes.map((t: ItemType) => (
                  <TableRow key={t.id} className={!t.isActive ? 'opacity-50' : ''}>
                    <TableCell>
                      <ItemIcon src={t.imageUrl} className="size-8" />
                    </TableCell>
                    <TableCell className="font-medium">{t.name}</TableCell>
                    <TableCell>
                      <Badge
                        variant="outline"
                        className={t.isCurrency
                          ? 'border-emerald-500/30 text-emerald-400 bg-emerald-500/10'
                          : 'border-blue-500/30 text-blue-400 bg-blue-500/10'
                        }
                      >
                        {t.isCurrency ? 'Currency ($)' : 'Goods (pcs)'}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-sm">{t.entryCount ?? 0}</TableCell>
                    <TableCell>
                      <Badge variant={t.isActive ? 'default' : 'secondary'}>
                        {t.isActive ? 'Active' : 'Disabled'}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-1">
                        <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => openEdit(t)}>
                          <Pencil className="h-3.5 w-3.5" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-8 w-8 text-destructive"
                          onClick={() => setDeleteTarget(t)}
                          disabled={!t.isActive}
                        >
                          <Trash2 className="h-3.5 w-3.5" />
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

      {/* Create Dialog */}
      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Create Item Type</DialogTitle>
            <DialogDescription>
              Add a new category for faction contributions.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label>Name</Label>
              <Input placeholder="e.g. Weapons" value={newName} onChange={(e) => setNewName(e.target.value)} />
            </div>
            <div className="flex items-center justify-between rounded-lg border p-3">
              <div>
                <p className="text-sm font-medium">Currency</p>
                <p className="text-xs text-zinc-500">
                  Currency types are shown as {'“'}$1,000.00{'”'} and use the
                  {' '}<code className="text-zinc-400">$</code> unit. Goods use
                  {' '}<code className="text-zinc-400">pcs</code> and are
                  formatted as {'“'}30 pcs{'”'}.
                </p>
              </div>
              <Switch checked={newIsCurrency} onCheckedChange={setNewIsCurrency} />
            </div>
            <div className="space-y-2">
              <Label>Image URL</Label>
              <div className="flex items-center gap-3">
                <ItemIcon src={newImageUrl.trim() || null} className="size-10" />
                <Input
                  placeholder="https://example.com/icon.png"
                  value={newImageUrl}
                  onChange={(e) => setNewImageUrl(e.target.value)}
                />
              </div>
              <p className="text-xs text-zinc-500">
                Optional. Link to an image hosted elsewhere; it appears wherever this item is
                listed.
              </p>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCreateOpen(false)}>Cancel</Button>
            <Button
              onClick={() => createMutation.mutate()}
              disabled={!newName.trim() || createMutation.isPending}
            >
              {createMutation.isPending ? 'Creating...' : 'Create'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Edit Dialog */}
      <Dialog open={editOpen} onOpenChange={setEditOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Edit Item Type</DialogTitle>
            <DialogDescription>Update item type settings.</DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label>Name</Label>
              <Input value={editName} onChange={(e) => setEditName(e.target.value)} />
            </div>
            <div className="flex items-center justify-between rounded-lg border p-3">
              <div>
                <p className="text-sm font-medium">Currency</p>
                <p className="text-xs text-zinc-500">
                  Currency types use <code className="text-zinc-400">$</code>;
                  goods use <code className="text-zinc-400">pcs</code>. The
                  unit changes automatically.
                </p>
              </div>
              <Switch checked={editIsCurrency} onCheckedChange={setEditIsCurrency} />
            </div>
            <div className="space-y-2">
              <Label>Image URL</Label>
              <div className="flex items-center gap-3">
                <ItemIcon src={editImageUrl.trim() || null} className="size-10" />
                <Input
                  placeholder="https://example.com/icon.png"
                  value={editImageUrl}
                  onChange={(e) => setEditImageUrl(e.target.value)}
                />
              </div>
              <p className="text-xs text-zinc-500">Clear the field to remove the image.</p>
            </div>
            <div className="flex items-center justify-between rounded-lg border p-3">
              <div>
                <p className="text-sm font-medium">Active</p>
                <p className="text-xs text-zinc-500">Disabled types cannot be used for new entries.</p>
              </div>
              <Switch checked={editActive} onCheckedChange={setEditActive} />
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
            <AlertDialogTitle>Disable &ldquo;{deleteTarget?.name}&rdquo;?</AlertDialogTitle>
            <AlertDialogDescription>
              This will disable the item type. Existing entries will be preserved, but no new
              entries can be logged with this type.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => deleteMutation.mutate()}
              disabled={deleteMutation.isPending}
              className="bg-red-500 text-white hover:bg-red-600"
            >
              {deleteMutation.isPending ? 'Disabling...' : 'Disable'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

// ══════════════════════════════════════════════════════
// Quotas Section
// ══════════════════════════════════════════════════════

function QuotasSection({ factionId }: { factionId: string }) {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const [createOpen, setCreateOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<Quota | null>(null);

  // Create form — Scope lets you target the whole faction (the default) or a
  // single member. Per-member quotas only count that member's contributions.
  const [newItemTypeId, setNewItemTypeId] = useState('');
  const [newTargetAmount, setNewTargetAmount] = useState('');
  const [newPeriodType, setNewPeriodType] = useState<'weekly' | 'monthly'>('weekly');
  const [newScope, setNewScope] = useState<'faction' | 'member'>('faction');
  const [newTargetUserId, setNewTargetUserId] = useState<string>('');
  const [newPeriodStart, setNewPeriodStart] = useState(() => {
    const d = new Date();
    const day = d.getDay();
    const diff = day === 0 ? 1 : 8 - day;
    const monday = new Date(d);
    monday.setDate(d.getDate() + diff);
    return monday.toISOString().split('T')[0];
  });

  // Edit form
  const [editTarget, setEditTarget] = useState<Quota | null>(null);
  const [editTargetAmount, setEditTargetAmount] = useState('');
  const [editPeriodType, setEditPeriodType] = useState<'weekly' | 'monthly'>('weekly');
  const [editPeriodStart, setEditPeriodStart] = useState('');
  const [editActive, setEditActive] = useState(true);

  const { data: quotasList = [], isLoading: quotasLoading } = useQuery({
    queryKey: ['quotas', factionId],
    queryFn: () => quotasApi.list(factionId),
    staleTime: 30 * 1000,
  });

  const { data: itemTypes = [] } = useQuery({
    queryKey: ['itemTypes', factionId],
    queryFn: () => itemTypesApi.list(factionId),
    staleTime: 5 * 60 * 1000,
  });

  // Members power the per-member dropdown in the create dialog and the scope
  // column lookup in the table.
  const { data: members = [] } = useQuery({
    queryKey: ['members', factionId],
    queryFn: () => membersApi.list(factionId),
    staleTime: 60 * 1000,
  });

  const activeItemTypes = itemTypes.filter((t: ItemType) => t.isActive);

  const createMutation = useMutation({
    mutationFn: () =>
      quotasApi.create(factionId, {
        itemTypeId: newItemTypeId,
        targetAmount: newTargetAmount,
        periodType: newPeriodType,
        periodStart: newPeriodStart,
        targetUserId: newScope === 'member' ? newTargetUserId : null,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['quotas', factionId] });
      setCreateOpen(false);
      resetCreateForm();
      toast({ title: 'Quota created' });
    },
    onError: (err: unknown) => {
      toast({
        title: 'Failed to create quota',
        description: apiErrorMessage(err),
        variant: 'destructive',
      });
    },
  });

  const updateMutation = useMutation({
    mutationFn: () =>
      quotasApi.update(factionId, editTarget!.id, {
        targetAmount: editTargetAmount,
        periodType: editPeriodType,
        periodStart: editPeriodStart,
        isActive: editActive,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['quotas', factionId] });
      setEditOpen(false);
      setEditTarget(null);
      toast({ title: 'Quota updated' });
    },
    onError: (err: unknown) => {
      toast({
        title: 'Update failed',
        description: apiErrorMessage(err),
        variant: 'destructive',
      });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: () => quotasApi.remove(factionId, deleteTarget!.id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['quotas', factionId] });
      setDeleteTarget(null);
      toast({ title: 'Quota deleted' });
    },
    onError: (err: unknown) => {
      toast({
        title: 'Delete failed',
        description: apiErrorMessage(err),
        variant: 'destructive',
      });
    },
  });

  const resetCreateForm = () => {
    setNewItemTypeId('');
    setNewTargetAmount('');
    setNewPeriodType('weekly');
    setNewScope('faction');
    setNewTargetUserId('');
    const d = new Date();
    const day = d.getDay();
    const diff = day === 0 ? 1 : 8 - day;
    const monday = new Date(d);
    monday.setDate(d.getDate() + diff);
    setNewPeriodStart(monday.toISOString().split('T')[0]);
  };

  const openEdit = (q: Quota) => {
    setEditTarget(q);
    setEditTargetAmount(q.targetAmount);
    setEditPeriodType(q.periodType);
    setEditPeriodStart(q.periodStart);
    setEditActive(q.isActive);
    setEditOpen(true);
  };

  const scopeLabel = (q: Quota): string => {
    if (!q.targetUserId) return 'Faction-wide';
    if (q.targetUsername) return q.targetUsername;
    const m = members.find((mm) => mm.userId === q.targetUserId);
    return m?.username ?? 'Per-member';
  };

  return (
    <>
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-lg font-semibold">Quotas</h3>
          <p className="text-sm text-zinc-500">
            Set weekly or monthly contribution targets per item type.
          </p>
        </div>
        <Button onClick={() => setCreateOpen(true)}>
          <Plus className="mr-2 h-4 w-4" />
          Add Quota
        </Button>
      </div>

      <Card>
        <CardContent className="p-0">
          {quotasLoading ? (
            <div className="p-6 space-y-3">
              {[...Array(3)].map((_, i) => (
                <Skeleton key={i} className="h-12 w-full" />
              ))}
            </div>
          ) : quotasList.length === 0 ? (
            <div className="p-12 text-center text-zinc-500">
              <Target className="h-8 w-8 mx-auto mb-2 opacity-50" />
              <p>No quotas configured.</p>
              <p className="text-xs mt-1">Create a quota to track contribution targets.</p>
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Item Type</TableHead>
                  <TableHead>Scope</TableHead>
                  <TableHead>Period</TableHead>
                  <TableHead>Target</TableHead>
                  <TableHead>Progress</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="w-[100px]">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {quotasList.map((q: Quota) => {
                  const pct = q.percentage ?? 0;
                  const met = pct >= 100;
                  return (
                    <TableRow key={q.id} className={!q.isActive ? 'opacity-50' : ''}>
                      <TableCell>
                        <div className="font-medium flex items-center gap-2">
                          <ItemIcon src={q.itemImageUrl} className="size-5" />
                          {q.itemTypeName}
                        </div>
                        {q.periodActive && q.periodStartComputed && q.periodEndComputed && (
                          <div className="text-xs text-zinc-500">
                            {q.periodStartComputed} — {q.periodEndComputed}
                          </div>
                        )}
                      </TableCell>
                      <TableCell>
                        {q.targetUserId ? (
                          <Badge variant="outline" className="text-[10px] border-blue-500/30 text-blue-400 bg-blue-500/10">
                            {scopeLabel(q)}
                          </Badge>
                        ) : (
                          <span className="text-xs text-zinc-500">Faction-wide</span>
                        )}
                      </TableCell>
                      <TableCell>
                        <Badge variant="outline" className="capitalize">
                          {q.periodType}
                        </Badge>
                      </TableCell>
                      <TableCell className="font-mono text-sm">
                        {formatAmount(q.targetAmount, q.itemUnit, q.itemIsCurrency)}
                      </TableCell>
                      <TableCell>
                        {q.isActive && q.periodActive ? (
                          <div className="space-y-1 min-w-[140px]">
                            <div className="flex items-center justify-between text-xs">
                              <span>{formatAmount(q.currentAmount ?? 0, q.itemUnit, q.itemIsCurrency)}</span>
                              <span className={met ? 'text-green-600 font-medium' : 'text-zinc-500'}>
                                {pct.toFixed(1)}%
                              </span>
                            </div>
                            <div className="h-2 bg-muted rounded-full overflow-hidden">
                              <div
                                className={`h-full rounded-full transition-all ${met ? 'bg-green-500' : 'bg-primary'}`}
                                style={{ width: `${Math.min(pct, 100)}%` }}
                              />
                            </div>
                          </div>
                        ) : q.isActive && !q.periodActive ? (
                          <span className="text-xs text-zinc-500">Starts {q.periodStart}</span>
                        ) : (
                          <span className="text-xs text-zinc-500">—</span>
                        )}
                      </TableCell>
                      <TableCell>
                        <Badge variant={q.isActive ? 'default' : 'secondary'}>
                          {q.isActive ? (met ? 'Met' : 'Active') : 'Disabled'}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center gap-1">
                          <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => openEdit(q)}>
                            <Pencil className="h-3.5 w-3.5" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-8 w-8 text-destructive"
                            onClick={() => setDeleteTarget(q)}
                          >
                            <Trash2 className="h-3.5 w-3.5" />
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

      {/* Create Quota Dialog */}
      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Create Quota</DialogTitle>
            <DialogDescription>
              Set a contribution target for a specific item type.
            </DialogDescription>
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
              <Label>Scope</Label>
              <Select
                value={newScope}
                onValueChange={(v: 'faction' | 'member') => {
                  setNewScope(v);
                  if (v === 'faction') setNewTargetUserId('');
                }}
              >
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="faction">Faction-wide</SelectItem>
                  <SelectItem value="member">Per-member</SelectItem>
                </SelectContent>
              </Select>
              <p className="text-xs text-zinc-500">
                {newScope === 'faction'
                  ? 'Counts every member\u2019s contributions toward the target.'
                  : 'Only the selected member\u2019s contributions count toward this quota.'}
              </p>
            </div>
            {newScope === 'member' && (
              <div className="space-y-2">
                <Label>Member</Label>
                <Select value={newTargetUserId} onValueChange={setNewTargetUserId}>
                  <SelectTrigger><SelectValue placeholder="Select member" /></SelectTrigger>
                  <SelectContent>
                    {members.map((m: Member) => (
                      <SelectItem key={m.userId} value={m.userId}>{m.username}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}
            <div className="space-y-2">
              <Label>Target Amount</Label>
              <Input
                type="number"
                step="0.01"
                min="0.01"
                placeholder="10000"
                value={newTargetAmount}
                onChange={(e) => setNewTargetAmount(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label>Period Type</Label>
              <Select value={newPeriodType} onValueChange={(v: 'weekly' | 'monthly') => setNewPeriodType(v)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="weekly">Weekly (Monday–Sunday)</SelectItem>
                  <SelectItem value="monthly">Monthly (Calendar month)</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Start Date</Label>
              <Input
                type="date"
                value={newPeriodStart}
                onChange={(e) => setNewPeriodStart(e.target.value)}
              />
              <p className="text-xs text-zinc-500">
                The quota will be inactive until this date. For weekly quotas, pick a Monday.
              </p>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCreateOpen(false)}>Cancel</Button>
            <Button
              onClick={() => createMutation.mutate()}
              disabled={
                !newItemTypeId
                || !newTargetAmount
                || Number(newTargetAmount) <= 0
                || (newScope === 'member' && !newTargetUserId)
                || createMutation.isPending
              }
            >
              {createMutation.isPending ? 'Creating...' : 'Create Quota'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Edit Quota Dialog */}
      <Dialog open={editOpen} onOpenChange={setEditOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Edit Quota</DialogTitle>
            <DialogDescription>Update quota settings for {editTarget?.itemTypeName}.</DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label>Target Amount</Label>
              <Input
                type="number"
                step="0.01"
                min="0.01"
                value={editTargetAmount}
                onChange={(e) => setEditTargetAmount(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label>Period Type</Label>
              <Select value={editPeriodType} onValueChange={(v: 'weekly' | 'monthly') => setEditPeriodType(v)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="weekly">Weekly (Monday–Sunday)</SelectItem>
                  <SelectItem value="monthly">Monthly (Calendar month)</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Start Date</Label>
              <Input
                type="date"
                value={editPeriodStart}
                onChange={(e) => setEditPeriodStart(e.target.value)}
              />
            </div>
            <div className="flex items-center justify-between rounded-lg border p-3">
              <div>
                <p className="text-sm font-medium">Active</p>
                <p className="text-xs text-zinc-500">Disabled quotas are hidden from the dashboard.</p>
              </div>
              <Switch checked={editActive} onCheckedChange={setEditActive} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditOpen(false)}>Cancel</Button>
            <Button
              onClick={() => updateMutation.mutate()}
              disabled={!editTargetAmount || Number(editTargetAmount) <= 0 || updateMutation.isPending}
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
            <AlertDialogTitle>Delete quota for &ldquo;{deleteTarget?.itemTypeName}&rdquo;?</AlertDialogTitle>
            <AlertDialogDescription>
              This will permanently delete this quota. The deletion will be recorded in the audit log.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => deleteMutation.mutate()}
              disabled={deleteMutation.isPending}
              className="bg-red-500 text-white hover:bg-red-600"
            >
              {deleteMutation.isPending ? 'Deleting...' : 'Delete'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

// ══════════════════════════════════════════════════════
// Customization Section
// ══════════════════════════════════════════════════════

function CustomizationSection({ factionId }: { factionId: string }) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const updateGlobalBrandColor = useAppStore((s) => s.setBrandColor);

  // Customization is read/written through factionSettingsApi so faction
  // admins (manage_settings OR manage_customization) can edit it — the
  // factionsApi.update endpoint is superadmin-only and would 403 most users.
  const { data: settings, isLoading } = useQuery({
    queryKey: ['faction-settings', factionId],
    queryFn: () => factionSettingsApi.get(factionId),
    staleTime: 30 * 1000,
  });

  const [brandColor, setBrandColor] = useState('#3b82f6');
  const [customFields, setCustomFields] = useState<{ name: string; required: boolean }[]>([]);
  const [payoutApprovalRequired, setPayoutApprovalRequired] = useState(false);
  const [newFieldName, setNewFieldName] = useState('');
  const [saving, setSaving] = useState(false);

  const initialized = useRef(false);
  useEffect(() => {
    if (settings && !initialized.current) {
      setBrandColor(settings.brandColor ?? '#3b82f6');
      setCustomFields(settings.customFields ?? []);
      setPayoutApprovalRequired(settings.payoutApprovalRequired ?? false);
      initialized.current = true;
    }
  }, [settings]);

  const saveMutation = useMutation({
    mutationFn: () =>
      factionSettingsApi.update(factionId, { brandColor, customFields, payoutApprovalRequired }),
    onSuccess: () => {
      updateGlobalBrandColor(brandColor);
      queryClient.invalidateQueries({ queryKey: ['faction-settings', factionId] });
      queryClient.invalidateQueries({ queryKey: ['faction-brand', factionId] });
      queryClient.invalidateQueries({ queryKey: ['faction-detail', factionId] });
      queryClient.invalidateQueries({ queryKey: ['dashboard', factionId] });
      toast({ title: 'Customization saved' });
    },
    onError: (err: unknown) => {
      toast({ title: 'Save failed', description: apiErrorMessage(err), variant: 'destructive' });
    },
  });

  const addField = () => {
    const name = newFieldName.trim();
    if (!name) return;
    if (customFields.some((f) => f.name.toLowerCase() === name.toLowerCase())) {
      toast({ title: 'Field name already exists', variant: 'destructive' });
      return;
    }
    setCustomFields([...customFields, { name, required: false }]);
    setNewFieldName('');
  };

  const removeField = (idx: number) => {
    setCustomFields(customFields.filter((_, i) => i !== idx));
  };

  const toggleRequired = (idx: number) => {
    setCustomFields(customFields.map((f, i) => i === idx ? { ...f, required: !f.required } : f));
  };

  const handleSave = () => {
    setSaving(true);
    saveMutation.mutate(undefined, { onSettled: () => setSaving(false) });
  };

  if (isLoading) {
    return <div className="p-6 space-y-3"><Skeleton className="h-20 w-full" /><Skeleton className="h-20 w-full" /></div>;
  }

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm text-zinc-200">Brand Color</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <p className="text-sm text-zinc-500">
            Set an accent color for this faction. Used for visual differentiation.
          </p>
          <div className="flex items-center gap-3">
            <input
              type="color"
              value={brandColor}
              onChange={(e) => setBrandColor(e.target.value)}
              className="h-10 w-14 rounded cursor-pointer border"
            />
            <Input
              value={brandColor}
              onChange={(e) => {
                const v = e.target.value;
                if (/^#[0-9a-fA-F]{6}$/.test(v)) setBrandColor(v);
              }}
              className="w-32"
              maxLength={7}
            />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm text-zinc-200">Custom Entry Fields</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <p className="text-sm text-zinc-500">
            Define extra fields members fill when logging entries.
          </p>
          <div className="flex gap-2">
            <Input
              placeholder="Field name (e.g. Location)"
              value={newFieldName}
              onChange={(e) => setNewFieldName(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && addField()}
              className="flex-1"
              maxLength={100}
            />
            <Button variant="outline" onClick={addField} disabled={!newFieldName.trim()}>
              <Plus className="h-4 w-4" />
            </Button>
          </div>
          {customFields.length > 0 && (
            <div className="space-y-2">
              {customFields.map((field, idx) => (
                <div key={idx} className="flex items-center gap-3 rounded-lg border p-3">
                  <span className="flex-1 text-sm font-medium">{field.name}</span>
                  <label className="flex items-center gap-2 text-xs cursor-pointer">
                    <input
                      type="checkbox"
                      checked={field.required}
                      onChange={() => toggleRequired(idx)}
                      className="h-3.5 w-3.5 rounded"
                    />
                    Required
                  </label>
                  <Button variant="ghost" size="icon" className="h-7 w-7 text-destructive" onClick={() => removeField(idx)}>
                    <X className="h-3.5 w-3.5" />
                  </Button>
                </div>
              ))}
            </div>
          )}
          {customFields.length === 0 && (
            <p className="text-sm text-zinc-500 text-center py-4">No custom fields defined.</p>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm text-zinc-200">Payout Approval</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <p className="text-sm text-zinc-500">
            When enabled, payouts created by one admin must be approved by a different admin before completion. Single-admin factions auto-complete regardless.
          </p>
          <label className="flex items-center gap-3 cursor-pointer">
            <Switch
              checked={payoutApprovalRequired}
              onCheckedChange={setPayoutApprovalRequired}
            />
            <span className="text-sm text-zinc-300">Require approval for payouts</span>
          </label>
        </CardContent>
      </Card>

      <Button onClick={handleSave} disabled={saving || saveMutation.isPending}>
        {saving ? 'Saving...' : 'Save Changes'}
      </Button>
    </div>
  );
}

// ══════════════════════════════════════════════════════
// Faction Settings Section (Phase 5)
// ══════════════════════════════════════════════════════

function FactionSettingsSection({
  factionId,
  isFactionAdmin,
}: {
  factionId: string;
  isFactionAdmin: boolean;
}) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const brandColor = useAppStore((s) => s.brandColor);

  const { data: settings, isLoading } = useQuery({
    queryKey: ['faction-settings', factionId],
    queryFn: () => factionSettingsApi.get(factionId),
    staleTime: 0,
  });

  const [ranks, setRanks] = useState<FactionRank[]>([]);
  const [inactivityThreshold, setInactivityThreshold] = useState(7);
  const [strikeExpiry, setStrikeExpiry] = useState<{ warning: number | null; minor: number | null; major: number | null }>({ warning: 30, minor: 90, major: null });
  const [hasChanges, setHasChanges] = useState(false);
  const [saving, setSaving] = useState(false);

  // Sync from server
  useEffect(() => {
    if (settings) {
      setRanks(settings.ranks);
      setInactivityThreshold(settings.inactivityThresholdDays);
      setStrikeExpiry(settings.strikeExpiryDays);
    }
  }, [settings]);

  const markChanged = () => setHasChanges(true);

  const addRank = () => {
    const maxLevel = ranks.length > 0 ? Math.max(...ranks.map(r => r.level)) : 0;
    setRanks([...ranks, { name: '', level: maxLevel + 1, permissions: [] }]);
    markChanged();
  };

  const removeRank = (idx: number) => {
    setRanks(ranks.filter((_, i) => i !== idx));
    markChanged();
  };

  const updateRank = (idx: number, field: 'name' | 'level', value: string | number) => {
    setRanks(ranks.map((r, i) => i === idx ? { ...r, [field]: value } : r));
    markChanged();
  };

  const togglePermission = (idx: number, perm: FactionPermission) => {
    setRanks((prev) => prev.map((r, i) => {
      if (i !== idx) return r;
      const has = r.permissions.includes(perm);
      return {
        ...r,
        permissions: has
          ? r.permissions.filter((p) => p !== perm)
          : [...r.permissions, perm],
      };
    }));
    markChanged();
  };

  const saveMutation = useMutation({
    mutationFn: () =>
      factionSettingsApi.update(factionId, {
        ranks: ranks.map(r => ({ ...r, level: Number(r.level) })),
        inactivityThresholdDays: inactivityThreshold,
        strikeExpiryDays: strikeExpiry,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['faction-settings', factionId] });
      setHasChanges(false);
      toast({ title: 'Faction settings saved' });
    },
    onError: (err: unknown) => {
      toast({ title: 'Failed', description: apiErrorMessage(err), variant: 'destructive' });
    },
    onSettled: () => setSaving(false),
  });

  if (isLoading) {
    return <div className="space-y-4"><Skeleton className="h-64 w-full" /><Skeleton className="h-48 w-full" /></div>;
  }

  return (
    <div className="space-y-6">
      {/* ── Ranks ── */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle className="text-sm text-zinc-200">Rank Hierarchy</CardTitle>
            <Button size="sm" variant="outline" onClick={addRank}><Plus className="mr-1.5 h-3.5 w-3.5" /> Add Rank</Button>
          </div>
          <p className="text-xs text-zinc-500 mt-1">
            Display-only ranks shown on the roster. Permissions gate what each rank can do.
            {!isFactionAdmin && ' Only a faction admin can change which permissions a rank grants.'}
          </p>
        </CardHeader>
        <CardContent>
          {ranks.length === 0 ? (
            <p className="text-zinc-600 text-sm text-center py-6">No ranks defined yet. Members will show no rank.</p>
          ) : (
            <div className="space-y-3">
              {[...ranks].sort((a, b) => a.level - b.level).map((r, sortedIdx) => {
                // The original index in the unsorted array, so toggles map back
                // to the right rank even after we re-sort for display.
                const idx = ranks.findIndex((rr) => rr === r);
                return (
                  <div key={idx} className="rounded-lg border border-white/[0.06] p-3 space-y-2">
                    <div className="flex items-center gap-2">
                      <span className="text-xs text-zinc-600 w-6 text-center tabular-nums">L{r.level}</span>
                      <Input
                        className="flex-1 h-8 text-sm"
                        value={r.name}
                        onChange={(e) => updateRank(idx, 'name', e.target.value)}
                        placeholder="Rank name"
                      />
                      <Input
                        className="w-16 h-8 text-sm tabular-nums"
                        type="number"
                        min={1}
                        value={r.level}
                        onChange={(e) => updateRank(idx, 'level', Number(e.target.value))}
                      />
                      <Button variant="ghost" size="icon" className="h-8 w-8 text-zinc-500 hover:text-red-400" onClick={() => removeRank(idx)}><Trash2 className="h-3.5 w-3.5" /></Button>
                    </div>
                    {/* Permissions. Read-only unless the caller runs the faction:
                        granting them is how someone would hand themselves the rest,
                        so it stays an admin decision and the API enforces the same. */}
                    <div className="flex flex-wrap gap-1.5 pl-8">
                      {(isFactionAdmin
                        ? FACTION_PERMISSIONS
                        : FACTION_PERMISSIONS.filter((perm) => r.permissions.includes(perm))
                      ).map((perm) => {
                        const active = r.permissions.includes(perm);
                        const chipClass = `text-[10px] px-2 py-1 rounded-md border transition-colors ${
                          active
                            ? 'bg-blue-500/15 border-blue-500/40 text-blue-300'
                            : 'bg-white/[0.02] border-white/[0.06] text-zinc-500 hover:text-zinc-300'
                        }`;
                        const chipStyle = active
                          ? { borderColor: `${brandColor}40`, backgroundColor: `${brandColor}15`, color: brandColor }
                          : undefined;

                        if (!isFactionAdmin) {
                          return (
                            <span
                              key={perm}
                              className={`text-[10px] px-2 py-1 rounded-md border ${
                                active
                                  ? 'bg-blue-500/15 border-blue-500/40 text-blue-300'
                                  : 'bg-white/[0.02] border-white/[0.06] text-zinc-500'
                              }`}
                              style={chipStyle}
                              title={`${PERMISSION_LABELS[perm]} — only a faction admin can change this`}
                            >
                              {PERMISSION_LABELS[perm]}
                            </span>
                          );
                        }

                        return (
                          <button
                            key={perm}
                            type="button"
                            onClick={() => togglePermission(idx, perm)}
                            className={chipClass}
                            style={chipStyle}
                            title={PERMISSION_LABELS[perm]}
                          >
                            {PERMISSION_LABELS[perm]}
                          </button>
                        );
                      })}
                      {!isFactionAdmin && r.permissions.length === 0 && (
                        <span className="text-[10px] text-zinc-600">No permissions</span>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>

      {/* ── Inactivity ── */}
      <Card>
        <CardHeader>
          <CardTitle className="text-sm text-zinc-200">Inactivity Threshold</CardTitle>
          <p className="text-xs text-zinc-500 mt-1">Days without a logged entry before a member is flagged as inactive on the dashboard.</p>
        </CardHeader>
        <CardContent>
          <div className="flex items-center gap-3 max-w-xs">
            <Input
              type="number"
              min={1}
              max={365}
              value={inactivityThreshold}
              onChange={(e) => { setInactivityThreshold(Number(e.target.value)); markChanged(); }}
              className="tabular-nums"
            />
            <span className="text-sm text-zinc-500">days</span>
          </div>
        </CardContent>
      </Card>

      {/* ── Strike Expiry ── */}
      <Card>
        <CardHeader>
          <CardTitle className="text-sm text-zinc-200">Strike Expiry (days)</CardTitle>
          <p className="text-xs text-zinc-500 mt-1">How long each severity level remains active. Null = never expires.</p>
        </CardHeader>
        <CardContent>
          <div className="space-y-3 max-w-sm">
            {(['warning', 'minor', 'major'] as const).map((sev) => (
              <div key={sev} className="flex items-center gap-3">
                <span className="text-sm text-zinc-300 capitalize w-14">{sev}</span>
                <Input
                  type="number"
                  min={1}
                  placeholder="Never"
                  value={strikeExpiry[sev] ?? ''}
                  onChange={(e) => {
                    const val = e.target.value;
                    setStrikeExpiry(prev => ({ ...prev, [sev]: val === '' ? null : Number(val) }));
                    markChanged();
                  }}
                  className="tabular-nums"
                />
                <span className="text-xs text-zinc-600">days</span>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* Save */}
      {hasChanges && (
        <div className="flex justify-end">
          <Button onClick={() => { setSaving(true); saveMutation.mutate(); }} disabled={saving || saveMutation.isPending}>
            {saving || saveMutation.isPending ? 'Saving...' : 'Save Faction Settings'}
          </Button>
        </div>
      )}
    </div>
  );
}
