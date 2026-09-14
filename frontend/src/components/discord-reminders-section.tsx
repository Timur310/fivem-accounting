'use client';

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { discordRemindersApi, discordApi, membersApi, apiErrorMessage } from '@/lib/api-client';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Switch } from '@/components/ui/switch';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { SearchableSelect, type SearchableSelectOption } from '@/components/ui/searchable-select';
import {
  Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { EmptyState, ErrorState } from '@/components/ui/empty-state';
import { useToast } from '@/hooks/use-toast';
import { useTranslation } from '@/providers/i18n-provider';
import {
  REMINDER_SCHEDULE_TYPES,
  REMINDER_SCHEDULE_LABEL_KEYS,
  type DiscordChannel,
  type DiscordReminder,
  type ReminderInput,
  type ReminderScheduleType,
} from '@/lib/api-types';
import type { TranslationKey } from '@/lib/i18n';
import { AlarmClock, Plus, Pencil, Trash2, Send, AlertTriangle, AtSign } from 'lucide-react';
import { displayName } from '@/lib/format';

interface Props {
  factionId: string;
  /** Null while the channel list is still loading or could not be read. */
  channels: DiscordChannel[] | undefined;
}

/**
 * Matches MAX_REMINDERS on the server, which is the one that actually refuses.
 * Shown so the limit is known before somebody hits it, rather than discovered
 * as a validation error on the fiftieth one.
 */
const MAX_REMINDERS = 50;

/** A blank form. Daily at 20:00 is the shape most of these take. */
function emptyDraft(): ReminderInput {
  return {
    channelId: '',
    title: '',
    message: '',
    scheduleType: 'daily',
    timeOfDay: '20:00',
    weekdays: [],
    mentionRoleIds: [],
    mentionUserIds: [],
    isEnabled: true,
  };
}

function draftFrom(reminder: DiscordReminder): ReminderInput {
  return {
    channelId: reminder.channelId,
    channelName: reminder.channelName ?? undefined,
    title: reminder.title ?? '',
    message: reminder.message,
    scheduleType: reminder.scheduleType,
    timeOfDay: reminder.timeOfDay ?? '20:00',
    weekdays: reminder.weekdays ?? [],
    dayOfMonth: reminder.dayOfMonth ?? undefined,
    // The input wants `YYYY-MM-DDTHH:MM` in local time; the API speaks ISO.
    runAt: reminder.runAt ?? undefined,
    mentionRoleIds: reminder.mentionRoleIds ?? [],
    mentionUserIds: reminder.mentionUserIds ?? [],
    isEnabled: reminder.isEnabled,
  };
}

/** An ISO instant as the value a `datetime-local` input expects. */
function toLocalInput(iso: string | undefined): string {
  if (!iso) return '';
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function DiscordRemindersSection({ factionId, channels }: Props) {
  const { t, locale } = useTranslation();
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const [editing, setEditing] = useState<DiscordReminder | null>(null);
  const [draft, setDraft] = useState<ReminderInput | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<DiscordReminder | null>(null);

  const { data: reminders, isLoading, error } = useQuery({
    queryKey: ['discord-reminders', factionId],
    queryFn: () => discordRemindersApi.list(factionId),
  });

  // Both only matter while the form is open, so neither is fetched until then.
  const { data: roles } = useQuery({
    queryKey: ['discord-roles', factionId],
    queryFn: () => discordApi.roles(factionId),
    enabled: !!draft,
    retry: false,
  });

  // People come from this app's roster rather than from Discord: listing a
  // guild's members needs a privileged intent, and every member here already
  // carries the Discord id the ping resolves to.
  const { data: members } = useQuery({
    queryKey: ['members', factionId],
    queryFn: () => membersApi.list(factionId),
    enabled: !!draft,
  });

  const invalidate = () =>
    queryClient.invalidateQueries({ queryKey: ['discord-reminders', factionId] });

  const save = useMutation({
    mutationFn: (input: ReminderInput) =>
      editing
        ? discordRemindersApi.update(factionId, editing.id, input)
        : discordRemindersApi.create(factionId, input),
    onSuccess: () => {
      setDraft(null);
      setEditing(null);
      invalidate();
      toast({ title: t('reminder.saved') });
    },
    onError: (e) =>
      toast({ title: t('reminder.saveFailed'), description: apiErrorMessage(e), variant: 'destructive' }),
  });

  const remove = useMutation({
    mutationFn: (id: string) => discordRemindersApi.remove(factionId, id),
    onSuccess: () => {
      setConfirmDelete(null);
      invalidate();
      toast({ title: t('reminder.removed') });
    },
    onError: (e) => toast({ title: apiErrorMessage(e), variant: 'destructive' }),
  });

  const sendNow = useMutation({
    mutationFn: (id: string) => discordRemindersApi.sendNow(factionId, id),
    onSuccess: (result) => {
      invalidate();
      if (result.ok) toast({ title: t('reminder.sentNow') });
      else toast({ title: t('reminder.sendFailed', { error: result.error ?? '' }), variant: 'destructive' });
    },
    onError: (e) => toast({ title: apiErrorMessage(e), variant: 'destructive' }),
  });

  const openNew = () => {
    setEditing(null);
    setDraft(emptyDraft());
  };

  const openEdit = (reminder: DiscordReminder) => {
    setEditing(reminder);
    setDraft(draftFrom(reminder));
  };

  const channelOptions: SearchableSelectOption[] = (channels ?? []).map((c) => ({
    value: c.id,
    label: `#${c.name}`,
    hint: c.parentName ?? undefined,
  }));

  const describeSchedule = (r: DiscordReminder): string => {
    const type = t(REMINDER_SCHEDULE_LABEL_KEYS[r.scheduleType]);
    if (r.scheduleType === 'once') {
      return r.runAt ? `${type} · ${new Date(r.runAt).toLocaleString(locale)}` : type;
    }
    if (r.scheduleType === 'weekly') {
      const days = (r.weekdays ?? [])
        .slice()
        .sort((a, b) => a - b)
        .map((d) => t(`reminder.weekday.${d}` as TranslationKey))
        .join(', ');
      return `${days} · ${r.timeOfDay}`;
    }
    if (r.scheduleType === 'monthly') return `${type} ${r.dayOfMonth}. · ${r.timeOfDay}`;
    return `${type} · ${r.timeOfDay}`;
  };

  if (isLoading) return <Skeleton className="h-40 w-full" />;
  if (error) return <ErrorState error={error} />;

  const patchDraft = (patch: Partial<ReminderInput>) =>
    setDraft((d) => (d ? { ...d, ...patch } : d));

  return (
    <Card>
      <CardHeader className="flex flex-row items-start justify-between gap-3">
        <div>
          <CardTitle className="flex items-center gap-2">
            <AlarmClock className="h-5 w-5" />
            {t('reminder.title')}
          </CardTitle>
          <p className="text-sm text-muted-foreground">
            {t('reminder.subtitle', { max: MAX_REMINDERS })}
          </p>
        </div>
        <Button onClick={openNew} disabled={!channels?.length}>
          <Plus className="mr-2 h-4 w-4" />
          {t('reminder.new')}
        </Button>
      </CardHeader>

      <CardContent className="space-y-2">
        {!reminders?.length ? (
          <EmptyState icon={AlarmClock} title={t('reminder.none')} hint={t('reminder.noneHint')} />
        ) : (
          reminders.map((r) => (
            <div key={r.id} className="space-y-2 rounded-md border p-3">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div className="min-w-0 space-y-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-sm font-medium">{r.title || r.message.slice(0, 60)}</span>
                    <Badge variant="secondary">#{r.channelName ?? r.channelId}</Badge>
                    {/* Off is a state worth seeing at a glance: a paused
                        reminder looks identical to a live one otherwise. */}
                    {!r.isEnabled && <Badge variant="outline">{t('discord.off')}</Badge>}
                  </div>
                  <p className="text-xs text-muted-foreground">{describeSchedule(r)}</p>
                  {/* Whether a reminder pings people is the thing most worth
                      knowing about it at a glance. */}
                  {!!(r.mentionRoleIds?.length || r.mentionUserIds?.length) && (
                    <p className="flex items-center gap-1 text-xs text-muted-foreground">
                      <AtSign className="h-3 w-3" />
                      {t('reminder.tagCount', {
                        count: (r.mentionRoleIds?.length ?? 0) + (r.mentionUserIds?.length ?? 0),
                      })}
                    </p>
                  )}
                  <p className="text-xs text-muted-foreground">
                    {r.nextRunAt
                      ? t('reminder.nextRun', { when: new Date(r.nextRunAt).toLocaleString(locale) })
                      : t('reminder.notScheduled')}
                  </p>
                </div>

                <div className="flex shrink-0 items-center gap-1">
                  <Switch
                    checked={r.isEnabled}
                    onCheckedChange={(isEnabled) => save.mutate({ ...draftFrom(r), isEnabled })}
                    aria-label={t('reminder.enabled')}
                  />
                  <Button variant="ghost" size="icon" onClick={() => sendNow.mutate(r.id)}
                    title={t('reminder.sendNow')} aria-label={t('reminder.sendNow')}>
                    <Send className="h-4 w-4" />
                  </Button>
                  <Button variant="ghost" size="icon" onClick={() => openEdit(r)}
                    aria-label={t('reminder.edit')}>
                    <Pencil className="h-4 w-4" />
                  </Button>
                  <Button variant="ghost" size="icon" onClick={() => setConfirmDelete(r)}
                    aria-label={t('common.delete')}>
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              </div>

              {/* One that has been failing quietly for a week should not look
                  healthy in the list. */}
              {r.lastError && (
                <p className="flex items-center gap-1 text-xs text-destructive">
                  <AlertTriangle className="h-3 w-3" />
                  {t('reminder.lastError', { error: r.lastError })}
                </p>
              )}
            </div>
          ))
        )}
      </CardContent>

      {/* ── The form ── */}
      <Dialog open={!!draft} onOpenChange={(open) => { if (!open) { setDraft(null); setEditing(null); } }}>
        <DialogContent className="max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{editing ? t('reminder.edit') : t('reminder.new')}</DialogTitle>
          </DialogHeader>

          {draft && (
            <form
              className="space-y-4"
              onSubmit={(e) => { e.preventDefault(); save.mutate(draft); }}
            >
              <div className="space-y-1">
                <Label htmlFor="reminder-channel">{t('reminder.channel')}</Label>
                <SearchableSelect
                  value={draft.channelId}
                  onValueChange={(channelId) =>
                    patchDraft({
                      channelId,
                      channelName: channels?.find((c) => c.id === channelId)?.name,
                    })
                  }
                  options={channelOptions}
                  aria-label={t('reminder.channel')}
                />
              </div>

              <div className="space-y-1">
                <Label htmlFor="reminder-title">{t('reminder.label')}</Label>
                <Input
                  id="reminder-title"
                  value={draft.title ?? ''}
                  onChange={(e) => patchDraft({ title: e.target.value })}
                  maxLength={120}
                />
                <p className="text-xs text-muted-foreground">{t('reminder.labelHint')}</p>
              </div>

              <div className="space-y-1">
                <Label htmlFor="reminder-message">{t('reminder.message')}</Label>
                <Textarea
                  id="reminder-message"
                  value={draft.message}
                  onChange={(e) => patchDraft({ message: e.target.value })}
                  rows={4}
                  maxLength={1500}
                  required
                />
                <p className="text-xs text-muted-foreground">{t('reminder.messageHint')}</p>
              </div>

              <div className="space-y-1">
                <Label>{t('reminder.when')}</Label>
                <div className="flex flex-wrap gap-2">
                  {REMINDER_SCHEDULE_TYPES.map((type) => (
                    <Button
                      key={type}
                      type="button"
                      size="sm"
                      variant={draft.scheduleType === type ? 'default' : 'outline'}
                      onClick={() => patchDraft({ scheduleType: type as ReminderScheduleType })}
                    >
                      {t(REMINDER_SCHEDULE_LABEL_KEYS[type])}
                    </Button>
                  ))}
                </div>
              </div>

              {draft.scheduleType === 'once' ? (
                <div className="space-y-1">
                  <Label htmlFor="reminder-runat">{t('reminder.date')}</Label>
                  <Input
                    id="reminder-runat"
                    type="datetime-local"
                    value={toLocalInput(draft.runAt)}
                    onChange={(e) =>
                      // The input gives local wall-clock text; the API wants an
                      // instant, and `new Date(localString)` reads it as local.
                      patchDraft({ runAt: e.target.value ? new Date(e.target.value).toISOString() : undefined })
                    }
                    required
                  />
                </div>
              ) : (
                <div className="space-y-1">
                  <Label htmlFor="reminder-time">{t('reminder.time')}</Label>
                  <Input
                    id="reminder-time"
                    type="time"
                    value={draft.timeOfDay ?? ''}
                    onChange={(e) => patchDraft({ timeOfDay: e.target.value })}
                    required
                  />
                  <p className="text-xs text-muted-foreground">{t('reminder.timeHint')}</p>
                </div>
              )}

              {draft.scheduleType === 'weekly' && (
                <div className="space-y-1">
                  <Label>{t('reminder.weekdays')}</Label>
                  <div className="flex flex-wrap gap-1">
                    {/* Monday first: the faction's week starts where quotas do,
                        not where Date.getDay() happens to. */}
                    {[1, 2, 3, 4, 5, 6, 0].map((day) => {
                      const on = draft.weekdays?.includes(day) ?? false;
                      return (
                        <Button
                          key={day}
                          type="button"
                          size="sm"
                          variant={on ? 'default' : 'outline'}
                          onClick={() =>
                            patchDraft({
                              weekdays: on
                                ? (draft.weekdays ?? []).filter((d) => d !== day)
                                : [...(draft.weekdays ?? []), day],
                            })
                          }
                        >
                          {t(`reminder.weekday.${day}` as TranslationKey)}
                        </Button>
                      );
                    })}
                  </div>
                </div>
              )}

              {draft.scheduleType === 'monthly' && (
                <div className="space-y-1">
                  <Label htmlFor="reminder-dom">{t('reminder.dayOfMonth')}</Label>
                  <Input
                    id="reminder-dom"
                    type="number"
                    min={1}
                    max={31}
                    value={draft.dayOfMonth ?? ''}
                    onChange={(e) =>
                      patchDraft({ dayOfMonth: e.target.value ? Number(e.target.value) : undefined })
                    }
                    required
                  />
                  <p className="text-xs text-muted-foreground">{t('reminder.dayOfMonthHint')}</p>
                </div>
              )}

              <div className="space-y-2">
                <Label>{t('reminder.tag')}</Label>
                <p className="text-xs text-muted-foreground">{t('reminder.tagHint')}</p>

                {!!roles?.length && (
                  <div className="flex flex-wrap gap-1">
                    {roles.map((role) => {
                      const on = draft.mentionRoleIds?.includes(role.id) ?? false;
                      return (
                        <Button
                          key={role.id}
                          type="button"
                          size="sm"
                          variant={on ? 'default' : 'outline'}
                          // A role nobody may ping would be a choice that
                          // silently does nothing, so it is not offered.
                          disabled={!role.mentionable}
                          title={role.mentionable ? undefined : t('reminder.roleNotMentionable')}
                          onClick={() =>
                            patchDraft({
                              mentionRoleIds: on
                                ? (draft.mentionRoleIds ?? []).filter((id) => id !== role.id)
                                : [...(draft.mentionRoleIds ?? []), role.id],
                            })
                          }
                        >
                          @{role.name}
                        </Button>
                      );
                    })}
                  </div>
                )}

                {!!members?.length && (
                  <div className="flex flex-wrap gap-1">
                    {members.map((m) => {
                      const on = draft.mentionUserIds?.includes(m.userId) ?? false;
                      return (
                        <Button
                          key={m.userId}
                          type="button"
                          size="sm"
                          variant={on ? 'secondary' : 'outline'}
                          onClick={() =>
                            patchDraft({
                              mentionUserIds: on
                                ? (draft.mentionUserIds ?? []).filter((id) => id !== m.userId)
                                : [...(draft.mentionUserIds ?? []), m.userId],
                            })
                          }
                        >
                          {displayName(m)}
                        </Button>
                      );
                    })}
                  </div>
                )}

                {!roles?.length && !members?.length && (
                  <p className="text-xs text-muted-foreground">{t('reminder.tagNothing')}</p>
                )}
              </div>

              <div className="flex items-center justify-between rounded-md border p-3">
                <Label htmlFor="reminder-enabled">{t('reminder.enabled')}</Label>
                <Switch
                  id="reminder-enabled"
                  checked={draft.isEnabled ?? true}
                  onCheckedChange={(isEnabled) => patchDraft({ isEnabled })}
                />
              </div>

              <DialogFooter>
                <Button type="button" variant="outline"
                  onClick={() => { setDraft(null); setEditing(null); }}>
                  {t('common.cancel')}
                </Button>
                <Button type="submit" disabled={save.isPending || !draft.channelId}>
                  {t('common.save')}
                </Button>
              </DialogFooter>
            </form>
          )}
        </DialogContent>
      </Dialog>

      <AlertDialog open={!!confirmDelete} onOpenChange={(open) => { if (!open) setConfirmDelete(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t('reminder.deleteTitle')}</AlertDialogTitle>
            <AlertDialogDescription>{t('reminder.deleteBody')}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t('common.cancel')}</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => confirmDelete && remove.mutate(confirmDelete.id)}
              disabled={remove.isPending}
            >
              {t('common.delete')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Card>
  );
}
