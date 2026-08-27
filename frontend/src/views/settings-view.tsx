'use client';

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { itemTypesApi, quotasApi, factionsApi } from '@/lib/api-client';
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
import { Plus, Pencil, Trash2, Package, Target, Palette, X } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { useAppStore } from '@/lib/store';
import type { ItemType, Quota } from '@/lib/api-types';
import { useEffect, useRef } from 'react';

interface Props {
  factionId: string;
}

type SettingsTab = 'item-types' | 'quotas' | 'customization';

export function SettingsView({ factionId }: Props) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [activeTab, setActiveTab] = useState<SettingsTab>('item-types');

  return (
    <div className="space-y-4">
      {/* Tab Switcher */}
      <div className="flex gap-2">
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
      </div>

      {activeTab === 'item-types' && <ItemTypesSection factionId={factionId} />}
      {activeTab === 'quotas' && <QuotasSection factionId={factionId} />}
      {activeTab === 'customization' && <CustomizationSection factionId={factionId} />}
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

  const [newName, setNewName] = useState('');
  const [newUnit, setNewUnit] = useState('$');
  const [editTarget, setEditTarget] = useState<ItemType | null>(null);
  const [editName, setEditName] = useState('');
  const [editUnit, setEditUnit] = useState('');
  const [editActive, setEditActive] = useState(true);

  const { data: itemTypes = [], isLoading } = useQuery({
    queryKey: ['itemTypes', factionId],
    queryFn: () => itemTypesApi.list(factionId),
    staleTime: 30 * 1000,
  });

  const createMutation = useMutation({
    mutationFn: () => itemTypesApi.create(factionId, { name: newName, unit: newUnit }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['itemTypes', factionId] });
      setCreateOpen(false);
      setNewName('');
      setNewUnit('$');
      toast({ title: 'Item type created' });
    },
    onError: (err: any) => {
      toast({
        title: 'Failed to create item type',
        description: err.response?.data?.error?.message || 'Unknown error',
        variant: 'destructive',
      });
    },
  });

  const updateMutation = useMutation({
    mutationFn: () =>
      itemTypesApi.update(factionId, editTarget!.id, {
        name: editName,
        unit: editUnit,
        isActive: editActive,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['itemTypes', factionId] });
      setEditOpen(false);
      setEditTarget(null);
      toast({ title: 'Item type updated' });
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
    mutationFn: () => itemTypesApi.remove(factionId, deleteTarget!.id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['itemTypes', factionId] });
      setDeleteTarget(null);
      toast({ title: 'Item type disabled' });
    },
    onError: (err: any) => {
      toast({
        title: 'Failed to disable',
        description: err.response?.data?.error?.message || 'Unknown error',
        variant: 'destructive',
      });
    },
  });

  const openEdit = (t: ItemType) => {
    setEditTarget(t);
    setEditName(t.name);
    setEditUnit(t.unit);
    setEditActive(t.isActive);
    setEditOpen(true);
  };

  return (
    <>
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-lg font-semibold">Item Types</h3>
          <p className="text-sm text-muted-foreground">
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
            <div className="p-12 text-center text-muted-foreground">
              <Package className="h-8 w-8 mx-auto mb-2 opacity-50" />
              <p>No item types configured.</p>
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Unit</TableHead>
                  <TableHead>Entries</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="w-[100px]">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {itemTypes.map((t: ItemType) => (
                  <TableRow key={t.id} className={!t.isActive ? 'opacity-50' : ''}>
                    <TableCell className="font-medium">{t.name}</TableCell>
                    <TableCell className="font-mono text-sm">{t.unit}</TableCell>
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
            <div className="space-y-2">
              <Label>Unit Symbol</Label>
              <Input placeholder="$" value={newUnit} onChange={(e) => setNewUnit(e.target.value)} />
              <p className="text-xs text-muted-foreground">
                Displayed before amounts, e.g. "$1,000” or “5 pcs”.
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
            <div className="space-y-2">
              <Label>Unit Symbol</Label>
              <Input value={editUnit} onChange={(e) => setEditUnit(e.target.value)} />
            </div>
            <div className="flex items-center justify-between rounded-lg border p-3">
              <div>
                <p className="text-sm font-medium">Active</p>
                <p className="text-xs text-muted-foreground">Disabled types cannot be used for new entries.</p>
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
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
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

  // Create form
  const [newItemTypeId, setNewItemTypeId] = useState('');
  const [newTargetAmount, setNewTargetAmount] = useState('');
  const [newPeriodType, setNewPeriodType] = useState<'weekly' | 'monthly'>('weekly');
  const [newPeriodStart, setNewPeriodStart] = useState(() => {
    // Default to upcoming Monday
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

  const activeItemTypes = itemTypes.filter((t: ItemType) => t.isActive);

  const createMutation = useMutation({
    mutationFn: () =>
      quotasApi.create(factionId, {
        itemTypeId: newItemTypeId,
        targetAmount: newTargetAmount,
        periodType: newPeriodType,
        periodStart: newPeriodStart,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['quotas', factionId] });
      setCreateOpen(false);
      resetCreateForm();
      toast({ title: 'Quota created' });
    },
    onError: (err: any) => {
      toast({
        title: 'Failed to create quota',
        description: err.response?.data?.error?.message || 'Unknown error',
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
    onError: (err: any) => {
      toast({
        title: 'Update failed',
        description: err.response?.data?.error?.message || 'Unknown error',
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
    setNewTargetAmount('');
    setNewPeriodType('weekly');
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

  return (
    <>
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-lg font-semibold">Quotas</h3>
          <p className="text-sm text-muted-foreground">
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
            <div className="p-12 text-center text-muted-foreground">
              <Target className="h-8 w-8 mx-auto mb-2 opacity-50" />
              <p>No quotas configured.</p>
              <p className="text-xs mt-1">Create a quota to track contribution targets.</p>
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Item Type</TableHead>
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
                        <div className="font-medium">{q.itemTypeName}</div>
                        {q.periodActive && q.periodStartComputed && q.periodEndComputed && (
                          <div className="text-xs text-muted-foreground">
                            {q.periodStartComputed} — {q.periodEndComputed}
                          </div>
                        )}
                      </TableCell>
                      <TableCell>
                        <Badge variant="outline" className="capitalize">
                          {q.periodType}
                        </Badge>
                      </TableCell>
                      <TableCell className="font-mono text-sm">
                        {q.itemUnit}{Number(q.targetAmount).toLocaleString('en-US', { minimumFractionDigits: 2 })}
                      </TableCell>
                      <TableCell>
                        {q.isActive && q.periodActive ? (
                          <div className="space-y-1 min-w-[140px]">
                            <div className="flex items-center justify-between text-xs">
                              <span>{q.itemUnit}{(q.currentAmount ?? 0).toLocaleString('en-US', { minimumFractionDigits: 2 })}</span>
                              <span className={met ? 'text-green-600 font-medium' : 'text-muted-foreground'}>
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
                          <span className="text-xs text-muted-foreground">Starts {q.periodStart}</span>
                        ) : (
                          <span className="text-xs text-muted-foreground">—</span>
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
              <Select value={newPeriodType} onValueChange={(v: any) => setNewPeriodType(v)}>
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
              <p className="text-xs text-muted-foreground">
                The quota will be inactive until this date. For weekly quotas, pick a Monday.
              </p>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCreateOpen(false)}>Cancel</Button>
            <Button
              onClick={() => createMutation.mutate()}
              disabled={!newItemTypeId || !newTargetAmount || Number(newTargetAmount) <= 0 || createMutation.isPending}
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
              <Select value={editPeriodType} onValueChange={(v: any) => setEditPeriodType(v)}>
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
                <p className="text-xs text-muted-foreground">Disabled quotas are hidden from the dashboard.</p>
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
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
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

  const { data: faction, isLoading } = useQuery({
    queryKey: ['faction-detail', factionId],
    queryFn: () => factionsApi.get(factionId),
    staleTime: 30 * 1000,
  });

  const [brandColor, setBrandColor] = useState('#3b82f6');
  const [customFields, setCustomFields] = useState<{ name: string; required: boolean }[]>([]);
  const [newFieldName, setNewFieldName] = useState('');
  const [saving, setSaving] = useState(false);

  const initialized = useRef(false);
  useEffect(() => {
    if (faction && !initialized.current) {
      setBrandColor(faction.brandColor ?? '#3b82f6');
      setCustomFields(faction.customFields ?? []);
      initialized.current = true;
    }
  }, [faction]);

  const saveMutation = useMutation({
    mutationFn: () =>
      factionsApi.update(factionId, { brandColor, customFields }),
    onSuccess: () => {
      // Immediately update the global brand color in the store
      updateGlobalBrandColor(brandColor);
      queryClient.invalidateQueries({ queryKey: ['faction-detail', factionId] });
      queryClient.invalidateQueries({ queryKey: ['faction-brand', factionId] });
      queryClient.invalidateQueries({ queryKey: ['dashboard', factionId] });
      toast({ title: 'Customization saved' });
    },
    onError: (err: any) => {
      toast({ title: 'Save failed', description: err.response?.data?.error?.message || 'Unknown error', variant: 'destructive' });
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
          <CardTitle className="text-base">Brand Color</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <p className="text-sm text-muted-foreground">
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
          <CardTitle className="text-base">Custom Entry Fields</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <p className="text-sm text-muted-foreground">
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
            <p className="text-sm text-muted-foreground text-center py-4">No custom fields defined.</p>
          )}
        </CardContent>
      </Card>

      <Button onClick={handleSave} disabled={saving || saveMutation.isPending}>
        {saving ? 'Saving...' : 'Save Changes'}
      </Button>
    </div>
  );
}
