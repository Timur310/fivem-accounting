'use client';

import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { membersApi, mentoringApi, apiErrorMessage } from '@/lib/api-client';
import { usePersistedState } from '@/hooks/use-persisted-state';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Textarea } from '@/components/ui/textarea';
import { Card, CardContent } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { Segmented } from '@/components/ui/segmented';
import { SearchableSelect } from '@/components/ui/searchable-select';
import { RatingStars } from '@/components/ui/rating-stars';
import { EmptyState, ErrorState } from '@/components/ui/empty-state';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { useToast } from '@/hooks/use-toast';
import { useTranslation } from '@/providers/i18n-provider';
import { displayName, formatDate, formatDateTime } from '@/lib/format';
import { cn } from '@/lib/utils';
import { AlertTriangle, ArrowRight, CalendarClock, GraduationCap, Lock, Pencil, Plus, Settings2, Trash2 } from 'lucide-react';
import {
  MENTOR_NOTE_KINDS, MENTOR_SCORE_AREAS,
  type Member, type MentorNote, type MentorNoteKind, type MentorScoreArea, type Mentorship, type MentorshipStatus,
} from '@/lib/api-types';

/** Colour per kind of note: green for what goes well, red for mistakes. */
const KIND_TONE: Record<MentorNoteKind, string> = {
  strength: 'border-emerald-500/40 bg-emerald-500/10 text-emerald-300',
  weakness: 'border-amber-500/40 bg-amber-500/10 text-amber-300',
  improve: 'border-sky-500/40 bg-sky-500/10 text-sky-300',
  mistake: 'border-red-500/40 bg-red-500/10 text-red-300',
  note: 'border-zinc-600 bg-zinc-800/60 text-zinc-300',
};

const STATUS_TONE: Record<MentorshipStatus, string> = {
  active: 'border-sky-500/40 text-sky-300',
  passed: 'border-emerald-500/40 text-emerald-300',
  failed: 'border-red-500/40 text-red-300',
  cancelled: 'border-zinc-600 text-zinc-400',
};

export function OutcomeBadge({ status }: { status: MentorshipStatus }) {
  const { t } = useTranslation();
  return <Badge variant="outline" className={cn('text-[10px]', STATUS_TONE[status])}>{t(`mentoring.status.${status}` as never)}</Badge>;
}

const initials = (name: string) => name.slice(0, 2).toUpperCase();
const dayInput = (iso: string | null) => (iso ? iso.slice(0, 10) : '');
/** A day picked in a date field, as the end of that day in the viewer's timezone. */
const endOfDay = (day: string) => (day ? new Date(`${day}T23:59:59`).toISOString() : null);

/**
 * Mentoring: newcomers, their mentors, and what the mentors write about them.
 *
 * Three people open this page and each sees something different. Leadership
 * (`manage_mentoring`) sees the whole board and every note. A mentor sees the
 * people they mentor and writes about them. A mentee sees who their mentor is
 * and what the mentorship is for — and, deliberately, none of what is written:
 * the server never sends it to them.
 */
export function MentoringView({ factionId }: { factionId: string }) {
  const { t } = useTranslation();
  const [tab, setTab] = usePersistedState<'active' | 'finished'>(`mentoring.tab.${factionId}`, 'active');
  const [openId, setOpenId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [limitOpen, setLimitOpen] = useState(false);

  const board = useQuery({
    queryKey: ['mentoring', factionId, tab],
    queryFn: () => mentoringApi.board(factionId, tab),
  });
  const data = board.data;
  const rows = data?.mentorships ?? [];
  const limit = data?.pointLimit ?? null;
  const manage = !!data?.canManage;

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-medium tracking-tight text-zinc-100">{t('mentoring.title')}</h1>
          <p className="text-meta mt-1 max-w-xl text-zinc-500">
            {manage
              ? t('mentoring.subtitleLeader')
              : data?.asMentee && rows.length === 0 ? t('mentoring.subtitleMentee') : t('mentoring.subtitleMentor')}
          </p>
        </div>
        {manage && (
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={() => setLimitOpen(true)}>
              <Settings2 className="mr-1.5 h-3.5 w-3.5" />
              {limit ? t('mentoring.limitShort', { count: limit }) : t('mentoring.setLimit')}
            </Button>
            <Button onClick={() => setCreating(true)}>
              <Plus className="mr-2 h-4 w-4" />{t('mentoring.new')}
            </Button>
          </div>
        )}
      </div>

      {/* The mentee's own view: who, and what for. */}
      {data?.asMentee && (
        <Card className="border-sky-500/30">
          <CardContent className="flex flex-wrap items-center gap-3 py-4">
            <Avatar className="h-10 w-10">
              <AvatarImage src={data.asMentee.mentorAvatarUrl ?? undefined} alt="" />
              <AvatarFallback>{initials(data.asMentee.mentorName)}</AvatarFallback>
            </Avatar>
            <div className="min-w-0 flex-1">
              <p className="text-sm text-zinc-100">{t('mentoring.yourMentor', { name: data.asMentee.mentorName })}</p>
              <p className="text-xs text-zinc-500">
                {t('mentoring.since', { date: formatDate(data.asMentee.startedAt) })}
                {data.asMentee.dueAt && ` · ${t('mentoring.until', { date: formatDate(data.asMentee.dueAt) })}`}
              </p>
              {data.asMentee.goal && <p className="mt-1 text-sm text-zinc-300">{data.asMentee.goal}</p>}
            </div>
            <p className="flex w-full items-center gap-1.5 text-[11px] text-zinc-500">
              <Lock className="h-3 w-3" />{t('mentoring.menteePrivacy')}
            </p>
          </CardContent>
        </Card>
      )}

      {(manage || rows.length > 0 || tab === 'finished') && (
        <Segmented
          label={t('mentoring.title')}
          value={tab}
          onChange={setTab}
          options={[
            { value: 'active', label: t('mentoring.active') },
            { value: 'finished', label: t('mentoring.finished') },
          ]}
        />
      )}

      {board.isLoading ? (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <Skeleton className="h-36" /><Skeleton className="h-36" /><Skeleton className="h-36" />
        </div>
      ) : board.isError ? (
        <ErrorState error={board.error} onRetry={() => void board.refetch()} />
      ) : rows.length === 0 ? (
        data?.asMentee && !manage ? null : (
          <EmptyState
            icon={GraduationCap}
            title={tab === 'active' ? t('mentoring.emptyActive') : t('mentoring.emptyFinished')}
            hint={manage ? t('mentoring.emptyHintLeader') : t('mentoring.emptyHintMember')}
          />
        )
      ) : (
        <div className="stagger grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {rows.map((m) => <MentorshipCard key={m.id} m={m} limit={limit} onOpen={() => setOpenId(m.id)} />)}
        </div>
      )}

      {openId && <MentorshipDialog factionId={factionId} id={openId} onClose={() => setOpenId(null)} />}
      {creating && <CreateDialog factionId={factionId} onClose={() => setCreating(false)} />}
      {limitOpen && <LimitDialog factionId={factionId} current={limit} onClose={() => setLimitOpen(false)} />}
    </div>
  );
}

function MentorshipCard({ m, limit, onOpen }: { m: Mentorship; limit: number | null; onOpen: () => void }) {
  const { t } = useTranslation();
  const flagged = m.status === 'active' && limit !== null && m.points >= limit;
  const overdue = m.status === 'active' && m.dueAt !== null && new Date(m.dueAt) < new Date();
  return (
    <button
      type="button"
      onClick={onOpen}
      className={cn(
        'lift space-y-3 rounded-lg border bg-zinc-900/60 p-4 text-left hover:border-zinc-700',
        flagged ? 'border-red-500/50' : 'border-zinc-800',
      )}
    >
      <div className="flex items-center gap-2.5">
        <Avatar className="h-9 w-9">
          <AvatarImage src={m.menteeAvatarUrl ?? undefined} alt="" />
          <AvatarFallback className="text-[10px]">{initials(m.menteeName)}</AvatarFallback>
        </Avatar>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium text-zinc-100">{m.menteeName}</p>
          <p className="truncate text-xs text-zinc-500">{t('mentoring.mentoredBy', { name: m.mentorName })}</p>
        </div>
        {m.status === 'active'
          ? flagged && <Badge className="bg-red-500/15 text-[10px] text-red-300"><AlertTriangle className="mr-1 h-3 w-3" />{t('mentoring.review')}</Badge>
          : <OutcomeBadge status={m.status} />}
      </div>

      <div className="flex flex-wrap gap-1">
        {MENTOR_NOTE_KINDS.filter((k) => m.counts[k] > 0).map((k) => (
          <span key={k} className={cn('rounded border px-1.5 py-0.5 text-[10px]', KIND_TONE[k])}>
            {t(`mentoring.kind.${k}` as never)} {m.counts[k]}
          </span>
        ))}
        {MENTOR_NOTE_KINDS.every((k) => m.counts[k] === 0) && (
          <span className="text-[11px] text-zinc-600">{t('mentoring.noNotesYet')}</span>
        )}
      </div>

      {m.status === 'active' && limit !== null && (
        <div className="space-y-1">
          <div className="flex justify-between text-[11px] text-zinc-500">
            <span>{t('mentoring.points')}</span>
            <span className={flagged ? 'text-red-300' : ''}>{m.points} / {limit}</span>
          </div>
          <div className="h-1 overflow-hidden rounded-full bg-zinc-800">
            <div
              className={cn('h-full rounded-full', flagged ? 'bg-red-500' : m.points / limit >= 0.6 ? 'bg-amber-400' : 'bg-emerald-400')}
              style={{ width: `${Math.min(1, m.points / limit) * 100}%` }}
            />
          </div>
        </div>
      )}
      {m.status === 'active' && limit === null && m.points > 0 && (
        <p className="text-[11px] text-zinc-500">{t('mentoring.pointsShort', { count: m.points })}</p>
      )}

      <p className={cn('flex items-center gap-1.5 text-[11px]', overdue ? 'text-amber-300' : 'text-zinc-500')}>
        <CalendarClock className="h-3 w-3" />
        {m.status === 'active'
          ? m.dueAt
            ? overdue ? t('mentoring.overdue', { date: formatDate(m.dueAt) }) : t('mentoring.until', { date: formatDate(m.dueAt) })
            : t('mentoring.since', { date: formatDate(m.startedAt) })
          : `${formatDate(m.startedAt)} – ${formatDate(m.endedAt ?? m.startedAt)}`}
      </p>
    </button>
  );
}

/** One mentorship opened: its notes, writing a new one, and leadership's controls. */
function MentorshipDialog({ factionId, id, onClose }: { factionId: string; id: string; onClose: () => void }) {
  const { t } = useTranslation();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [filter, setFilter] = useState<MentorNoteKind | 'all'>('all');
  const [draft, setDraft] = useState<{ kind: MentorNoteKind; body: string; points: number }>({ kind: 'note', body: '', points: 1 });
  const [editing, setEditing] = useState<{ id: string; body: string } | null>(null);
  const [closing, setClosing] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [reassign, setReassign] = useState('');

  const detail = useQuery({
    queryKey: ['mentoring-detail', factionId, id],
    queryFn: () => mentoringApi.detail(factionId, id),
  });
  const m = detail.data?.mentorship;
  const manage = !!detail.data?.canManage;
  const notes = detail.data?.notes ?? [];
  const shown = filter === 'all' ? notes : notes.filter((n) => n.kind === filter);
  const active = m?.status === 'active';

  const members = useQuery({
    queryKey: ['members', factionId],
    queryFn: () => membersApi.list(factionId),
    enabled: manage,
  });

  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: ['mentoring-detail', factionId, id] });
    void queryClient.invalidateQueries({ queryKey: ['mentoring', factionId] });
    void queryClient.invalidateQueries({ queryKey: ['mentoring-history', factionId] });
  };
  const fail = (err: unknown) => toast({ title: t('common.failed'), description: apiErrorMessage(err), variant: 'destructive' });

  const add = useMutation({
    mutationFn: () => mentoringApi.addNote(factionId, id, {
      kind: draft.kind, body: draft.body.trim(), ...(draft.kind === 'mistake' ? { points: draft.points } : {}),
    }),
    onSuccess: () => { setDraft((d) => ({ ...d, body: '' })); refresh(); },
    onError: fail,
  });
  const saveEdit = useMutation({
    mutationFn: (v: { id: string; body: string }) => mentoringApi.updateNote(factionId, v.id, { body: v.body.trim() }),
    onSuccess: () => { setEditing(null); refresh(); },
    onError: fail,
  });
  const removeNote = useMutation({
    mutationFn: (noteId: string) => mentoringApi.removeNote(factionId, noteId),
    onSuccess: refresh,
    onError: fail,
  });
  const update = useMutation({
    mutationFn: (input: { mentorUserId?: string; dueAt?: string | null }) => mentoringApi.update(factionId, id, input),
    onSuccess: () => { setReassign(''); refresh(); toast({ title: t('mentoring.saved') }); },
    onError: fail,
  });
  const remove = useMutation({
    mutationFn: () => mentoringApi.remove(factionId, id),
    onSuccess: () => { refresh(); onClose(); toast({ title: t('mentoring.deleted') }); },
    onError: fail,
  });

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[90vh] max-w-2xl overflow-y-auto">
        {!m ? (
          <Skeleton className="h-40 w-full" />
        ) : (
          <>
            <DialogHeader>
              <DialogTitle className="flex flex-wrap items-center gap-2">
                {m.menteeName}
                <ArrowRight className="h-4 w-4 rotate-180 text-zinc-600" />
                <span className="text-sm font-normal text-zinc-400">{t('mentoring.mentoredBy', { name: m.mentorName })}</span>
                {!active && <OutcomeBadge status={m.status} />}
              </DialogTitle>
              <DialogDescription>
                {t('mentoring.since', { date: formatDate(m.startedAt) })}
                {m.dueAt && active && ` · ${t('mentoring.until', { date: formatDate(m.dueAt) })}`}
                {m.endedAt && ` · ${t('mentoring.endedOn', { date: formatDate(m.endedAt) })}`}
                {` · ${t('mentoring.pointsShort', { count: m.points })}`}
                {detail.data?.pointLimit ? ` / ${detail.data.pointLimit}` : ''}
              </DialogDescription>
            </DialogHeader>

            {m.goal && (
              <p className="rounded-md border border-zinc-800 bg-zinc-900/60 px-3 py-2 text-sm text-zinc-300">
                <span className="mr-1 text-xs uppercase tracking-wide text-zinc-500">{t('mentoring.goal')}</span>{m.goal}
              </p>
            )}

            {!active && (m.summary || m.scores) && (
              <div className="space-y-2 rounded-md border border-zinc-800 p-3">
                {m.summary && <p className="whitespace-pre-wrap text-sm text-zinc-200">{m.summary}</p>}
                {m.scores && (
                  <div className="grid gap-1.5 sm:grid-cols-2">
                    {MENTOR_SCORE_AREAS.filter((a) => m.scores?.[a]).map((area) => (
                      <div key={area} className="flex items-center justify-between gap-2 text-xs text-zinc-400">
                        {t(`mentoring.area.${area}` as never)}
                        <RatingStars value={m.scores?.[area] ?? null} label={t(`mentoring.area.${area}` as never)} size="xs" />
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* Leadership's controls on a running mentorship. */}
            {manage && active && (
              <div className="flex flex-wrap items-center gap-2 rounded-md border border-zinc-800 p-3">
                <SearchableSelect
                  className="min-w-[10rem] flex-1"
                  size="sm"
                  value={reassign}
                  placeholder={t('mentoring.reassign')}
                  onValueChange={setReassign}
                  options={(members.data ?? [])
                    .filter((x: Member) => x.userId !== m.menteeUserId && x.userId !== m.mentorUserId)
                    .map((x: Member) => ({ value: x.userId, label: displayName(x) }))}
                  aria-label={t('mentoring.reassign')}
                />
                <Button size="sm" variant="outline" disabled={!reassign || update.isPending} onClick={() => update.mutate({ mentorUserId: reassign })}>
                  {t('mentoring.reassignButton')}
                </Button>
                <label className="flex items-center gap-1.5 text-xs text-zinc-500">
                  {t('mentoring.dueDate')}
                  <Input
                    type="date"
                    className="h-8 w-40"
                    defaultValue={dayInput(m.dueAt)}
                    onChange={(e) => update.mutate({ dueAt: endOfDay(e.target.value) })}
                  />
                </label>
                <div className="ml-auto flex gap-2">
                  <Button size="sm" onClick={() => setClosing(true)}>{t('mentoring.close')}</Button>
                  <Button size="icon-sm" variant="ghost" onClick={() => setDeleting(true)} aria-label={t('common.remove')}>
                    <Trash2 className="h-4 w-4 text-red-400" />
                  </Button>
                </div>
              </div>
            )}
            {manage && !active && (
              <div className="flex justify-end">
                <Button size="sm" variant="ghost" className="text-red-400" onClick={() => setDeleting(true)}>
                  <Trash2 className="mr-1.5 h-3.5 w-3.5" />{t('mentoring.delete')}
                </Button>
              </div>
            )}

            {/* Writing a note. */}
            {active && (
              <div className="space-y-2 rounded-md border border-dashed border-zinc-800 p-3">
                <div className="flex flex-wrap gap-1.5" role="radiogroup" aria-label={t('mentoring.noteKind')}>
                  {MENTOR_NOTE_KINDS.map((k) => (
                    <button
                      key={k}
                      type="button"
                      role="radio"
                      aria-checked={draft.kind === k}
                      onClick={() => setDraft((d) => ({ ...d, kind: k }))}
                      className={cn(
                        'rounded-full border px-2.5 py-1 text-xs transition-colors',
                        draft.kind === k ? KIND_TONE[k] : 'border-zinc-800 text-zinc-500 hover:text-zinc-300',
                      )}
                    >
                      {t(`mentoring.kind.${k}` as never)}
                    </button>
                  ))}
                </div>
                <Textarea
                  rows={3}
                  value={draft.body}
                  maxLength={4000}
                  placeholder={t(`mentoring.placeholder.${draft.kind}` as never)}
                  onChange={(e) => setDraft((d) => ({ ...d, body: e.target.value }))}
                />
                <div className="flex flex-wrap items-center gap-3">
                  {draft.kind === 'mistake' && (
                    <div className="flex items-center gap-1.5 text-xs text-zinc-400">
                      {t('mentoring.points')}
                      {[1, 2, 3, 4, 5].map((n) => (
                        <button
                          key={n}
                          type="button"
                          onClick={() => setDraft((d) => ({ ...d, points: n }))}
                          aria-pressed={draft.points === n}
                          className={cn(
                            'size-7 rounded-md border text-xs pointer-coarse:size-9',
                            draft.points === n ? 'border-red-500/60 bg-red-500/15 text-red-200' : 'border-zinc-800 text-zinc-500',
                          )}
                        >
                          {n}
                        </button>
                      ))}
                    </div>
                  )}
                  <p className="flex items-center gap-1 text-[11px] text-zinc-600"><Lock className="h-3 w-3" />{t('mentoring.privateNote')}</p>
                  <Button size="sm" className="ml-auto" disabled={!draft.body.trim() || add.isPending} onClick={() => add.mutate()}>
                    {t('mentoring.addNote')}
                  </Button>
                </div>
              </div>
            )}

            {/* The notes. */}
            <div className="space-y-2">
              {notes.length > 0 && (
                <div className="flex flex-wrap gap-1.5">
                  {(['all', ...MENTOR_NOTE_KINDS] as const).map((k) => {
                    const count = k === 'all' ? notes.length : notes.filter((n) => n.kind === k).length;
                    if (k !== 'all' && count === 0) return null;
                    return (
                      <button
                        key={k}
                        type="button"
                        onClick={() => setFilter(k)}
                        className={cn(
                          'rounded-full border px-2 py-0.5 text-[11px]',
                          filter === k ? 'border-[var(--brand-color)] bg-[var(--brand-color-light)] text-zinc-100' : 'border-zinc-800 text-zinc-500',
                        )}
                      >
                        {k === 'all' ? t('mentoring.allNotes') : t(`mentoring.kind.${k}` as never)} {count}
                      </button>
                    );
                  })}
                </div>
              )}
              {shown.length === 0 && (
                <p className="py-4 text-center text-sm text-zinc-500">{t('mentoring.noNotesYet')}</p>
              )}
              {shown.map((n: MentorNote) => (
                <div key={n.id} className="rounded-md border border-zinc-800 px-3 py-2">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className={cn('rounded border px-1.5 py-0.5 text-[10px]', KIND_TONE[n.kind])}>
                      {t(`mentoring.kind.${n.kind}` as never)}{n.kind === 'mistake' && ` · ${t('mentoring.pointsShort', { count: n.points })}`}
                    </span>
                    <span className="text-xs text-zinc-400">{n.authorName}</span>
                    <span className="text-[11px] text-zinc-600">{formatDateTime(n.createdAt)}{n.updatedAt ? ` · ${t('mentoring.edited')}` : ''}</span>
                    {active && (manage || n.authorUserId === m.mentorUserId) && (
                      <span className="ml-auto flex gap-0.5">
                        <Button size="icon-xs" variant="ghost" onClick={() => setEditing({ id: n.id, body: n.body })} aria-label={t('mentoring.edit')}>
                          <Pencil className="h-3.5 w-3.5" />
                        </Button>
                        <Button size="icon-xs" variant="ghost" onClick={() => removeNote.mutate(n.id)} aria-label={t('common.remove')}>
                          <Trash2 className="h-3.5 w-3.5 text-red-400" />
                        </Button>
                      </span>
                    )}
                  </div>
                  {editing?.id === n.id ? (
                    <div className="mt-2 space-y-2">
                      <Textarea rows={3} value={editing.body} onChange={(e) => setEditing({ id: n.id, body: e.target.value })} />
                      <div className="flex justify-end gap-2">
                        <Button size="sm" variant="ghost" onClick={() => setEditing(null)}>{t('common.cancel')}</Button>
                        <Button size="sm" disabled={!editing.body.trim() || saveEdit.isPending} onClick={() => saveEdit.mutate(editing)}>{t('common.save')}</Button>
                      </div>
                    </div>
                  ) : (
                    <p className="mt-1.5 whitespace-pre-wrap text-sm text-zinc-200">{n.body}</p>
                  )}
                </div>
              ))}
            </div>
          </>
        )}

        {closing && m && <CloseDialog factionId={factionId} m={m} onClose={() => setClosing(false)} onDone={refresh} />}

        <AlertDialog open={deleting} onOpenChange={setDeleting}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>{t('mentoring.deleteTitle')}</AlertDialogTitle>
              <AlertDialogDescription>{t('mentoring.deleteBody')}</AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>{t('common.cancel')}</AlertDialogCancel>
              <AlertDialogAction className="bg-red-600 hover:bg-red-500" onClick={() => remove.mutate()} disabled={remove.isPending}>
                {t('mentoring.delete')}
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </DialogContent>
    </Dialog>
  );
}

function CloseDialog({ factionId, m, onClose, onDone }: { factionId: string; m: Mentorship; onClose: () => void; onDone: () => void }) {
  const { t } = useTranslation();
  const { toast } = useToast();
  const [outcome, setOutcome] = useState<'passed' | 'failed' | 'cancelled'>('passed');
  const [summary, setSummary] = useState('');
  const [scores, setScores] = useState<Partial<Record<MentorScoreArea, number>>>({});

  const close = useMutation({
    mutationFn: () => mentoringApi.close(factionId, m.id, {
      outcome, summary: summary.trim() || undefined, scores: Object.keys(scores).length ? scores : undefined,
    }),
    onSuccess: () => { onDone(); onClose(); toast({ title: t('mentoring.closedToast') }); },
    onError: (err) => toast({ title: t('common.failed'), description: apiErrorMessage(err), variant: 'destructive' }),
  });

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{t('mentoring.closeTitle', { name: m.menteeName })}</DialogTitle>
          <DialogDescription>{t('mentoring.closeHint')}</DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <Segmented
            label={t('mentoring.outcome')}
            value={outcome}
            onChange={setOutcome}
            fill
            options={[
              { value: 'passed', label: t('mentoring.status.passed') },
              { value: 'failed', label: t('mentoring.status.failed') },
              { value: 'cancelled', label: t('mentoring.status.cancelled') },
            ]}
          />
          <div className="space-y-1.5">
            <Label htmlFor="ms-summary">{t('mentoring.summary')}</Label>
            <Textarea id="ms-summary" rows={3} value={summary} maxLength={4000} onChange={(e) => setSummary(e.target.value)} placeholder={t('mentoring.summaryPlaceholder')} />
          </div>
          <div className="space-y-2">
            <p className="text-sm text-zinc-300">{t('mentoring.scores')}</p>
            {MENTOR_SCORE_AREAS.map((area) => (
              <div key={area} className="flex items-center justify-between gap-2">
                <span className="text-sm text-zinc-400">{t(`mentoring.area.${area}` as never)}</span>
                <RatingStars
                  value={scores[area] ?? null}
                  label={t(`mentoring.area.${area}` as never)}
                  onChange={(v) => setScores((s) => {
                    const next = { ...s };
                    if (v === null) delete next[area]; else next[area] = v;
                    return next;
                  })}
                />
              </div>
            ))}
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>{t('common.cancel')}</Button>
          <Button onClick={() => close.mutate()} disabled={close.isPending}>{t('mentoring.close')}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function CreateDialog({ factionId, onClose }: { factionId: string; onClose: () => void }) {
  const { t } = useTranslation();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [mentee, setMentee] = useState('');
  const [mentor, setMentor] = useState('');
  const [goal, setGoal] = useState('');
  const [due, setDue] = useState('');

  const members = useQuery({ queryKey: ['members', factionId], queryFn: () => membersApi.list(factionId) });
  const active = useQuery({ queryKey: ['mentoring', factionId, 'active'], queryFn: () => mentoringApi.board(factionId, 'active') });
  const taken = useMemo(() => new Set((active.data?.mentorships ?? []).map((m) => m.menteeUserId)), [active.data]);
  const options = (members.data ?? []).map((x: Member) => ({ value: x.userId, label: displayName(x), hint: x.rank ?? undefined }));

  const create = useMutation({
    mutationFn: () => mentoringApi.create(factionId, {
      menteeUserId: mentee, mentorUserId: mentor, goal: goal.trim() || undefined, dueAt: endOfDay(due),
    }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['mentoring', factionId] });
      toast({ title: t('mentoring.created') });
      onClose();
    },
    onError: (err) => toast({ title: t('common.failed'), description: apiErrorMessage(err), variant: 'destructive' }),
  });

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{t('mentoring.new')}</DialogTitle>
          <DialogDescription>{t('mentoring.newHint')}</DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label>{t('mentoring.mentee')}</Label>
            <SearchableSelect
              value={mentee}
              placeholder={t('mentoring.pickMember')}
              onValueChange={setMentee}
              options={options.filter((o) => !taken.has(o.value) && o.value !== mentor)}
              aria-label={t('mentoring.mentee')}
            />
          </div>
          <div className="space-y-1.5">
            <Label>{t('mentoring.mentor')}</Label>
            <SearchableSelect
              value={mentor}
              placeholder={t('mentoring.pickMember')}
              onValueChange={setMentor}
              options={options.filter((o) => o.value !== mentee)}
              aria-label={t('mentoring.mentor')}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="ms-goal">{t('mentoring.goal')}</Label>
            <Textarea id="ms-goal" rows={2} value={goal} maxLength={1000} onChange={(e) => setGoal(e.target.value)} placeholder={t('mentoring.goalPlaceholder')} />
            <p className="text-[11px] text-zinc-500">{t('mentoring.goalHint')}</p>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="ms-due">{t('mentoring.dueDate')}</Label>
            <Input id="ms-due" type="date" className="w-44" value={due} onChange={(e) => setDue(e.target.value)} />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>{t('common.cancel')}</Button>
          <Button onClick={() => create.mutate()} disabled={!mentee || !mentor || create.isPending}>{t('mentoring.start')}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function LimitDialog({ factionId, current, onClose }: { factionId: string; current: number | null; onClose: () => void }) {
  const { t } = useTranslation();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [value, setValue] = useState(current ? String(current) : '');
  const n = value.trim() === '' ? null : Number(value);
  const valid = n === null || (Number.isInteger(n) && n >= 1 && n <= 100);

  const save = useMutation({
    mutationFn: () => mentoringApi.setLimit(factionId, n),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['mentoring', factionId] });
      void queryClient.invalidateQueries({ queryKey: ['mentoring-detail', factionId] });
      onClose();
    },
    onError: (err) => toast({ title: t('common.failed'), description: apiErrorMessage(err), variant: 'destructive' }),
  });

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>{t('mentoring.limitTitle')}</DialogTitle>
          <DialogDescription>{t('mentoring.limitHint')}</DialogDescription>
        </DialogHeader>
        <Input inputMode="numeric" value={value} onChange={(e) => setValue(e.target.value)} placeholder={t('mentoring.noLimit')} aria-label={t('mentoring.limitTitle')} />
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>{t('common.cancel')}</Button>
          <Button onClick={() => save.mutate()} disabled={!valid || save.isPending}>{t('common.save')}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
