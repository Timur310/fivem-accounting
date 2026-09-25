'use client';

import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  announcementsApi, complaintsApi, memberStrikesApi, quotasApi,
} from '@/lib/api-client';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { ShiftClock } from '@/components/shift-clock';
import { StrikeDetailDialog } from '@/components/strike-detail-dialog';
import { useFactionModules } from '@/hooks/use-faction-modules';
import { useAppStore } from '@/lib/store';
import { useTranslation } from '@/providers/i18n-provider';
import { formatDate, formatNumber, displayName } from '@/lib/format';
import {
  AlertTriangle, ArrowRight, CheckCircle2, Megaphone, MessageSquareReply, Target,
} from 'lucide-react';
import { COMPLAINT_STATUS_KEYS } from '@/lib/api-types';
import type { Quota, Strike } from '@/lib/api-types';

interface Props {
  factionId: string;
  /** May clock in; the clock is only shown to people who can use it. */
  canLogShifts: boolean;
}

/**
 * The member's own front page: what is going on with *them*.
 *
 * The dashboard answers leadership's questions — the treasury, the board, the
 * week's contributors. A plain member opening the app mostly wants five other
 * things, and before this they were on five screens: am I clocked in, how far
 * am I off my quota, is there an announcement I have not read, has anybody
 * answered what I raised, and is there a strike on my record.
 *
 * Everything here is a read of an endpoint that already exists, narrowed to
 * the caller, and each panel is hidden when its module is off or when it has
 * nothing to say. A screen that shows five empty boxes to tell you nothing is
 * happening is worse than one line saying so.
 */
export function MyDayView({ factionId, canLogShifts }: Props) {
  const { t } = useTranslation();
  const user = useAppStore((s) => s.user);
  const setCurrentView = useAppStore((s) => s.setCurrentView);
  const { isOn } = useFactionModules(factionId);
  const [openStrike, setOpenStrike] = useState<Strike | null>(null);

  const quotas = useQuery({
    queryKey: ['quotas', factionId],
    queryFn: () => quotasApi.list(factionId),
    enabled: isOn('quotas'),
  });

  const announcements = useQuery({
    queryKey: ['announcements', factionId, false],
    queryFn: () => announcementsApi.list(factionId),
    enabled: isOn('announcements'),
  });

  const strikes = useQuery({
    queryKey: ['member-strikes', factionId, user?.id],
    queryFn: () => memberStrikesApi.list(factionId, user!.id),
    enabled: isOn('strikes') && !!user,
  });

  const complaints = useQuery({
    queryKey: ['complaints', factionId, 'mine'],
    queryFn: () => complaintsApi.list(factionId, { mine: 'true' }),
    enabled: isOn('complaints'),
  });

  // Quotas the caller is actually measured against. A target set on somebody
  // else is their business; a faction-wide one and an everyone-each one are
  // both the caller's too.
  const myQuotas = useMemo(
    () => (quotas.data ?? []).filter((q) =>
      q.isActive && (q.scope !== 'member' || q.targetUserId === user?.id)),
    [quotas.data, user?.id],
  );

  const unread = (announcements.data ?? []).filter((a) => !a.isReadByMe);
  const activeStrikes = (strikes.data ?? []).filter((s) => s.effectiveStatus === 'active');

  // What came of what I raised: the ones still open, and the ones answered in
  // the last fortnight. An answer from three months ago is history, not news.
  const fortnightAgo = Date.now() - 14 * 24 * 3_600_000;
  const myComplaints = (complaints.data?.complaints ?? []).filter((c) =>
    c.status === 'open' || c.status === 'in_review'
    || ((c.status === 'resolved' || c.status === 'dismissed')
      && c.handledAt && new Date(c.handledAt).getTime() > fortnightAgo));

  const loading = quotas.isLoading || announcements.isLoading || strikes.isLoading || complaints.isLoading;
  const nothing = !loading
    && myQuotas.length === 0
    && unread.length === 0
    && activeStrikes.length === 0
    && myComplaints.length === 0;

  const name = user ? displayName({ username: user.username, inGameName: user.inGameName }) : '';

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-zinc-100">
          {t('myDay.greeting').replace('{name}', name)}
        </h1>
        <p className="mt-1 text-sm text-zinc-400">{t('myDay.subtitle')}</p>
      </div>

      {/* First, because it is the thing people open the app to do. */}
      {isOn('shifts') && canLogShifts && <ShiftClock factionId={factionId} />}

      {loading && (
        <div className="grid gap-4 md:grid-cols-2">
          <Skeleton className="h-32 w-full" />
          <Skeleton className="h-32 w-full" />
        </div>
      )}

      {nothing && (
        <Card>
          <CardContent className="flex items-center gap-3 py-5">
            <CheckCircle2 className="h-5 w-5 text-emerald-400" />
            <div>
              <p className="text-sm text-zinc-200">{t('myDay.allQuiet')}</p>
              <p className="text-xs text-zinc-500">{t('myDay.allQuietHint')}</p>
            </div>
          </CardContent>
        </Card>
      )}

      <div className="grid gap-4 md:grid-cols-2">
        {/* ── Unread announcements ──────────────────── */}
        {unread.length > 0 && (
          <Panel
            icon={<Megaphone className="h-4 w-4 text-brand" />}
            title={t('myDay.unread').replace('{count}', String(unread.length))}
            action={t('myDay.readThem')}
            onAction={() => setCurrentView('announcements')}
          >
            <ul className="space-y-1.5">
              {unread.slice(0, 4).map((a) => (
                <li key={a.id} className="flex items-center gap-2 text-sm text-zinc-200">
                  {a.priority === 'urgent' && (
                    <Badge variant="outline" className="border-red-500/40 bg-red-500/10 text-[10px] text-red-300">
                      {t('myDay.urgent')}
                    </Badge>
                  )}
                  <span className="truncate">{a.title}</span>
                </li>
              ))}
            </ul>
          </Panel>
        )}

        {/* ── Quotas ────────────────────────────────── */}
        {myQuotas.length > 0 && (
          <Panel
            icon={<Target className="h-4 w-4 text-brand" />}
            title={t('myDay.quotas')}
            action={t('myDay.logEntry')}
            onAction={isOn('entries') ? () => setCurrentView('entries') : undefined}
          >
            <div className="space-y-3">
              {myQuotas.slice(0, 4).map((q) => <QuotaLine key={q.id} quota={q} />)}
            </div>
          </Panel>
        )}

        {/* ── What I raised ─────────────────────────── */}
        {myComplaints.length > 0 && (
          <Panel
            icon={<MessageSquareReply className="h-4 w-4 text-brand" />}
            title={t('myDay.complaints')}
            action={t('myDay.openComplaints')}
            onAction={() => setCurrentView('complaints')}
          >
            <ul className="space-y-2">
              {myComplaints.slice(0, 4).map((c) => (
                <li key={c.id} className="space-y-0.5">
                  <div className="flex items-center gap-2">
                    <span className="truncate text-sm text-zinc-200">{c.subject}</span>
                    <Badge variant="outline" className="shrink-0 text-[10px]">
                      {t(COMPLAINT_STATUS_KEYS[c.status])}
                    </Badge>
                  </div>
                  {/* The answer is the news. Showing it here saves opening the
                      complaint just to find out it was dealt with. */}
                  {c.resolutionNote && (
                    <p className="line-clamp-2 text-xs text-zinc-400">
                      {c.handlerName ? `${c.handlerName}: ` : ''}{c.resolutionNote}
                    </p>
                  )}
                </li>
              ))}
            </ul>
          </Panel>
        )}

        {/* ── Strikes ───────────────────────────────── */}
        {activeStrikes.length > 0 && (
          <Panel
            icon={<AlertTriangle className="h-4 w-4 text-amber-400" />}
            title={t('myDay.strikes').replace('{count}', String(activeStrikes.length))}
          >
            <ul className="space-y-1.5">
              {activeStrikes.map((s) => (
                <li key={s.id}>
                  <button
                    type="button"
                    onClick={() => setOpenStrike(s)}
                    className="flex w-full items-center gap-2 text-left text-sm text-zinc-200 hover:text-zinc-50"
                  >
                    <span className="min-w-0 flex-1 truncate">{s.reason}</span>
                    {s.expiresAt && (
                      <span className="shrink-0 text-xs text-zinc-500">
                        {t('myDay.strikeUntil').replace('{date}', formatDate(s.expiresAt))}
                      </span>
                    )}
                  </button>
                </li>
              ))}
            </ul>
          </Panel>
        )}
      </div>

      <StrikeDetailDialog strike={openStrike} onClose={() => setOpenStrike(null)} />
    </div>
  );
}

/** One card on the page: a heading, a few lines, and where to go for more. */
function Panel({
  icon,
  title,
  action,
  onAction,
  children,
}: {
  icon: React.ReactNode;
  title: string;
  action?: string;
  onAction?: () => void;
  children: React.ReactNode;
}) {
  return (
    <Card>
      <CardContent className="space-y-3 py-4">
        <div className="flex items-center justify-between gap-2">
          <p className="flex items-center gap-2 text-sm font-medium text-zinc-200">
            {icon}
            {title}
          </p>
          {action && onAction && (
            <Button variant="ghost" size="sm" onClick={onAction} className="h-7 text-xs">
              {action}
              <ArrowRight className="ml-1 h-3.5 w-3.5" />
            </Button>
          )}
        </div>
        {children}
      </CardContent>
    </Card>
  );
}

function QuotaLine({ quota }: { quota: Quota }) {
  const { t } = useTranslation();
  const current = quota.currentAmount ?? 0;
  const target = Number(quota.targetAmount) || 0;
  const percentage = Math.min(100, Math.round(quota.percentage ?? 0));
  const met = target > 0 && current >= target;

  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between gap-2 text-xs">
        <span className="truncate text-zinc-300">
          {quota.itemTypeName}
          {/* A faction-wide target is everybody's number, not yours alone —
              worth saying, or a member reads the shared total as their own. */}
          {quota.scope === 'faction' && <span className="text-zinc-500"> · {t('myDay.sharedTarget')}</span>}
        </span>
        <span className={`shrink-0 tabular-nums ${met ? 'text-emerald-400' : 'text-zinc-400'}`}>
          {formatNumber(current)} / {formatNumber(target)}
        </span>
      </div>
      <div className="h-1.5 overflow-hidden rounded-full bg-[var(--fill-3)]">
        <div
          className={`h-full rounded-full ${met ? 'bg-emerald-500' : 'bg-brand'}`}
          style={{ width: `${percentage}%` }}
        />
      </div>
      {quota.periodEndComputed && !met && (
        <p className="text-[10px] text-zinc-600">
          {t('myDay.quotaUntil').replace('{date}', formatDate(quota.periodEndComputed))}
        </p>
      )}
    </div>
  );
}
