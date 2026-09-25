'use client';

import { useMemo, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { complaintsApi, membersApi, apiErrorMessage } from '@/lib/api-client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { Textarea } from '@/components/ui/textarea';
import { EmptyState, ErrorState } from '@/components/ui/empty-state';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import {
  SearchableSelect, type SearchableSelectOption,
} from '@/components/ui/searchable-select';
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import { useToast } from '@/hooks/use-toast';
import { useTranslation } from '@/providers/i18n-provider';
import { formatDateTime, displayName } from '@/lib/format';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { MessageSquareWarning, Plus, ShieldOff, Trash2, UserX } from 'lucide-react';
import {
  COMPLAINT_CATEGORIES, COMPLAINT_CATEGORY_KEYS, COMPLAINT_STATUS_KEYS,
} from '@/lib/api-types';
import type { Complaint, ComplaintCategory, ComplaintStatus } from '@/lib/api-types';

interface Props {
  factionId: string;
  /** May read the whole queue and settle what is in it. */
  canHandle: boolean;
}

const STATUS_COLORS: Record<ComplaintStatus, string> = {
  open: 'border-amber-500/30 bg-amber-500/10 text-amber-400',
  in_review: 'border-blue-500/30 bg-blue-500/10 text-blue-300',
  resolved: 'border-emerald-500/30 bg-emerald-500/10 text-emerald-400',
  dismissed: 'border-zinc-600/40 bg-zinc-600/10 text-zinc-400',
  withdrawn: 'border-zinc-600/40 bg-zinc-600/10 text-zinc-500',
};

/**
 * What members raise with their own leadership.
 *
 * Two screens in one, decided by a single permission: without
 * `manage_complaints` it is "the things I have raised, and what came of them";
 * with it, it is a queue to work through.
 *
 * Nothing here is ever shown to the person a complaint is about — that is
 * enforced by the server, and the screen says so plainly when somebody files
 * one, because a person deciding whether to speak up needs to know that before
 * they type rather than after.
 */
export function ComplaintsView({ factionId, canHandle }: Props) {
  const { t } = useTranslation();
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const [composing, setComposing] = useState(false);
  const [statusFilter, setStatusFilter] = useState<'' | ComplaintStatus>('');
  const [reading, setReading] = useState<Complaint | null>(null);

  const query = useQuery({
    queryKey: ['complaints', factionId, statusFilter],
    queryFn: () => complaintsApi.list(factionId, {
      status: statusFilter || undefined,
    }),
  });

  const complaints = query.data?.complaints ?? [];

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold text-zinc-100">{t('complaints.title')}</h1>
          <p className="mt-1 max-w-2xl text-sm text-zinc-400">
            {canHandle ? t('complaints.subtitleHandler') : t('complaints.subtitleMember')}
          </p>
        </div>
        <Button onClick={() => setComposing(true)}>
          <Plus className="mr-2 h-4 w-4" />
          {t('complaints.raise')}
        </Button>
      </div>

      {canHandle && (query.data?.openCount ?? 0) > 0 && (
        <Card className="border-highlight" style={{ borderColor: 'var(--brand-color-light)' }}>
          <CardContent className="flex items-center gap-2 py-3">
            <MessageSquareWarning className="h-4 w-4 text-brand" />
            <span className="text-sm text-zinc-300">
              {t('complaints.openCount').replace('{count}', String(query.data!.openCount))}
            </span>
          </CardContent>
        </Card>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <div className="flex rounded-lg border border-[var(--line-2)] p-0.5" role="tablist" aria-label={t('common.status')}>
          {(['', 'open', 'in_review', 'resolved', 'dismissed'] as const).map((value) => (
            <button
              key={value || 'all'}
              role="tab"
              type="button"
              aria-selected={statusFilter === value}
              onClick={() => setStatusFilter(value)}
              className={`h-7 rounded-md px-3 text-xs font-medium transition-colors ${
                statusFilter === value ? 'bg-[var(--fill-4)] text-zinc-100' : 'text-zinc-500 hover:text-zinc-300'
              }`}
            >
              {value ? t(COMPLAINT_STATUS_KEYS[value]) : t('complaints.allStatuses')}
            </button>
          ))}
        </div>
      </div>

      {query.isLoading ? (
        <div className="space-y-2">
          {[...Array(3)].map((_, i) => <Skeleton key={i} className="h-20 w-full" />)}
        </div>
      ) : query.isError ? (
        <ErrorState error={query.error} onRetry={() => void query.refetch()} />
      ) : complaints.length === 0 ? (
        <EmptyState
          icon={MessageSquareWarning}
          title={t('complaints.empty')}
          hint={canHandle ? t('complaints.emptyHintHandler') : t('complaints.emptyHintMember')}
        />
      ) : (
        <div className="space-y-2">
          {complaints.map((complaint) => (
            <ComplaintRow key={complaint.id} complaint={complaint} onOpen={() => setReading(complaint)} />
          ))}
        </div>
      )}

      {composing && (
        <ComposeDialog
          factionId={factionId}
          onClose={() => setComposing(false)}
          onFiled={() => {
            void queryClient.invalidateQueries({ queryKey: ['complaints', factionId] });
            setComposing(false);
            toast({ title: t('complaints.filed') });
          }}
        />
      )}

      {reading && (
        <ReadDialog
          factionId={factionId}
          complaint={reading}
          canHandle={canHandle}
          onClose={() => setReading(null)}
          onChanged={() => {
            void queryClient.invalidateQueries({ queryKey: ['complaints', factionId] });
            setReading(null);
          }}
        />
      )}
    </div>
  );
}

function ComplaintRow({ complaint, onOpen }: { complaint: Complaint; onOpen: () => void }) {
  const { t } = useTranslation();

  return (
    <button
      type="button"
      onClick={onOpen}
      className="flex w-full flex-wrap items-center gap-3 rounded-lg border border-[var(--line-2)] bg-[var(--surface-1)] p-3 text-left transition-colors hover:bg-[var(--fill-1)]"
    >
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <span className="truncate text-sm text-zinc-100">{complaint.subject}</span>
          <Badge variant="outline" className="text-[10px]">
            {t(COMPLAINT_CATEGORY_KEYS[complaint.category])}
          </Badge>
          <Badge variant="outline" className={`text-[10px] ${STATUS_COLORS[complaint.status]}`}>
            {t(COMPLAINT_STATUS_KEYS[complaint.status])}
          </Badge>
        </div>
        <p className="mt-1 flex flex-wrap items-center gap-2 text-xs text-zinc-500">
          {/* About whom, which is the first thing anybody working the queue
              wants to know. */}
          {complaint.targetName ? (
            <span className="flex items-center gap-1">
              <UserX className="h-3 w-3" />
              {complaint.targetName}
            </span>
          ) : (
            <span>{t('complaints.aboutFaction')}</span>
          )}
          <span>·</span>
          <span>
            {complaint.isAnonymous
              ? t('complaints.anonymous')
              : t('complaints.byAuthor').replace('{name}', complaint.authorName ?? '—')}
          </span>
          <span>·</span>
          <span>{formatDateTime(complaint.createdAt)}</span>
        </p>
      </div>
    </button>
  );
}

/** Raising one. */
function ComposeDialog({
  factionId,
  onClose,
  onFiled,
}: {
  factionId: string;
  onClose: () => void;
  onFiled: () => void;
}) {
  const { t } = useTranslation();
  const { toast } = useToast();

  const [about, setAbout] = useState<'faction' | 'member'>('faction');
  const [targetUserId, setTargetUserId] = useState('');
  const [category, setCategory] = useState<ComplaintCategory>('other');
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');
  const [isAnonymous, setIsAnonymous] = useState(false);

  const members = useQuery({
    queryKey: ['members', factionId],
    queryFn: () => membersApi.list(factionId),
  });

  const memberOptions = useMemo<SearchableSelectOption[]>(
    () => (members.data ?? []).map((m) => ({
      value: m.userId,
      label: displayName({ username: m.username, inGameName: m.inGameName }),
    })),
    [members.data],
  );

  const file = useMutation({
    mutationFn: () => complaintsApi.create(factionId, {
      targetUserId: about === 'member' ? targetUserId : null,
      category,
      subject: subject.trim(),
      body: body.trim(),
      isAnonymous,
    }),
    onSuccess: onFiled,
    onError: (err) =>
      toast({ title: t('complaints.failed'), description: apiErrorMessage(err), variant: 'destructive' }),
  });

  const valid = subject.trim().length > 0
    && body.trim().length > 0
    && (about === 'faction' || !!targetUserId);

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{t('complaints.raise')}</DialogTitle>
          {/* Said before anybody types, not after. Somebody deciding whether
              to speak up needs to know who will read it. */}
          <DialogDescription>{t('complaints.privacyNote')}</DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <div className="space-y-1">
            <Label>{t('complaints.about')}</Label>
            <div className="flex rounded-lg border border-[var(--line-2)] p-0.5" role="tablist" aria-label={t('complaints.about')}>
              {(['faction', 'member'] as const).map((value) => (
                <button
                  key={value}
                  role="tab"
                  type="button"
                  aria-selected={about === value}
                  onClick={() => setAbout(value)}
                  className={`h-8 flex-1 rounded-md px-3 text-xs font-medium transition-colors ${
                    about === value ? 'bg-[var(--fill-4)] text-zinc-100' : 'text-zinc-500 hover:text-zinc-300'
                  }`}
                >
                  {t(value === 'faction' ? 'complaints.aboutFaction' : 'complaints.aboutMember')}
                </button>
              ))}
            </div>
          </div>

          {about === 'member' && (
            <div className="space-y-1">
              <Label>{t('complaints.whichMember')}</Label>
              <SearchableSelect
                value={targetUserId}
                onValueChange={setTargetUserId}
                options={memberOptions}
                placeholder={t('complaints.chooseMember')}
              />
            </div>
          )}

          <div className="space-y-1">
            <Label>{t('complaints.category')}</Label>
            <SearchableSelect
              value={category}
              onValueChange={(value) => setCategory(value as ComplaintCategory)}
              options={COMPLAINT_CATEGORIES.map((c) => ({
                value: c,
                label: t(COMPLAINT_CATEGORY_KEYS[c]),
              }))}
            />
          </div>

          <div className="space-y-1">
            <Label htmlFor="complaint-subject">{t('complaints.subject')}</Label>
            <Input
              id="complaint-subject"
              value={subject}
              maxLength={140}
              onChange={(e) => setSubject(e.target.value)}
              placeholder={t('complaints.subjectPlaceholder')}
            />
          </div>

          <div className="space-y-1">
            <Label htmlFor="complaint-body">{t('complaints.body')}</Label>
            <Textarea
              id="complaint-body"
              rows={6}
              value={body}
              maxLength={4000}
              onChange={(e) => setBody(e.target.value)}
              placeholder={t('complaints.bodyPlaceholder')}
            />
          </div>

          <label className="flex cursor-pointer items-start gap-2 rounded-lg border border-[var(--line-1)] p-3">
            <input
              type="checkbox"
              className="mt-0.5"
              checked={isAnonymous}
              onChange={(e) => setIsAnonymous(e.target.checked)}
            />
            <span>
              <span className="flex items-center gap-1.5 text-sm text-zinc-200">
                <ShieldOff className="h-3.5 w-3.5" />
                {t('complaints.fileAnonymously')}
              </span>
              {/* The trade is real and it is stated: no name is kept, which
                  also means there is no name to match you to it later. */}
              <span className="mt-0.5 block text-xs text-zinc-500">{t('complaints.anonymousHint')}</span>
            </span>
          </label>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>{t('common.cancel')}</Button>
          <Button onClick={() => file.mutate()} disabled={!valid || file.isPending}>
            {t('complaints.send')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** Reading one, and settling it if you may. */
function ReadDialog({
  factionId,
  complaint,
  canHandle,
  onClose,
  onChanged,
}: {
  factionId: string;
  complaint: Complaint;
  canHandle: boolean;
  onClose: () => void;
  onChanged: () => void;
}) {
  const { t } = useTranslation();
  const { toast } = useToast();
  const [note, setNote] = useState(complaint.resolutionNote ?? '');
  const [confirmDelete, setConfirmDelete] = useState(false);

  const remove = useMutation({
    mutationFn: () => complaintsApi.remove(factionId, complaint.id),
    onSuccess: () => {
      toast({ title: t('complaints.deleted') });
      onChanged();
    },
    onError: (err) =>
      toast({ title: t('complaints.failed'), description: apiErrorMessage(err), variant: 'destructive' }),
  });

  const settle = useMutation({
    mutationFn: (status: ComplaintStatus) =>
      complaintsApi.update(factionId, complaint.id, {
        status,
        ...(canHandle ? { resolutionNote: note.trim() || null } : {}),
      }),
    onSuccess: () => {
      toast({ title: t('complaints.updated') });
      onChanged();
    },
    onError: (err) =>
      toast({ title: t('complaints.failed'), description: apiErrorMessage(err), variant: 'destructive' }),
  });

  const settled = complaint.status === 'resolved' || complaint.status === 'dismissed';
  // Only the author can withdraw, and an anonymous complaint has no author to
  // be — the screen offers what the server will actually accept.
  const canWithdraw = !canHandle && !complaint.isAnonymous && !settled
    && complaint.status !== 'withdrawn';

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{complaint.subject}</DialogTitle>
          <DialogDescription>
            {complaint.targetName
              ? t('complaints.aboutName').replace('{name}', complaint.targetName)
              : t('complaints.aboutFaction')}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant="outline" className="text-[10px]">
              {t(COMPLAINT_CATEGORY_KEYS[complaint.category])}
            </Badge>
            <Badge variant="outline" className={`text-[10px] ${STATUS_COLORS[complaint.status]}`}>
              {t(COMPLAINT_STATUS_KEYS[complaint.status])}
            </Badge>
            <span className="text-xs text-zinc-500">{formatDateTime(complaint.createdAt)}</span>
          </div>

          <p className="max-h-[40vh] overflow-y-auto whitespace-pre-wrap break-words text-sm leading-relaxed text-zinc-200">
            {complaint.body}
          </p>

          <div className="flex items-center gap-2 border-t border-[var(--line-1)] pt-3">
            {complaint.isAnonymous ? (
              <span className="flex items-center gap-1.5 text-xs text-zinc-500">
                <ShieldOff className="h-3.5 w-3.5" />
                {t('complaints.anonymous')}
              </span>
            ) : (
              <>
                <Avatar className="h-6 w-6">
                  <AvatarImage src={complaint.authorAvatarUrl ?? undefined} alt="" />
                  <AvatarFallback className="text-[8px]">
                    {(complaint.authorName ?? '?').slice(0, 2).toUpperCase()}
                  </AvatarFallback>
                </Avatar>
                <span className="text-xs text-zinc-400">
                  {t('complaints.byAuthor').replace('{name}', complaint.authorName ?? '—')}
                </span>
              </>
            )}
          </div>

          {/* The answer, which the author reads. A complaint that closes in
              silence teaches people not to file the next one. */}
          {canHandle ? (
            <div className="space-y-1">
              <Label htmlFor="complaint-note">{t('complaints.resolutionNote')}</Label>
              <Textarea
                id="complaint-note"
                rows={3}
                value={note}
                onChange={(e) => setNote(e.target.value)}
                placeholder={t('complaints.resolutionPlaceholder')}
              />
            </div>
          ) : complaint.resolutionNote ? (
            <div className="rounded-lg border border-[var(--line-1)] p-3">
              <p className="text-xs uppercase tracking-wide text-zinc-500">
                {t('complaints.answer')}
                {complaint.handlerName ? ` · ${complaint.handlerName}` : ''}
              </p>
              <p className="mt-1 whitespace-pre-wrap text-sm text-zinc-200">{complaint.resolutionNote}</p>
            </div>
          ) : null}
        </div>

        <DialogFooter className="flex-wrap gap-2">
          <Button variant="outline" onClick={onClose}>{t('common.close')}</Button>
          {canWithdraw && (
            <Button variant="outline" onClick={() => settle.mutate('withdrawn')} disabled={settle.isPending}>
              {t('complaints.withdraw')}
            </Button>
          )}
          {canHandle && (
            <>
              {/* Set apart on the left and plainly red: dismissing keeps it on
                  file, this does not, and the two should never be mistaken
                  for each other. */}
              <Button
                variant="ghost"
                onClick={() => setConfirmDelete(true)}
                disabled={remove.isPending}
                className="mr-auto text-red-400 hover:bg-red-950/40 hover:text-red-300"
              >
                <Trash2 className="mr-2 h-4 w-4" />
                {t('complaints.delete')}
              </Button>
              {complaint.status === 'open' && (
                <Button variant="outline" onClick={() => settle.mutate('in_review')} disabled={settle.isPending}>
                  {t('complaints.markInReview')}
                </Button>
              )}
              <Button
                variant="outline"
                onClick={() => settle.mutate('dismissed')}
                disabled={settle.isPending}
              >
                {t('complaints.dismiss')}
              </Button>
              <Button onClick={() => settle.mutate('resolved')} disabled={settle.isPending}>
                {t('complaints.resolve')}
              </Button>
            </>
          )}
        </DialogFooter>

        <AlertDialog open={confirmDelete} onOpenChange={setConfirmDelete}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>{t('complaints.deleteTitle')}</AlertDialogTitle>
              <AlertDialogDescription>{t('complaints.deleteBody')}</AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>{t('common.cancel')}</AlertDialogCancel>
              <AlertDialogAction
                onClick={() => remove.mutate()}
                disabled={remove.isPending}
                className="bg-red-600 text-white hover:bg-red-500"
              >
                {t('complaints.delete')}
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </DialogContent>
    </Dialog>
  );
}
