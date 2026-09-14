'use client';

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { feedApi } from '@/lib/api-client';
import { useAppStore } from '@/lib/store';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { EmptyState, ErrorState, ListSkeleton } from '@/components/ui/empty-state';
import { ItemIcon } from '@/components/item-icon';
import {
  Activity, List, ArrowDownToLine, Megaphone, AlertTriangle, UserPlus, ChevronsUp,
  ChevronLeft, ChevronRight,
} from 'lucide-react';
import { useTranslation } from '@/providers/i18n-provider';
import { formatAmount, formatDateTime, displayName } from '@/lib/format';
import { usePersistedState } from '@/hooks/use-persisted-state';
import type { FeedItem, FeedType, ItemCategory } from '@/lib/api-types';
import type { TranslationKey, TranslationParams } from '@/lib/i18n';

const PAGE_SIZE = 30;

/** Icon per kind, mirroring the sidebar so the timeline reads as the same app. */
const TYPE_ICON: Record<FeedType, typeof List> = {
  entry: List,
  payout: ArrowDownToLine,
  announcement: Megaphone,
  strike: AlertTriangle,
  member_join: UserPlus,
  rank_change: ChevronsUp,
};

/**
 * Only the two that carry a judgement wear colour. An entry and a withdrawal
 * are the ordinary business of a ledger; a strike is not, and a rank change is
 * worth spotting. Everything else stays neutral, as §9.3 asks.
 */
const TYPE_TINT: Partial<Record<FeedType, string>> = {
  strike: 'bg-red-500/10 text-red-300',
  announcement: 'bg-amber-500/10 text-amber-300',
};

const FILTERS: { value: FeedType | 'all'; label: TranslationKey }[] = [
  { value: 'all', label: 'feed.filterAll' },
  { value: 'entry', label: 'feed.filterEntries' },
  { value: 'payout', label: 'feed.filterPayouts' },
  { value: 'announcement', label: 'feed.filterAnnouncements' },
  { value: 'strike', label: 'feed.filterStrikes' },
];

export function FeedView({ factionId }: { factionId: string }) {
  const { t } = useTranslation();
  const user = useAppStore((s) => s.user);
  const [page, setPage] = useState(1);
  const [filter, setFilter] = usePersistedState<FeedType | 'all'>(
    `feed.filter.${factionId}`,
    'all',
  );

  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: ['feed', factionId, page, filter],
    queryFn: () =>
      feedApi.list(factionId, {
        page,
        page_size: PAGE_SIZE,
        ...(filter === 'all' ? {} : { type: filter }),
      }),
    staleTime: 0,
  });

  const items = data?.data ?? [];
  const totalPages = Math.max(1, Math.ceil((data?.meta?.total_count ?? 0) / PAGE_SIZE));

  /**
   * Render one line.
   *
   * The server sends a type and a data bag, never a sentence — a summary
   * written in English at write time would be frozen in it, and the interface
   * is bilingual. Amounts are formatted here so they follow the same rules as
   * every other figure in the app.
   */
  const describe = (item: FeedItem): string => {
    const d = item.data ?? {};
    const who = item.actorIsSystem
      ? t('feed.theFaction')
      : displayName({ username: item.actorUsername, inGameName: item.actorInGameName });

    const amount =
      d.amount !== undefined && d.amount !== null
        ? formatAmount(String(d.amount), String(d.itemUnit ?? ''), d.itemIsCurrency === true)
        : '';

    // The whole data bag goes through, then the few fields that are not raw
    // values are overridden. Hand-listing the placeholders is what broke the
    // notification bell — a sentence gained a `{title}` nobody added to the
    // list, and it rendered literally. Nothing here uses a placeholder the
    // server does not send today, and this keeps it that way.
    const params: TranslationParams = {};
    for (const [name, value] of Object.entries(d)) {
      params[name] = value == null ? '' : String(value);
    }
    // After the loop: the resolved name wins over anything the row carries.
    params.who = who;
    if (amount) params.amount = amount;
    if (d.itemTypeName !== undefined) params.itemType = String(d.itemTypeName ?? '');
    if (d.severity) params.severity = t(`strikes.severity.${d.severity}` as TranslationKey);

    const key = `feed.${item.type}` as TranslationKey;
    const text = t(key, params);
    return text === key ? item.type : text;
  };

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-medium tracking-tight text-zinc-100">{t('nav.feed')}</h2>
        <p className="text-zinc-500 text-sm mt-0.5">{t('feed.intro')}</p>
      </div>

      <Card>
        <CardContent className="py-3">
          <div className="flex flex-wrap items-center gap-1.5">
            {FILTERS.map((f) => (
              <Button
                key={f.value}
                variant="outline"
                size="sm"
                aria-pressed={filter === f.value}
                className={`h-7 px-2.5 text-xs ${
                  filter === f.value ? 'border-primary text-primary bg-primary/10' : 'text-zinc-400'
                }`}
                onClick={() => { setFilter(f.value); setPage(1); }}
              >
                {t(f.label)}
              </Button>
            ))}
          </div>
        </CardContent>
      </Card>

      <Card className="py-0 gap-0">
        <CardContent className="p-0">
          {isLoading ? (
            <ListSkeleton rows={6} height="h-12" />
          ) : isError ? (
            <ErrorState error={error} onRetry={() => refetch()} />
          ) : items.length === 0 ? (
            <EmptyState icon={Activity} title={t('feed.none')} hint={t('feed.noneHint')} />
          ) : (
            <ol className="divide-y divide-white/[0.04]">
              {items.map((item) => {
                const Icon = TYPE_ICON[item.type] ?? Activity;
                const tint = TYPE_TINT[item.type] ?? 'bg-white/[0.05] text-zinc-400';
                const isMe = !item.actorIsSystem && item.actorId === user?.id;
                return (
                  <li key={`${item.type}-${item.id}`} className="flex items-start gap-3 px-4 py-2.5">
                    <span
                      className={`mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-md ${tint}`}
                      aria-hidden="true"
                    >
                      <Icon className="h-3 w-3" />
                    </span>

                    {item.actorIsSystem ? (
                      <span className="mt-0.5 h-5 w-5 shrink-0" aria-hidden="true" />
                    ) : (
                      <Avatar className="mt-0.5 h-5 w-5 shrink-0">
                        <AvatarImage src={item.actorAvatarUrl ?? undefined} />
                        <AvatarFallback className="text-[8px]">
                          {item.actorUsername.slice(0, 2).toUpperCase()}
                        </AvatarFallback>
                      </Avatar>
                    )}

                    <span className="min-w-0 flex-1">
                      <span className={`block text-sm break-words ${isMe ? 'text-zinc-100' : 'text-zinc-300'}`}>
                        {describe(item)}
                      </span>
                      <span className="mt-0.5 block text-[10px] tabular-nums text-zinc-600">
                        {formatDateTime(item.createdAt)}
                      </span>
                    </span>

                    {/* The item's own icon, where the line is about one. */}
                    {item.data.itemTypeName != null && (
                      <ItemIcon
                        src={null}
                        icon={item.data.itemIcon as string | null}
                        category={item.data.itemCategory as ItemCategory | null}
                        className="mt-0.5 size-5"
                      />
                    )}
                  </li>
                );
              })}
            </ol>
          )}

          {totalPages > 1 && (
            <div className="flex items-center justify-between border-t border-white/[0.06] px-4 py-3">
              <span className="text-[11px] tabular-nums text-zinc-600">
                {t('common.pageOf', { page, pages: totalPages })}
              </span>
              <div className="flex gap-1">
                <Button
                  variant="outline" size="sm" className="h-7 w-7 p-0"
                  disabled={page <= 1}
                  onClick={() => setPage((p) => Math.max(1, p - 1))}
                >
                  <ChevronLeft className="h-3.5 w-3.5" />
                </Button>
                <Button
                  variant="outline" size="sm" className="h-7 w-7 p-0"
                  disabled={page >= totalPages}
                  onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                >
                  <ChevronRight className="h-3.5 w-3.5" />
                </Button>
              </div>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
