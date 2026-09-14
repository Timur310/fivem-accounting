'use client';

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { itemTypesApi, quotasApi, factionSettingsApi, membersApi, configApi, apiErrorMessage } from '@/lib/api-client';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import {
  SearchableSelect, type SearchableSelectOption,
} from '@/components/ui/searchable-select';
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
import { Plus, Pencil, Trash2, Package, Target, Palette, X, Shield, Download, Upload, History, MessageSquare } from 'lucide-react';
import { DiscordSettingsSection } from '@/components/discord-settings-section';

const EXPENSE_CATEGORY_LABELS = {
  warehouse: 'expenses.category.warehouse',
  utilities: 'expenses.category.utilities',
  supplies: 'expenses.category.supplies',
  other: 'expenses.category.other',
} as const;
import { useToast } from '@/hooks/use-toast';
import { useAppStore } from '@/lib/store';
import type { ItemCategory, ItemType, Quota, Member, FactionRank } from '@/lib/api-types';
import {
  FACTION_PERMISSIONS,
  PERMISSION_LABEL_KEYS,
  type FactionPermission,
} from '@/lib/api-types';
import { useEffect, useMemo, useRef } from 'react';
import { formatAmount, displayName, todayLocalDateString } from '@/lib/format';
import { EmptyState, ErrorState } from '@/components/ui/empty-state';
import { ItemIcon } from '@/components/item-icon';
import { IconCategoryPicker } from '@/components/ui/icon-category-picker';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { useTranslation } from '@/providers/i18n-provider';
import type { TranslationKey } from '@/lib/i18n';

const SCOPE_KEYS: Record<string, TranslationKey> = {
  faction: 'quota.scope.faction',
  everyone: 'quota.scope.everyone',
  member: 'quota.scope.member',
};

const PERIOD_TYPE_KEYS: Record<string, TranslationKey> = {
  weekly: 'quota.periodType.weekly',
  monthly: 'quota.periodType.monthly',
};

/** Strike severities, in the order they escalate. */
const SEVERITY_KEYS: Record<string, TranslationKey> = {
  warning: 'strikes.severity.warning',
  minor: 'strikes.severity.minor',
  major: 'strikes.severity.major',
};

interface Props {
  factionId: string;
  /**
   * Whether the caller runs this faction. Delegates with manage_settings may
   * shape the rank list, but who holds which permission is an admin decision —
   * the API refuses it, so the screen must not offer it.
   */
  isFactionAdmin?: boolean;
  /** Per-resource gates for the CSV import/export buttons. */
  canManageItemTypes?: boolean;
  canManageQuotas?: boolean;
  canManageSettings?: boolean;
  /**
   * Separate from manage_settings on purpose: pointing the faction's activity
   * at a Discord channel is reach outside the app, so it is its own grant.
   */
  canManageDiscord?: boolean;
}

type SettingsTab = 'item-types' | 'quotas' | 'customization' | 'faction-settings' | 'discord';

export function SettingsView({ factionId, isFactionAdmin, canManageItemTypes = false, canManageQuotas = false, canManageSettings = false, canManageDiscord = false }: Props) {
  const { t } = useTranslation();
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
          {t('settings.itemTypes')}
        </Button>
        <Button
          variant={activeTab === 'quotas' ? 'default' : 'outline'}
          onClick={() => setActiveTab('quotas')}
        >
          <Target className="mr-2 h-4 w-4" />
          {t('settings.quotas')}
        </Button>
        <Button
          variant={activeTab === 'customization' ? 'default' : 'outline'}
          onClick={() => setActiveTab('customization')}
        >
          <Palette className="mr-2 h-4 w-4" />
          {t('settings.customization')}
        </Button>
        <Button
          variant={activeTab === 'faction-settings' ? 'default' : 'outline'}
          onClick={() => setActiveTab('faction-settings')}
        >
          <Shield className="mr-2 h-4 w-4" />
          {t('settings.factionSettings')}
        </Button>
        {/* Hidden rather than disabled: a tab nobody in this rank can use is
            just a question they cannot answer. */}
        {canManageDiscord && (
          <Button
            variant={activeTab === 'discord' ? 'default' : 'outline'}
            onClick={() => setActiveTab('discord')}
          >
            <MessageSquare className="mr-2 h-4 w-4" />
            {t('discord.title')}
          </Button>
        )}
      </div>

      {activeTab === 'item-types' && <ItemTypesSection factionId={factionId} canManage={canManageItemTypes} />}
      {activeTab === 'quotas' && <QuotasSection factionId={factionId} canManage={canManageQuotas} />}
      {activeTab === 'customization' && <CustomizationSection factionId={factionId} />}
      {activeTab === 'faction-settings' && (
        <FactionSettingsSection factionId={factionId} isFactionAdmin={!!isFactionAdmin} canManage={canManageSettings} />
      )}
      {activeTab === 'discord' && canManageDiscord && <DiscordSettingsSection factionId={factionId} />}
    </div>
  );
}

// ══════════════════════════════════════════════════════
// Config CSV export/import buttons
// ══════════════════════════════════════════════════════

/**
 * Export downloads a CSV straight from the API; import reads a picked file as
 * text and posts it, reporting the per-row outcome in a toast. `resource`
 * selects the endpoint and the query cache to refresh afterwards.
 */
function ConfigIoButtons({ factionId, resource, canManage }: { factionId: string; resource: 'item-types' | 'quotas' | 'ranks'; canManage: boolean }) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const fileRef = useRef<HTMLInputElement>(null);

  const url = resource === 'item-types'
    ? configApi.itemTypesUrl(factionId)
    : resource === 'quotas'
      ? configApi.quotasUrl(factionId)
      : configApi.ranksUrl(factionId);

  const importFn = resource === 'item-types'
    ? configApi.importItemTypes
    : resource === 'quotas'
      ? configApi.importQuotas
      : configApi.importRanks;

  const cacheKeys: string[][] = resource === 'item-types'
    ? [['itemTypes', factionId]]
    : resource === 'quotas'
      ? [['quotas', factionId], ['dashboard', factionId]]
      : [['faction-settings', factionId], ['members', factionId]];

  const importMutation = useMutation({
    mutationFn: (csv: string) => importFn(factionId, csv),
    onSuccess: (result) => {
      for (const key of cacheKeys) queryClient.invalidateQueries({ queryKey: key });
      if (fileRef.current) fileRef.current.value = '';
      const summary = [
        t('settings.import.imported', { count: result.imported }),
        result.updated !== undefined ? t('settings.import.updated', { count: result.updated }) : null,
        t('settings.import.skipped', { count: result.skipped }),
      ].filter(Boolean).join(' · ');
      toast({
        title: t('settings.import.done'),
        description: result.errors.length > 0
          ? `${summary}\n${result.errors.slice(0, 5).join('\n')}${result.errors.length > 5 ? `\n+${result.errors.length - 5}` : ''}`
          : summary,
        variant: result.errors.length > 0 ? 'destructive' : 'default',
      });
    },
    onError: (err: unknown) => {
      toast({ title: t('settings.import.failed'), description: apiErrorMessage(err), variant: 'destructive' });
    },
  });

  const handleFile = async (file: File) => {
    const text = await file.text();
    importMutation.mutate(text);
  };

  return (
    <div className="flex items-center gap-2">
      <Button variant="outline" size="sm" onClick={() => window.open(url, '_blank', 'noopener,noreferrer')}>
        <Download className="mr-1.5 h-3.5 w-3.5" />
        {t('settings.import.export')}
      </Button>
      {canManage && (
        <>
          <Button variant="outline" size="sm" disabled={importMutation.isPending} onClick={() => fileRef.current?.click()}>
            <Upload className="mr-1.5 h-3.5 w-3.5" />
            {importMutation.isPending ? t('settings.import.importing') : t('settings.import.import')}
          </Button>
          <input
            ref={fileRef}
            type="file"
            accept=".csv,text/csv"
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) void handleFile(file);
              e.target.value = '';
            }}
          />
        </>
      )}
    </div>
  );
}

// ══════════════════════════════════════════════════════
// Item Types Section
// ══════════════════════════════════════════════════════

function ItemTypesSection({ factionId, canManage = false }: { factionId: string; canManage?: boolean }) {
  const { t } = useTranslation();
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
  const [newIcon, setNewIcon] = useState('');
  const [newCategory, setNewCategory] = useState<ItemCategory>('other');
  const [editTarget, setEditTarget] = useState<ItemType | null>(null);
  const [editName, setEditName] = useState('');
  const [editIsCurrency, setEditIsCurrency] = useState(false);
  const [editImageUrl, setEditImageUrl] = useState('');
  const [editIcon, setEditIcon] = useState('');
  const [editCategory, setEditCategory] = useState<ItemCategory>('other');
  const [editActive, setEditActive] = useState(true);

  const { data: itemTypes = [], isLoading, isError, error, refetch } = useQuery({
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
        // Omitted rather than sent empty for the same reason as the URL: the
        // API rejects a blank where it expects an emoji.
        ...(newIcon ? { icon: newIcon } : {}),
        category: newCategory,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['itemTypes', factionId] });
      setCreateOpen(false);
      setNewName('');
      setNewIsCurrency(false);
      setNewImageUrl('');
      setNewIcon('');
      setNewCategory('other');
      toast({ title: t('itemTypes.created') });
    },
    onError: (err: unknown) => {
      toast({
        title: t('itemTypes.createFailed'),
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
        icon: editIcon || null,
        category: editCategory,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['itemTypes', factionId] });
      setEditOpen(false);
      setEditTarget(null);
      toast({ title: t('itemTypes.updated') });
    },
    onError: (err: unknown) => {
      toast({
        title: t('common.updateFailed'),
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
      toast({ title: t('itemTypes.disabled') });
    },
    onError: (err: unknown) => {
      toast({
        title: t('itemTypes.disableFailed'),
        description: apiErrorMessage(err),
        variant: 'destructive',
      });
    },
  });

  const openEdit = (item: ItemType) => {
    setEditTarget(item);
    setEditName(item.name);
    setEditIsCurrency(item.isCurrency);
    setEditImageUrl(item.imageUrl ?? '');
    setEditIcon(item.icon ?? '');
    setEditCategory(item.category ?? 'other');
    setEditActive(item.isActive);
    setEditOpen(true);
  };

  return (
    <>
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-lg font-semibold">{t('settings.itemTypes')}</h3>
          <p className="text-sm text-zinc-500">{t('itemTypes.intro')}</p>
        </div>
        <div className="flex items-center gap-2">
          <ConfigIoButtons factionId={factionId} resource="item-types" canManage={canManage} />
          <Button onClick={() => setCreateOpen(true)}>
            <Plus className="mr-2 h-4 w-4" />
            {t('itemTypes.addType')}
          </Button>
        </div>
      </div>

      <Card>
        <CardContent className="p-0">
          {isLoading ? (
            <div className="p-6 space-y-3">
              {[...Array(3)].map((_, i) => (
                <Skeleton key={i} className="h-12 w-full" />
              ))}
            </div>
          ) : isError ? (
            <ErrorState error={error} onRetry={() => refetch()} />
          ) : itemTypes.length === 0 ? (
            <div className="p-12 text-center text-zinc-500">
              <Package className="h-8 w-8 mx-auto mb-2 opacity-50" />
              <p>{t('itemTypes.noneConfigured')}</p>
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-[52px]"></TableHead>
                  <TableHead>{t('common.name')}</TableHead>
                  <TableHead>{t('entries.type')}</TableHead>
                  <TableHead>{t('nav.entries')}</TableHead>
                  <TableHead>{t('common.status')}</TableHead>
                  <TableHead className="w-[100px]">{t('common.actions')}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {itemTypes.map((item: ItemType) => (
                  <TableRow key={item.id} className={!item.isActive ? 'opacity-50' : ''}>
                    <TableCell>
                      <ItemIcon src={item.imageUrl} icon={item.icon} category={item.category} className="size-8" />
                    </TableCell>
                    <TableCell className="font-medium">{item.name}</TableCell>
                    <TableCell>
                      <Badge
                        variant="outline"
                        className={item.isCurrency
                          ? 'border-emerald-500/30 text-emerald-400 bg-emerald-500/10'
                          : 'border-blue-500/30 text-blue-400 bg-blue-500/10'
                        }
                      >
                        {item.isCurrency ? t('itemTypes.currency') : t('itemTypes.goods')}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-sm">{item.entryCount ?? 0}</TableCell>
                    <TableCell>
                      <Badge variant={item.isActive ? 'default' : 'secondary'}>
                        {item.isActive ? t('common.active') : t('common.disabled')}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-1">
                        <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => openEdit(item)}>
                          <Pencil className="h-3.5 w-3.5" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-8 w-8 text-destructive"
                          onClick={() => setDeleteTarget(item)}
                          disabled={!item.isActive}
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
            <DialogTitle>{t('itemTypes.create')}</DialogTitle>
            <DialogDescription>{t('itemTypes.createHint')}</DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label>{t('common.name')}</Label>
              <Input placeholder={t('itemTypes.namePlaceholder')} value={newName} onChange={(e) => setNewName(e.target.value)} />
            </div>
            <div className="flex items-center justify-between rounded-lg border p-3">
              <div>
                <p className="text-sm font-medium">{t('itemTypes.currencyLabel')}</p>
                <p className="text-xs text-zinc-500">{t('itemTypes.currencyHint')}</p>
              </div>
              <Switch checked={newIsCurrency} onCheckedChange={setNewIsCurrency} />
            </div>
            <div className="space-y-2">
              <Label>{t('itemTypes.imageUrl')}</Label>
              <div className="flex items-center gap-3">
                <ItemIcon src={newImageUrl.trim() || null} icon={newIcon || null} category={newCategory} className="size-10" />
                <Input
                  placeholder="https://example.com/icon.png"
                  value={newImageUrl}
                  onChange={(e) => setNewImageUrl(e.target.value)}
                />
              </div>
              <p className="text-xs text-zinc-500">{t('itemTypes.imageUrlHint')}</p>
            </div>
            <IconCategoryPicker
              icon={newIcon}
              onIconChange={setNewIcon}
              category={newCategory}
              onCategoryChange={setNewCategory}
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCreateOpen(false)}>{t('common.cancel')}</Button>
            <Button
              onClick={() => createMutation.mutate()}
              disabled={!newName.trim() || createMutation.isPending}
            >
              {createMutation.isPending ? t('common.creating') : t('common.create')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Edit Dialog */}
      <Dialog open={editOpen} onOpenChange={setEditOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t('itemTypes.edit')}</DialogTitle>
            <DialogDescription>{t('itemTypes.editHint')}</DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label>{t('common.name')}</Label>
              <Input value={editName} onChange={(e) => setEditName(e.target.value)} />
            </div>
            <div className="flex items-center justify-between rounded-lg border p-3">
              <div>
                <p className="text-sm font-medium">{t('itemTypes.currencyLabel')}</p>
                <p className="text-xs text-zinc-500">{t('itemTypes.currencyEditHint')}</p>
              </div>
              <Switch checked={editIsCurrency} onCheckedChange={setEditIsCurrency} />
            </div>
            <div className="space-y-2">
              <Label>{t('itemTypes.imageUrl')}</Label>
              <div className="flex items-center gap-3">
                <ItemIcon src={editImageUrl.trim() || null} icon={editIcon || null} category={editCategory} className="size-10" />
                <Input
                  placeholder="https://example.com/icon.png"
                  value={editImageUrl}
                  onChange={(e) => setEditImageUrl(e.target.value)}
                />
              </div>
              <p className="text-xs text-zinc-500">{t('itemTypes.clearImageHint')}</p>
            </div>
            <IconCategoryPicker
              icon={editIcon}
              onIconChange={setEditIcon}
              category={editCategory}
              onCategoryChange={setEditCategory}
            />
            <div className="flex items-center justify-between rounded-lg border p-3">
              <div>
                <p className="text-sm font-medium">{t('common.active')}</p>
                <p className="text-xs text-zinc-500">{t('itemTypes.disabledHint')}</p>
              </div>
              <Switch checked={editActive} onCheckedChange={setEditActive} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditOpen(false)}>{t('common.cancel')}</Button>
            <Button
              onClick={() => updateMutation.mutate()}
              disabled={!editName.trim() || updateMutation.isPending}
            >
              {updateMutation.isPending ? t('common.saving') : t('common.saveChanges')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete Confirmation */}
      <AlertDialog open={!!deleteTarget} onOpenChange={(open) => !open && setDeleteTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t('itemTypes.disableConfirmTitle', { name: deleteTarget?.name ?? '' })}</AlertDialogTitle>
            <AlertDialogDescription>{t('itemTypes.disableConfirmBody')}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t('common.cancel')}</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => deleteMutation.mutate()}
              disabled={deleteMutation.isPending}
              className="bg-red-500 text-white hover:bg-red-600"
            >
              {deleteMutation.isPending ? t('itemTypes.disabling') : t('itemTypes.disable')}
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

function QuotasSection({ factionId, canManage = false }: { factionId: string; canManage?: boolean }) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const [createOpen, setCreateOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<Quota | null>(null);
  const [historyTarget, setHistoryTarget] = useState<Quota | null>(null);
  const { data: historyData, isLoading: historyLoading } = useQuery({
    queryKey: ['quota-history', factionId, historyTarget?.id],
    queryFn: () => quotasApi.history(factionId, historyTarget!.id),
    enabled: !!historyTarget,
  });

  // Create form — Scope lets you target the whole faction (the default) or a
  // single member. Per-member quotas only count that member's contributions.
  const [newItemTypeId, setNewItemTypeId] = useState('');
  const [newTargetAmount, setNewTargetAmount] = useState('');
  const [newPeriodType, setNewPeriodType] = useState<'weekly' | 'monthly'>('weekly');
  const [newScope, setNewScope] = useState<'faction' | 'everyone' | 'member'>('faction');
  const [newTargetUserId, setNewTargetUserId] = useState<string>('');
  const [newPeriodStart, setNewPeriodStart] = useState(() => {
    const d = new Date();
    const day = d.getDay();
    const diff = day === 0 ? 1 : 8 - day;
    const monday = new Date(d);
    monday.setDate(d.getDate() + diff);
    return todayLocalDateString(monday);
  });

  // Edit form
  const [editTarget, setEditTarget] = useState<Quota | null>(null);
  const [editTargetAmount, setEditTargetAmount] = useState('');
  const [editPeriodType, setEditPeriodType] = useState<'weekly' | 'monthly'>('weekly');
  const [editPeriodStart, setEditPeriodStart] = useState('');
  const [editActive, setEditActive] = useState(true);

  const { data: quotasList = [], isLoading: quotasLoading, isError: quotasIsError, error: quotasError, refetch: quotasRefetch } = useQuery({
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

  const activeItemTypes = useMemo(() => itemTypes.filter((t: ItemType) => t.isActive), [itemTypes]);

  const itemTypeOptions = useMemo<SearchableSelectOption[]>(() => activeItemTypes.map((item: ItemType) => ({
    value: item.id,
    label: item.name,
    hint: item.unit ? `(${item.unit})` : undefined,
    icon: <ItemIcon src={item.imageUrl} icon={item.icon} category={item.category} className="size-5" />,
  })), [activeItemTypes]);

  const scopeOptions = useMemo<SearchableSelectOption[]>(
    () => Object.entries(SCOPE_KEYS).map(([value, key]) => ({ value, label: t(key) })),
    [t],
  );

  const periodTypeOptions = useMemo<SearchableSelectOption[]>(
    () => Object.entries(PERIOD_TYPE_KEYS).map(([value, key]) => ({ value, label: t(key) })),
    [t],
  );

  // Same shape as everywhere else members are listed: in-game name first, the
  // Discord name in parentheses, both of them searchable.
  const memberOptions = useMemo<SearchableSelectOption[]>(() => members.map((m: Member) => ({
    value: m.userId,
    label: displayName(m),
    hint: m.inGameName?.trim() ? `(${m.username})` : undefined,
    icon: (
      <Avatar className="size-5">
        <AvatarImage src={m.avatarUrl ?? undefined} />
        <AvatarFallback className="text-[9px]">{displayName(m).slice(0, 2).toUpperCase()}</AvatarFallback>
      </Avatar>
    ),
  })), [members]);

  const createMutation = useMutation({
    mutationFn: () =>
      quotasApi.create(factionId, {
        itemTypeId: newItemTypeId,
        targetAmount: newTargetAmount,
        periodType: newPeriodType,
        periodStart: newPeriodStart,
        scope: newScope,
        targetUserId: newScope === 'member' ? newTargetUserId : null,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['quotas', factionId] });
      setCreateOpen(false);
      resetCreateForm();
      toast({ title: t('quota.created') });
    },
    onError: (err: unknown) => {
      toast({
        title: t('quota.createFailed'),
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
      toast({ title: t('quota.updated') });
    },
    onError: (err: unknown) => {
      toast({
        title: t('common.updateFailed'),
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
      toast({ title: t('quota.deleted') });
    },
    onError: (err: unknown) => {
      toast({
        title: t('common.deleteFailed'),
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
    setNewPeriodStart(todayLocalDateString(monday));
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
    if (q.scope === 'everyone') return t('quota.scope.everyone');
    if (!q.targetUserId) return t('quota.scope.faction');
    if (q.targetUsername) return q.targetUsername;
    const m = members.find((mm) => mm.userId === q.targetUserId);
    return m?.username ?? t('quota.scope.member');
  };

  return (
    <>
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-lg font-semibold">{t('settings.quotas')}</h3>
          <p className="text-sm text-zinc-500">{t('quota.intro')}</p>
        </div>
        <div className="flex items-center gap-2">
          <ConfigIoButtons factionId={factionId} resource="quotas" canManage={canManage} />
          <Button onClick={() => setCreateOpen(true)}>
            <Plus className="mr-2 h-4 w-4" />
            {t('quota.add')}
          </Button>
        </div>
      </div>

      <Card>
        <CardContent className="p-0">
          {quotasLoading ? (
            <div className="p-6 space-y-3">
              {[...Array(3)].map((_, i) => (
                <Skeleton key={i} className="h-12 w-full" />
              ))}
            </div>
          ) : quotasIsError ? (
            <ErrorState error={quotasError} onRetry={() => quotasRefetch()} />
          ) : quotasList.length === 0 ? (
            <div className="p-12 text-center text-zinc-500">
              <Target className="h-8 w-8 mx-auto mb-2 opacity-50" />
              <p>{t('quota.noneConfigured')}</p>
              <p className="text-xs mt-1">{t('quota.noneConfiguredHint')}</p>
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t('entries.itemType')}</TableHead>
                  <TableHead>{t('quota.scope')}</TableHead>
                  <TableHead>{t('quota.period')}</TableHead>
                  <TableHead>{t('quota.target')}</TableHead>
                  <TableHead>{t('quota.progress')}</TableHead>
                  <TableHead>{t('common.status')}</TableHead>
                  <TableHead className="w-[100px]">{t('common.actions')}</TableHead>
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
                          <ItemIcon src={q.itemImageUrl} icon={q.itemIcon} category={q.itemCategory} className="size-5" />
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
                        ) : q.scope === 'everyone' ? (
                          <Badge variant="outline" className="text-[10px] border-violet-500/30 text-violet-400 bg-violet-500/10">
                            {t('quota.scope.everyone')}
                          </Badge>
                        ) : (
                          <span className="text-xs text-zinc-500">{t('quota.scope.faction')}</span>
                        )}
                      </TableCell>
                      <TableCell>
                        <Badge variant="outline">
                          {PERIOD_TYPE_KEYS[q.periodType] ? t(PERIOD_TYPE_KEYS[q.periodType]) : q.periodType}
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
                                className={`h-full rounded-full energy-bar transition-all duration-500 ${met ? 'bg-green-500' : 'bg-primary'}`}
                                style={{ width: `${Math.min(pct, 100)}%` }}
                              />
                            </div>
                          </div>
                        ) : q.isActive && !q.periodActive ? (
                          <span className="text-xs text-zinc-500">{t('quota.startsOn', { date: q.periodStart })}</span>
                        ) : (
                          <span className="text-xs text-zinc-500">—</span>
                        )}
                      </TableCell>
                      <TableCell>
                        <div className="space-y-1">
                          <Badge variant={q.isActive ? 'default' : 'secondary'}>
                            {q.isActive ? (met ? t('quota.met') : t('common.active')) : t('common.disabled')}
                          </Badge>
                          {q.isActive && q.previousPeriod && !q.previousPeriod.met && (
                            <p className="text-[11px] text-amber-500 tabular-nums">
                              {t('quota.lastPeriodNotMet', {
                                current: formatAmount(q.previousPeriod.currentAmount, q.itemUnit, q.itemIsCurrency),
                                target: formatAmount(q.previousPeriod.targetAmount, q.itemUnit, q.itemIsCurrency),
                              })}
                            </p>
                          )}
                        </div>
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center gap-1">
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-8 w-8"
                            title={t('quota.history')}
                            onClick={() => setHistoryTarget(q)}
                          >
                            <History className="h-3.5 w-3.5" />
                          </Button>
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

      {/* Quota History Dialog */}
      <Dialog open={!!historyTarget} onOpenChange={(open) => { if (!open) setHistoryTarget(null); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t('quota.history')}</DialogTitle>
            <DialogDescription>
              {historyTarget ? `${historyTarget.itemTypeName} · ${PERIOD_TYPE_KEYS[historyTarget.periodType] ? t(PERIOD_TYPE_KEYS[historyTarget.periodType]) : historyTarget.periodType}` : ''}
            </DialogDescription>
          </DialogHeader>
          {historyLoading ? (
            <div className="space-y-2"><Skeleton className="h-8 w-full" /><Skeleton className="h-8 w-full" /></div>
          ) : (
            <div className="space-y-3">
              <p className="text-sm text-zinc-300">
                {t('quota.historySummary', {
                  met: historyData?.summary.met ?? 0,
                  total: historyData?.summary.total ?? 0,
                })}
              </p>
              <div className="max-h-[300px] overflow-y-auto rounded-lg border border-white/[0.06]">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>{t('quota.period')}</TableHead>
                      <TableHead>{t('quota.progress')}</TableHead>
                      <TableHead className="w-[70px]">{t('common.status')}</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {(historyData?.periods ?? []).slice().reverse().map((p) => (
                      <TableRow key={p.periodStart}>
                        <TableCell className="text-xs text-zinc-400 tabular-nums whitespace-nowrap">{p.periodStart} — {p.periodEnd}</TableCell>
                        <TableCell className="text-xs tabular-nums text-zinc-300">
                          {formatAmount(p.currentAmount, historyTarget!.itemUnit, historyTarget!.itemIsCurrency)} {t('quota.ofTarget', { amount: formatAmount(p.targetAmount, historyTarget!.itemUnit, historyTarget!.itemIsCurrency) })}
                        </TableCell>
                        <TableCell>
                          <Badge variant="outline" className={p.met ? 'border-emerald-500/30 text-emerald-400' : 'border-amber-500/30 text-amber-400'}>
                            {p.met ? t('quota.met') : t('quota.notMet')}
                          </Badge>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* Create Quota Dialog */}
      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t('quota.create')}</DialogTitle>
            <DialogDescription>{t('quota.createHint')}</DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label>{t('entries.itemType')}</Label>
              <SearchableSelect
                value={newItemTypeId}
                onValueChange={setNewItemTypeId}
                options={itemTypeOptions}
                placeholder={t('itemTypes.select')}
                searchPlaceholder={t('itemTypes.search')}
                emptyMessage={t('itemTypes.noneMatch')}
              />
            </div>
            <div className="space-y-2">
              <Label>{t('quota.scope')}</Label>
              <SearchableSelect
                aria-label={t('quota.scope')}
                value={newScope}
                onValueChange={(v) => {
                  setNewScope(v as 'faction' | 'everyone' | 'member');
                  if (v === 'faction') setNewTargetUserId('');
                }}
                options={scopeOptions}
              />
              <p className="text-xs text-zinc-500">
                {newScope === 'faction'
                  ? t('quota.scopeFactionHint')
                  : newScope === 'everyone'
                    ? t('quota.scopeEveryoneHint')
                    : t('quota.scopeMemberHint')}
              </p>
            </div>
            {newScope === 'member' && (
              <div className="space-y-2">
                <Label>{t('role.member')}</Label>
                <SearchableSelect
                  value={newTargetUserId}
                  onValueChange={setNewTargetUserId}
                  options={memberOptions}
                  placeholder={t('members.select')}
                  searchPlaceholder={t('members.search')}
                  emptyMessage={t('members.noneMatch')}
                />
              </div>
            )}
            <div className="space-y-2">
              <Label>{t('quota.targetAmount')}</Label>
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
              <Label>{t('quota.periodType')}</Label>
              <SearchableSelect
                aria-label={t('quota.periodType')}
                value={newPeriodType}
                onValueChange={(v) => setNewPeriodType(v as 'weekly' | 'monthly')}
                options={periodTypeOptions}
              />
            </div>
            <div className="space-y-2">
              <Label>{t('quota.startDate')}</Label>
              <Input
                type="date"
                value={newPeriodStart}
                onChange={(e) => setNewPeriodStart(e.target.value)}
              />
              <p className="text-xs text-zinc-500">{t('quota.startDateHint')}</p>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCreateOpen(false)}>{t('common.cancel')}</Button>
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
              {createMutation.isPending ? t('common.creating') : t('quota.create')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Edit Quota Dialog */}
      <Dialog open={editOpen} onOpenChange={setEditOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t('quota.edit')}</DialogTitle>
            <DialogDescription>{t('quota.editHint', { itemType: editTarget?.itemTypeName ?? '' })}</DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label>{t('quota.targetAmount')}</Label>
              <Input
                type="number"
                step="0.01"
                min="0.01"
                value={editTargetAmount}
                onChange={(e) => setEditTargetAmount(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label>{t('quota.periodType')}</Label>
              <SearchableSelect
                aria-label={t('quota.periodType')}
                value={editPeriodType}
                onValueChange={(v) => setEditPeriodType(v as 'weekly' | 'monthly')}
                options={periodTypeOptions}
              />
            </div>
            <div className="space-y-2">
              <Label>{t('quota.startDate')}</Label>
              <Input
                type="date"
                value={editPeriodStart}
                onChange={(e) => setEditPeriodStart(e.target.value)}
              />
            </div>
            <div className="flex items-center justify-between rounded-lg border p-3">
              <div>
                <p className="text-sm font-medium">{t('common.active')}</p>
                <p className="text-xs text-zinc-500">{t('quota.disabledHint')}</p>
              </div>
              <Switch checked={editActive} onCheckedChange={setEditActive} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditOpen(false)}>{t('common.cancel')}</Button>
            <Button
              onClick={() => updateMutation.mutate()}
              disabled={!editTargetAmount || Number(editTargetAmount) <= 0 || updateMutation.isPending}
            >
              {updateMutation.isPending ? t('common.saving') : t('common.saveChanges')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete Confirmation */}
      <AlertDialog open={!!deleteTarget} onOpenChange={(open) => !open && setDeleteTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t('quota.deleteConfirmTitle', { itemType: deleteTarget?.itemTypeName ?? '' })}</AlertDialogTitle>
            <AlertDialogDescription>{t('quota.deleteConfirmBody')}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t('common.cancel')}</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => deleteMutation.mutate()}
              disabled={deleteMutation.isPending}
              className="bg-red-500 text-white hover:bg-red-600"
            >
              {deleteMutation.isPending ? t('common.deleting') : t('common.delete')}
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
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const updateGlobalBrandColor = useAppStore((s) => s.setBrandColor);

  // Customization is read/written through factionSettingsApi so faction
  // admins (manage_settings OR manage_customization) can edit it — the
  // factionsApi.update endpoint is superadmin-only and would 403 most users.
  const { data: settings, isLoading, isError, error, refetch } = useQuery({
    queryKey: ['faction-settings', factionId],
    queryFn: () => factionSettingsApi.get(factionId),
    staleTime: 30 * 1000,
  });

  const [brandColor, setBrandColor] = useState('#3b82f6');
  const [customFields, setCustomFields] = useState<{ name: string; required: boolean }[]>([]);
  const [newFieldName, setNewFieldName] = useState('');
  const [saving, setSaving] = useState(false);

  const initialized = useRef(false);
  useEffect(() => {
    if (settings && !initialized.current) {
      setBrandColor(settings.brandColor ?? '#3b82f6');
      setCustomFields(settings.customFields ?? []);
      initialized.current = true;
    }
  }, [settings]);

  const saveMutation = useMutation({
    mutationFn: () =>
      factionSettingsApi.update(factionId, { brandColor, customFields }),
    onSuccess: () => {
      updateGlobalBrandColor(brandColor);
      queryClient.invalidateQueries({ queryKey: ['faction-settings', factionId] });
      queryClient.invalidateQueries({ queryKey: ['faction-brand', factionId] });
      queryClient.invalidateQueries({ queryKey: ['faction-detail', factionId] });
      queryClient.invalidateQueries({ queryKey: ['dashboard', factionId] });
      toast({ title: t('settings.customizationSaved') });
    },
    onError: (err: unknown) => {
      toast({ title: t('common.saveFailed'), description: apiErrorMessage(err), variant: 'destructive' });
    },
  });

  const addField = () => {
    const name = newFieldName.trim();
    if (!name) return;
    if (customFields.some((f) => f.name.toLowerCase() === name.toLowerCase())) {
      toast({ title: t('settings.fieldNameExists'), variant: 'destructive' });
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

  if (isError) {
    return <ErrorState error={error} onRetry={() => refetch()} />;
  }

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm text-zinc-200">{t('settings.brandColor')}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <p className="text-sm text-zinc-500">{t('settings.brandColorHint')}</p>
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
          <CardTitle className="text-sm text-zinc-200">{t('settings.customFields')}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <p className="text-sm text-zinc-500">{t('settings.customFieldsHint')}</p>
          <div className="flex gap-2">
            <Input
              placeholder={t('settings.fieldNamePlaceholder')}
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
                    {t('common.required')}
                  </label>
                  <Button variant="ghost" size="icon" className="h-7 w-7 text-destructive" onClick={() => removeField(idx)}>
                    <X className="h-3.5 w-3.5" />
                  </Button>
                </div>
              ))}
            </div>
          )}
          {customFields.length === 0 && (
            <p className="text-sm text-zinc-500 text-center py-4">{t('settings.noCustomFields')}</p>
          )}
        </CardContent>
      </Card>

      <Button onClick={handleSave} disabled={saving || saveMutation.isPending}>
        {saving ? t('common.saving') : t('common.saveChanges')}
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
  canManage = false,
}: {
  factionId: string;
  isFactionAdmin: boolean;
  canManage?: boolean;
}) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const brandColor = useAppStore((s) => s.brandColor);

  const { data: settings, isLoading, isError, error, refetch } = useQuery({
    queryKey: ['faction-settings', factionId],
    queryFn: () => factionSettingsApi.get(factionId),
    staleTime: 0,
  });

  const [ranks, setRanks] = useState<FactionRank[]>([]);
  const [inactivityThreshold, setInactivityThreshold] = useState(7);
  const [strikeExpiry, setStrikeExpiry] = useState<{ warning: number | null; minor: number | null; major: number | null }>({ warning: 30, minor: 90, major: null });
  const [strikeEscalation, setStrikeEscalation] = useState<{ warning: number | null; minor: number | null; major: number | null }>({ warning: null, minor: null, major: null });
  const [expenseBudgets, setExpenseBudgets] = useState<{ warehouse: number | null; utilities: number | null; supplies: number | null; other: number | null }>({ warehouse: null, utilities: null, supplies: null, other: null });
  const [hasChanges, setHasChanges] = useState(false);
  const [saving, setSaving] = useState(false);

  // Sync from server
  useEffect(() => {
    if (settings) {
      setRanks(settings.ranks);
      setInactivityThreshold(settings.inactivityThresholdDays);
      setStrikeExpiry(settings.strikeExpiryDays);
      setStrikeEscalation(settings.strikeEscalation);
      setExpenseBudgets(settings.expenseBudgets);
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
        strikeEscalation,
        expenseBudgets,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['faction-settings', factionId] });
      setHasChanges(false);
      toast({ title: t('settings.factionSettingsSaved') });
    },
    onError: (err: unknown) => {
      toast({ title: t('common.failed'), description: apiErrorMessage(err), variant: 'destructive' });
    },
    onSettled: () => setSaving(false),
  });

  if (isLoading) {
    return <div className="space-y-4"><Skeleton className="h-64 w-full" /><Skeleton className="h-48 w-full" /></div>;
  }

  if (isError) {
    return <ErrorState error={error} onRetry={() => refetch()} />;
  }

  return (
    <div className="space-y-6">
      {/* ── Ranks ── */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle className="text-sm text-zinc-200">{t('settings.rankHierarchy')}</CardTitle>
            <div className="flex items-center gap-2">
              <ConfigIoButtons factionId={factionId} resource="ranks" canManage={canManage} />
              <Button size="sm" variant="outline" onClick={addRank}><Plus className="mr-1.5 h-3.5 w-3.5" /> {t('settings.addRank')}</Button>
            </div>
          </div>
          <p className="text-xs text-zinc-500 mt-1">
            {t('settings.rankHierarchyHint')}
            {!isFactionAdmin && ` ${t('settings.rankPermissionsAdminOnly')}`}
          </p>
        </CardHeader>
        <CardContent>
          {ranks.length === 0 ? (
            <EmptyState icon={Shield} title={t('settings.noRanksYet')} compact />
          ) : (
            <div className="space-y-3">
              {[...ranks].sort((a, b) => a.level - b.level).map((r, sortedIdx) => {
                // The original index in the unsorted array, so toggles map back
                // to the right rank even after we re-sort for display.
                const idx = ranks.findIndex((rr) => rr === r);
                return (
                  <div key={idx} className="rounded-lg border border-white/[0.06] p-3 space-y-2">
                    <div className="flex items-center gap-2">
                      <span className="text-xs text-zinc-600 w-6 text-center tabular-nums">{t('settings.levelShort', { level: r.level })}</span>
                      <Input
                        className="flex-1 h-8 text-sm"
                        value={r.name}
                        onChange={(e) => updateRank(idx, 'name', e.target.value)}
                        placeholder={t('settings.rankNamePlaceholder')}
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
                              title={`${t(PERMISSION_LABEL_KEYS[perm])} — ${t('settings.rankPermissionsAdminOnly')}`}
                            >
                              {t(PERMISSION_LABEL_KEYS[perm])}
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
                            title={t(PERMISSION_LABEL_KEYS[perm])}
                          >
                            {t(PERMISSION_LABEL_KEYS[perm])}
                          </button>
                        );
                      })}
                      {!isFactionAdmin && r.permissions.length === 0 && (
                        <span className="text-[10px] text-zinc-600">{t('settings.noPermissions')}</span>
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
          <CardTitle className="text-sm text-zinc-200">{t('settings.inactivityThreshold')}</CardTitle>
          <p className="text-xs text-zinc-500 mt-1">{t('settings.inactivityThresholdHint')}</p>
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
            <span className="text-sm text-zinc-500">{t('common.days')}</span>
          </div>
        </CardContent>
      </Card>

      {/* ── Strike Expiry ── */}
      <Card>
        <CardHeader>
          <CardTitle className="text-sm text-zinc-200">{t('settings.strikeExpiry')}</CardTitle>
          <p className="text-xs text-zinc-500 mt-1">{t('settings.strikeExpiryHint')}</p>
        </CardHeader>
        <CardContent>
          <div className="space-y-3 max-w-sm">
            {(['warning', 'minor', 'major'] as const).map((sev) => (
              <div key={sev} className="flex items-center gap-3">
                <span className="text-sm text-zinc-300 w-14">{t(SEVERITY_KEYS[sev])}</span>
                <Input
                  type="number"
                  min={1}
                  placeholder={t('settings.never')}
                  value={strikeExpiry[sev] ?? ''}
                  onChange={(e) => {
                    const val = e.target.value;
                    setStrikeExpiry(prev => ({ ...prev, [sev]: val === '' ? null : Number(val) }));
                    markChanged();
                  }}
                  className="tabular-nums"
                />
                <span className="text-xs text-zinc-600">{t('common.days')}</span>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* ── Expense Budgets ── */}
      <Card>
        <CardHeader>
          <CardTitle className="text-sm text-zinc-200">{t('settings.expenseBudgets')}</CardTitle>
          <p className="text-xs text-zinc-500 mt-1">{t('settings.expenseBudgetsHint')}</p>
        </CardHeader>
        <CardContent>
          <div className="space-y-3 max-w-sm">
            {(['warehouse', 'utilities', 'supplies', 'other'] as const).map((cat) => (
              <div key={cat} className="flex items-center gap-3">
                <span className="text-sm text-zinc-300 w-14">{t(EXPENSE_CATEGORY_LABELS[cat])}</span>
                <Input
                  type="number"
                  min={0}
                  placeholder={t('settings.never')}
                  value={expenseBudgets[cat] ?? ''}
                  onChange={(e) => {
                    const val = e.target.value;
                    setExpenseBudgets(prev => ({ ...prev, [cat]: val === '' ? null : Number(val) }));
                    markChanged();
                  }}
                  className="tabular-nums"
                />
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* ── Strike Escalation ── */}
      <Card>
        <CardHeader>
          <CardTitle className="text-sm text-zinc-200">{t('settings.strikeEscalation')}</CardTitle>
          <p className="text-xs text-zinc-500 mt-1">{t('settings.strikeEscalationHint')}</p>
        </CardHeader>
        <CardContent>
          <div className="space-y-3 max-w-sm">
            {(['warning', 'minor', 'major'] as const).map((sev) => (
              <div key={sev} className="flex items-center gap-3">
                <span className="text-sm text-zinc-300 w-14">{t(SEVERITY_KEYS[sev])}</span>
                <Input
                  type="number"
                  min={1}
                  placeholder={t('settings.never')}
                  value={strikeEscalation[sev] ?? ''}
                  onChange={(e) => {
                    const val = e.target.value;
                    setStrikeEscalation(prev => ({ ...prev, [sev]: val === '' ? null : Number(val) }));
                    markChanged();
                  }}
                  className="tabular-nums"
                />
                <span className="text-xs text-zinc-600">{t('settings.escalationUnit')}</span>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* Save */}
      {hasChanges && (
        <div className="flex justify-end">
          <Button onClick={() => { setSaving(true); saveMutation.mutate(); }} disabled={saving || saveMutation.isPending}>
            {saving || saveMutation.isPending ? t('common.saving') : t('settings.saveFactionSettings')}
          </Button>
        </div>
      )}
    </div>
  );
}
