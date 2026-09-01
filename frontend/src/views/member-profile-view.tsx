'use client';

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  membersApi, notesApi, memberStrikesApi,
} from '@/lib/api-client';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { SearchableSelect } from '@/components/ui/searchable-select';
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import {
  ArrowLeft, Flame, Trophy, Target, Calendar, FileText, AlertTriangle,
  Flag, Plus, Pencil, Trash2, Send, Activity, Zap, Clock, User,
} from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import type { NoteCategory, StrikeEffectiveStatus } from '@/lib/api-types';
import { useAppStore } from '@/lib/store';
import { formatAmount, displayName, formatDate, formatNumber, formatCount } from '@/lib/format';
import { ItemIcon } from '@/components/item-icon';
import { useTranslation } from '@/providers/i18n-provider';
import type { TranslationKey } from '@/lib/i18n';

interface Props {
  factionId: string;
  userId: string;
  /**
   * Whether the caller may issue and settle strikes. The API runs those on
   * `manage_strikes`, so gating them on the admin role here hid the buttons
   * from a rank that was allowed to use them.
   */
  canManageStrikes?: boolean;
}

type ProfileTab = 'overview' | 'notes' | 'history';

const NOTE_CATEGORY_KEYS: Record<NoteCategory, TranslationKey> = {
  general: 'notes.category.general',
  performance: 'notes.category.performance',
  discipline: 'notes.category.discipline',
  positive: 'notes.category.positive',
  promotion: 'notes.category.promotion',
};

const SEVERITY_KEYS: Record<string, TranslationKey> = {
  warning: 'strikes.severity.warning',
  minor: 'strikes.severity.minor',
  major: 'strikes.severity.major',
};

const STRIKE_STATUS_KEYS: Record<string, TranslationKey> = {
  active: 'strikes.status.active',
  appealed: 'strikes.status.appealed',
  revoked: 'strikes.status.revoked',
  expired: 'strikes.status.expired',
};

/** The five components the API scores a member on. */
const PERFORMANCE_KEYS: Record<string, TranslationKey> = {
  quotaHitRate: 'profile.performance.quotaHitRate',
  consistency: 'profile.performance.consistency',
  totalVolume: 'profile.performance.totalVolume',
  streakBonus: 'profile.performance.streakBonus',
  seniorityBonus: 'profile.performance.seniorityBonus',
};

const TAB_KEYS: Record<ProfileTab, TranslationKey> = {
  overview: 'profile.tab.overview',
  notes: 'profile.tab.notes',
  history: 'profile.tab.history',
};

const SEVERITY_COLORS: Record<string, string> = {
  warning: 'border-amber-500/30 bg-amber-500/10 text-amber-400',
  minor: 'border-orange-500/30 bg-orange-500/10 text-orange-400',
  major: 'border-red-500/30 bg-red-500/10 text-red-400',
};

const EFFECTIVE_STATUS_COLORS: Record<StrikeEffectiveStatus, string> = {
  active: 'text-amber-400',
  appealed: 'text-blue-400',
  revoked: 'text-zinc-500',
  expired: 'text-zinc-600',
};

export function MemberProfileView({ factionId, userId, canManageStrikes }: Props) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const brandColor = useAppStore((s) => s.brandColor);
  const setCurrentView = useAppStore((s) => s.setCurrentView);

  const [tab, setTab] = useState<ProfileTab>('overview');

  // Note dialog
  const [noteOpen, setNoteOpen] = useState(false);
  const [noteContent, setNoteContent] = useState('');
  const [noteCategory, setNoteCategory] = useState<NoteCategory>('general');
  const [noteFlagged, setNoteFlagged] = useState(false);
  const [editingNoteId, setEditingNoteId] = useState<string | null>(null);
  const [deleteNoteId, setDeleteNoteId] = useState<string | null>(null);

  // Strike dialog
  const [strikeOpen, setStrikeOpen] = useState(false);
  const [strikeReason, setStrikeReason] = useState('');
  const [strikeSeverity, setStrikeSeverity] = useState<'warning' | 'minor' | 'major'>('warning');

  // Heatmap year
  const [heatmapYear, setHeatmapYear] = useState(new Date().getFullYear());

  // ── Queries ──
  const { data: profile, isLoading } = useQuery({
    queryKey: ['member-profile', factionId, userId],
    queryFn: () => membersApi.getProfile(factionId, userId),
    staleTime: 0,
  });

  // Notes need `manage_members` — they are never shown to their subject —
  // while history is also your own to read. The profile response reports both.
  // Falling back to Overview matters when the same screen is reused for the
  // next member, whose file may be closed.
  const visibleTabs: ProfileTab[] = [
    'overview',
    ...(profile?.canViewNotes ? ['notes' as const] : []),
    ...(profile?.canViewHistory ? ['history' as const] : []),
  ];
  const activeTab: ProfileTab = visibleTabs.includes(tab) ? tab : 'overview';

  const { data: notes = [], isLoading: notesLoading } = useQuery({
    queryKey: ['member-notes', factionId, userId],
    queryFn: () => notesApi.list(factionId, userId),
    enabled: profile?.canViewNotes === true,
    staleTime: 0,
  });

  const { data: strikes = [] } = useQuery({
    queryKey: ['member-strikes', factionId, userId],
    queryFn: () => memberStrikesApi.list(factionId, userId),
    staleTime: 0,
  });

  const { data: heatmap } = useQuery({
    queryKey: ['member-heatmap', factionId, userId, heatmapYear],
    queryFn: () => membersApi.getHeatmap(factionId, userId, heatmapYear),
    staleTime: 5 * 60 * 1000,
  });

  const { data: historyData } = useQuery({
    queryKey: ['member-history', factionId, userId],
    queryFn: () => membersApi.getHistory(factionId, userId, 1, 50),
    enabled: activeTab === 'history' && profile?.canViewHistory === true,
    staleTime: 0,
  });

  // ── Mutations ──
  const noteMutation = useMutation({
    mutationFn: () => {
      if (editingNoteId) {
        return notesApi.update(factionId, userId, editingNoteId, { content: noteContent, category: noteCategory, isFlagged: noteFlagged });
      }
      return notesApi.create(factionId, userId, { content: noteContent, category: noteCategory, isFlagged: noteFlagged });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['member-notes', factionId, userId] });
      closeNoteDialog();
      toast({ title: editingNoteId ? t('notes.updated') : t('notes.added') });
    },
    onError: (err: any) => {
      toast({ title: t('common.failed'), description: err.response?.data?.error?.message || t('common.unknownError'), variant: 'destructive' });
    },
  });

  const deleteNoteMutation = useMutation({
    mutationFn: () => notesApi.remove(factionId, userId, deleteNoteId!),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['member-notes', factionId, userId] });
      setDeleteNoteId(null);
      toast({ title: t('notes.deleted') });
    },
  });

  const strikeMutation = useMutation({
    mutationFn: () => memberStrikesApi.issue(factionId, userId, { reason: strikeReason, severity: strikeSeverity }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['member-strikes', factionId, userId] });
      queryClient.invalidateQueries({ queryKey: ['member-profile', factionId, userId] });
      queryClient.invalidateQueries({ queryKey: ['members', factionId] });
      setStrikeOpen(false);
      setStrikeReason('');
      toast({ title: t('strikes.issuedToast') });
    },
    onError: (err: any) => {
      toast({ title: t('common.failed'), description: err.response?.data?.error?.message || t('common.unknownError'), variant: 'destructive' });
    },
  });

  const updateStrikeMutation = useMutation({
    mutationFn: ({ strikeId, status }: { strikeId: string; status: 'appealed' | 'revoked' | 'active' }) =>
      memberStrikesApi.update(factionId, userId, strikeId, status),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['member-strikes', factionId, userId] });
      queryClient.invalidateQueries({ queryKey: ['member-profile', factionId, userId] });
      toast({ title: t('strikes.updated') });
    },
    onError: (err: any) => {
      toast({ title: t('common.failed'), description: err.response?.data?.error?.message || t('common.unknownError'), variant: 'destructive' });
    },
  });

  function closeNoteDialog() {
    setNoteOpen(false);
    setNoteContent('');
    setNoteCategory('general');
    setNoteFlagged(false);
    setEditingNoteId(null);
  }

  const fmt = (n: number) => `$${formatNumber(n)}`;
  const fmtItems = (n: number) => `${formatCount(n)} ${t('common.pieces')}`;

  if (isLoading || !profile) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-8 w-48" />
        <div className="grid gap-4 md:grid-cols-3">
          {[...Array(6)].map((_, i) => <Skeleton key={i} className="h-28 w-full" />)}
        </div>
      </div>
    );
  }

  const { member, contribution, payouts: payoutStats, quotaProgress, streak, performance, recentEntries, recentPayouts } = profile;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center gap-4">
        <Button variant="ghost" size="icon" className="h-8 w-8 text-zinc-500 hover:text-zinc-200" onClick={() => setCurrentView('members')}>
          <ArrowLeft className="h-4 w-4" />
        </Button>
        <Avatar className="h-10 w-10">
          <AvatarImage src={member.avatarUrl ?? undefined} />
          <AvatarFallback>{displayName(member).slice(0, 2).toUpperCase()}</AvatarFallback>
        </Avatar>
        <div className="flex-1">
          <div className="flex items-center gap-2">
            <h3 className="text-lg font-medium text-zinc-100">{displayName(member)}</h3>
            {member.rank && (
              <span className="flex items-center gap-1.5">
                <Badge variant="outline" className="text-[11px]" style={{ borderColor: `${brandColor}30`, color: brandColor }}>{member.rank}</Badge>
                {member.daysInRank !== null && (
                  <span
                    className="text-[10px] text-zinc-500"
                    title={member.rankSince ? t('profile.rankSince', { date: formatDate(member.rankSince) }) : undefined}
                  >
                    {member.daysInRank === 0
                      ? t('profile.rankSinceToday')
                      : t('profile.daysInRank', { days: member.daysInRank ?? 0 })}
                  </span>
                )}
              </span>
            )}
            {member.role === 'admin' && (
              <Badge className="text-[11px]" style={{ backgroundColor: `${brandColor}15`, color: brandColor }}>{t('role.admin')}</Badge>
            )}
          </div>
          <p className="text-xs text-zinc-500">
            {t('profile.joinedOn', { date: formatDate(member.joinedAt) })}
            {member.daysInactive !== null && member.daysInactive > 0 && (
              <span className="text-amber-400 ml-2">{t('profile.daysInactive', { days: member.daysInactive })}</span>
            )}
          </p>
        </div>
        {canManageStrikes && (
          <Button variant="outline" size="sm" onClick={() => setStrikeOpen(true)} className="text-amber-400 border-amber-500/20 hover:bg-amber-500/10">
            <AlertTriangle className="mr-1.5 h-3.5 w-3.5" />
            {t('strikes.issue')}
          </Button>
        )}
      </div>

      {/* Notes and history are your own file, or anyone's with
          `manage_members` — the API decides, these flags report it. */}
      {visibleTabs.length > 1 && (
        <div className="flex gap-1 border-b border-white/[0.06] pb-px">
          {visibleTabs.map((tabKey) => (
            <button
              key={tabKey}
              onClick={() => setTab(tabKey)}
              className={`px-3 py-1.5 text-sm font-medium transition-colors ${activeTab === tabKey ? 'border-b-2 border-[var(--brand-color)] text-zinc-100' : 'text-zinc-500 hover:text-zinc-300'}`}
              style={activeTab === tabKey ? { borderColor: brandColor, color: brandColor } : undefined}
            >
              {tabKey === 'notes' && notes.length > 0
                ? `${t(TAB_KEYS.notes)} (${notes.length})`
                : t(TAB_KEYS[tabKey])}
            </button>
          ))}
        </div>
      )}

      {activeTab === 'overview' && (
        <div className="space-y-4">
          {/* ── Top Stats Row ── */}
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {/* Performance Score */}
            <Card className="faction-glow border-highlight">
              <CardHeader className="pb-1">
                <CardTitle className="text-xs font-normal text-zinc-500 uppercase tracking-wider flex items-center gap-1.5">
                  <Trophy className="h-3 w-3" /> {t('profile.performanceScore')}
                </CardTitle>
              </CardHeader>
              <CardContent>
                {/* Neutral like the three stat cards beside it: a score is
                    not a verdict the faction accent gets to colour. */}
                <div className="text-2xl font-medium tabular-nums text-zinc-100">{performance.score}</div>
                <p className="text-[11px] text-zinc-600 mt-1">{t('profile.outOf100')}</p>
              </CardContent>
            </Card>

            {/* Streak */}
            <Card>
              <CardHeader className="pb-1">
                <CardTitle className="text-xs font-normal text-zinc-500 uppercase tracking-wider flex items-center gap-1.5">
                  <Flame className="h-3 w-3" /> {t('profile.streak')}
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-medium tabular-nums text-zinc-100">
                  {streak.current}<span className="text-sm text-zinc-500">/{streak.best}</span>
                </div>
                <p className="text-[11px] text-zinc-600 mt-1">
                  {streak.activeToday
                    ? t('members.activeToday')
                    : streak.lastEntryDate
                      ? t('profile.lastEntry', { date: streak.lastEntryDate })
                      : t('profile.noEntriesYet')}
                </p>
              </CardContent>
            </Card>

            {/* Total Contributed */}
            <Card>
              <CardHeader className="pb-1">
                <CardTitle className="text-xs font-normal text-zinc-500 uppercase tracking-wider flex items-center gap-1.5">
                  <Activity className="h-3 w-3" /> {t('profile.totalContributed')}
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-medium tabular-nums text-zinc-100">{fmt(contribution.currencyContributed)}</div>
                <p className="text-[11px] text-zinc-600 mt-1">
                  {t('entries.count', { count: contribution.currencyEntryCount })} &middot; {t('reports.avg', { amount: fmt(contribution.avgPerCurrencyEntry) })}
                </p>
                {contribution.itemEntryCount > 0 && (
                  <p className="text-[11px] text-zinc-600 mt-0.5">
                    + {fmtItems(contribution.itemContributed)} ({t('entries.count', { count: contribution.itemEntryCount })})
                  </p>
                )}
              </CardContent>
            </Card>

            {/* Payouts Received */}
            <Card>
              <CardHeader className="pb-1">
                <CardTitle className="text-xs font-normal text-zinc-500 uppercase tracking-wider flex items-center gap-1.5">
                  <Zap className="h-3 w-3" /> {t('profile.withdrawalsReceived')}
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-medium tabular-nums text-zinc-100">{fmt(payoutStats.currencyReceived)}</div>
                <p className="text-[11px] text-zinc-600 mt-1">{t('payouts.count', { count: payoutStats.payoutCount })}</p>
                {payoutStats.itemReceived > 0 && (
                  <p className="text-[11px] text-zinc-600 mt-0.5">+ {fmtItems(payoutStats.itemReceived)}</p>
                )}
              </CardContent>
            </Card>
          </div>

          {/* ── Performance Breakdown ── */}
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm text-zinc-200">{t('profile.performanceBreakdown')}</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid gap-3 sm:grid-cols-5">
                {Object.entries(performance.breakdown).map(([key, val]) => (
                  <div key={key} className="text-center">
                    <div className="text-xs text-zinc-500 mb-1">{PERFORMANCE_KEYS[key] ? t(PERFORMANCE_KEYS[key]) : key}</div>
                    <div className="relative h-2 bg-white/[0.04] rounded-full overflow-hidden">
                      <div className="h-full rounded-full transition-all duration-500" style={{ width: `${Math.round(val * 100)}%`, backgroundColor: brandColor }} />
                    </div>
                    <div className="text-xs text-zinc-400 mt-1 tabular-nums">{Math.round(val * 100)}%</div>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>

          {/* ── Two Column: Quota Progress + Strikes ── */}
          <div className="grid gap-4 lg:grid-cols-2">
            {/* Quota Progress */}
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm text-zinc-200 flex items-center gap-1.5">
                  <Target className="h-3.5 w-3.5 text-zinc-400" /> {t('dashboard.quotaProgress')}
                </CardTitle>
              </CardHeader>
              <CardContent>
                {quotaProgress.length === 0 ? (
                  <p className="text-zinc-600 text-sm text-center py-6">{t('quota.noneActive')}</p>
                ) : (
                  <div className="space-y-3">
                    {quotaProgress.map((q) => {
                      const met = q.percentage >= 100;
                      return (
                        <div key={q.quotaId}>
                          <div className="flex items-center justify-between mb-1">
                            <span className="text-sm text-zinc-300 flex items-center gap-2 min-w-0">
                              <ItemIcon src={q.imageUrl} className="size-5" />
                              <span className="truncate">{q.itemTypeName}</span>
                            </span>
                            <span className={`text-xs font-medium ${met ? 'text-emerald-400' : 'text-zinc-400'}`}>{q.percentage.toFixed(1)}%</span>
                          </div>
                          <div className="h-1.5 bg-white/[0.04] rounded-full overflow-hidden">
                            {/* Neutral until met, like the same bar on the
                                dashboard — the faction accent must not stand in
                                for "done". */}
                            <div className={`h-full rounded-full transition-all duration-500 ${met ? 'bg-emerald-500' : 'bg-primary'}`} style={{ width: `${Math.min(q.percentage, 100)}%` }} />
                          </div>
                          <div className="flex justify-between text-[10px] text-zinc-600 mt-0.5">
                            <span>{formatAmount(q.contributed, q.unit, q.isCurrency)}</span>
                            <span>{t('quota.ofTarget', { amount: formatAmount(q.targetAmount, q.unit, q.isCurrency) })}</span>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </CardContent>
            </Card>

            {/* Active Strikes */}
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm text-zinc-200 flex items-center gap-1.5">
                  <AlertTriangle className={`h-3.5 w-3.5 ${profile.activeStrikeCount > 0 ? 'text-amber-400' : 'text-zinc-500'}`} />
                  {t('nav.strikes')}
                  {profile.activeStrikeCount > 0 && (
                    <Badge className="ml-auto bg-amber-500/15 text-amber-400 border-amber-500/20 text-[11px]" variant="outline">{t('strikes.activeCount', { count: profile.activeStrikeCount })}</Badge>
                  )}
                </CardTitle>
              </CardHeader>
              <CardContent>
                {strikes.length === 0 ? (
                  <p className="text-zinc-600 text-sm text-center py-6">{t('strikes.none')}</p>
                ) : (
                  <div className="space-y-2 max-h-[240px] overflow-y-auto">
                    {strikes.slice(0, 5).map((s) => (
                      <div key={s.id} className="rounded-lg border border-white/[0.06] p-3 space-y-1.5">
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-2">
                            <Badge className={`text-[10px] border ${SEVERITY_COLORS[s.severity] || ''}`} variant="outline">{SEVERITY_KEYS[s.severity] ? t(SEVERITY_KEYS[s.severity]) : s.severity}</Badge>
                            <span className={`text-xs font-medium ${EFFECTIVE_STATUS_COLORS[s.effectiveStatus]}`}>{STRIKE_STATUS_KEYS[s.effectiveStatus] ? t(STRIKE_STATUS_KEYS[s.effectiveStatus]) : s.effectiveStatus}</span>
                          </div>
                          <span className="text-[10px] text-zinc-600">{formatDate(s.createdAt)}</span>
                        </div>
                        <p className="text-xs text-zinc-400 line-clamp-2">{s.reason}</p>
                        {canManageStrikes && s.effectiveStatus === 'active' && (
                          <div className="flex gap-1 pt-1">
                            <Button variant="ghost" size="sm" className="h-6 text-[11px] text-blue-400 hover:text-blue-300" onClick={() => updateStrikeMutation.mutate({ strikeId: s.id, status: 'appealed' })}>{t('strikes.appeal')}</Button>
                            <Button variant="ghost" size="sm" className="h-6 text-[11px] text-zinc-500 hover:text-zinc-300" onClick={() => updateStrikeMutation.mutate({ strikeId: s.id, status: 'revoked' })}>{t('strikes.revoke')}</Button>
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          </div>

          {/* ── Contribution by Item Type ── */}
          {contribution.byItemType.length > 0 && (
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm text-zinc-200">{t('profile.contributionByType')}</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                  {contribution.byItemType.map((row) => {
                    const isTop = contribution.mostActiveItemType?.itemTypeName === row.itemTypeName;
                    return (
                      <div key={row.itemTypeId} className="flex items-center justify-between rounded-lg border border-white/[0.06] p-3" style={isTop ? { borderColor: `${brandColor}25`, backgroundColor: `${brandColor}08` } : undefined}>
                        <div className="flex items-center gap-2.5 min-w-0">
                          <ItemIcon src={row.imageUrl} className="size-8" />
                          <div className="min-w-0">
                            <p className="text-sm text-zinc-300 truncate">{row.itemTypeName}</p>
                            <p className="text-[11px] text-zinc-600">{t('entries.count', { count: row.count })}</p>
                          </div>
                        </div>
                        <div className="text-right">
                          <p className="text-sm font-medium tabular-nums text-zinc-200">{formatAmount(row.total, row.unit, row.isCurrency)}</p>
                          {isTop && <p className="text-[10px]" style={{ color: brandColor }}>{t('profile.mostActive')}</p>}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </CardContent>
            </Card>
          )}

          {/* ── Heatmap ── */}
          {heatmap && (
            <Card>
              <CardHeader className="pb-2">
                <div className="flex items-center justify-between">
                  <CardTitle className="text-sm text-zinc-200 flex items-center gap-1.5">
                    <Calendar className="h-3.5 w-3.5 text-zinc-400" /> {t('profile.activityHeatmap')}
                  </CardTitle>
                  <div className="flex items-center gap-1">
                    <Button variant="ghost" size="sm" className="h-6 w-6 p-0 text-zinc-500" onClick={() => setHeatmapYear(heatmapYear - 1)}>&lt;</Button>
                    <span className="text-xs text-zinc-400 w-10 text-center tabular-nums">{heatmapYear}</span>
                    <Button variant="ghost" size="sm" className="h-6 w-6 p-0 text-zinc-500" onClick={() => setHeatmapYear(heatmapYear + 1)}>&gt;</Button>
                  </div>
                </div>
              </CardHeader>
              <CardContent>
                <div className="flex gap-[3px] flex-wrap">
                  {heatmap.data.map((d) => {
                    const intensity = heatmap.maxCount > 0 ? d.count / heatmap.maxCount : 0;
                    const opacity = d.count === 0 ? 0.06 : 0.2 + intensity * 0.8;
                    return (
                      <div
                        key={d.date}
                        className="w-[11px] h-[11px] rounded-[2px] transition-colors duration-100"
                        style={{ backgroundColor: `${brandColor}${Math.round(opacity * 255).toString(16).padStart(2, '0')}` }}
                        title={`${d.date}: ${t('entries.count', { count: d.count })}${d.currencyTotal > 0 ? ` · ${fmt(d.currencyTotal)}` : ''}${d.itemTotal > 0 ? ` · ${fmtItems(d.itemTotal)}` : ''}`}
                      />
                    );
                  })}
                </div>
                <div className="flex items-center justify-end gap-1.5 mt-3">
                  <span className="text-[10px] text-zinc-600">{t('profile.less')}</span>
                  {[0, 0.25, 0.5, 0.75, 1].map((v, i) => (
                    <div key={i} className="w-[11px] h-[11px] rounded-[2px]" style={{ backgroundColor: `${brandColor}${v === 0 ? '10' : Math.round((0.2 + v * 0.8) * 255).toString(16).padStart(2, '0')}` }} />
                  ))}
                  <span className="text-[10px] text-zinc-600">{t('profile.more')}</span>
                </div>
              </CardContent>
            </Card>
          )}

          {/* ── Recent Entries ── */}
          {recentEntries.length > 0 && (
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm text-zinc-200 flex items-center gap-1.5">
                  <FileText className="h-3.5 w-3.5 text-zinc-400" /> {t('profile.recentEntries')}
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-1 max-h-[240px] overflow-y-auto">
                  {recentEntries.map((e) => (
                    <div key={e.id} className="flex items-center justify-between py-1.5 px-2 -mx-2 rounded-md hover:bg-white/[0.02]">
                      <div className="flex items-center gap-2 min-w-0">
                        <ItemIcon src={e.itemImageUrl} className="size-5" />
                        <span className="text-sm font-medium tabular-nums text-zinc-200">{formatAmount(e.amount, e.itemUnit, e.itemIsCurrency)}</span>
                        <span className="text-xs text-zinc-600 truncate">{e.itemTypeName}</span>
                      </div>
                      <div className="text-right">
                        <div className="text-xs text-zinc-500 tabular-nums">{e.entryDate}</div>
                        {e.description && <div className="text-[11px] text-zinc-600 truncate max-w-[200px]">{e.description}</div>}
                      </div>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          )}
        </div>
      )}

      {/* ── Notes Tab ── */}
      {activeTab === 'notes' && (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <p className="text-sm text-zinc-500">{t('notes.count', { count: notes.length })}</p>
            <Button size="sm" onClick={() => { setEditingNoteId(null); setNoteOpen(true); }}><Plus className="mr-1.5 h-3.5 w-3.5" /> {t('notes.add')}</Button>
          </div>
          {notesLoading ? <div className="space-y-2">{[...Array(3)].map((_, i) => <Skeleton key={i} className="h-16 w-full" />)}</div> : notes.length === 0 ? (
            <Card><CardContent className="py-8 text-center text-zinc-600 text-sm">{t('notes.none')}</CardContent></Card>
          ) : (
            <div className="space-y-2">
              {notes.map((n) => (
                <Card key={n.id} className={n.isFlagged ? 'border-amber-500/20' : ''}>
                  <CardContent className="py-3">
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-1">
                          <Badge variant="outline" className="text-[10px]">{t(NOTE_CATEGORY_KEYS[n.category])}</Badge>
                          {n.isFlagged && <Flag className="h-3 w-3 text-amber-400" />}
                          <span className="text-[10px] text-zinc-600">{t('notes.byAuthor', { name: n.authorInGameName?.trim() || n.authorUsername })} &middot; {formatDate(n.createdAt)}</span>
                        </div>
                        <p className="text-sm text-zinc-300 whitespace-pre-wrap">{n.content}</p>
                      </div>
                      <div className="flex gap-0.5 shrink-0">
                        <Button variant="ghost" size="icon" className="h-7 w-7 text-zinc-500 hover:text-zinc-200" onClick={() => { setEditingNoteId(n.id); setNoteContent(n.content); setNoteCategory(n.category); setNoteFlagged(n.isFlagged); setNoteOpen(true); }}><Pencil className="h-3 w-3" /></Button>
                        <Button variant="ghost" size="icon" className="h-7 w-7 text-zinc-500 hover:text-red-400" onClick={() => setDeleteNoteId(n.id)}><Trash2 className="h-3 w-3" /></Button>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </div>
      )}

      {/* ── History Tab ── */}
      {activeTab === 'history' && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm text-zinc-200 flex items-center gap-1.5"><Clock className="h-3.5 w-3.5 text-zinc-400" /> {t('profile.memberHistory')}</CardTitle>
          </CardHeader>
          <CardContent>
            {!historyData?.data?.length ? (
              <p className="text-zinc-600 text-sm text-center py-6">{t('profile.noHistory')}</p>
            ) : (
              <div className="space-y-2">
                {historyData.data.map((h) => (
                  <div key={h.id} className="flex items-center gap-3 py-2 px-2 -mx-2 rounded-md hover:bg-white/[0.02]">
                    <Avatar className="h-6 w-6"><AvatarImage src={h.actorAvatarUrl ?? undefined} /><AvatarFallback className="text-[8px]">{(h.actorInGameName?.trim() || h.actorUsername || '?').slice(0, 2).toUpperCase()}</AvatarFallback></Avatar>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm text-zinc-300"><span className="font-medium">{h.actorInGameName?.trim() || h.actorUsername}</span> <span className="text-zinc-500">{t('profile.historyAction', { action: h.action })}</span></p>
                      {h.details && <p className="text-[11px] text-zinc-600 truncate">{JSON.stringify(h.details)}</p>}
                    </div>
                    <span className="text-[10px] text-zinc-600 tabular-nums shrink-0">{formatDate(h.createdAt)}</span>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* ── Note Dialog ── */}
      <Dialog open={noteOpen} onOpenChange={setNoteOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{editingNoteId ? t('notes.edit') : t('notes.add')}</DialogTitle>
            <DialogDescription>{t('notes.dialogHint', { name: displayName(member) })}</DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label>{t('notes.category')}</Label>
              <SearchableSelect
                value={noteCategory}
                onValueChange={(v) => setNoteCategory(v as NoteCategory)}
                options={Object.entries(NOTE_CATEGORY_KEYS).map(([value, key]) => ({ value, label: t(key) }))}
                aria-label={t('notes.category')}
              />
            </div>
            <div className="space-y-2">
              <Label>{t('notes.content')}</Label>
              <Textarea value={noteContent} onChange={(e) => setNoteContent(e.target.value)} rows={4} placeholder={t('notes.contentPlaceholder')} />
            </div>
            <div className="flex items-center gap-2">
              <input type="checkbox" id="flag" checked={noteFlagged} onChange={(e) => setNoteFlagged(e.target.checked)} className="rounded border-zinc-700" />
              <Label htmlFor="flag" className="text-sm text-zinc-400 flex items-center gap-1.5"><Flag className="h-3 w-3" /> {t('notes.flagForAttention')}</Label>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={closeNoteDialog}>{t('common.cancel')}</Button>
            <Button onClick={() => noteMutation.mutate()} disabled={!noteContent.trim() || noteMutation.isPending}>
              {noteMutation.isPending ? t('common.saving') : editingNoteId ? t('common.update') : t('notes.add')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Delete Note Confirmation ── */}
      <AlertDialog open={!!deleteNoteId} onOpenChange={(open) => !open && setDeleteNoteId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t('notes.deleteTitle')}</AlertDialogTitle>
            <AlertDialogDescription>{t('notes.deleteConfirm')}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t('common.cancel')}</AlertDialogCancel>
            <AlertDialogAction onClick={() => deleteNoteMutation.mutate()} disabled={deleteNoteMutation.isPending} className="bg-red-500 text-white hover:bg-red-600">{t('common.delete')}</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* ── Strike Dialog ── */}
      <Dialog open={strikeOpen} onOpenChange={setStrikeOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t('strikes.issue')}</DialogTitle>
            <DialogDescription>{t('strikes.issueHint', { name: displayName(member) })}</DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label>{t('strikes.severityColumn')}</Label>
              <div className="flex gap-2">
                {(['warning', 'minor', 'major'] as const).map((s) => (
                  <Button key={s} variant={strikeSeverity === s ? 'default' : 'outline'} size="sm" className={`flex-1 ${strikeSeverity === s ? SEVERITY_COLORS[s] : ''}`} onClick={() => setStrikeSeverity(s)}>
                    {t(SEVERITY_KEYS[s])}
                  </Button>
                ))}
              </div>
            </div>
            <div className="space-y-2">
              <Label>{t('strikes.reason')}</Label>
              <Textarea value={strikeReason} onChange={(e) => setStrikeReason(e.target.value)} rows={3} placeholder={t('strikes.reasonPlaceholder')} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => { setStrikeOpen(false); setStrikeReason(''); }}>{t('common.cancel')}</Button>
            <Button onClick={() => strikeMutation.mutate()} disabled={!strikeReason.trim() || strikeMutation.isPending} className="bg-amber-500 text-white hover:bg-amber-600">
              {strikeMutation.isPending ? t('strikes.issuing') : t('strikes.issue')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
