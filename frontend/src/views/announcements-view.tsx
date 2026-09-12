'use client';

import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { announcementsApi, apiErrorMessage } from '@/lib/api-client';
import { useAppStore } from '@/lib/store';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { Switch } from '@/components/ui/switch';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { EmptyState, ErrorState, ListSkeleton } from '@/components/ui/empty-state';
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Megaphone, Pin, Plus, Pencil, Trash2, Eye, Check } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { useTranslation } from '@/providers/i18n-provider';
import { formatDateTime, displayName, fullDisplayName } from '@/lib/format';
import type { Announcement, AnnouncementPriority } from '@/lib/api-types';
import { ANNOUNCEMENT_PRIORITIES } from '@/lib/api-types';
import type { TranslationKey } from '@/lib/i18n';

/**
 * Priority styling.
 *
 * This is the one place a colour is allowed to mean urgency rather than a
 * value, because the thing being coloured is a label rather than a figure —
 * the §9.3 rule is about numbers. `low` and `normal` deliberately get nothing:
 * if every notice wears a badge, the badge stops meaning anything.
 */
const PRIORITY_STYLE: Record<AnnouncementPriority, { rule: string; badge: string | null }> = {
  low: { rule: 'border-l-white/[0.06]', badge: null },
  normal: { rule: 'border-l-white/[0.06]', badge: null },
  high: { rule: 'border-l-amber-500/50', badge: 'border-amber-500/30 bg-amber-500/10 text-amber-300' },
  urgent: { rule: 'border-l-red-500/60', badge: 'border-red-500/30 bg-red-500/10 text-red-300' },
};

const PRIORITY_LABELS: Record<AnnouncementPriority, TranslationKey> = {
  low: 'announcements.priorityLow',
  normal: 'announcements.priorityNormal',
  high: 'announcements.priorityHigh',
  urgent: 'announcements.priorityUrgent',
};

interface Props {
  factionId: string;
  /** `manage_settings` — whoever speaks for the faction. */
  canManage?: boolean;
}

export function AnnouncementsView({ factionId, canManage = false }: Props) {
  const { t } = useTranslation();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const user = useAppStore((s) => s.user);
  const brandColor = useAppStore((s) => s.brandColor);

  const [includeExpired, setIncludeExpired] = useState(false);
  const [composeOpen, setComposeOpen] = useState(false);
  const [editing, setEditing] = useState<Announcement | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<Announcement | null>(null);
  const [readsFor, setReadsFor] = useState<Announcement | null>(null);

  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [priority, setPriority] = useState<AnnouncementPriority>('normal');
  const [isPinned, setIsPinned] = useState(false);
  const [expiresAt, setExpiresAt] = useState('');

  const { data: items = [], isLoading, isError, error, refetch } = useQuery({
    queryKey: ['announcements', factionId, includeExpired],
    queryFn: () => announcementsApi.list(factionId, { include_expired: includeExpired }),
    staleTime: 0,
  });

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ['announcements', factionId] });
    queryClient.invalidateQueries({ queryKey: ['notifications-unread'] });
  };

  const resetForm = () => {
    setTitle('');
    setBody('');
    setPriority('normal');
    setIsPinned(false);
    setExpiresAt('');
    setEditing(null);
  };

  const saveMutation = useMutation({
    mutationFn: () => {
      const payload = {
        title: title.trim(),
        body: body.trim(),
        priority,
        isPinned,
        // A datetime-local value has no zone; it is the author's wall clock,
        // which is what they meant. Converting through Date attaches theirs.
        expiresAt: expiresAt ? new Date(expiresAt).toISOString() : null,
      };
      return editing
        ? announcementsApi.update(factionId, editing.id, payload)
        : announcementsApi.create(factionId, payload);
    },
    onSuccess: () => {
      toast({ title: editing ? t('announcements.updated') : t('announcements.posted') });
      setComposeOpen(false);
      resetForm();
      invalidate();
    },
    onError: (err: unknown) => {
      toast({ title: t('common.failed'), description: apiErrorMessage(err), variant: 'destructive' });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => announcementsApi.remove(factionId, id),
    onSuccess: () => {
      toast({ title: t('announcements.removed') });
      setDeleteTarget(null);
      invalidate();
    },
    onError: (err: unknown) => {
      toast({ title: t('common.failed'), description: apiErrorMessage(err), variant: 'destructive' });
    },
  });

  const markRead = useMutation({
    mutationFn: (id: string) => announcementsApi.markRead(factionId, id),
    onSuccess: invalidate,
  });

  const { data: reads = [], isLoading: readsLoading } = useQuery({
    queryKey: ['announcement-reads', factionId, readsFor?.id],
    queryFn: () => announcementsApi.reads(factionId, readsFor!.id),
    enabled: !!readsFor,
  });

  /**
   * Mark everything on screen as read, once.
   *
   * Reading the board *is* reading the announcements — making someone click
   * each one to clear a badge would be a chore invented by the badge rather
   * than by anything a member wants.
   */
  useEffect(() => {
    for (const a of items) {
      if (!a.isReadByMe) markRead.mutate(a.id);
    }
    // Deliberately keyed on the ids present: re-running on every render or on
    // every mutation settle would loop.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [items.map((a) => `${a.id}:${a.isReadByMe}`).join(',')]);

  const openCompose = () => { resetForm(); setComposeOpen(true); };
  const openEdit = (a: Announcement) => {
    setEditing(a);
    setTitle(a.title);
    setBody(a.body);
    setPriority(a.priority);
    setIsPinned(a.isPinned);
    // datetime-local wants a local wall-clock string, not an ISO instant.
    setExpiresAt(a.expiresAt ? toLocalInput(a.expiresAt) : '');
    setComposeOpen(true);
  };

  const canSave = title.trim().length > 0 && body.trim().length > 0 && !saveMutation.isPending;

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h2 className="text-xl font-medium tracking-tight text-zinc-100">{t('nav.announcements')}</h2>
          <p className="text-zinc-500 text-sm mt-0.5">{t('announcements.intro')}</p>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            aria-pressed={includeExpired}
            className={includeExpired ? 'border-primary text-primary' : ''}
            onClick={() => setIncludeExpired((v) => !v)}
          >
            {t('announcements.showExpired')}
          </Button>
          {canManage && (
            <Button size="sm" onClick={openCompose} style={{ backgroundColor: brandColor }}>
              <Plus className="h-4 w-4 mr-1.5" />
              {t('announcements.new')}
            </Button>
          )}
        </div>
      </div>

      {isLoading ? (
        <Card className="py-0 gap-0"><CardContent className="p-0"><ListSkeleton rows={3} height="h-24" /></CardContent></Card>
      ) : isError ? (
        <Card className="py-0 gap-0"><CardContent className="p-0"><ErrorState error={error} onRetry={() => refetch()} /></CardContent></Card>
      ) : items.length === 0 ? (
        <Card className="py-0 gap-0">
          <CardContent className="p-0">
            <EmptyState icon={Megaphone} title={t('announcements.none')} hint={canManage ? t('announcements.noneHintAdmin') : t('announcements.noneHint')} />
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {items.map((a) => {
            const style = PRIORITY_STYLE[a.priority];
            const expired = !!a.expiresAt && new Date(a.expiresAt) <= new Date();
            return (
              <Card key={a.id} className={`border-l-2 ${style.rule} ${expired ? 'opacity-60' : ''}`}>
                <CardContent className="py-4 space-y-3">
                  <div className="flex flex-wrap items-start gap-2">
                    {a.isPinned && <Pin className="h-3.5 w-3.5 mt-1 shrink-0 text-zinc-400" aria-label={t('announcements.pinned')} />}
                    <h3 className="text-sm font-medium text-zinc-100 min-w-0 break-words flex-1">{a.title}</h3>
                    {style.badge && (
                      <Badge variant="outline" className={`text-[10px] border ${style.badge}`}>
                        {t(PRIORITY_LABELS[a.priority])}
                      </Badge>
                    )}
                    {expired && (
                      <Badge variant="outline" className="text-[10px] border-white/[0.08] text-zinc-500">
                        {t('announcements.expired')}
                      </Badge>
                    )}
                  </div>

                  <div className="prose-invert max-w-none text-sm text-zinc-300 [&_a]:text-primary [&_a]:underline [&_ul]:list-disc [&_ul]:pl-5 [&_ol]:list-decimal [&_ol]:pl-5 [&_p]:my-1.5 [&_strong]:text-zinc-100 [&_code]:rounded [&_code]:bg-white/[0.06] [&_code]:px-1">
                    <ReactMarkdown remarkPlugins={[remarkGfm]}>{a.body}</ReactMarkdown>
                  </div>

                  <div className="flex flex-wrap items-center gap-2 text-[11px] text-zinc-600">
                    <Avatar className="h-5 w-5">
                      <AvatarImage src={a.authorAvatarUrl ?? undefined} />
                      <AvatarFallback className="text-[8px]">
                        {displayName({ username: a.authorUsername, inGameName: a.authorInGameName }).slice(0, 2).toUpperCase()}
                      </AvatarFallback>
                    </Avatar>
                    <span className="text-zinc-400">
                      {displayName({ username: a.authorUsername, inGameName: a.authorInGameName })}
                    </span>
                    <span className="tabular-nums">· {formatDateTime(a.createdAt)}</span>
                    {a.updatedAt !== a.createdAt && <span>· {t('announcements.edited')}</span>}

                    <span className="ml-auto flex items-center gap-1">
                      {canManage && (
                        <Button
                          variant="ghost" size="sm"
                          className="h-6 px-1.5 text-[11px] text-zinc-500 hover:text-zinc-200"
                          onClick={() => setReadsFor(a)}
                        >
                          <Eye className="mr-1 h-3 w-3" />
                          {t('announcements.readBy', { count: a.readCount })}
                        </Button>
                      )}
                      {a.authorId === user?.id && (
                        <Button
                          variant="ghost" size="icon"
                          className="h-6 w-6 text-zinc-500 hover:text-zinc-200"
                          aria-label={t('common.edit')}
                          onClick={() => openEdit(a)}
                        >
                          <Pencil className="h-3 w-3" />
                        </Button>
                      )}
                      {(a.authorId === user?.id || canManage) && (
                        <Button
                          variant="ghost" size="icon"
                          className="h-6 w-6 text-zinc-500 hover:text-red-300"
                          aria-label={t('common.delete')}
                          onClick={() => setDeleteTarget(a)}
                        >
                          <Trash2 className="h-3 w-3" />
                        </Button>
                      )}
                    </span>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      {/* Compose / edit */}
      <Dialog open={composeOpen} onOpenChange={(open) => { if (!open) { setComposeOpen(false); resetForm(); } }}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>{editing ? t('announcements.edit') : t('announcements.new')}</DialogTitle>
            <DialogDescription>{t('announcements.composeHint')}</DialogDescription>
          </DialogHeader>
          <form onSubmit={(e) => { e.preventDefault(); if (canSave) saveMutation.mutate(); }}>
            <div className="space-y-4">
              <div className="space-y-1.5">
                <Label className="text-xs text-zinc-500">{t('announcements.title')}</Label>
                <Input value={title} maxLength={200} onChange={(e) => setTitle(e.target.value)} />
              </div>

              <div className="space-y-1.5">
                <Label className="text-xs text-zinc-500">{t('announcements.body')}</Label>
                <Textarea value={body} rows={8} maxLength={10000} onChange={(e) => setBody(e.target.value)} />
                <p className="text-[11px] text-zinc-600">{t('announcements.markdownHint')}</p>
              </div>

              <div className="space-y-1.5">
                <Label className="text-xs text-zinc-500">{t('announcements.priority')}</Label>
                <div className="flex flex-wrap gap-1.5">
                  {ANNOUNCEMENT_PRIORITIES.map((p) => (
                    <Button
                      key={p}
                      type="button"
                      variant="outline"
                      size="sm"
                      aria-pressed={priority === p}
                      className={`h-7 text-xs ${priority === p ? 'border-primary text-primary bg-primary/10' : 'text-zinc-400'}`}
                      onClick={() => setPriority(p)}
                    >
                      {t(PRIORITY_LABELS[p])}
                    </Button>
                  ))}
                </div>
              </div>

              <div className="flex items-center justify-between rounded-lg border border-white/[0.06] p-3">
                <div className="pr-3">
                  <p className="text-sm">{t('announcements.pin')}</p>
                  <p className="text-xs text-zinc-500">{t('announcements.pinHint')}</p>
                </div>
                <Switch checked={isPinned} onCheckedChange={setIsPinned} />
              </div>

              <div className="space-y-1.5">
                <Label className="text-xs text-zinc-500">{t('announcements.expiry')}</Label>
                <Input type="datetime-local" value={expiresAt} onChange={(e) => setExpiresAt(e.target.value)} />
                <p className="text-[11px] text-zinc-600">{t('announcements.expiryHint')}</p>
              </div>
            </div>
            <DialogFooter className="mt-4">
              <Button variant="outline" onClick={() => { setComposeOpen(false); resetForm(); }}>
                {t('common.cancel')}
              </Button>
              <Button type="submit" disabled={!canSave} style={{ backgroundColor: brandColor }}>
                {saveMutation.isPending ? t('common.saving') : editing ? t('common.save') : t('announcements.post')}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Who has read it */}
      <Dialog open={!!readsFor} onOpenChange={(open) => { if (!open) setReadsFor(null); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t('announcements.readsTitle')}</DialogTitle>
            <DialogDescription>{readsFor?.title}</DialogDescription>
          </DialogHeader>
          {readsLoading ? (
            <ListSkeleton rows={3} height="h-8" />
          ) : (
            <div className="max-h-[50vh] space-y-1 overflow-y-auto">
              {reads.map((r) => (
                <div key={r.userId} className="flex items-center gap-2 rounded-md px-2 py-1.5">
                  <Avatar className="h-6 w-6">
                    <AvatarImage src={r.avatarUrl ?? undefined} />
                    <AvatarFallback className="text-[9px]">{r.username.slice(0, 2).toUpperCase()}</AvatarFallback>
                  </Avatar>
                  <span className="min-w-0 flex-1 truncate text-sm text-zinc-300">
                    {fullDisplayName({ username: r.username, inGameName: r.inGameName })}
                  </span>
                  {r.readAt ? (
                    <span className="flex items-center gap-1 text-[11px] tabular-nums text-emerald-400">
                      <Check className="h-3 w-3" />
                      {formatDateTime(r.readAt)}
                    </span>
                  ) : (
                    <span className="text-[11px] text-zinc-600">{t('announcements.unread')}</span>
                  )}
                </div>
              ))}
            </div>
          )}
        </DialogContent>
      </Dialog>

      <AlertDialog open={!!deleteTarget} onOpenChange={(open) => { if (!open) setDeleteTarget(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t('announcements.removeTitle')}</AlertDialogTitle>
            <AlertDialogDescription>{t('announcements.removeConfirm')}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t('common.cancel')}</AlertDialogCancel>
            <AlertDialogAction
              disabled={deleteMutation.isPending}
              onClick={() => { if (deleteTarget) deleteMutation.mutate(deleteTarget.id); }}
            >
              {deleteMutation.isPending ? t('common.deleting') : t('common.delete')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

/** ISO instant → the `datetime-local` wall-clock string for this browser. */
function toLocalInput(iso: string): string {
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
