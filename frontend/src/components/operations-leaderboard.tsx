'use client';

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { operationsApi } from '@/lib/api-client';
import { Card, CardContent } from '@/components/ui/card';
import { EmptyState, ErrorState } from '@/components/ui/empty-state';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Crown, Medal, Star, Trophy } from 'lucide-react';
import { formatAmount, formatDate, displayName } from '@/lib/format';
import { useTranslation } from '@/providers/i18n-provider';
import type { TranslationKey } from '@/lib/i18n';
import type { OperationRanking } from '@/lib/api-types';

const PERIODS: { value: 'week' | 'month' | 'all'; key: TranslationKey }[] = [
  { value: 'week', key: 'period.thisWeek' },
  { value: 'month', key: 'period.thisMonth' },
  { value: 'all', key: 'period.allTime' },
];

const SORTS: { value: 'operations' | 'rating'; key: TranslationKey }[] = [
  { value: 'operations', key: 'operations.board.byCount' },
  { value: 'rating', key: 'operations.board.byRating' },
];

/**
 * Who runs the jobs, and how the people logging them rate the crew.
 *
 * Two boards rather than one, because "turns up most" and "is best to have
 * along" are different claims and a single number would blur them. The order
 * is a deliberate choice in both cases and the screen says which one it is.
 *
 * Nothing here can be sorted worst-first. The data would allow it and it would
 * be a bullying tool in a community app; a board that only counts upwards is
 * the same information without the pillory.
 */
export function OperationsLeaderboard({ factionId }: { factionId: string }) {
  const { t } = useTranslation();
  const [period, setPeriod] = useState<'week' | 'month' | 'all'>('month');
  const [sort, setSort] = useState<'operations' | 'rating'>('operations');

  const query = useQuery({
    queryKey: ['operations-leaderboard', factionId, period, sort],
    queryFn: () => operationsApi.leaderboard(factionId, { period, sort }),
  });

  const board = query.data;
  const rankings = board?.rankings ?? [];

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="text-lg font-medium text-zinc-200">{t('operations.board.title')}</h2>
          <p className="text-sm text-zinc-500">{t('operations.board.subtitle')}</p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Segmented
            label={t('operations.board.sortBy')}
            options={SORTS.map((s) => ({ value: s.value, label: t(s.key) }))}
            value={sort}
            onChange={(value) => setSort(value as 'operations' | 'rating')}
          />
          <Segmented
            label={t('leaderboard.period')}
            options={PERIODS.map((p) => ({ value: p.value, label: t(p.key) }))}
            value={period}
            onChange={(value) => setPeriod(value as 'week' | 'month' | 'all')}
          />
        </div>
      </div>

      {/* What the weighted score is measured against, said out loud rather
          than left as an unexplained number next to somebody's name. */}
      {sort === 'rating' && board && (
        <p className="text-xs text-zinc-500">
          {board.factionAverage === null
            ? t('operations.board.noRatingsYet')
            : t('operations.board.scoreHint')
                .replace('{average}', board.factionAverage.toFixed(2))
                .replace('{count}', String(board.ratedCount))}
        </p>
      )}

      {board?.myRank && (
        <Card className="border-highlight" style={{ borderColor: 'var(--brand-color-light)' }}>
          <CardContent className="flex items-center justify-between py-3">
            <div className="flex items-center gap-2">
              <Trophy className="h-4 w-4 text-brand" />
              <span className="text-sm text-zinc-300">{t('leaderboard.yourRank')}</span>
            </div>
            <span className="text-xl font-medium tabular-nums text-zinc-100">#{board.myRank}</span>
          </CardContent>
        </Card>
      )}

      {query.isLoading ? (
        <div className="space-y-2">
          {[...Array(4)].map((_, i) => <Skeleton key={i} className="h-16 w-full" />)}
        </div>
      ) : query.isError ? (
        <ErrorState error={query.error} onRetry={() => void query.refetch()} />
      ) : rankings.length === 0 ? (
        <EmptyState
          icon={Trophy}
          title={t('operations.board.empty')}
          hint={t('operations.board.emptyHint')}
        />
      ) : (
        <div className="space-y-2">
          {rankings.map((row) => (
            <BoardRow key={row.userId} row={row} sort={sort} />
          ))}
        </div>
      )}
    </div>
  );
}

/** The period and sort switches, which are the same control twice. */
function Segmented({
  label,
  options,
  value,
  onChange,
}: {
  label: string;
  options: { value: string; label: string }[];
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <div className="flex rounded-lg border border-[var(--line-2)] p-0.5" role="tablist" aria-label={label}>
      {options.map((option) => (
        <button
          key={option.value}
          role="tab"
          aria-selected={value === option.value}
          onClick={() => onChange(option.value)}
          className={`h-7 rounded-md px-3 text-xs font-medium transition-colors ${
            value === option.value ? 'bg-[var(--fill-4)] text-zinc-100' : 'text-zinc-500 hover:text-zinc-300'
          }`}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}

function BoardRow({ row, sort }: { row: OperationRanking; sort: 'operations' | 'rating' }) {
  const { t } = useTranslation();
  const name = displayName({ username: row.username, inGameName: row.inGameName });

  const rankMark = row.rank === 1
    ? <Crown className="h-4 w-4 text-amber-400" />
    : row.rank === 2
      ? <Medal className="h-4 w-4 text-zinc-300" />
      : row.rank === 3
        ? <Medal className="h-4 w-4 text-amber-600" />
        : <span className="w-4 text-center text-xs tabular-nums text-zinc-600">{row.rank}</span>;

  return (
    <div
      className={`rounded-lg border p-3 ${
        row.isMe ? 'border-[var(--brand-color-light)] bg-[var(--fill-2)]' : 'border-[var(--line-2)] bg-[var(--surface-1)]'
      }`}
    >
      <div className="flex items-center gap-3">
        <div className="flex w-6 justify-center">{rankMark}</div>

        <Avatar className="size-8">
          <AvatarImage src={row.avatarUrl ?? undefined} alt="" />
          <AvatarFallback>{name.slice(0, 2).toUpperCase()}</AvatarFallback>
        </Avatar>

        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="truncate text-sm text-zinc-100">{name}</span>
            {row.provisional && sort === 'rating' && (
              <Badge variant="outline" className="text-[10px]">{t('operations.board.provisional')}</Badge>
            )}
          </div>
          <p className="mt-0.5 text-xs text-zinc-500">
            {t('operations.board.operationCount').replace('{count}', String(row.operationCount))}
            {row.lastOperationAt ? ` · ${t('operations.board.last').replace('{date}', formatDate(row.lastOperationAt))}` : ''}
          </p>
        </div>

        <div className="text-right">
          {sort === 'rating' ? (
            row.ratingScore === null ? (
              <span className="text-xs text-zinc-500">{t('operations.ratingNone')}</span>
            ) : (
              <>
                <div className="flex items-center justify-end gap-1">
                  <Star className="h-4 w-4 fill-amber-400 text-amber-400" />
                  <span className="text-lg font-medium tabular-nums text-zinc-100">
                    {row.ratingScore.toFixed(2)}
                  </span>
                </div>
                {/* The plain average and how many people it came from: the
                    weighted score is the ranking, this is the evidence. */}
                <p className="text-[11px] text-zinc-500">
                  {t('operations.board.rawAverage')
                    .replace('{average}', (row.ratingAverage ?? 0).toFixed(2))
                    .replace('{count}', String(row.ratingCount))
                    .replace('{raters}', String(row.raterCount))}
                </p>
              </>
            )
          ) : (
            <span className="text-lg font-medium tabular-nums text-zinc-100">{row.operationCount}</span>
          )}
        </div>
      </div>

      {/* Two currencies cannot be added together, so the haul stays as the
          separate lines it actually is. */}
      {row.haul.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 pl-9 text-xs text-zinc-400">
          {row.haul.map((line) => (
            <span key={line.itemTypeName}>
              {line.itemTypeName}: {formatAmount(line.total, line.unit, line.isCurrency)}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
