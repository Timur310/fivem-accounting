'use client';

import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { leaderboardApi, globalLeaderboardApi, itemTypesApi } from '@/lib/api-client';
import { Card, CardContent } from '@/components/ui/card';
import { EmptyState, ErrorState } from '@/components/ui/empty-state';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import {
  SearchableSelect, type SearchableSelectOption,
} from '@/components/ui/searchable-select';
import { Trophy, Medal, Crown, Flame } from 'lucide-react';
import { useAppStore } from '@/lib/store';
import type { ItemType } from '@/lib/api-types';
import { Button } from '@/components/ui/button';
import { ItemIcon } from '@/components/item-icon';
import { formatNumber, displayName } from '@/lib/format';
import { useTranslation } from '@/providers/i18n-provider';
import type { TranslationKey } from '@/lib/i18n';

const PERIOD_KEYS: Record<string, TranslationKey> = {
  week: 'period.thisWeek',
  month: 'period.thisMonth',
  all: 'period.allTime',
};

interface Props {
  factionId: string;
  isSuperadmin: boolean;
}

export function LeaderboardView({ factionId, isSuperadmin }: Props) {
  const { t } = useTranslation();
  const brandColor = useAppStore((s) => s.brandColor);
  const setSelectedMemberUserId = useAppStore((s) => s.setSelectedMemberUserId);
  const setCurrentView = useAppStore((s) => s.setCurrentView);
  const handleOpenProfile = (userId: string) => {
    setSelectedMemberUserId(userId);
    setCurrentView('member-profile');
  };
  const [period, setPeriod] = useState<string>('month');
  const [itemTypeId, setItemTypeId] = useState<string>('');
  const [showGlobal, setShowGlobal] = useState(false);

  const periodOptions = useMemo<SearchableSelectOption[]>(
    () => Object.entries(PERIOD_KEYS).map(([value, key]) => ({ value, label: t(key) })),
    [t],
  );

  // Fetch item types for filter
  const { data: itemTypes = [] } = useQuery({
    queryKey: ['item-types', factionId],
    queryFn: () => itemTypesApi.list(factionId),
    staleTime: 5 * 60 * 1000,
  });

  // The empty value is the unfiltered case, so it doubles as a way to clear.
  const itemTypeFilterOptions = useMemo<SearchableSelectOption[]>(() => [
    { value: '', label: t('entries.allTypes') },
    ...itemTypes.map((item: ItemType) => ({
      value: item.id,
      label: item.name,
      hint: item.unit ? `(${item.unit})` : undefined,
      icon: <ItemIcon src={item.imageUrl} icon={item.icon} category={item.category} className="size-5" />,
    })),
  ], [itemTypes, t]);

  // Faction leaderboard
  const { data: lbData, isLoading: lbLoading, isError: lbIsError, error: lbError, refetch: lbRefetch } = useQuery({
    queryKey: ['leaderboard', factionId, period, itemTypeId],
    queryFn: () => leaderboardApi.get(factionId, {
      period: period as 'week' | 'month' | 'all',
      item_type_id: itemTypeId || undefined,
    }),
    staleTime: 0,
    enabled: !showGlobal,
  });

  // Global leaderboard (superadmin only)
  const { data: globalData, isLoading: globalLoading, isError: globalIsError, error: globalError, refetch: globalRefetch } = useQuery({
    queryKey: ['global-leaderboard', period],
    queryFn: () => globalLeaderboardApi.get({ period: period as 'week' | 'month' | 'all' }),
    staleTime: 0,
    enabled: showGlobal && isSuperadmin,
  });

  const loading = showGlobal ? globalLoading : lbLoading;
  const isError = showGlobal ? globalIsError : lbIsError;
  const loadError = showGlobal ? globalError : lbError;
  const retry = showGlobal ? globalRefetch : lbRefetch;
  const rankings = showGlobal ? (globalData?.rankings ?? []) : (lbData?.rankings ?? []);
  const myRank = showGlobal ? null : (lbData?.myRank ?? null);
  // The API also sends a label for the period, but always in English. The
  // period is chosen right here, so translating it locally keeps the subtitle
  // in the language the rest of the screen is in.
  const periodLabel = PERIOD_KEYS[period] ? t(PERIOD_KEYS[period]) : '';

  const fmt = formatNumber;

  const rankIcon = (rank: number) => {
    if (rank === 1) return <Crown className="h-4 w-4 text-amber-400" />;
    if (rank === 2) return <Medal className="h-4 w-4 text-zinc-300" />;
    if (rank === 3) return <Medal className="h-4 w-4 text-amber-600" />;
    return <span className="text-xs text-zinc-600 w-4 text-center tabular-nums">{rank}</span>;
  };

  return (
    <div className="space-y-4">
      {/* Header + Filters */}
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div>
          <h3 className="text-lg font-medium text-zinc-200">{t('nav.leaderboard')}</h3>
          <p className="text-sm text-zinc-500">{periodLabel}</p>
        </div>
        <div className="flex items-center gap-2">
          {isSuperadmin && (
            <Button
              variant={showGlobal ? 'default' : 'outline'}
              size="sm"
              onClick={() => setShowGlobal(!showGlobal)}
              className="text-xs"
            >
              {showGlobal ? t('leaderboard.global') : t('leaderboard.faction')}
            </Button>
          )}
          {/* Segmented period control — a race you can flip with a tap. */}
          <div className="flex rounded-lg border border-[var(--line-2)] p-0.5" role="tablist" aria-label={t('leaderboard.period')}>
            {(Object.keys(PERIOD_KEYS) as string[]).map((value) => (
              <button
                key={value}
                role="tab"
                aria-selected={period === value}
                onClick={() => setPeriod(value)}
                className={`h-7 px-3 rounded-md text-xs font-medium transition-colors ${period === value ? 'bg-[var(--fill-4)] text-zinc-100' : 'text-zinc-500 hover:text-zinc-300'}`}
              >
                {t(PERIOD_KEYS[value])}
              </button>
            ))}
          </div>
          {!showGlobal && (
            <SearchableSelect
              className="w-[140px]"
              size="sm"
              aria-label={t('itemTypes.filterBy')}
              value={itemTypeId}
              onValueChange={setItemTypeId}
              options={itemTypeFilterOptions}
              placeholder={t('entries.allTypes')}
              searchPlaceholder={t('itemTypes.search')}
              emptyMessage={t('itemTypes.noneMatch')}
            />
          )}
        </div>
      </div>

      {/* My Rank Banner */}
      {myRank && (
        <Card className="border-highlight" style={{ borderColor: 'var(--brand-color-light)' }}>
          <CardContent className="py-3 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Trophy className="h-4 w-4 text-brand" />
              <span className="text-sm text-zinc-300">{t('leaderboard.yourRank')}</span>
            </div>
            <span className="text-xl font-medium tabular-nums text-zinc-100">#{myRank}</span>
          </CardContent>
        </Card>
      )}

      {/* Rankings List */}
      <Card className="py-0 gap-0">
        <CardContent className="p-0">
          {loading ? (
            <div className="p-6 space-y-3">{[...Array(5)].map((_, i) => <Skeleton key={i} className="h-14 w-full" />)}</div>
          ) : isError ? (
            <ErrorState error={loadError} onRetry={() => retry()} />
          ) : rankings.length === 0 ? (
            <EmptyState icon={Trophy} title={t('leaderboard.noEntriesForPeriod')} />
          ) : (
            <div>
            {/* Podium: the top three get an emphasized header row — the race
                should look like one. Skipped on the global board and when a
                filter narrows the field to fewer than three. */}
            {!showGlobal && rankings.length >= 3 && (
              <div className="grid grid-cols-3 items-end gap-2 border-b border-[var(--line-1)] p-3 pt-5">
                {/* Second, first, third — the order a podium is stood on, and
                    the order a photograph of one is read.

                    It was three identical cards before, which is a top-three
                    list rather than a podium: nothing about it said one of
                    them had won. The difference is height and metal, not
                    decoration — this is still a ledger, and the number under
                    each name is the point. */}
                {[1, 0, 2].map((idx) => {
                  const r = rankings[idx];
                  if (!r) return null;
                  const isMe = 'isMe' in r && r.isMe;
                  const first = r.rank === 1;

                  const metal =
                    r.rank === 1 ? 'var(--medal-gold)'
                    : r.rank === 2 ? 'var(--medal-silver)'
                    : 'var(--medal-bronze)';

                  return (
                    <button
                      key={r.userId}
                      onClick={() => handleOpenProfile?.(r.userId)}
                      className={`group relative flex flex-col items-center gap-1.5 rounded-lg border pb-3 transition-colors ${
                        first ? 'pt-5' : 'pt-3'
                      } ${isMe ? 'ring-1 ring-[var(--brand-color,#6366f1)]' : ''}`}
                      style={{
                        // A wash of the metal rather than a block of it. Gold
                        // has to be legible as first place without the tile
                        // turning into a button that outshines the figures.
                        borderColor: first ? metal : 'var(--line-1)',
                        background: first
                          ? `linear-gradient(to bottom, color-mix(in srgb, ${metal} 12%, transparent), transparent 70%)`
                          : undefined,
                      }}
                      title={displayName(r)}
                    >
                      {/* The medal sits on the tile's edge, so the three read
                          as one object rather than three separate cards. */}
                      <span
                        className="absolute -top-2.5 flex size-5 items-center justify-center rounded-full border bg-[var(--card)]"
                        style={{ borderColor: metal, color: metal }}
                      >
                        {first ? <Crown className="h-3 w-3" /> : <Medal className="h-3 w-3" />}
                      </span>

                      <Avatar
                        className={`${first ? 'h-14 w-14' : 'h-10 w-10'} border`}
                        style={{ borderColor: metal }}
                      >
                        <AvatarImage src={r.avatarUrl ?? undefined} />
                        <AvatarFallback className={first ? 'text-sm' : 'text-xs'}>
                          {displayName(r).slice(0, 2).toUpperCase()}
                        </AvatarFallback>
                      </Avatar>

                      <p className={`max-w-full truncate px-1 ${first ? 'text-sm text-zinc-100' : 'text-xs text-zinc-300'}`}>
                        {displayName(r)}
                      </p>

                      <p className={`font-medium tabular-nums ${first ? 'text-base text-zinc-100' : 'text-sm text-zinc-300'}`}>
                        {formatNumber(r.total)}
                      </p>

                      {/* The plinth. Its height is the whole point of the
                          component: first stands taller than second, second
                          taller than third, before a single number is read. */}
                      <span
                        aria-hidden
                        className={`mt-1 w-full rounded-t-sm ${
                          first ? 'h-4' : r.rank === 2 ? 'h-2.5' : 'h-1.5'
                        }`}
                        style={{ backgroundColor: `color-mix(in srgb, ${metal} 28%, transparent)` }}
                      />
                    </button>
                  );
                })}
              </div>
            )}
            <div className="divide-y divide-[var(--line-1)]">
              {rankings.map((r) => {
                const isMe = 'isMe' in r && r.isMe;
                return (
                  <div
                    key={`${showGlobal && 'factionId' in r ? r.factionId : ''}-${r.userId}`}
                    className={`flex items-center gap-4 px-4 py-3 transition-colors duration-100 ${isMe ? 'bg-[var(--fill-2)]' : 'hover:bg-[var(--fill-1)]'}`}
                    style={isMe ? { borderLeft: `3px solid ${brandColor}` } : { borderLeft: '3px solid transparent' }}
                  >
                    {/* Rank + movement vs. the previous period */}
                    <div className="w-6 flex justify-center shrink-0 relative">
                      {rankIcon(r.rank)}
                      {'streakCurrent' in r && r.movement != null && r.movement !== 0 && (
                        <span
                          className={`absolute -top-1 -right-1.5 text-[9px] font-medium tabular-nums ${r.movement > 0 ? 'text-emerald-400' : 'text-red-400'}`}
                          title={t('leaderboard.movement', { count: Math.abs(r.movement) })}
                        >
                          {r.movement > 0 ? '▲' : '▼'}{Math.abs(r.movement)}
                        </span>
                      )}
                    </div>

                    {/* Avatar + Name */}
                    <Avatar className="h-8 w-8 shrink-0">
                      <AvatarImage src={r.avatarUrl ?? undefined} />
                      <AvatarFallback className="text-micro">{displayName(r).slice(0, 2).toUpperCase()}</AvatarFallback>
                    </Avatar>
                    <div className="flex-1 min-w-0">
                      <p className={`text-sm font-medium truncate ${isMe ? 'text-brand' : 'text-zinc-300'}`}>
                        {displayName(r)}
                        {/* A streak only earns colour when it is alive today. */}
                        {'streakCurrent' in r && (r.streakCurrent ?? 0) >= 3 && (
                          <span
                            className={`inline-flex items-center ml-1.5 text-micro ${r.streakActiveToday ? 'text-amber-400' : 'text-zinc-500'}`}
                            title={t('leaderboard.streak', { count: r.streakCurrent ?? 0 })}
                          >
                            <Flame className="h-3 w-3 mr-0.5" />{r.streakCurrent}
                          </span>
                        )}
                        {isMe && <span className="text-micro text-zinc-500 ml-1">{t('leaderboard.you')}</span>}
                      </p>
                      {'factionName' in r && (
                        <p className="text-meta text-zinc-600">{r.factionName}</p>
                      )}
                    </div>

                    {/* Item Breakdown (faction only) */}
                    {!showGlobal && 'itemBreakdown' in r && Object.keys(r.itemBreakdown).length > 0 && (
                      <div className="hidden lg:flex items-center gap-2">
                        {Object.entries(r.itemBreakdown).slice(0, 3).map(([name, val]) => (
                          <Badge key={name} variant="outline" className="text-micro text-zinc-500 border-[var(--line-1)]">
                            {name}: {fmt(val)}
                          </Badge>
                        ))}
                      </div>
                    )}

                    {/* Stats */}
                    <div className="text-right shrink-0">
                      <p className="text-sm font-medium tabular-nums text-zinc-100">{fmt(r.total)}</p>
                      <p className="text-micro text-zinc-600">{t('entries.count', { count: r.entryCount })}</p>
                    </div>
                  </div>
                );
              })}
            </div>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
