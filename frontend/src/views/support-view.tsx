'use client';

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supportApi, apiErrorMessage } from '@/lib/api-client';
import { useAppStore } from '@/lib/store';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { EmptyState, ErrorState, ListSkeleton } from '@/components/ui/empty-state';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Bug, Lightbulb, LifeBuoy, Send, Undo2 } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { useTranslation } from '@/providers/i18n-provider';
import { formatDateTime } from '@/lib/format';
import type { SupportTicket, SupportTicketKind } from '@/lib/api-types';
import { STATUS_STYLES, STATUS_LABELS } from '@/lib/support-status';

const SUBJECT_MAX = 120;
const MESSAGE_MAX = 4000;
const MESSAGE_MIN = 10;

/**
 * Send a bug report or a feature request, and see what happened to the ones
 * you already sent.
 *
 * The two halves sit on one page on purpose. A form on its own is a void: a
 * reporter who cannot see that their last three reports were read has no
 * reason to believe this one will be either, and files the same bug again.
 */
export function SupportView() {
  const { t } = useTranslation();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const selectedFactionId = useAppStore((s) => s.selectedFactionId);
  const brandColor = useAppStore((s) => s.brandColor);

  const [kind, setKind] = useState<SupportTicketKind>('bug');
  const [subject, setSubject] = useState('');
  const [message, setMessage] = useState('');
  const [cancelTarget, setCancelTarget] = useState<SupportTicket | null>(null);

  const { data: tickets = [], isLoading, isError, error, refetch } = useQuery({
    queryKey: ['support-mine'],
    queryFn: () => supportApi.listMine(),
    staleTime: 0,
  });

  const createMutation = useMutation({
    mutationFn: () =>
      supportApi.create({
        kind,
        subject: subject.trim(),
        message: message.trim(),
        // Context for whoever reads it, not authorisation — the API treats an
        // unknown id as no id rather than refusing the ticket.
        ...(selectedFactionId ? { factionId: selectedFactionId } : {}),
      }),
    onSuccess: () => {
      toast({ title: t('support.sent'), description: t('support.sentHint') });
      setSubject('');
      setMessage('');
      queryClient.invalidateQueries({ queryKey: ['support-mine'] });
      queryClient.invalidateQueries({ queryKey: ['support-open-count'] });
    },
    onError: (err: unknown) => {
      toast({ title: t('common.failed'), description: apiErrorMessage(err), variant: 'destructive' });
    },
  });

  const cancelMutation = useMutation({
    mutationFn: (ticketId: string) => supportApi.update(ticketId, { status: 'cancelled' }),
    onSuccess: () => {
      toast({ title: t('support.cancelled') });
      setCancelTarget(null);
      queryClient.invalidateQueries({ queryKey: ['support-mine'] });
      queryClient.invalidateQueries({ queryKey: ['support-open-count'] });
    },
    onError: (err: unknown) => {
      toast({ title: t('common.failed'), description: apiErrorMessage(err), variant: 'destructive' });
    },
  });

  const trimmedSubject = subject.trim();
  const trimmedMessage = message.trim();
  const canSubmit =
    trimmedSubject.length >= 3 &&
    trimmedMessage.length >= MESSAGE_MIN &&
    !createMutation.isPending;

  const kindOptions: { value: SupportTicketKind; label: string; hint: string; icon: typeof Bug }[] = [
    { value: 'bug', label: t('support.kindBug'), hint: t('support.kindBugHint'), icon: Bug },
    { value: 'feature', label: t('support.kindFeature'), hint: t('support.kindFeatureHint'), icon: Lightbulb },
  ];

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-medium tracking-tight text-zinc-100">{t('nav.support')}</h2>
        <p className="text-zinc-500 text-sm mt-0.5">{t('support.intro')}</p>
      </div>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-sm text-zinc-200">
            <LifeBuoy className="h-4 w-4 text-zinc-400" />
            {t('support.newTicket')}
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* Two cards rather than a dropdown: there are exactly two kinds, and
              which one you pick changes what the maintainer needs from you, so
              the choice carries a line of guidance with it. */}
          <div className="grid gap-2 sm:grid-cols-2">
            {kindOptions.map((opt) => {
              const Icon = opt.icon;
              const active = kind === opt.value;
              return (
                <button
                  key={opt.value}
                  type="button"
                  aria-pressed={active}
                  onClick={() => setKind(opt.value)}
                  className={`flex items-start gap-3 rounded-lg border p-3 text-left transition-colors ${
                    active
                      ? 'border-primary bg-primary/10'
                      : 'border-white/[0.08] hover:border-white/[0.2]'
                  }`}
                >
                  <Icon className={`h-4 w-4 mt-0.5 shrink-0 ${active ? 'text-primary' : 'text-zinc-400'}`} />
                  <span className="min-w-0">
                    <span className={`block text-sm ${active ? 'text-zinc-100' : 'text-zinc-300'}`}>{opt.label}</span>
                    <span className="block text-[11px] text-zinc-500 mt-0.5">{opt.hint}</span>
                  </span>
                </button>
              );
            })}
          </div>

          <div className="space-y-1.5">
            <Label className="text-xs text-zinc-500">{t('support.subject')}</Label>
            <Input
              value={subject}
              maxLength={SUBJECT_MAX}
              onChange={(e) => setSubject(e.target.value)}
              placeholder={kind === 'bug' ? t('support.subjectPlaceholderBug') : t('support.subjectPlaceholderFeature')}
            />
          </div>

          <div className="space-y-1.5">
            <div className="flex items-baseline justify-between">
              <Label className="text-xs text-zinc-500">{t('support.message')}</Label>
              <span className="text-[10px] tabular-nums text-zinc-600">
                {trimmedMessage.length}/{MESSAGE_MAX}
              </span>
            </div>
            <Textarea
              value={message}
              maxLength={MESSAGE_MAX}
              rows={6}
              onChange={(e) => setMessage(e.target.value)}
              placeholder={kind === 'bug' ? t('support.messagePlaceholderBug') : t('support.messagePlaceholderFeature')}
            />
            <p className="text-[11px] text-zinc-600">
              {kind === 'bug' ? t('support.messageHintBug') : t('support.messageHintFeature')}
            </p>
          </div>

          <div className="flex justify-end">
            <Button
              disabled={!canSubmit}
              onClick={() => createMutation.mutate()}
              style={canSubmit ? { backgroundColor: brandColor } : undefined}
            >
              <Send className="h-4 w-4 mr-1.5" />
              {createMutation.isPending ? t('common.saving') : t('support.send')}
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card className="py-0 gap-0">
        <CardHeader className="py-4">
          <CardTitle className="text-sm text-zinc-200">{t('support.myTickets')}</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {isLoading ? (
            <ListSkeleton rows={3} />
          ) : isError ? (
            <ErrorState error={error} onRetry={() => refetch()} />
          ) : tickets.length === 0 ? (
            <EmptyState icon={LifeBuoy} title={t('support.noneYet')} hint={t('support.noneYetHint')} />
          ) : (
            <div className="divide-y divide-white/[0.04]">
              {tickets.map((ticket) => (
                <article key={ticket.id} className="p-4 space-y-2">
                  <div className="flex flex-wrap items-center gap-2">
                    {ticket.kind === 'bug' ? (
                      <Bug className="h-3.5 w-3.5 shrink-0 text-zinc-500" aria-hidden="true" />
                    ) : (
                      <Lightbulb className="h-3.5 w-3.5 shrink-0 text-zinc-500" aria-hidden="true" />
                    )}
                    <h3 className="text-sm text-zinc-200 min-w-0 break-words">{ticket.subject}</h3>
                    <Badge variant="outline" className={`text-[10px] border ${STATUS_STYLES[ticket.status]}`}>
                      {t(STATUS_LABELS[ticket.status])}
                    </Badge>
                    <span className="text-[11px] text-zinc-600 ml-auto tabular-nums">
                      {formatDateTime(ticket.createdAt)}
                    </span>
                  </div>

                  <p className="text-xs text-zinc-500 whitespace-pre-wrap break-words">{ticket.message}</p>

                  {/* The answer, where there is one. This is why the status is
                      worth showing at all. */}
                  {ticket.resolutionNote && (
                    <div className="rounded-md border border-white/[0.06] bg-white/[0.02] p-2.5">
                      <p className="text-[10px] uppercase tracking-wider text-zinc-600 mb-1">
                        {t('support.replyFromMaintainer')}
                      </p>
                      <p className="text-xs text-zinc-300 whitespace-pre-wrap break-words">{ticket.resolutionNote}</p>
                    </div>
                  )}

                  {ticket.status === 'open' && (
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-7 px-2 text-xs text-zinc-400 hover:text-zinc-200"
                      onClick={() => setCancelTarget(ticket)}
                    >
                      <Undo2 className="h-3.5 w-3.5 mr-1" />
                      {t('support.cancel')}
                    </Button>
                  )}
                </article>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <AlertDialog open={!!cancelTarget} onOpenChange={(open) => { if (!open) setCancelTarget(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t('support.cancelTitle')}</AlertDialogTitle>
            <AlertDialogDescription>{t('support.cancelConfirm')}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t('common.cancel')}</AlertDialogCancel>
            <AlertDialogAction
              disabled={cancelMutation.isPending}
              onClick={() => { if (cancelTarget) cancelMutation.mutate(cancelTarget.id); }}
            >
              {cancelMutation.isPending ? t('common.saving') : t('support.cancel')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
