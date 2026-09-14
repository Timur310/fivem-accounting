'use client';

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supportApi, apiErrorMessage } from '@/lib/api-client';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { EmptyState, ErrorState, ListSkeleton } from '@/components/ui/empty-state';
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Bug, Lightbulb, LifeBuoy, Check, X, Trash2, ChevronLeft, ChevronRight } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { useTranslation } from '@/providers/i18n-provider';
import { formatDateTime, fullDisplayName } from '@/lib/format';
import type { SupportTicketAdminRow, SupportTicketKind, SupportTicketStatus } from '@/lib/api-types';
import { STATUS_STYLES, STATUS_LABELS } from '@/lib/support-status';

const PAGE_SIZE = 20;

type Closing = { ticket: SupportTicketAdminRow; status: 'resolved' | 'declined' };

/**
 * The maintainer's inbox. Superadmin only — reading it crosses every faction
 * boundary the rest of the app enforces.
 *
 * The list is a reading surface first: a ticket is prose someone wrote, so the
 * message is shown in full rather than truncated into a table cell that would
 * have to be clicked to be useful.
 */
export function AdminSupportView() {
  const { t } = useTranslation();
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const [statusFilter, setStatusFilter] = useState<SupportTicketStatus | 'all'>('open');
  const [kindFilter, setKindFilter] = useState<SupportTicketKind | 'all'>('all');
  const [page, setPage] = useState(1);

  const [closing, setClosing] = useState<Closing | null>(null);
  const [note, setNote] = useState('');
  const [deleteTarget, setDeleteTarget] = useState<SupportTicketAdminRow | null>(null);

  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: ['support-admin', statusFilter, kindFilter, page],
    queryFn: () =>
      supportApi.list({
        ...(statusFilter === 'all' ? {} : { status: statusFilter }),
        ...(kindFilter === 'all' ? {} : { kind: kindFilter }),
        page,
        page_size: PAGE_SIZE,
      }),
    staleTime: 0,
  });

  const tickets = data?.data ?? [];
  const totalCount = data?.meta?.total_count ?? 0;
  const totalPages = Math.max(1, Math.ceil(totalCount / PAGE_SIZE));

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ['support-admin'] });
    queryClient.invalidateQueries({ queryKey: ['support-open-count'] });
    queryClient.invalidateQueries({ queryKey: ['support-mine'] });
  };

  const closeMutation = useMutation({
    mutationFn: ({ ticket, status }: Closing) =>
      supportApi.update(ticket.id, { status, ...(note.trim() ? { resolutionNote: note.trim() } : {}) }),
    onSuccess: (_row, vars) => {
      toast({ title: vars.status === 'resolved' ? t('support.markedResolved') : t('support.markedDeclined') });
      setClosing(null);
      setNote('');
      invalidate();
    },
    onError: (err: unknown) => {
      toast({ title: t('common.failed'), description: apiErrorMessage(err), variant: 'destructive' });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (ticketId: string) => supportApi.remove(ticketId),
    onSuccess: () => {
      toast({ title: t('support.deleted') });
      setDeleteTarget(null);
      invalidate();
    },
    onError: (err: unknown) => {
      toast({ title: t('common.failed'), description: apiErrorMessage(err), variant: 'destructive' });
    },
  });

  const statusTabs: { value: SupportTicketStatus | 'all'; label: string }[] = [
    { value: 'open', label: t('support.statusOpen') },
    { value: 'resolved', label: t('support.statusResolved') },
    { value: 'declined', label: t('support.statusDeclined') },
    { value: 'cancelled', label: t('support.statusCancelled') },
    { value: 'all', label: t('support.filterAll') },
  ];

  const kindTabs: { value: SupportTicketKind | 'all'; label: string }[] = [
    { value: 'all', label: t('support.filterAll') },
    { value: 'bug', label: t('support.kindBug') },
    { value: 'feature', label: t('support.kindFeature') },
  ];

  const openClose = (ticket: SupportTicketAdminRow, status: 'resolved' | 'declined') => {
    setNote('');
    setClosing({ ticket, status });
  };

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-medium tracking-tight text-zinc-100">{t('nav.supportInbox')}</h2>
        <p className="text-zinc-500 text-sm mt-0.5">{t('support.inboxIntro')}</p>
      </div>

      <Card>
        <CardContent className="py-3 space-y-2">
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="text-meta uppercase tracking-wider text-zinc-600 mr-1">{t('common.status')}</span>
            {statusTabs.map((tab) => (
              <button
                key={tab.value}
                type="button"
                aria-pressed={statusFilter === tab.value}
                onClick={() => { setStatusFilter(tab.value); setPage(1); }}
                className={`h-7 rounded-md border px-2.5 text-xs transition-colors ${
                  statusFilter === tab.value
                    ? 'border-primary text-primary bg-primary/10'
                    : 'border-[var(--line-2)] text-zinc-400 hover:text-zinc-200'
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="text-meta uppercase tracking-wider text-zinc-600 mr-1">{t('support.kind')}</span>
            {kindTabs.map((tab) => (
              <button
                key={tab.value}
                type="button"
                aria-pressed={kindFilter === tab.value}
                onClick={() => { setKindFilter(tab.value); setPage(1); }}
                className={`h-7 rounded-md border px-2.5 text-xs transition-colors ${
                  kindFilter === tab.value
                    ? 'border-primary text-primary bg-primary/10'
                    : 'border-[var(--line-2)] text-zinc-400 hover:text-zinc-200'
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>
        </CardContent>
      </Card>

      <Card className="py-0 gap-0">
        <CardContent className="p-0">
          {isLoading ? (
            <ListSkeleton rows={4} height="h-20" />
          ) : isError ? (
            <ErrorState error={error} onRetry={() => refetch()} />
          ) : tickets.length === 0 ? (
            <EmptyState icon={LifeBuoy} title={t('support.inboxEmpty')}
              hint={t('support.inboxEmptyHint')} />
          ) : (
            <div className="divide-y divide-[var(--line-1)]">
              {tickets.map((ticket) => (
                <article key={ticket.id} className="p-4 space-y-2.5">
                  <div className="flex flex-wrap items-center gap-2">
                    {ticket.kind === 'bug' ? (
                      <Bug className="h-3.5 w-3.5 shrink-0 text-zinc-500" aria-hidden="true" />
                    ) : (
                      <Lightbulb className="h-3.5 w-3.5 shrink-0 text-zinc-500" aria-hidden="true" />
                    )}
                    <h3 className="text-sm text-zinc-200 min-w-0 break-words">{ticket.subject}</h3>
                    <Badge variant="outline" className={`text-micro border ${STATUS_STYLES[ticket.status]}`}>
                      {t(STATUS_LABELS[ticket.status])}
                    </Badge>
                  </div>

                  <div className="flex flex-wrap items-center gap-2 text-meta text-zinc-600">
                    <Avatar className="h-5 w-5">
                      <AvatarImage src={ticket.reporterAvatarUrl ?? undefined} />
                      <AvatarFallback className="text-[8px]">
                        {ticket.reporterUsername.slice(0, 2).toUpperCase()}
                      </AvatarFallback>
                    </Avatar>
                    <span className="text-zinc-400">
                      {fullDisplayName({ username: ticket.reporterUsername, inGameName: ticket.reporterInGameName })}
                    </span>
                    {/* Null once the faction is gone — the ticket outlives it. */}
                    {ticket.factionName && <span>· {ticket.factionName}</span>}
                    <span className="tabular-nums">· {formatDateTime(ticket.createdAt)}</span>
                  </div>

                  <p className="text-xs text-zinc-400 whitespace-pre-wrap break-words">{ticket.message}</p>

                  {ticket.resolutionNote && (
                    <div className="rounded-md border border-[var(--line-1)] bg-[var(--fill-1)] p-2.5">
                      <p className="text-micro uppercase tracking-wider text-zinc-600 mb-1">
                        {t('support.yourReply')}
                      </p>
                      <p className="text-xs text-zinc-300 whitespace-pre-wrap break-words">{ticket.resolutionNote}</p>
                    </div>
                  )}

                  <div className="flex flex-wrap items-center gap-1.5">
                    {/* Only an open ticket is still a decision. A cancelled one
                        was withdrawn by its reporter and is not yours to
                        answer. */}
                    {ticket.status === 'open' && (
                      <>
                        <Button
                          variant="outline"
                          size="xs" className="text-emerald-300 hover:text-emerald-200"
                          onClick={() => openClose(ticket, 'resolved')}
                        >
                          <Check className="h-3.5 w-3.5 mr-1" />
                          {t('support.resolve')}
                        </Button>
                        <Button
                          variant="outline"
                          size="xs" className="text-red-300 hover:text-red-200"
                          onClick={() => openClose(ticket, 'declined')}
                        >
                          <X className="h-3.5 w-3.5 mr-1" />
                          {t('support.decline')}
                        </Button>
                      </>
                    )}
                    <Button
                      variant="ghost"
                      size="xs" className="text-zinc-500 hover:text-red-300 ml-auto"
                      onClick={() => setDeleteTarget(ticket)}
                    >
                      <Trash2 className="h-3.5 w-3.5 mr-1" />
                      {t('common.delete')}
                    </Button>
                  </div>
                </article>
              ))}
            </div>
          )}

          {totalPages > 1 && (
            <div className="flex items-center justify-between border-t border-[var(--line-1)] px-4 py-3">
              <span className="text-meta text-zinc-600 tabular-nums">
                {t('common.pageOf', { page, pages: totalPages })}
              </span>
              <div className="flex gap-1">
                <Button
                  variant="outline" size="xs" className="w-7 p-0"
                  disabled={page <= 1}
                  onClick={() => setPage((p) => Math.max(1, p - 1))}
                >
                  <ChevronLeft className="h-3.5 w-3.5" />
                </Button>
                <Button
                  variant="outline" size="xs" className="w-7 p-0"
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

      <Dialog open={!!closing} onOpenChange={(open) => { if (!open) { setClosing(null); setNote(''); } }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {closing?.status === 'resolved' ? t('support.resolveTitle') : t('support.declineTitle')}
            </DialogTitle>
            <DialogDescription>
              {closing?.status === 'resolved' ? t('support.resolveHint') : t('support.declineHint')}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-1.5">
            <Label className="text-xs text-zinc-500">{t('support.noteOptional')}</Label>
            <Textarea
              value={note}
              maxLength={2000}
              rows={4}
              onChange={(e) => setNote(e.target.value)}
              placeholder={t('support.notePlaceholder')}
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => { setClosing(null); setNote(''); }}>
              {t('common.cancel')}
            </Button>
            <Button
              disabled={closeMutation.isPending}
              onClick={() => { if (closing) closeMutation.mutate(closing); }}
            >
              {closeMutation.isPending
                ? t('common.saving')
                : closing?.status === 'resolved' ? t('support.resolve') : t('support.decline')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={!!deleteTarget} onOpenChange={(open) => { if (!open) setDeleteTarget(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t('support.deleteTitle')}</AlertDialogTitle>
            <AlertDialogDescription>{t('support.deleteConfirm')}</AlertDialogDescription>
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
