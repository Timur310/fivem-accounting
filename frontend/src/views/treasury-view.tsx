'use client';

import { useMemo, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { treasuryApi, expensesApi, itemTypesApi, factionSettingsApi, apiErrorMessage } from '@/lib/api-client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import {
  Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import {
  SearchableSelect, type SearchableSelectOption,
} from '@/components/ui/searchable-select';
import {
  Wallet, TrendingDown, Clock, ArrowDownToLine, Search,
  ArrowDownWideNarrow, ArrowUpNarrowWide, Receipt, Plus, Trash2, Pencil, ClipboardCheck, ChevronDown,
} from 'lucide-react';
import { useAppStore } from '@/lib/store';
import { formatAmount, displayName, formatNumber, todayLocalDateString } from '@/lib/format';
import { getIntlLocale } from '@/lib/i18n';
import { ItemIcon } from '@/components/item-icon';
import { useTranslation } from '@/providers/i18n-provider';
import { useCountUp } from '@/hooks/use-count-up';
import { cn } from '@/lib/utils';
import { EmptyState, ErrorState } from '@/components/ui/empty-state';
import { AmountPreview } from '@/components/ui/amount-preview';
import { useToast } from '@/hooks/use-toast';
import type { TranslationKey } from '@/lib/i18n';
import type { ItemType, ExpenseCategory, Expense } from '@/lib/api-types';
import { EXPENSE_CATEGORIES } from '@/lib/api-types';

interface Props {
  factionId: string;
  canManageExpenses?: boolean;
  canManageChecks?: boolean;
}

/** Category names as the API spells them, with their label keys. */
const EXPENSE_CATEGORY_KEYS: Record<ExpenseCategory, TranslationKey> = {
  warehouse: 'expenses.category.warehouse',
  utilities: 'expenses.category.utilities',
  supplies: 'expenses.category.supplies',
  other: 'expenses.category.other',
};

type SortField = 'name' | 'balance';
type SortDirection = 'asc' | 'desc';

export function TreasuryView({ factionId, canManageExpenses = false, canManageChecks = false }: Props) {
  const { t } = useTranslation();
  const brandColor = useAppStore((s) => s.brandColor);

  const [nameFilter, setNameFilter] = useState('');
  // Reference detail, not the daily glance: the balance grid stays folded.
  const [balancesOpen, setBalancesOpen] = useState(false);
  const [sortField, setSortField] = useState<SortField>('name');
  const [sortDirection, setSortDirection] = useState<SortDirection>('asc');

  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ['treasury', factionId],
    queryFn: () => treasuryApi.get(factionId, 30),
    staleTime: 0,
    refetchOnWindowFocus: true,
  });

  if (isLoading) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-8 w-48" />
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {[...Array(3)].map((_, i) => <Skeleton key={i} className="h-28 w-full" />)}
        </div>
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  if (error || !data) {
    return (
      <Card>
        <CardContent className="p-0">
          <ErrorState error={error} onRetry={() => refetch()} />
        </CardContent>
      </Card>
    );
  }

  const fmt = (n: number) => `$${formatNumber(n)}`;

  const { balances, netBalance, totalInflow, totalOutflow, totals, pending, outflowTrend, recentPayouts } = data;

  // The headline figure travels to its new value rather than jumping, so a
  // withdrawal completing is something you watch happen rather than something
  // you notice afterwards. Magnitude only — the sign is rendered separately.
  const displayNetBalance = useCountUp(Math.abs(netBalance));

  // Filtering and ordering are a reading aid over a list the API already sent
  // whole, so both happen here rather than as query parameters: no refetch, and
  // the totals above go on covering every type regardless of what is hidden.
  // `.filter` hands back a fresh array, so sorting it leaves `balances` alone.
  const query = nameFilter.trim().toLowerCase();
  const visibleBalances = balances
    .filter((b) => !query || b.itemTypeName.toLowerCase().includes(query))
    .sort((a, b) => {
      // Collated in the reading language: without it Hungarian sorts "Ő" after
      // "Z" instead of next to "O".
      const order = sortField === 'name'
        ? a.itemTypeName.localeCompare(b.itemTypeName, getIntlLocale())
        : a.balance - b.balance;
      return sortDirection === 'asc' ? order : -order;
    });

  const sortOptions: SearchableSelectOption[] = [
    { value: 'name', label: t('common.name') },
    { value: 'balance', label: t('common.amount') },
  ];

  // The three headline totals cover currency types only — goods have no shared
  // unit to add up. Say so whenever the faction actually tracks any.
  const totalsNote =
    totals.nonCurrencyTypeCount > 0
      ? t('treasury.totalsNoteMixed', {
          count: totals.currencyTypeCount,
          nonCurrency: totals.nonCurrencyTypeCount,
        })
      : t('treasury.totalsNoteAll');

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h2 className="text-xl font-medium tracking-tight text-zinc-100">{t('nav.treasury')}</h2>
        <p className="text-zinc-500 text-sm mt-0.5">{t('treasury.intro')}</p>
      </div>

      {/* ══ Summary Cards ══ */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {/* Net Balance */}
        <Card className={`faction-glow border-highlight lg:col-span-1 sm:col-span-2 ${netBalance < 0 ? 'border-red-500/20' : ''}`}>
          <CardHeader className="pb-2">
            <CardTitle className="text-xs font-normal text-zinc-500 uppercase tracking-wider">{t('treasury.netBalance')}</CardTitle>
          </CardHeader>
          <CardContent className="relative z-10">
            {/* Neutral unless the figure is actually negative — see the note
                on the per-item balances below. */}
            <div className="flex flex-wrap items-center gap-3">
              <div className={cn("text-3xl font-medium tabular-nums tracking-tight", netBalance < 0 ? "text-negative" : "text-zinc-200")}>
                {netBalance < 0 ? '-' : ''}{fmt(displayNetBalance)}
              </div>
              {/* Decorative: the figure is already red and the line below says
                  the same thing in words, so this is hidden from readers. */}
              {netBalance < 0 && (
                <span
                  aria-hidden="true"
                  className="stamp px-2 py-0.5 text-micro font-semibold uppercase text-red-500"
                >
                  {t('treasury.inTheRed')}
                </span>
              )}
            </div>
            <p className="text-xs text-zinc-500 mt-1.5">
              {netBalance < 0 && <span className="text-red-400">⚠ {t('treasury.negativeBalance')}</span>}
              {netBalance >= 0 && totalsNote}
            </p>
          </CardContent>
        </Card>

        {/* Total Inflow */}
        <Card className="border-highlight">
          <CardHeader className="pb-2">
            <CardTitle className="text-xs font-normal text-zinc-500 uppercase tracking-wider">{t('treasury.totalInflow')}</CardTitle>
          </CardHeader>
          <CardContent className="relative z-10">
            <div className="flex items-center gap-2">
              <div className="h-7 w-7 rounded-md bg-emerald-500/10 flex items-center justify-center">
                <TrendingDown className="h-3.5 w-3.5 text-emerald-400 rotate-180" />
              </div>
              <span className="text-2xl font-medium tabular-nums tracking-tight text-emerald-400">
                {fmt(totalInflow)}
              </span>
            </div>
            <p className="text-xs text-zinc-500 mt-1.5">{t('treasury.inflowNote')}</p>
          </CardContent>
        </Card>

        {/* Total Outflow */}
        <Card className="border-highlight">
          <CardHeader className="pb-2">
            <CardTitle className="text-xs font-normal text-zinc-500 uppercase tracking-wider">{t('treasury.totalOutflow')}</CardTitle>
          </CardHeader>
          <CardContent className="relative z-10">
            <div className="flex items-center gap-2">
              <div className="h-7 w-7 rounded-md bg-red-500/10 flex items-center justify-center">
                <ArrowDownToLine className="h-3.5 w-3.5 text-red-400" />
              </div>
              <span className="text-2xl font-medium tabular-nums tracking-tight text-red-400">
                {fmt(totalOutflow)}
              </span>
            </div>
            <p className="text-xs text-zinc-500 mt-1.5">{t('treasury.outflowNote')}</p>
          </CardContent>
        </Card>
      </div>

      {/* ══ Pending Payouts Banner ══ */}
      {pending.count > 0 && (
        <Card className="border-amber-500/20 bg-amber-500/[0.03]">
          <CardContent className="py-4">
            <div className="flex items-center gap-3">
              <div className="h-9 w-9 rounded-lg bg-amber-500/10 flex items-center justify-center shrink-0">
                <Clock className="h-4 w-4 text-amber-400" />
              </div>
              <div className="flex-1">
                <p className="text-sm font-medium text-amber-300">
                  {t('treasury.pendingWithdrawals', { count: pending.count })}
                </p>
                <p className="text-xs text-zinc-500 mt-0.5">
                  {t('treasury.pendingWaiting', { amount: fmt(pending.total) })}
                </p>
              </div>
              <Badge className="bg-amber-500/10 text-amber-400 border border-amber-500/20">
                {fmt(pending.total)}
              </Badge>
            </div>
          </CardContent>
        </Card>
      )}

      {/* ══ Running Expenses ══ */}
      <ExpensesSection factionId={factionId} canManage={canManageExpenses} />

      {/* ══ Balance Cards per Item Type ══ */}
      <Card>
        <CardHeader className="flex-row flex-wrap items-center justify-between gap-3">
          {/* Title and its collapse belong together: with three loose children
              under justify-between the toggle drifted into the middle of the
              row, and wrapped onto its own line before the filters did. */}
          <div className="flex items-center gap-1">
            <CardTitle className="flex items-center gap-2 text-sm text-zinc-200">
              <Wallet className="h-4 w-4 text-zinc-400" />
              {t('treasury.balancesByItemType')}
            </CardTitle>
            <Button
              variant="ghost"
              size="sm"
              className="text-xs text-zinc-400"
              onClick={() => setBalancesOpen((v) => !v)}
            >
              {balancesOpen ? t('treasury.hideBalances') : t('treasury.showBalances', { count: balances.length })}
              <ChevronDown className={`h-3.5 w-3.5 ml-1.5 transition-transform duration-200 ${balancesOpen ? 'rotate-180' : ''}`} />
            </Button>
          </div>
          {/* Nothing to search or reorder until there is a list. */}
          {balancesOpen && balances.length > 0 && (
            <div className="flex items-center gap-2">
              <div className="relative">
                <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-zinc-600" />
                <Input
                  size="sm"
                  className="w-[170px] pl-8"
                  placeholder={t('itemTypes.search')}
                  aria-label={t('itemTypes.search')}
                  value={nameFilter}
                  onChange={(e) => setNameFilter(e.target.value)}
                />
              </div>
              <SearchableSelect
                className="w-[120px]"
                size="sm"
                aria-label={t('treasury.sortBy')}
                value={sortField}
                onValueChange={(v) => setSortField(v as SortField)}
                options={sortOptions}
              />
              <Button
                variant="outline"
                size="icon-sm" className="shrink-0"
                onClick={() => setSortDirection((d) => (d === 'asc' ? 'desc' : 'asc'))}
                title={t('treasury.toggleSortDirection')}
                aria-label={t('treasury.toggleSortDirection')}
              >
                {sortDirection === 'asc'
                  ? <ArrowUpNarrowWide className="h-3.5 w-3.5" />
                  : <ArrowDownWideNarrow className="h-3.5 w-3.5" />}
              </Button>
            </div>
          )}
        </CardHeader>
        {balancesOpen && (
        <CardContent>
          {balances.length === 0 ? (
            <EmptyState icon={Wallet} title={t('treasury.noBalances')}
              hint={t('treasury.noBalancesHint')} compact />
          ) : visibleBalances.length === 0 ? (
            <EmptyState icon={Search} title={t('itemTypes.noneMatch')} hint={t('itemTypes.noneMatchHint')} compact />
          ) : (
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {visibleBalances.map((b) => (
                <div
                  key={b.itemTypeId}
                  className={`rounded-lg border p-4 space-y-3 transition-all duration-150 hover:border-[var(--line-3)] ${
                    b.balance < 0 ? 'border-red-500/20 bg-red-500/[0.02]' : 'border-[var(--line-1)]'
                  }`}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="flex items-center gap-2.5 min-w-0">
                      <ItemIcon src={b.imageUrl} icon={b.icon} category={b.category} className="size-8" />
                      <p className="text-sm font-medium text-zinc-200 truncate">{b.itemTypeName}</p>
                    </span>
                    <Badge
                      variant="outline"
                      className={`text-meta ${
                        b.balance < 0
                          ? 'border-red-500/30 text-red-400 bg-red-500/10'
                          : 'border-emerald-500/30 text-emerald-400 bg-emerald-500/10'
                      }`}
                    >
                      {b.balance < 0 ? t('treasury.negative') : t('treasury.positive')}
                    </Badge>
                  </div>
                  {/* Red is the only colour a balance is allowed to carry,
                      and it means one thing: this vault is in the red. Painting
                      a healthy balance in the faction accent said the same
                      thing in reverse whenever that accent was green — and the
                      opposite whenever it was red. */}
                  <div className={cn("text-2xl font-medium tabular-nums tracking-tight", b.balance < 0 ? "text-negative" : "text-zinc-200")}>
                    {b.balance < 0 ? '-' : ''}{formatAmount(Math.abs(b.balance), b.unit, b.isCurrency)}
                  </div>
                  <div className="flex justify-between text-meta text-zinc-500 tabular-nums">
                    <span className="text-emerald-500/80">{t('treasury.inflowRow', { amount: formatAmount(b.inflow, b.unit, b.isCurrency) })}</span>
                    <span className="text-red-500/80">{t('treasury.outflowRow', { amount: formatAmount(b.outflow, b.unit, b.isCurrency) })}</span>
                  </div>
                  {/* Mini outflow trend */}
                  {b.outflowTrend.length > 1 && (
                    <div className="h-8 flex items-end gap-[2px]">
                      {b.outflowTrend.slice(-14).map((pt, i) => {
                        const max = Math.max(...b.outflowTrend.slice(-14).map((p) => p.total), 1);
                        const h = (pt.total / max) * 100;
                        return (
                          <div
                            key={i}
                            className="flex-1 rounded-t-sm min-h-[2px]"
                            style={{
                              height: `${Math.max(h, 4)}%`,
                              backgroundColor: `${brandColor}${i === b.outflowTrend.slice(-14).length - 1 ? 'cc' : '30'}`,
                            }}
                          />
                        );
                      })}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </CardContent>
        )}
      </Card>

      {/* ══ Outflow Trend ══ */}
      {outflowTrend.length > 1 && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-sm text-zinc-200">
              <TrendingDown className="h-4 w-4 text-zinc-400" />
              {t('treasury.outflowTrend', { days: data.trendDays })}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="h-32 flex items-end gap-[3px]">
              {outflowTrend.map((pt, i) => {
                const max = Math.max(...outflowTrend.map((p) => p.total), 1);
                const h = (pt.total / max) * 100;
                return (
                  <div key={i} className="flex-1 flex flex-col items-center gap-1">
                    <div
                      className="w-full rounded-t-sm min-h-[2px] transition-all duration-200"
                      style={{
                        height: `${Math.max(h, 4)}%`,
                        backgroundColor: i === outflowTrend.length - 1 ? brandColor : `${brandColor}30`,
                      }}
                    />
                  </div>
                );
              })}
            </div>
          </CardContent>
        </Card>
      )}

      {/* ══ Vault verification (counted vs. recorded) ══ */}
      <ChecksSection factionId={factionId} canManage={canManageChecks} />

      {/* ══ Recent Completed Payouts ══ */}
      <Card>
        <CardHeader>
          <CardTitle className="text-sm text-zinc-200">{t('treasury.recentWithdrawals')}</CardTitle>
        </CardHeader>
        <CardContent>
          {recentPayouts.length === 0 ? (
            <EmptyState icon={ArrowDownToLine} title={t('treasury.noCompletedWithdrawals')}
              hint={t('treasury.noCompletedWithdrawalsHint')} compact />
          ) : (
            <div className="space-y-1">
              {recentPayouts.map((p) => (
                <div key={p.id} className="flex items-center gap-3 py-2 px-2 -mx-2 rounded-md hover:bg-[var(--fill-1)] transition-colors duration-100">
                  <Avatar className="h-7 w-7 shrink-0">
                    <AvatarImage src={p.recipientAvatarUrl ?? undefined} />
                    <AvatarFallback className="text-micro">{displayName({ username: p.recipientUsername, inGameName: p.recipientInGameName }).slice(0, 2).toUpperCase()}</AvatarFallback>
                  </Avatar>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm">
                      <span className="text-zinc-300 font-medium">{displayName({ username: p.recipientUsername, inGameName: p.recipientInGameName })}</span>
                      <span className="text-zinc-600"> {t('treasury.received')} </span>
                      <span className="font-medium tabular-nums text-zinc-200">{formatAmount(p.amount, p.itemUnit, p.itemIsCurrency)}</span>
                    </p>
                    <p className="text-meta text-zinc-600 flex items-center gap-1.5">
                      <ItemIcon src={p.itemImageUrl} icon={p.itemIcon} category={p.itemCategory} className="size-4" />
                      <span className="truncate">
                        {p.itemTypeName} &middot; {p.payoutDate}
                        {p.description && ` — ${p.description}`}
                      </span>
                    </p>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

// ── Running Expenses ──────────────────────────────────
// Warehouse rent, utilities and the like: value that left the vault without
// any member receiving it. Listed here rather than in a view of its own,
// because the balance cards above already carry their effect.

function ExpensesSection({ factionId, canManage }: { factionId: string; canManage: boolean }) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const [dialogOpen, setDialogOpen] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [formItemType, setFormItemType] = useState('');
  const [formCategory, setFormCategory] = useState<ExpenseCategory>('other');
  const [formAmount, setFormAmount] = useState('');
  const [formDescription, setFormDescription] = useState('');
  const [formDate, setFormDate] = useState(todayLocalDateString());
  // Deleting used to fire straight off the trash icon. An expense is a real
  // ledger row that moves the vault, and it sits one pixel from Edit.
  const [confirmDelete, setConfirmDelete] = useState<Expense | null>(null);

  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: ['expenses', factionId],
    queryFn: () => expensesApi.list(factionId, { page_size: 100 }),
    staleTime: 0,
  });

  // Only needed to fill the picker; skip the request when the reader cannot
  // open the dialog anyway.
  const { data: itemTypes = [] } = useQuery({
    queryKey: ['item-types', factionId],
    queryFn: () => itemTypesApi.list(factionId),
    enabled: canManage,
  });

  // Budgets and month-to-date spending turn the category totals into
  // "raktár: 80% of budget" — the loop leaders actually close.
  const { data: settings } = useQuery({
    queryKey: ['faction-settings', factionId],
    queryFn: () => factionSettingsApi.get(factionId),
    staleTime: 5 * 60 * 1000,
  });
  const budgets = settings?.expenseBudgets;

  const today = new Date();
  const monthStart = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-01`;
  const { data: monthData } = useQuery({
    queryKey: ['expenses', factionId, 'month', monthStart],
    queryFn: () => expensesApi.list(factionId, { date_from: monthStart, date_to: todayLocalDateString(), page_size: 1 }),
    staleTime: 0,
  });
  const monthTotals = monthData?.categoryTotals ?? [];

  const resetForm = () => {
    setEditId(null);
    setFormItemType('');
    setFormCategory('other');
    setFormAmount('');
    setFormDescription('');
    setFormDate(todayLocalDateString());
  };

  const openCreate = () => {
    resetForm();
    setDialogOpen(true);
  };

  const openEdit = (e: Expense) => {
    setEditId(e.id);
    setFormItemType(e.itemTypeId);
    setFormCategory(e.category);
    setFormAmount(e.amount);
    setFormDescription(e.description ?? '');
    setFormDate(e.expenseDate);
    setDialogOpen(true);
  };

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ['expenses', factionId] });
    // The balance cards above the section read from the treasury query.
    queryClient.invalidateQueries({ queryKey: ['treasury', factionId] });
  };

  const saveMutation = useMutation({
    mutationFn: () => {
      const body = {
        itemTypeId: formItemType,
        category: formCategory,
        amount: formAmount,
        description: formDescription.trim() || undefined,
        expenseDate: formDate,
      };
      return editId
        ? expensesApi.update(factionId, editId, body)
        : expensesApi.create(factionId, body);
    },
    onSuccess: () => {
      invalidate();
      setDialogOpen(false);
      toast({ title: editId ? t('expenses.updated') : t('expenses.created') });
    },
    onError: (err: unknown) => {
      toast({ title: t('common.failed'), description: apiErrorMessage(err), variant: 'destructive' });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (expenseId: string) => expensesApi.remove(factionId, expenseId),
    onSuccess: () => {
      invalidate();
      setConfirmDelete(null);
      toast({ title: t('expenses.deleted') });
    },
    onError: (err: unknown) => {
      toast({ title: t('common.failed'), description: apiErrorMessage(err), variant: 'destructive' });
    },
  });

  const expenses = data?.expenses ?? [];
  const categoryTotals = data?.categoryTotals ?? [];

  /**
   * One tile per category: what it has cost over the listed period, and how
   * the month sits against its cap where one is set.
   *
   * Every category that has either spending or a budget appears, so a cap
   * nobody has spent against yet still shows — a budget you cannot see until
   * you break it is not much of a budget.
   */
  const categorySummary = useMemo(() => {
    const seen = new Set<ExpenseCategory>();
    for (const ct of categoryTotals) seen.add(ct.category);
    if (budgets) {
      for (const [category, cap] of Object.entries(budgets) as [ExpenseCategory, number | null][]) {
        if (cap !== null && cap !== undefined) seen.add(category);
      }
    }

    return EXPENSE_CATEGORIES.filter((c) => seen.has(c)).map((category) => {
      const total = categoryTotals.find((ct) => ct.category === category)?.total ?? 0;
      const cap = budgets?.[category] ?? null;
      const spent = monthTotals.find((ct) => ct.category === category)?.total ?? 0;
      return {
        category,
        label: EXPENSE_CATEGORY_KEYS[category] ? t(EXPENSE_CATEGORY_KEYS[category]) : category,
        total,
        cap,
        spent,
        pct: cap && cap > 0 ? (spent / cap) * 100 : null,
      };
    });
  }, [categoryTotals, budgets, monthTotals, t]);

  const itemTypeOptions: SearchableSelectOption[] = useMemo(
    () => itemTypes.map((it: ItemType) => ({ value: it.id, label: it.name })),
    [itemTypes],
  );

  const canSaveExpense =
    !!formItemType && !!formAmount && Number(formAmount) > 0 && !saveMutation.isPending;

  const categoryOptions: SearchableSelectOption[] = useMemo(
    () => EXPENSE_CATEGORIES.map((c) => ({ value: c, label: t(EXPENSE_CATEGORY_KEYS[c]) })),
    [t],
  );

  const selectedItemType = itemTypes.find((it: ItemType) => it.id === formItemType);

  return (
    <Card>
      <CardHeader className="flex-row flex-wrap items-center justify-between gap-3">
        <CardTitle className="flex items-center gap-2 text-sm text-zinc-200">
          <Receipt className="h-4 w-4 text-zinc-400" />
          {t('treasury.expenses')}
        </CardTitle>
        {canManage && (
          <Button size="sm" onClick={openCreate}>
            <Plus className="mr-1.5 h-3.5 w-3.5" />
            {t('expenses.add')}
          </Button>
        )}
      </CardHeader>
      <CardContent>
        {/* One strip, not two. The totals were a row of loose badges and the
            budgets a separate grid below them, so every capped category
            appeared twice and neither block looked like it belonged to the
            other. A category is one tile: what it has cost, and how that sits
            against its cap when it has one. */}
        {categorySummary.length > 0 && (
          <div className="mb-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
            {categorySummary.map((c) => {
              const over = c.pct !== null && c.pct >= 100;
              const near = c.pct !== null && c.pct >= 80 && !over;
              return (
                <div
                  key={c.category}
                  className={`rounded-lg border px-3 py-2.5 ${
                    over ? 'border-red-500/30 bg-red-500/[0.04]'
                    : near ? 'border-amber-500/30 bg-amber-500/[0.04]'
                    : 'border-[var(--line-1)]'
                  }`}
                >
                  <div className="flex items-baseline justify-between gap-2">
                    <span className="truncate text-xs text-zinc-500">{c.label}</span>
                    <span className="shrink-0 text-sm font-medium tabular-nums text-zinc-200">
                      {formatNumber(c.total)}
                    </span>
                  </div>
                  {c.cap !== null && (
                    <>
                      <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-[var(--fill-2)]">
                        <div
                          className={`energy-bar h-full rounded-full transition-all duration-500 ${
                            over ? 'bg-red-500' : near ? 'bg-amber-500' : 'bg-emerald-500'
                          }`}
                          style={{ width: `${Math.min(c.pct ?? 0, 100)}%` }}
                        />
                      </div>
                      <p className={`mt-1 text-meta tabular-nums ${
                        over ? 'text-red-400' : near ? 'text-amber-400' : 'text-zinc-600'
                      }`}>
                        {t('treasury.budgetMonth')} · {formatNumber(c.spent)} / {formatNumber(c.cap)}
                        {' '}({(c.pct ?? 0).toFixed(0)}%)
                      </p>
                    </>
                  )}
                </div>
              );
            })}
          </div>
        )}
        {isLoading ? (
          <div className="space-y-2">
            {[...Array(3)].map((_, i) => <Skeleton key={i} className="h-10 w-full" />)}
          </div>
        ) : isError ? (
          <ErrorState error={error} onRetry={() => refetch()} compact />
        ) : expenses.length === 0 ? (
          <EmptyState icon={Receipt} title={t('expenses.none')}
              hint={t('expenses.noneHint')} compact />
        ) : (
          // Columns, not a sentence. The amount used to sit mid-paragraph
          // between a badge and the item name, so nothing lined up and the
          // figures — the only reason to open this tab — could not be scanned
          // down the page.
          <div className="divide-y divide-[var(--line-1)]">
            {expenses.map((e) => (
              <div
                key={e.id}
                className="group -mx-2 flex items-center gap-3 rounded-md px-2 py-2.5 transition-colors duration-100 hover:bg-[var(--fill-1)]"
              >
                <ItemIcon src={e.itemImageUrl} icon={e.itemIcon} category={e.itemCategory} className="size-7 shrink-0" />

                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="truncate text-sm text-zinc-200">{e.itemTypeName}</span>
                    <Badge variant="outline" className="shrink-0 text-micro text-zinc-400">
                      {EXPENSE_CATEGORY_KEYS[e.category] ? t(EXPENSE_CATEGORY_KEYS[e.category]) : e.category}
                    </Badge>
                  </div>
                  <p className="truncate text-meta text-zinc-600">
                    {e.expenseDate}
                    {e.creatorUsername && ` · ${displayName({ username: e.creatorUsername, inGameName: e.creatorInGameName })}`}
                    {e.description && ` · ${e.description}`}
                  </p>
                </div>

                <span className="shrink-0 text-sm font-medium tabular-nums text-zinc-200">
                  {formatAmount(e.amount, e.itemUnit, e.itemIsCurrency)}
                </span>

                {canManage && (
                  // Reserved width whether or not the buttons are showing, so
                  // the amount column does not shift as the mouse moves down
                  // the list.
                  <div className="flex w-[68px] shrink-0 items-center justify-end gap-1 opacity-0 transition-opacity duration-100 group-hover:opacity-100 focus-within:opacity-100">
                    <Button variant="ghost" size="icon-xs" className="text-zinc-500 hover:text-zinc-200" title={t('common.edit')} onClick={() => openEdit(e)}>
                      <Pencil className="h-3.5 w-3.5" />
                    </Button>
                    <Button variant="ghost" size="icon-xs" className="text-zinc-500 hover:text-red-400" title={t('common.delete')} onClick={() => setConfirmDelete(e)}>
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </CardContent>

      <AlertDialog open={!!confirmDelete} onOpenChange={(open) => { if (!open) setConfirmDelete(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t('expenses.deleteTitle')}</AlertDialogTitle>
            <AlertDialogDescription>
              {confirmDelete && t('expenses.deleteBody', {
                amount: formatAmount(confirmDelete.amount, confirmDelete.itemUnit, confirmDelete.itemIsCurrency),
                item: confirmDelete.itemTypeName,
                date: confirmDelete.expenseDate,
              })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t('common.cancel')}</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => confirmDelete && deleteMutation.mutate(confirmDelete.id)}
              disabled={deleteMutation.isPending}
            >
              {t('common.delete')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Create / edit dialog */}
      <Dialog open={dialogOpen} onOpenChange={(open) => { if (!open) setDialogOpen(false); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{editId ? t('expenses.edit') : t('expenses.add')}</DialogTitle>
          </DialogHeader>
          <form onSubmit={(e) => { e.preventDefault(); if (canSaveExpense) saveMutation.mutate(); }}>
          <div className="space-y-4">
            <div className="space-y-1.5">
              <Label>{t('expenses.itemType')}</Label>
              <SearchableSelect
                value={formItemType}
                onValueChange={setFormItemType}
                options={itemTypeOptions}
                placeholder={t('expenses.itemTypePlaceholder')}
                aria-label={t('expenses.itemType')}
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>{t('expenses.category')}</Label>
                <SearchableSelect
                  value={formCategory}
                  onValueChange={(v) => setFormCategory(v as ExpenseCategory)}
                  options={categoryOptions}
                  aria-label={t('expenses.category')}
                />
              </div>
              <div className="space-y-1.5">
                <Label>{t('common.amount')}{selectedItemType ? ` (${selectedItemType.unit})` : ''}</Label>
                <Input
                  type="number"
                  min="0"
                  step="0.01"
                  value={formAmount}
                  onChange={(e) => setFormAmount(e.target.value)}
                  placeholder="0.00"
                />
                <AmountPreview
                  value={formAmount}
                  unit={selectedItemType?.unit}
                  isCurrency={selectedItemType?.isCurrency}
                />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label>{t('common.date')}</Label>
              <Input
                type="date"
                max={todayLocalDateString()}
                value={formDate}
                onChange={(e) => setFormDate(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label>{t('common.description')}</Label>
              <Input
                value={formDescription}
                onChange={(e) => setFormDescription(e.target.value)}
                maxLength={500}
                placeholder={t('expenses.descriptionPlaceholder')}
              />
            </div>
          </div>
          <DialogFooter className="mt-4">
            <Button variant="outline" onClick={() => setDialogOpen(false)}>{t('common.cancel')}</Button>
            <Button type="submit" disabled={!canSaveExpense}>
              {saveMutation.isPending ? t('common.saving') : t('common.save')}
            </Button>
          </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </Card>
  );
}

// ── Vault verification ────────────────────────────────
// "Counted vs. recorded": someone counts the real vault, the number is
// recorded, and the recorded balance for that day is derived from the same
// source as the live balance. A dispute gets a variance, not a memory.

function ChecksSection({ factionId, canManage }: { factionId: string; canManage: boolean }) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const [formItemType, setFormItemType] = useState('');
  const [formCounted, setFormCounted] = useState('');
  const [formDate, setFormDate] = useState(todayLocalDateString());
  const [formNote, setFormNote] = useState('');

  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: ['treasury-checks', factionId],
    queryFn: () => treasuryApi.listChecks(factionId),
    enabled: canManage,
    staleTime: 0,
  });

  const { data: itemTypes = [] } = useQuery({
    queryKey: ['item-types', factionId],
    queryFn: () => itemTypesApi.list(factionId),
    enabled: canManage,
  });

  const itemTypeOptions: SearchableSelectOption[] = useMemo(
    () => (itemTypes as ItemType[]).filter((it) => it.isActive).map((it) => ({ value: it.id, label: it.name })),
    [itemTypes],
  );
  const countedType = (itemTypes as ItemType[]).find((it) => it.id === formItemType);

  const createMutation = useMutation({
    mutationFn: () =>
      treasuryApi.createCheck(factionId, {
        itemTypeId: formItemType,
        countedAmount: formCounted,
        checkDate: formDate,
        note: formNote.trim() || undefined,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['treasury-checks', factionId] });
      setFormCounted('');
      setFormNote('');
      toast({ title: t('treasury.checkCreated') });
    },
    onError: (err: unknown) => {
      toast({ title: t('common.failed'), description: apiErrorMessage(err), variant: 'destructive' });
    },
  });

  const canRecordCheck =
    !!formItemType && formCounted !== '' && Number(formCounted) >= 0 && !createMutation.isPending;

  const checks = data?.checks ?? [];

  if (!canManage) return null;

  return (
    <Card>
      <CardHeader className="flex-row flex-wrap items-center justify-between gap-3">
        <CardTitle className="flex items-center gap-2 text-sm text-zinc-200">
          <ClipboardCheck className="h-4 w-4 text-zinc-400" />
          {t('treasury.checks')}
        </CardTitle>
      </CardHeader>
      <CardContent>
        <p className="text-xs text-zinc-500 mb-3">{t('treasury.checksIntro')}</p>

        {/* Record a count */}
        <form
          onSubmit={(e) => { e.preventDefault(); if (canRecordCheck) createMutation.mutate(); }}
          className="flex flex-wrap items-end gap-3 mb-4"
        >
          <div className="space-y-1.5 min-w-[180px] flex-1">
            <Label className="text-xs text-zinc-500">{t('expenses.itemType')}</Label>
            <SearchableSelect
              value={formItemType}
              onValueChange={setFormItemType}
              options={itemTypeOptions}
              placeholder={t('itemTypes.select')}
              aria-label={t('expenses.itemType')}
            />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs text-zinc-500">{t('treasury.countedAmount')}{countedType ? ` (${countedType.unit})` : ''}</Label>
            <Input
              type="number"
              step="0.01"
              min="0"
              placeholder="0.00"
              value={formCounted}
              onChange={(e) => setFormCounted(e.target.value)}
              className="tabular-nums w-36"
            />
            <AmountPreview value={formCounted} unit={countedType?.unit} isCurrency={countedType?.isCurrency} />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs text-zinc-500">{t('common.date')}</Label>
            <Input
              type="date"
              max={todayLocalDateString()}
              value={formDate}
              onChange={(e) => setFormDate(e.target.value)}
              className="w-40"
            />
          </div>
          <div className="space-y-1.5 min-w-[160px] flex-1">
            <Label className="text-xs text-zinc-500">{t('common.description')}</Label>
            <Input value={formNote} onChange={(e) => setFormNote(e.target.value)} maxLength={500} placeholder={t('treasury.checkNotePlaceholder')} />
          </div>
          <Button type="submit" disabled={!canRecordCheck}>
            {createMutation.isPending ? t('common.saving') : t('treasury.recordCheck')}
          </Button>
        </form>

        {isLoading ? (
          <div className="space-y-2">
            {[...Array(2)].map((_, i) => <Skeleton key={i} className="h-10 w-full" />)}
          </div>
        ) : isError ? (
          <ErrorState error={error} onRetry={() => refetch()} compact />
        ) : checks.length === 0 ? (
          <EmptyState icon={ClipboardCheck} title={t('treasury.noChecks')}
              hint={t('treasury.noChecksHint')} compact />
        ) : (
          <div className="space-y-1">
            {checks.map((c) => {
              const matches = Math.abs(c.variance) < 0.005;
              return (
                <div key={c.id} className="flex items-center gap-3 py-2 px-2 -mx-2 rounded-md hover:bg-[var(--fill-1)] transition-colors duration-100">
                  <ItemIcon src={null} className="size-0 hidden" />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm">
                      <span className="text-zinc-300 font-medium">{c.itemTypeName}</span>
                      <span className="text-zinc-600"> · {c.checkDate}</span>
                    </p>
                    <p className="text-meta text-zinc-600 truncate">
                      {t('treasury.checkRecorded', { amount: formatAmount(c.recordedBalance, c.itemUnit, c.itemIsCurrency) })}
                      {c.creatorUsername && ` — ${displayName({ username: c.creatorUsername, inGameName: c.creatorInGameName })}`}
                      {c.note && ` — ${c.note}`}
                    </p>
                  </div>
                  <div className="text-right shrink-0">
                    <p className="text-sm font-medium tabular-nums text-zinc-200">
                      {formatAmount(c.countedAmount, c.itemUnit, c.itemIsCurrency)}
                    </p>
                    <p className={`text-meta tabular-nums ${matches ? 'text-emerald-500' : 'text-red-400'}`}>
                      {matches
                        ? t('treasury.checkMatch')
                        : t('treasury.checkVariance', { variance: formatAmount(Math.abs(c.variance), c.itemUnit, c.itemIsCurrency) })}
                    </p>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
