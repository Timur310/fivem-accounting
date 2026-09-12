'use client';

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import React, { useState, useEffect, useMemo, useRef } from 'react';
import { dashboardApi, quotasApi, exportApi, entriesApi, itemTypesApi, leaderboardApi, membersApi, apiErrorMessage } from '@/lib/api-client';
import { Input } from '@/components/ui/input';
import { SearchableSelect, type SearchableSelectOption } from '@/components/ui/searchable-select';
import { Label } from '@/components/ui/label';
import { ErrorState } from '@/components/ui/empty-state';
import { AmountPreview } from '@/components/ui/amount-preview';
import { useToast } from '@/hooks/use-toast';
import { LogIn, Flame, Trophy, Target as TargetIcon, Coins, Check } from 'lucide-react';
import type { ItemType } from '@/lib/api-types';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { List, TrendingUp, Target, Download, BarChart3, ArrowUpRight, AlertTriangle, Clock, ChevronDown } from 'lucide-react';
import { useAppStore } from '@/lib/store';
import { DashboardCharts } from '@/components/dashboard-charts';
import { formatAmount, displayName, formatNumber, formatCount } from '@/lib/format';
import { ItemIcon } from '@/components/item-icon';
import { useTranslation } from '@/providers/i18n-provider';
import type { TranslationKey } from '@/lib/i18n';

/** Quota period names as the API spells them. */
const QUOTA_PERIOD_KEYS: Record<string, TranslationKey> = {
  daily: 'quota.period.daily',
  weekly: 'quota.period.weekly',
  monthly: 'quota.period.monthly',
};

interface Props {
  factionId: string;
  canLogEntries?: boolean;
}

export function DashboardView({ factionId, canLogEntries = false }: Props) {
  const { t } = useTranslation();
  const setCurrentView = useAppStore((s) => s.setCurrentView);
  const brandColor = useAppStore((s) => s.brandColor);

  const [displayBalance, setDisplayBalance] = useState(0);

  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ['dashboard', factionId],
    queryFn: () => dashboardApi.get(factionId),
    staleTime: 0,
    refetchOnWindowFocus: true,
  });

  const { data: quotasList = [] } = useQuery({
    queryKey: ['quotas', factionId],
    queryFn: () => quotasApi.list(factionId),
    staleTime: 0,
  });

  const { data: itemTypes = [] } = useQuery({
    queryKey: ['itemTypes', factionId],
    queryFn: () => itemTypesApi.list(factionId),
    enabled: canLogEntries,
  });

  // ── My stats strip ──
  // Assembled from endpoints that already exist: the week leaderboard carries
  // the member's rank, the profile carries the streak.
  const user = useAppStore((s) => s.user);
  const { data: lbWeek } = useQuery({
    queryKey: ['leaderboard', 'week', factionId],
    queryFn: () => leaderboardApi.get(factionId, { period: 'week', limit: 100 }),
    enabled: canLogEntries && !!user,
  });
  const { data: myProfile } = useQuery({
    queryKey: ['member-profile', factionId, user?.id],
    queryFn: () => membersApi.getProfile(factionId, user!.id),
    enabled: canLogEntries && !!user,
    retry: false,
  });

  // ── Quick log ──
  // One card, pre-filled with the member's own last entry: logging the same
  // haul again should not cost a navigation and a blank form.
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [quickTypeId, setQuickTypeId] = useState('');
  const [quickAmount, setQuickAmount] = useState('');

  // `myRecentItems` is the caller's own last three item types, newest first,
  // resolved on the server. Filtering the faction-wide `recentEntries` for the
  // caller — which is what this did — only worked while the faction was quiet
  // enough for the member to be in its last ten rows.
  const myRecentItems = useMemo(() => data?.myRecentItems ?? [], [data]);

  const quickDefaults = useMemo(() => {
    const mine = myRecentItems[0];
    return mine ? { typeId: mine.itemTypeId, amount: mine.amount } : null;
  }, [myRecentItems]);

  // Prefill once, on arrival — not on every change of `quickDefaults`.
  //
  // Logging invalidates the dashboard, so the refetch used to hand back a new
  // defaults object and refill the amount the success handler had just
  // cleared, putting the card straight back into "one tap logs this again".
  // The prefill is a convenience when you open the page, not something that
  // should reassert itself over what you just did.
  const hasPrefilled = useRef(false);
  // The view is not remounted when the faction selector changes, so the
  // "already prefilled" latch has to be released by hand — otherwise the
  // first faction you opened is the only one that ever prefills.
  useEffect(() => {
    hasPrefilled.current = false;
    setQuickTypeId('');
    setQuickAmount('');
  }, [factionId]);

  useEffect(() => {
    if (!quickDefaults || hasPrefilled.current) return;
    hasPrefilled.current = true;
    setQuickTypeId((prev) => prev || quickDefaults.typeId);
    setQuickAmount((prev) => prev || quickDefaults.amount);
  }, [quickDefaults]);

  // Brief "Logged" state on the button after a successful quick log.
  //
  // The card previously kept type and amount filled and re-enabled the button
  // the moment the request returned, with only a toast to say anything had
  // happened — so a second thumb tap on a phone silently logged the same haul
  // twice. Clearing the amount and holding the button for a beat makes the
  // repeat deliberate rather than accidental, and gives the card the
  // confirmation it never had.
  const [quickJustLogged, setQuickJustLogged] = useState(false);
  const quickFlashTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => { if (quickFlashTimer.current) clearTimeout(quickFlashTimer.current); }, []);

  const quickType = (itemTypes as ItemType[]).find((it) => it.id === quickTypeId);
  const quickStep = quickType?.isCurrency ? 1000 : 1;
  const quickBump = (dir: number) => {
    const current = Number(quickAmount);
    setQuickAmount(String(isNaN(current) || quickAmount === '' ? Math.max(quickStep, 0) : Math.max(current + dir * quickStep, 0)));
  };

  const quickLogMutation = useMutation({
    mutationFn: () => entriesApi.create(factionId, { itemTypeId: quickTypeId, amount: quickAmount }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['dashboard', factionId] });
      queryClient.invalidateQueries({ queryKey: ['entries', factionId] });
      queryClient.invalidateQueries({ queryKey: ['quotas', factionId] });
      queryClient.invalidateQueries({ queryKey: ['treasury', factionId] });
      toast({ title: t('entries.logged') });
      setQuickAmount('');
      setQuickJustLogged(true);
      if (quickFlashTimer.current) clearTimeout(quickFlashTimer.current);
      quickFlashTimer.current = setTimeout(() => setQuickJustLogged(false), 1200);
    },
    onError: (err: unknown) => {
      toast({ title: t('common.failed'), description: apiErrorMessage(err), variant: 'destructive' });
    },
  });

  const canQuickLog =
    !quickJustLogged &&
    !!quickTypeId &&
    !!quickAmount &&
    Number(quickAmount) > 0 &&
    !quickLogMutation.isPending;

  const quickTypeOptions: SearchableSelectOption[] = (itemTypes as ItemType[])
    .filter((it) => it.isActive)
    .map((it) => ({ value: it.id, label: it.name }));

  // One-tap chips for the member's usual items — the card should be usable
  // in three taps, thumb-only.
  const quickRecentTypes = myRecentItems;

  // Charts and export are reference material, not the daily glance — folded
  // away by default so the page reads in one screenful.
  const [analyticsOpen, setAnalyticsOpen] = useState(false);

  // Balance counts up on load: the vault "arrives" instead of popping in.
  // Skipped entirely when the user prefers reduced motion.
  // NOTE: this hook (and the value it depends on) must run on every render,
  // so it lives above the isLoading/error early returns below. `data` may
  // not exist yet at this point, hence the optional chaining/fallback.
  const heroBalance = data?.netBalance ?? data?.grandTotal ?? 0;

  useEffect(() => {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      setDisplayBalance(heroBalance);
      return;
    }
    const start = performance.now();
    const from = 0;
    const dur = 600;
    let raf = 0;
    const tick = (now: number) => {
      const t = Math.min((now - start) / dur, 1);
      const eased = 1 - Math.pow(1 - t, 3);
      setDisplayBalance(from + (heroBalance - from) * eased);
      if (t < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [heroBalance]);

  if (isLoading) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-8 w-48" />
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {[...Array(4)].map((_, i) => (
            <Skeleton key={i} className="h-24 w-full" />
          ))}
        </div>
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

  const { faction, totalsByType, grandTotal, treasuryBalances, netBalance, memberCount, adminCount, totalEntries, topContributors, recentEntries, inactiveMembers, inactivityThresholdDays } = data;
  const activeQuotas = (quotasList as import('@/lib/api-types').Quota[]).filter(q => q.isActive && q.periodActive);
  // A quota period that ended short of its target used to vanish when the
  // next one began — this is the only trace that it was missed.
  const missedQuotas = (quotasList as import('@/lib/api-types').Quota[]).filter(
    (q) => q.isActive && q.previousPeriod && !q.previousPeriod.met,
  );

  // Currency summaries are prefixed with $; the goods breakdown uses
  // formatAmount() with the type-specific unit instead.
  const fmt = (n: number) => `$${formatNumber(n)}`;

  return (
    <div className="space-y-6">
      {/* Faction Header — the faction's own masthead: display type, its accent
          as a rule under the name, and a faint accent wash behind it. */}
      <div className="relative rounded-lg border border-white/[0.06] overflow-hidden">
        <div
          className="absolute inset-0 pointer-events-none"
          style={{ background: `linear-gradient(120deg, ${brandColor}0f, transparent 55%)` }}
        />
        <div className="relative px-5 py-4">
          <h2 className="text-2xl font-medium tracking-tight text-zinc-100">{faction.name}</h2>
          <div className="h-0.5 w-10 rounded-full mt-2" style={{ backgroundColor: brandColor }} />
          {faction.description && (
            <p className="text-zinc-500 mt-2 text-sm">{faction.description}</p>
          )}
        </div>
      </div>

      {/* ══ Quick Log ══ */}
      {canLogEntries && (
        <Card className={quickJustLogged ? 'row-flash' : ''}>
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-sm text-zinc-200">
              <LogIn className="h-4 w-4 text-zinc-400" />
              {t('dashboard.quickLog')}
              {quickDefaults && <span className="text-[11px] text-zinc-600 font-normal">· {t('dashboard.quickLogPrefilled')}</span>}
            </CardTitle>
          </CardHeader>
          <CardContent>
            {quickRecentTypes.length > 0 && (
              <div className="flex flex-wrap gap-2 mb-3">
                {quickRecentTypes.map((it) => (
                  <button
                    key={it.itemTypeId}
                    type="button"
                    onClick={() => { setQuickTypeId(it.itemTypeId); setQuickAmount(it.amount); }}
                    className={`inline-flex items-center gap-1.5 h-10 px-4 rounded-lg border text-sm transition-colors ${quickTypeId === it.itemTypeId ? 'border-primary text-primary bg-primary/10' : 'border-white/[0.08] text-zinc-300 hover:text-zinc-100 hover:border-white/[0.2]'}`}
                  >
                    <ItemIcon src={it.itemImageUrl} className="size-4" />
                    {it.itemTypeName}
                  </button>
                ))}
              </div>
            )}
            {/* A real form: Enter anywhere in the card logs the entry, which is
                what a one-thumb flow wants on a phone keyboard too. */}
            <form
              onSubmit={(e) => { e.preventDefault(); if (canQuickLog) quickLogMutation.mutate(); }}
              className="flex flex-wrap items-end gap-3"
            >
              <div className="space-y-1.5 min-w-[180px] flex-1">
                <Label className="text-xs text-zinc-500">{t('entries.itemType')}</Label>
                <SearchableSelect
                  value={quickTypeId}
                  onValueChange={setQuickTypeId}
                  options={quickTypeOptions}
                  placeholder={t('itemTypes.select')}
                  aria-label={t('entries.itemType')}
                />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs text-zinc-500">{t('common.amount')}{quickType ? ` (${quickType.unit})` : ''}</Label>
                <div className="flex items-center gap-2">
                  <Button type="button" variant="outline" size="icon" className="h-11 w-11 shrink-0" title={t('entries.decrease')} onClick={() => quickBump(-1)}>−</Button>
                  <Input
                    type="number"
                    step="0.01"
                    min="0.01"
                    placeholder="0.00"
                    value={quickAmount}
                    onChange={(e) => setQuickAmount(e.target.value)}
                    className="tabular-nums w-32"
                  />
                  <Button type="button" variant="outline" size="icon" className="h-11 w-11 shrink-0" title={t('entries.increase')} onClick={() => quickBump(1)}>+</Button>
                </div>
                <AmountPreview value={quickAmount} unit={quickType?.unit} isCurrency={quickType?.isCurrency} />
              </div>
              <Button
                type="submit"
                className="h-11 px-6 text-sm"
                disabled={!canQuickLog}
                style={quickJustLogged ? undefined : { backgroundColor: brandColor }}
              >
                {quickJustLogged ? (
                  <><Check className="h-4 w-4 mr-1.5" />{t('dashboard.quickLogDone')}</>
                ) : quickLogMutation.isPending ? t('common.saving') : t('dashboard.quickLogSubmit')}
              </Button>
            </form>
          </CardContent>
        </Card>
      )}

      {/* ══ My Stats Strip ══ */}
      {canLogEntries && user && (lbWeek || myProfile) && (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          {(() => {
            const mine = lbWeek?.rankings.find((r) => r.isMe);
            const myQuota = (quotasList as import('@/lib/api-types').Quota[]).find(
              (q) => q.isActive && q.periodActive && q.scope === 'everyone',
            );
            const streak = myProfile?.streak;
            const cells = [
              mine && {
                icon: <Coins className="h-4 w-4 text-zinc-400" />,
                label: t('dashboard.myWeek'),
                value: fmt(mine.total),
                hint: t('entries.count', { count: mine.entryCount }),
              },
              lbWeek?.myRank != null && {
                icon: <Trophy className="h-4 w-4 text-zinc-400" />,
                label: t('dashboard.myRank'),
                value: `#${lbWeek.myRank}`,
                hint: t('leaderboard.thisWeek'),
              },
              streak && streak.current > 0 && {
                icon: <Flame className={`h-4 w-4 ${streak.activeToday ? 'text-amber-400' : 'text-zinc-400'}`} />,
                label: t('dashboard.myStreak'),
                value: t('dashboard.daysShort2', { count: streak.current }),
                hint: streak.activeToday ? t('dashboard.activeToday') : t('dashboard.logToday'),
              },
              myQuota && {
                icon: <TargetIcon className="h-4 w-4 text-zinc-400" />,
                label: t('dashboard.myQuota'),
                value: `${formatAmount(myQuota.currentAmount ?? 0, myQuota.itemUnit, myQuota.itemIsCurrency)} / ${formatAmount(myQuota.targetAmount, myQuota.itemUnit, myQuota.itemIsCurrency)}`,
                hint: `${(myQuota.percentage ?? 0).toFixed(0)}%`,
              },
            ].filter(Boolean) as { icon: React.ReactNode; label: string; value: string; hint?: string }[];
            return cells.map((c) => (
              <Card key={c.label} className="border-highlight">
                <CardContent className="py-3 px-4">
                  <div className="flex items-center gap-2 text-xs text-zinc-500">
                    {c.icon}
                    {c.label}
                  </div>
                  <p className="text-lg font-medium tabular-nums text-zinc-200 mt-1 truncate">{c.value}</p>
                  {c.hint && <p className="text-[11px] text-zinc-600">{c.hint}</p>}
                </CardContent>
              </Card>
            ));
          })()}
        </div>
      )}

      {/* ══ Bento Grid: Hero + 3 Stats ══ */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {/* Hero Card — Grand Total with Glow */}
        <Card className="faction-glow border-highlight lg:col-span-1 sm:col-span-2">
          <CardHeader className="pb-2">
            <CardTitle className="text-xs font-normal text-zinc-500 uppercase tracking-wider">{t('dashboard.netTreasuryBalance')}</CardTitle>
          </CardHeader>
          <CardContent className="relative z-10">
            {(() => {
              const bal = netBalance ?? grandTotal;
              // Money only: adding currency to kilograms and piece counts gives
              // a figure with no unit. Goods are listed per type further down.
              const currencyBalances = (treasuryBalances ?? []).filter((b) => b.isCurrency);
              const goodsCount = (treasuryBalances ?? []).length - currencyBalances.length;
              const hasTreasury = currencyBalances.length > 0;
              const totalIn = hasTreasury ? currencyBalances.reduce((s, b) => s + b.inflow, 0) : grandTotal;
              const totalOut = hasTreasury ? currencyBalances.reduce((s, b) => s + b.outflow, 0) : 0;
              return (
                <>
                  {/* Neutral unless the figure is actually negative: a faction
                      whose accent is green or red would otherwise colour an
                      ordinary balance as if it meant something. */}
                  <div className="text-3xl font-medium tabular-nums tracking-tight" style={{ color: bal < 0 ? '#ef4444' : '#e4e4e7' }}>
                    {fmt(displayBalance)}
                  </div>
                  <p className="text-xs text-zinc-500 mt-1.5">
                    {hasTreasury
                      ? <>
                          {t('dashboard.inflowOutflow', { inflow: fmt(totalIn), outflow: fmt(totalOut) })}
                          {goodsCount > 0 && <> &middot; {t('dashboard.currencyOnly')}</>}
                        </>
                      : t('treasury.totalsNoteAll')
                    }
                  </p>
                </>
              );
            })()}
          </CardContent>
        </Card>

        {/* Stat: Total Entries */}
        <Card className="border-highlight">
          <CardHeader className="pb-2">
            <CardTitle className="text-xs font-normal text-zinc-500 uppercase tracking-wider">{t('nav.entries')}</CardTitle>
          </CardHeader>
          <CardContent className="relative z-10">
            <div className="text-2xl font-medium tabular-nums tracking-tight">{formatCount(totalEntries)}</div>
            <p className="text-xs text-zinc-500 mt-1.5">{t('dashboard.loggedContributions')}</p>
          </CardContent>
        </Card>

        {/* Stat: Members */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-xs font-normal text-zinc-500 uppercase tracking-wider">{t('nav.members')}</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-medium tabular-nums tracking-tight">{memberCount}</div>
            <p className="text-xs text-zinc-500 mt-1.5">{t('dashboard.adminCount', { count: adminCount })}</p>
          </CardContent>
        </Card>

        {/* Stat: Item Types */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-xs font-normal text-zinc-500 uppercase tracking-wider">{t('dashboard.categories')}</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-medium tabular-nums tracking-tight">{totalsByType.length}</div>
            <p className="text-xs text-zinc-500 mt-1.5">{t('dashboard.activeItemTypes')}</p>
          </CardContent>
        </Card>
      </div>

      {/* ══ Quota Progress — Energy Bars ══ */}
      {activeQuotas.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-sm text-zinc-200">
              <Target className="h-4 w-4 text-zinc-400" />
              {t('dashboard.quotaProgress')}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {activeQuotas.map((q) => {
                const pct = q.percentage ?? 0;
                const met = pct >= 100;
                return (
                  <div key={q.id} className="rounded-lg border border-white/[0.06] p-4 space-y-3 transition-all duration-150 hover:border-white/[0.1]">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2.5 min-w-0">
                        <ItemIcon src={q.itemImageUrl} />
                        <div className="min-w-0">
                          <p className="text-sm font-medium text-zinc-200 truncate">{q.itemTypeName}</p>
                          <p className="text-[11px] text-zinc-500">{QUOTA_PERIOD_KEYS[q.periodType] ? t(QUOTA_PERIOD_KEYS[q.periodType]) : q.periodType}</p>
                        </div>
                      </div>
                      {/* Only "met" earns a colour. The percentage used to wear
                          the faction accent, which read as a verdict on the
                          number whenever that accent was green or red. */}
                      <Badge variant="outline" className={met ? 'border-emerald-500/30 text-emerald-400' : 'text-zinc-300'}>
                        {met ? t('quota.met') : `${pct.toFixed(1)}%`}
                      </Badge>
                    </div>
                    {/* Energy bar */}
                    <div className="h-2 bg-white/[0.04] rounded-full overflow-hidden">
                      {/* Met is green, everything short of it is neutral. The
                          unmet bar used to wear the faction accent, which made
                          the two states indistinguishable for a faction whose
                          colour happens to be green — and read as a failure for
                          one whose colour is red. Matches the quota bar in
                          Settings, which was already neutral. */}
                      <div
                        className={`h-full rounded-full energy-bar transition-all duration-500 ${met ? 'bg-emerald-500' : 'bg-primary'}`}
                        style={{ width: `${Math.min(pct, 100)}%` }}
                      />
                    </div>
                    <div className="flex justify-between text-[11px] text-zinc-500 tabular-nums">
                      <span>{formatAmount(q.currentAmount ?? 0, q.itemUnit, q.itemIsCurrency)}</span>
                      {met
                        ? <span>{t('quota.ofTarget', { amount: formatAmount(q.targetAmount, q.itemUnit, q.itemIsCurrency) })}</span>
                        : <span className="text-zinc-400">{t('quota.remaining', { amount: formatAmount(Number(q.targetAmount) - (q.currentAmount ?? 0), q.itemUnit, q.itemIsCurrency) })}</span>}
                    </div>
                  </div>
                );
              })}
            </div>
          </CardContent>
        </Card>
      )}

      {/* ══ Quota periods that ended unmet ══ */}
      {missedQuotas.length > 0 && (
        <Card className="border-amber-500/15">
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-sm text-zinc-200">
              <AlertTriangle className="h-4 w-4 text-amber-400" />
              {t('dashboard.missedQuotas')}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-1">
              {missedQuotas.map((q) => {
                const prev = q.previousPeriod!;
                return (
                  <div key={q.id} className="flex items-center gap-3 py-1.5 px-2 -mx-2 rounded-md hover:bg-white/[0.02]">
                    <ItemIcon src={q.itemImageUrl} className="size-5" />
                    <div className="flex-1 min-w-0">
                      <p className="text-sm text-zinc-300 truncate">
                        {q.itemTypeName}
                        <span className="text-zinc-600"> &middot; {QUOTA_PERIOD_KEYS[q.periodType] ? t(QUOTA_PERIOD_KEYS[q.periodType]) : q.periodType}</span>
                      </p>
                      <p className="text-[11px] text-zinc-600 tabular-nums">{prev.periodStart} – {prev.periodEnd}</p>
                    </div>
                    <span className="text-xs text-amber-400 tabular-nums">
                      {t('quota.lastPeriodNotMet', {
                        current: formatAmount(prev.currentAmount, q.itemUnit, q.itemIsCurrency),
                        target: formatAmount(prev.targetAmount, q.itemUnit, q.itemIsCurrency),
                      })}
                    </span>
                  </div>
                );
              })}
            </div>
          </CardContent>
        </Card>
      )}

      {/* ══ Two Column: Top Contributors + Recent Activity ══ */}
      <div className="grid gap-4 lg:grid-cols-2">
        {/* Top Contributors */}
        <Card>
          <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-sm text-zinc-200">
              <TrendingUp className="h-4 w-4 text-zinc-400" />
              {t('dashboard.topContributors')}
            </CardTitle>
          </CardHeader>
          <CardContent>
            {topContributors.length === 0 ? (
              <p className="text-zinc-600 text-sm text-center py-8">{t('dashboard.noContributions')}</p>
            ) : (
              <div className="space-y-1">
                {topContributors.slice(0, 7).map((c, i) => (
                  <div key={c.userId} className="flex items-center gap-3 py-2 px-2 -mx-2 rounded-md hover:bg-white/[0.02] transition-colors duration-100">
                    <span className="text-xs font-medium text-zinc-600 w-4 tabular-nums">{i + 1}</span>
                    <Avatar className="h-7 w-7">
                      <AvatarImage src={c.avatarUrl ?? undefined} />
                      <AvatarFallback className="text-[10px]">{displayName(c).slice(0, 2).toUpperCase()}</AvatarFallback>
                    </Avatar>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm text-zinc-300 truncate">{displayName(c)}</p>
                      <p className="text-[11px] text-zinc-600">{t('entries.count', { count: c.entryCount })}</p>
                    </div>
                    <span className="text-sm font-medium tabular-nums text-zinc-200">{fmt(c.totalContributed)}</span>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Recent Activity */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center justify-between text-sm text-zinc-200">
              <span className="flex items-center gap-2">
                <List className="h-4 w-4 text-zinc-400" />
                {t('dashboard.recentActivity')}
              </span>
              <Button
                onClick={() => setCurrentView('entries')}
                className="text-[11px] font-medium flex items-center gap-1 transition-colors duration-100 hover:opacity-80"
                style={{ color: brandColor }}
              >
                {t('dashboard.viewAll')} <ArrowUpRight className="h-3 w-3" />
              </Button>
            </CardTitle>
          </CardHeader>
          <CardContent>
            {recentEntries.length === 0 ? (
              <p className="text-zinc-600 text-sm text-center py-8">{t('entries.noneYet')}</p>
            ) : (
              <div className="space-y-1 max-h-[320px] overflow-y-auto">
                {recentEntries.map((e) => (
                  <div key={e.id} className="flex items-center gap-3 py-2 px-2 -mx-2 rounded-md hover:bg-white/[0.02] transition-colors duration-100">
                    <Avatar className="h-7 w-7 shrink-0">
                      <AvatarImage src={e.avatarUrl ?? undefined} />
                      <AvatarFallback className="text-[10px]">{displayName(e).slice(0, 2).toUpperCase()}</AvatarFallback>
                    </Avatar>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm">
                        <span className="text-zinc-300 font-medium">{displayName(e)}</span>
                        <span className="text-zinc-600"> {t('dashboard.logged')} </span>
                        <span className="font-medium tabular-nums text-zinc-200">{formatAmount(e.amount, e.itemUnit, e.itemIsCurrency)}</span>
                      </p>
                      <p className="text-[11px] text-zinc-600 flex items-center gap-1.5">
                        <ItemIcon src={e.itemImageUrl} className="size-4" />
                        <span className="truncate">
                          {e.itemTypeName} &middot; {e.entryDate}
                          {e.description && ` — ${e.description}`}
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

      {/* ══ Totals by Type — compact grid (with treasury balance if available) ══ */}
      {totalsByType.length > 0 && (
        <Card>
          <CardHeader className="flex flex-row items-center justify-between">
            <CardTitle className="text-sm text-zinc-200">{t('dashboard.treasuryByItemType')}</CardTitle>
            {(treasuryBalances?.length ?? 0) > 0 && (
              <Button
                onClick={() => setCurrentView('treasury')}
                className="text-[11px] font-medium flex items-center gap-1 transition-colors duration-100 hover:opacity-80"
                style={{ color: brandColor }}
              >
                {t('dashboard.fullView')} <ArrowUpRight className="h-3 w-3" />
              </Button>
            )}
          </CardHeader>
          <CardContent>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {(treasuryBalances?.length ?? 0) > 0
                ? treasuryBalances.map((b) => (
                  <div
                    key={b.itemTypeId}
                    className="flex items-center justify-between rounded-lg border border-white/[0.06] p-3.5 transition-all duration-150 hover:border-white/[0.1]"
                  >
                    <div className="flex items-center gap-2.5 min-w-0">
                      <ItemIcon src={b.imageUrl} className="size-8" />
                      <div className="min-w-0">
                        <p className="text-sm font-medium text-zinc-300 truncate">{b.itemTypeName}</p>
                        <p className="text-xs text-zinc-600">{t('dashboard.inOut', { inflow: formatAmount(b.inflow, b.unit, b.isCurrency), outflow: formatAmount(b.outflow, b.unit, b.isCurrency) })}</p>
                      </div>
                    </div>
                    <div className="text-right">
                      <p className="text-lg font-medium tabular-nums" style={{ color: b.balance < 0 ? '#ef4444' : '#e4e4e7' }}>
                        {b.balance < 0 ? '-' : ''}{formatAmount(Math.abs(b.balance), b.unit, b.isCurrency)}
                      </p>
                    </div>
                  </div>
                ))
                : totalsByType.map((row) => (
                  <div
                    key={row.itemTypeId}
                    className="flex items-center justify-between rounded-lg border border-white/[0.06] p-3.5 transition-all duration-150 hover:border-white/[0.1]"
                  >
                    <div className="flex items-center gap-2.5 min-w-0">
                      <ItemIcon src={row.imageUrl} className="size-8" />
                      <div className="min-w-0">
                        <p className="text-sm font-medium text-zinc-300 truncate">{row.itemTypeName}</p>
                        <p className="text-xs text-zinc-600">{row.unit}</p>
                      </div>
                    </div>
                    <div className="text-right">
                      <p className="text-lg font-medium tabular-nums text-zinc-100">
                        {formatAmount(row.total, row.unit, row.isCurrency)}
                      </p>
                    </div>
                  </div>
                ))
              }
            </div>
          </CardContent>
        </Card>
      )}

      {/* ══ Inactive Members (admin only, data only sent by backend to admins) ══ */}
      {inactiveMembers && inactiveMembers.length > 0 && (
        <Card className="border-amber-500/15">
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center justify-between text-sm text-zinc-200">
              <span className="flex items-center gap-2">
                <Clock className="h-4 w-4 text-amber-400" />
                {t('dashboard.inactiveMembers')}
              </span>
              <Badge variant="outline" className="text-[11px] border-amber-500/20 text-amber-400 bg-amber-500/5">
                {t('dashboard.inactiveThreshold', { count: inactiveMembers.length, days: inactivityThresholdDays ?? 7 })}
              </Badge>
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-1">
              {inactiveMembers.slice(0, 5).map((m) => (
                <div key={m.userId} className="flex items-center gap-3 py-1.5 px-2 -mx-2 rounded-md hover:bg-white/[0.02]">
                  <Avatar className="h-6 w-6">
                    <AvatarImage src={m.avatarUrl ?? undefined} />
                    <AvatarFallback className="text-[9px]">{displayName(m).slice(0, 2).toUpperCase()}</AvatarFallback>
                  </Avatar>
                  <span className="text-sm text-zinc-300 flex-1 truncate">{displayName(m)}</span>
                  <span className="text-xs text-amber-400 tabular-nums">{m.daysInactive === null ? t('dashboard.never') : t('dashboard.daysShort', { days: m.daysInactive })}</span>
                </div>
              ))}
              {inactiveMembers.length > 5 && (
                <p className="text-[11px] text-zinc-600 text-center pt-1">{t('common.andMore', { count: inactiveMembers.length - 5 })}</p>
              )}
            </div>
          </CardContent>
        </Card>
      )}

      {/* ══ Analytics & Export — folded away by default ══ */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle className="flex items-center gap-2 text-sm text-zinc-200">
              <BarChart3 className="h-4 w-4 text-zinc-400" />
              {t('dashboard.analytics')}
            </CardTitle>
            <Button variant="ghost" size="sm" className="text-xs text-zinc-400" onClick={() => setAnalyticsOpen((v) => !v)}>
              {analyticsOpen ? t('dashboard.hideAnalytics') : t('dashboard.showAnalytics')}
              <ChevronDown className={`h-3.5 w-3.5 ml-1.5 transition-transform duration-200 ${analyticsOpen ? 'rotate-180' : ''}`} />
            </Button>
          </div>
        </CardHeader>
        {analyticsOpen && (
          <CardContent className="space-y-6">
            <DashboardCharts factionId={factionId} brandColor={brandColor} />
            <div className="flex items-center gap-3 pt-2 border-t border-white/[0.06]">
              <Download className="h-4 w-4 text-zinc-500" />
              <span className="text-sm text-zinc-400">{t('common.export')}</span>
              <div className="flex gap-2 ml-auto">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => window.open(exportApi.entriesUrl(factionId), '_blank', 'noopener,noreferrer')}
                >
                  {t('dashboard.exportEntries')}
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => window.open(exportApi.quotaReportUrl(factionId), '_blank', 'noopener,noreferrer')}
                >
                  {t('dashboard.exportQuotaReport')}
                </Button>
              </div>
            </div>
          </CardContent>
        )}
      </Card>
    </div>
  );
}