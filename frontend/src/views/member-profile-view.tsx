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
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
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
import { formatAmount, displayName } from '@/lib/format';
import { ItemIcon } from '@/components/item-icon';

interface Props {
  factionId: string;
  userId: string;
}

type ProfileTab = 'overview' | 'notes' | 'history';

const NOTE_CATEGORIES: { value: NoteCategory; label: string }[] = [
  { value: 'general', label: 'General' },
  { value: 'performance', label: 'Performance' },
  { value: 'discipline', label: 'Discipline' },
  { value: 'positive', label: 'Positive' },
  { value: 'promotion', label: 'Promotion' },
];

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

export function MemberProfileView({ factionId, userId }: Props) {
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
    enabled: tab === 'history',
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
      toast({ title: editingNoteId ? 'Note updated' : 'Note added' });
    },
    onError: (err: any) => {
      toast({ title: 'Failed', description: err.response?.data?.error?.message || 'Unknown error', variant: 'destructive' });
    },
  });

  const deleteNoteMutation = useMutation({
    mutationFn: () => notesApi.remove(factionId, userId, deleteNoteId!),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['member-notes', factionId, userId] });
      setDeleteNoteId(null);
      toast({ title: 'Note deleted' });
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
      toast({ title: 'Strike issued' });
    },
    onError: (err: any) => {
      toast({ title: 'Failed', description: err.response?.data?.error?.message || 'Unknown error', variant: 'destructive' });
    },
  });

  const updateStrikeMutation = useMutation({
    mutationFn: ({ strikeId, status }: { strikeId: string; status: 'appealed' | 'revoked' | 'active' }) =>
      memberStrikesApi.update(factionId, userId, strikeId, status),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['member-strikes', factionId, userId] });
      queryClient.invalidateQueries({ queryKey: ['member-profile', factionId, userId] });
      toast({ title: 'Strike updated' });
    },
    onError: (err: any) => {
      toast({ title: 'Failed', description: err.response?.data?.error?.message || 'Unknown error', variant: 'destructive' });
    },
  });

  function closeNoteDialog() {
    setNoteOpen(false);
    setNoteContent('');
    setNoteCategory('general');
    setNoteFlagged(false);
    setEditingNoteId(null);
  }

  const fmt = (n: number) => `$${n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  const fmtItems = (n: number) => `${n.toLocaleString('en-US', { maximumFractionDigits: 2 })} pcs`;

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
  const isAdmin = useAppStore.getState().user?.role === 'superadmin' || useAppStore.getState().user?.factions.find(f => f.factionId === factionId)?.role === 'admin';

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
                    title={member.rankSince ? `Since ${new Date(member.rankSince).toLocaleDateString()}` : undefined}
                  >
                    {member.daysInRank === 0 ? 'since today' : `${member.daysInRank}d in rank`}
                  </span>
                )}
              </span>
            )}
            {member.role === 'admin' && (
              <Badge className="text-[11px]" style={{ backgroundColor: `${brandColor}15`, color: brandColor }}>Admin</Badge>
            )}
          </div>
          <p className="text-xs text-zinc-500">
            Joined {new Date(member.joinedAt).toLocaleDateString()}
            {member.daysInactive !== null && member.daysInactive > 0 && (
              <span className="text-amber-400 ml-2">{member.daysInactive}d inactive</span>
            )}
          </p>
        </div>
        {isAdmin && (
          <Button variant="outline" size="sm" onClick={() => setStrikeOpen(true)} className="text-amber-400 border-amber-500/20 hover:bg-amber-500/10">
            <AlertTriangle className="mr-1.5 h-3.5 w-3.5" />
            Issue Strike
          </Button>
        )}
      </div>

      {/* Tabs: admin sees notes + history */}
      {isAdmin && (
        <div className="flex gap-1 border-b border-white/[0.06] pb-px">
          {(['overview', 'notes', 'history'] as ProfileTab[]).map((t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={`px-3 py-1.5 text-sm font-medium capitalize transition-colors ${tab === t ? 'border-b-2 border-[var(--brand-color)] text-zinc-100' : 'text-zinc-500 hover:text-zinc-300'}`}
              style={tab === t ? { borderColor: brandColor, color: brandColor } : undefined}
            >
              {t === 'notes' ? `Notes${notes.length > 0 ? ` (${notes.length})` : ''}` : t}
            </button>
          ))}
        </div>
      )}

      {tab === 'overview' && (
        <div className="space-y-4">
          {/* ── Top Stats Row ── */}
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {/* Performance Score */}
            <Card className="faction-glow border-highlight">
              <CardHeader className="pb-1">
                <CardTitle className="text-xs font-normal text-zinc-500 uppercase tracking-wider flex items-center gap-1.5">
                  <Trophy className="h-3 w-3" /> Performance Score
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-medium tabular-nums" style={{ color: brandColor }}>{performance.score}</div>
                <p className="text-[11px] text-zinc-600 mt-1">out of 100</p>
              </CardContent>
            </Card>

            {/* Streak */}
            <Card>
              <CardHeader className="pb-1">
                <CardTitle className="text-xs font-normal text-zinc-500 uppercase tracking-wider flex items-center gap-1.5">
                  <Flame className="h-3 w-3" /> Streak
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-medium tabular-nums text-zinc-100">
                  {streak.current}<span className="text-sm text-zinc-500">/{streak.best}</span>
                </div>
                <p className="text-[11px] text-zinc-600 mt-1">
                  {streak.activeToday ? 'active today' : streak.lastEntryDate ? `last: ${streak.lastEntryDate}` : 'no entries yet'}
                </p>
              </CardContent>
            </Card>

            {/* Total Contributed */}
            <Card>
              <CardHeader className="pb-1">
                <CardTitle className="text-xs font-normal text-zinc-500 uppercase tracking-wider flex items-center gap-1.5">
                  <Activity className="h-3 w-3" /> Total Contributed
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-medium tabular-nums text-zinc-100">{fmt(contribution.currencyContributed)}</div>
                <p className="text-[11px] text-zinc-600 mt-1">
                  {contribution.currencyEntryCount} entries &middot; avg {fmt(contribution.avgPerCurrencyEntry)}
                </p>
                {contribution.itemEntryCount > 0 && (
                  <p className="text-[11px] text-zinc-600 mt-0.5">
                    + {fmtItems(contribution.itemContributed)} ({contribution.itemEntryCount} entries)
                  </p>
                )}
              </CardContent>
            </Card>

            {/* Payouts Received */}
            <Card>
              <CardHeader className="pb-1">
                <CardTitle className="text-xs font-normal text-zinc-500 uppercase tracking-wider flex items-center gap-1.5">
                  <Zap className="h-3 w-3" /> Payouts Received
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-medium tabular-nums text-zinc-100">{fmt(payoutStats.currencyReceived)}</div>
                <p className="text-[11px] text-zinc-600 mt-1">{payoutStats.payoutCount} payout{payoutStats.payoutCount !== 1 ? 's' : ''}</p>
                {payoutStats.itemReceived > 0 && (
                  <p className="text-[11px] text-zinc-600 mt-0.5">+ {fmtItems(payoutStats.itemReceived)}</p>
                )}
              </CardContent>
            </Card>
          </div>

          {/* ── Performance Breakdown ── */}
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm text-zinc-200">Performance Breakdown</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid gap-3 sm:grid-cols-5">
                {Object.entries(performance.breakdown).map(([key, val]) => (
                  <div key={key} className="text-center">
                    <div className="text-xs text-zinc-500 capitalize mb-1">{key.replace(/([A-Z])/g, ' $1').trim()}</div>
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
                  <Target className="h-3.5 w-3.5 text-zinc-400" /> Quota Progress
                </CardTitle>
              </CardHeader>
              <CardContent>
                {quotaProgress.length === 0 ? (
                  <p className="text-zinc-600 text-sm text-center py-6">No active quotas.</p>
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
                            <div className={`h-full rounded-full transition-all duration-500 ${met ? 'bg-emerald-500' : ''}`} style={{ width: `${Math.min(q.percentage, 100)}%`, ...(!met ? { backgroundColor: brandColor } : {}) }} />
                          </div>
                          <div className="flex justify-between text-[10px] text-zinc-600 mt-0.5">
                            <span>{formatAmount(q.contributed, q.unit, q.isCurrency)}</span>
                            <span>of {formatAmount(q.targetAmount, q.unit, q.isCurrency)}</span>
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
                  Strikes
                  {profile.activeStrikeCount > 0 && (
                    <Badge className="ml-auto bg-amber-500/15 text-amber-400 border-amber-500/20 text-[11px]" variant="outline">{profile.activeStrikeCount} active</Badge>
                  )}
                </CardTitle>
              </CardHeader>
              <CardContent>
                {strikes.length === 0 ? (
                  <p className="text-zinc-600 text-sm text-center py-6">No strikes.</p>
                ) : (
                  <div className="space-y-2 max-h-[240px] overflow-y-auto">
                    {strikes.slice(0, 5).map((s) => (
                      <div key={s.id} className="rounded-lg border border-white/[0.06] p-3 space-y-1.5">
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-2">
                            <Badge className={`text-[10px] border ${SEVERITY_COLORS[s.severity] || ''}`} variant="outline">{s.severity}</Badge>
                            <span className={`text-xs font-medium ${EFFECTIVE_STATUS_COLORS[s.effectiveStatus]}`}>{s.effectiveStatus}</span>
                          </div>
                          <span className="text-[10px] text-zinc-600">{new Date(s.createdAt).toLocaleDateString()}</span>
                        </div>
                        <p className="text-xs text-zinc-400 line-clamp-2">{s.reason}</p>
                        {isAdmin && s.effectiveStatus === 'active' && (
                          <div className="flex gap-1 pt-1">
                            <Button variant="ghost" size="sm" className="h-6 text-[11px] text-blue-400 hover:text-blue-300" onClick={() => updateStrikeMutation.mutate({ strikeId: s.id, status: 'appealed' })}>Appeal</Button>
                            <Button variant="ghost" size="sm" className="h-6 text-[11px] text-zinc-500 hover:text-zinc-300" onClick={() => updateStrikeMutation.mutate({ strikeId: s.id, status: 'revoked' })}>Revoke</Button>
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
                <CardTitle className="text-sm text-zinc-200">Contribution by Type</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                  {contribution.byItemType.map((t) => {
                    const isTop = contribution.mostActiveItemType?.itemTypeName === t.itemTypeName;
                    return (
                      <div key={t.itemTypeId} className="flex items-center justify-between rounded-lg border border-white/[0.06] p-3" style={isTop ? { borderColor: `${brandColor}25`, backgroundColor: `${brandColor}08` } : undefined}>
                        <div className="flex items-center gap-2.5 min-w-0">
                          <ItemIcon src={t.imageUrl} className="size-8" />
                          <div className="min-w-0">
                            <p className="text-sm text-zinc-300 truncate">{t.itemTypeName}</p>
                            <p className="text-[11px] text-zinc-600">{t.count} entries</p>
                          </div>
                        </div>
                        <div className="text-right">
                          <p className="text-sm font-medium tabular-nums text-zinc-200">{formatAmount(t.total, t.unit, t.isCurrency)}</p>
                          {isTop && <p className="text-[10px]" style={{ color: brandColor }}>most active</p>}
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
                    <Calendar className="h-3.5 w-3.5 text-zinc-400" /> Activity Heatmap
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
                        title={`${d.date}: ${d.count} ${d.count === 1 ? 'entry' : 'entries'}${d.currencyTotal > 0 ? ` · ${fmt(d.currencyTotal)}` : ''}${d.itemTotal > 0 ? ` · ${fmtItems(d.itemTotal)}` : ''}`}
                      />
                    );
                  })}
                </div>
                <div className="flex items-center justify-end gap-1.5 mt-3">
                  <span className="text-[10px] text-zinc-600">Less</span>
                  {[0, 0.25, 0.5, 0.75, 1].map((v, i) => (
                    <div key={i} className="w-[11px] h-[11px] rounded-[2px]" style={{ backgroundColor: `${brandColor}${v === 0 ? '10' : Math.round((0.2 + v * 0.8) * 255).toString(16).padStart(2, '0')}` }} />
                  ))}
                  <span className="text-[10px] text-zinc-600">More</span>
                </div>
              </CardContent>
            </Card>
          )}

          {/* ── Recent Entries ── */}
          {recentEntries.length > 0 && (
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm text-zinc-200 flex items-center gap-1.5">
                  <FileText className="h-3.5 w-3.5 text-zinc-400" /> Recent Entries
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
      {tab === 'notes' && (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <p className="text-sm text-zinc-500">{notes.length} note{notes.length !== 1 ? 's' : ''}</p>
            <Button size="sm" onClick={() => { setEditingNoteId(null); setNoteOpen(true); }}><Plus className="mr-1.5 h-3.5 w-3.5" /> Add Note</Button>
          </div>
          {notesLoading ? <div className="space-y-2">{[...Array(3)].map((_, i) => <Skeleton key={i} className="h-16 w-full" />)}</div> : notes.length === 0 ? (
            <Card><CardContent className="py-8 text-center text-zinc-600 text-sm">No notes yet.</CardContent></Card>
          ) : (
            <div className="space-y-2">
              {notes.map((n) => (
                <Card key={n.id} className={n.isFlagged ? 'border-amber-500/20' : ''}>
                  <CardContent className="py-3">
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-1">
                          <Badge variant="outline" className="text-[10px] capitalize">{n.category}</Badge>
                          {n.isFlagged && <Flag className="h-3 w-3 text-amber-400" />}
                          <span className="text-[10px] text-zinc-600">by {n.authorInGameName?.trim() || n.authorUsername} &middot; {new Date(n.createdAt).toLocaleDateString()}</span>
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
      {tab === 'history' && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm text-zinc-200 flex items-center gap-1.5"><Clock className="h-3.5 w-3.5 text-zinc-400" /> Member History</CardTitle>
          </CardHeader>
          <CardContent>
            {!historyData?.data?.length ? (
              <p className="text-zinc-600 text-sm text-center py-6">No history recorded.</p>
            ) : (
              <div className="space-y-2">
                {historyData.data.map((h) => (
                  <div key={h.id} className="flex items-center gap-3 py-2 px-2 -mx-2 rounded-md hover:bg-white/[0.02]">
                    <Avatar className="h-6 w-6"><AvatarImage src={h.actorAvatarUrl ?? undefined} /><AvatarFallback className="text-[8px]">{(h.actorInGameName?.trim() || h.actorUsername || '?').slice(0, 2).toUpperCase()}</AvatarFallback></Avatar>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm text-zinc-300"><span className="font-medium">{h.actorInGameName?.trim() || h.actorUsername}</span> <span className="text-zinc-500 capitalize">{h.action}</span> <span className="text-zinc-500">member</span></p>
                      {h.details && <p className="text-[11px] text-zinc-600 truncate">{JSON.stringify(h.details)}</p>}
                    </div>
                    <span className="text-[10px] text-zinc-600 tabular-nums shrink-0">{new Date(h.createdAt).toLocaleDateString()}</span>
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
            <DialogTitle>{editingNoteId ? 'Edit Note' : 'Add Note'}</DialogTitle>
            <DialogDescription>Admin-only note about {displayName(member)}.</DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label>Category</Label>
              <Select value={noteCategory} onValueChange={(v) => setNoteCategory(v as NoteCategory)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>{NOTE_CATEGORIES.map((c) => <SelectItem key={c.value} value={c.value}>{c.label}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Content</Label>
              <Textarea value={noteContent} onChange={(e) => setNoteContent(e.target.value)} rows={4} placeholder="Write your note..." />
            </div>
            <div className="flex items-center gap-2">
              <input type="checkbox" id="flag" checked={noteFlagged} onChange={(e) => setNoteFlagged(e.target.checked)} className="rounded border-zinc-700" />
              <Label htmlFor="flag" className="text-sm text-zinc-400 flex items-center gap-1.5"><Flag className="h-3 w-3" /> Flag for attention</Label>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={closeNoteDialog}>Cancel</Button>
            <Button onClick={() => noteMutation.mutate()} disabled={!noteContent.trim() || noteMutation.isPending}>
              {noteMutation.isPending ? 'Saving...' : editingNoteId ? 'Update' : 'Add Note'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Delete Note Confirmation ── */}
      <AlertDialog open={!!deleteNoteId} onOpenChange={(open) => !open && setDeleteNoteId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Note?</AlertDialogTitle>
            <AlertDialogDescription>This note will be permanently deleted. The audit log will record the deletion.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={() => deleteNoteMutation.mutate()} disabled={deleteNoteMutation.isPending} className="bg-red-500 text-white hover:bg-red-600">Delete</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* ── Strike Dialog ── */}
      <Dialog open={strikeOpen} onOpenChange={setStrikeOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Issue Strike</DialogTitle>
            <DialogDescription>Issue a formal strike against {displayName(member)}. They will be able to see it.</DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label>Severity</Label>
              <div className="flex gap-2">
                {(['warning', 'minor', 'major'] as const).map((s) => (
                  <Button key={s} variant={strikeSeverity === s ? 'default' : 'outline'} size="sm" className={`flex-1 capitalize ${strikeSeverity === s ? SEVERITY_COLORS[s] : ''}`} onClick={() => setStrikeSeverity(s)}>
                    {s}
                  </Button>
                ))}
              </div>
            </div>
            <div className="space-y-2">
              <Label>Reason</Label>
              <Textarea value={strikeReason} onChange={(e) => setStrikeReason(e.target.value)} rows={3} placeholder="Describe the reason for this strike..." />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => { setStrikeOpen(false); setStrikeReason(''); }}>Cancel</Button>
            <Button onClick={() => strikeMutation.mutate()} disabled={!strikeReason.trim() || strikeMutation.isPending} className="bg-amber-500 text-white hover:bg-amber-600">
              {strikeMutation.isPending ? 'Issuing...' : 'Issue Strike'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
