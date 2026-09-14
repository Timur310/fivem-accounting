'use client';

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { notificationsApi } from '@/lib/api-client';
import { useAppStore, type AppView } from '@/lib/store';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Bell, Check, Trash2 } from 'lucide-react';
import { useTranslation } from '@/providers/i18n-provider';
import { formatAmount, formatDateTime } from '@/lib/format';
import type { AppNotification } from '@/lib/api-types';
import type { TranslationKey, TranslationParams } from '@/lib/i18n';

/** Icon tint per type. Red for a strike and a rejection, green for the rest. */
const TONE: Record<string, string> = {
  payout_approved: 'bg-emerald-500/15 text-emerald-300',
  payout_completed: 'bg-emerald-500/15 text-emerald-300',
  payout_rejected: 'bg-red-500/15 text-red-300',
  strike_issued: 'bg-red-500/15 text-red-300',
  support_resolved: 'bg-emerald-500/15 text-emerald-300',
  support_declined: 'bg-zinc-500/15 text-zinc-300',
};

/**
 * The bell.
 *
 * Everything the app knows and never used to say. Rendered from a `type` and a
 * `data` bag rather than stored text, so a notification raised months ago
 * still follows the reader's current language.
 */
export function NotificationBell() {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);

  const setCurrentView = useAppStore((s) => s.setCurrentView);
  const setSelectedFactionId = useAppStore((s) => s.setSelectedFactionId);

  // The badge polls; the list is only fetched while the panel is open, so a
  // closed bell costs one small query a minute rather than a full list.
  const { data: countData } = useQuery({
    queryKey: ['notifications-unread'],
    queryFn: () => notificationsApi.unreadCount(),
    refetchInterval: 60 * 1000,
    refetchOnWindowFocus: true,
  });
  const unread = countData?.unread ?? 0;

  const { data: items = [], isLoading } = useQuery({
    queryKey: ['notifications'],
    queryFn: () => notificationsApi.list({ limit: 30 }),
    enabled: open,
    staleTime: 0,
  });

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ['notifications'] });
    queryClient.invalidateQueries({ queryKey: ['notifications-unread'] });
  };

  const markRead = useMutation({
    mutationFn: (id: string) => notificationsApi.markRead(id),
    onSuccess: invalidate,
  });
  const markAllRead = useMutation({
    mutationFn: () => notificationsApi.markAllRead(),
    onSuccess: invalidate,
  });
  const clearAll = useMutation({
    mutationFn: () => notificationsApi.clear(),
    onSuccess: invalidate,
  });

  /**
   * Render one notification's sentence.
   *
   * The server's whole `data` bag is handed to the translator, rather than a
   * hand-written list of the placeholders each sentence happens to use. That
   * list was the bug: `announcement_posted` carries a `title` nobody had
   * added to it, so the bell read "Új közlemény: {title}" — and every new
   * notification type would have failed the same way until someone noticed.
   * Passing everything makes forgetting impossible.
   *
   * Two fields are then overridden, because they are not raw values:
   * amounts are formatted here so they follow the same rules as every other
   * figure in the app, and a severity is a translated word, not a key.
   *
   * A missing key shows the raw type instead of an empty row, which makes
   * that kind of omission visible too.
   */
  const describe = (n: AppNotification): string => {
    const d = n.data ?? {};

    const params: TranslationParams = {};
    for (const [name, value] of Object.entries(d)) {
      // null renders as an empty gap rather than the word "null".
      params[name] = value == null ? '' : String(value);
    }

    if (d.amount !== undefined && d.amount !== null) {
      params.amount = formatAmount(
        String(d.amount),
        String(d.itemUnit ?? ''),
        Number(d.itemIsCurrency) === 1,
      );
    }
    if (d.severity) {
      params.severity = t(`strikes.severity.${d.severity}` as TranslationKey);
    }
    // The payout sentences name it `itemType`; the server sends `itemTypeName`.
    if (d.itemTypeName !== undefined) params.itemType = String(d.itemTypeName ?? '');

    const key = `notification.${n.type}` as TranslationKey;
    const text = t(key, params);
    return text === key ? n.type : text;
  };

  const handleClick = (n: AppNotification) => {
    if (!n.readAt) markRead.mutate(n.id);
    // Follow the notification to where it happened — including into the right
    // faction, since the reader may be looking at a different one.
    if (n.factionId) setSelectedFactionId(n.factionId);
    if (n.linkView) setCurrentView(n.linkView as AppView);
    setOpen(false);
  };

  return (
    <DropdownMenu open={open} onOpenChange={setOpen}>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className="relative h-8 w-8 text-zinc-400 hover:text-zinc-200"
          aria-label={t('notification.title')}
        >
          <Bell className="h-4 w-4" />
          {unread > 0 && (
            <span
              className="absolute -top-0.5 -right-0.5 min-w-[16px] rounded-full bg-amber-500/90 px-1 text-[9px] font-medium leading-4 text-zinc-950 tabular-nums"
              aria-label={t('notification.unreadCount', { count: unread })}
            >
              {unread > 99 ? '99+' : unread}
            </span>
          )}
        </Button>
      </DropdownMenuTrigger>

      <DropdownMenuContent align="end" className="w-[min(360px,calc(100vw-2rem))] p-0">
        <div className="flex items-center justify-between border-b border-[var(--line-1)] px-3 py-2">
          <span className="text-xs font-medium text-zinc-300">{t('notification.title')}</span>
          <div className="flex gap-1">
            {unread > 0 && (
              <Button
                variant="ghost" size="sm" className="h-6 px-1.5 text-meta text-zinc-500 hover:text-zinc-200"
                onClick={() => markAllRead.mutate()}
              >
                <Check className="mr-1 h-3 w-3" />
                {t('notification.markAllRead')}
              </Button>
            )}
            {items.length > 0 && (
              <Button
                variant="ghost" size="sm" className="h-6 px-1.5 text-meta text-zinc-500 hover:text-zinc-200"
                onClick={() => clearAll.mutate()}
              >
                <Trash2 className="mr-1 h-3 w-3" />
                {t('notification.clear')}
              </Button>
            )}
          </div>
        </div>

        <div className="max-h-[min(420px,60vh)] overflow-y-auto">
          {isLoading ? (
            <div className="space-y-2 p-3">
              {[...Array(3)].map((_, i) => (
                <div key={i} className="h-10 w-full animate-pulse rounded-md bg-[var(--fill-2)]" />
              ))}
            </div>
          ) : items.length === 0 ? (
            <p className="px-3 py-8 text-center text-xs text-zinc-600">{t('notification.none')}</p>
          ) : (
            items.map((n) => (
              <button
                key={n.id}
                type="button"
                onClick={() => handleClick(n)}
                className={`flex w-full items-start gap-2.5 border-b border-[var(--line-1)] px-3 py-2.5 text-left transition-colors last:border-0 hover:bg-[var(--fill-2)] ${
                  n.readAt ? 'opacity-60' : ''
                }`}
              >
                <span
                  className={`mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full ${TONE[n.type] ?? 'bg-[var(--fill-3)] text-zinc-300'}`}
                  aria-hidden="true"
                >
                  <Bell className="h-2.5 w-2.5" />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block text-xs text-zinc-200 break-words">{describe(n)}</span>
                  <span className="mt-0.5 block text-micro text-zinc-600 tabular-nums">
                    {n.factionName ? `${n.factionName} · ` : ''}
                    {formatDateTime(n.createdAt)}
                  </span>
                </span>
                {!n.readAt && (
                  <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-amber-400" aria-hidden="true" />
                )}
              </button>
            ))
          )}
        </div>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
