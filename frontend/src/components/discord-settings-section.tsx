'use client';

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { discordApi, apiErrorMessage } from '@/lib/api-client';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Skeleton } from '@/components/ui/skeleton';
import {
  SearchableSelect, type SearchableSelectOption,
} from '@/components/ui/searchable-select';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { EmptyState, ErrorState } from '@/components/ui/empty-state';
import { useToast } from '@/hooks/use-toast';
import { useTranslation } from '@/providers/i18n-provider';
import {
  DISCORD_EVENT_LABEL_KEYS,
  DISCORD_REMOVAL_EVENTS,
  type DiscordChannelRoute,
  type DiscordEventType,
} from '@/lib/api-types';
import { MessageSquare, Link2, Unlink, Send, AlertTriangle } from 'lucide-react';
import { DiscordRemindersSection } from '@/components/discord-reminders-section';

/** The sentinel a "not routed anywhere" select carries; not a channel id. */
const OFF = '__off__';

interface Props {
  factionId: string;
}

export function DiscordSettingsSection({ factionId }: Props) {
  const { t, locale } = useTranslation();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [confirmUnlink, setConfirmUnlink] = useState(false);
  // Defaults to off every time the dialog opens. A destructive extra should
  // never be pre-ticked, and should never remember a previous yes.
  const [alsoLeave, setAlsoLeave] = useState(false);

  const { data: status, isLoading, error } = useQuery({
    queryKey: ['discord-status', factionId],
    queryFn: () => discordApi.status(factionId),
  });

  const linked = !!status?.integration;

  // Only asked for once a server is connected: without one there is nothing to
  // list, and the request would 404 by design.
  const { data: channels, error: channelsError, isLoading: channelsLoading } = useQuery({
    queryKey: ['discord-channels', factionId],
    queryFn: () => discordApi.channels(factionId),
    enabled: linked,
    retry: false,
  });

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ['discord-status', factionId] });

  const connect = useMutation({
    mutationFn: () => discordApi.inviteUrl(factionId),
    // A full navigation rather than a popup: Discord's invite dialog asks the
    // leader to pick a server and confirm permissions, and popup blockers
    // swallow that often enough to look like the button is broken.
    onSuccess: (data) => { window.location.href = data.url; },
    onError: (e) => toast({ title: apiErrorMessage(e), variant: 'destructive' }),
  });

  const unlink = useMutation({
    mutationFn: (leave: boolean) => discordApi.unlink(factionId, leave),
    onSuccess: (result) => {
      setConfirmUnlink(false);
      invalidate();
      // Three outcomes, and they are not the same news: they did not ask to
      // remove the bot, it was removed, or we asked and Discord refused — in
      // which case the bot is still sitting in their server and they need to
      // know that rather than assume it is gone.
      if (result.left === false) {
        toast({
          title: t('discord.disconnected'),
          description: t('discord.leaveFailed', { error: result.leaveError ?? '' }),
          variant: 'destructive',
        });
      } else {
        toast({ title: result.left ? t('discord.disconnectedAndLeft') : t('discord.disconnected') });
      }
    },
    onError: (e) => toast({ title: apiErrorMessage(e), variant: 'destructive' }),
  });

  const setRoute = useMutation({
    mutationFn: ({ eventType, channelId, channelName }: {
      eventType: DiscordEventType; channelId: string; channelName?: string;
    }) =>
      channelId === OFF
        ? discordApi.clearRoute(factionId, eventType)
        : discordApi.setRoute(factionId, eventType, { channelId, channelName }),
    onSuccess: () => { invalidate(); toast({ title: t('discord.saved') }); },
    onError: (e) => toast({ title: t('discord.saveFailed'), description: apiErrorMessage(e), variant: 'destructive' }),
  });

  const sendTest = useMutation({
    mutationFn: (channelId: string) => discordApi.test(factionId, channelId),
    onSuccess: (result) => {
      // The request succeeded either way; ok:false means Discord said no, and
      // the reason is what the person needs to read.
      if (result.ok) {
        toast({ title: t('discord.testSent') });
      } else {
        toast({ title: t('discord.testFailed', { error: result.error ?? '' }), variant: 'destructive' });
      }
      invalidate();
    },
    onError: (e) => toast({ title: apiErrorMessage(e), variant: 'destructive' }),
  });

  if (isLoading) {
    return <Skeleton className="h-64 w-full" />;
  }

  if (error) {
    return <ErrorState error={error} />;
  }

  // ── No bot on this deployment at all ──
  // Distinct from "this faction has not connected one": nothing the leader
  // does here will help, so the screen must not offer them a button.
  if (!status?.configured) {
    return (
      <Card>
        <CardContent className="pt-6">
          <EmptyState
            icon={MessageSquare}
            title={t('discord.notConfigured')}
            hint={t('discord.notConfiguredBody')}
          />
        </CardContent>
      </Card>
    );
  }

  const routeFor = (eventType: DiscordEventType): DiscordChannelRoute | undefined =>
    status.routes.find((r) => r.eventType === eventType);

  // Rendered twice, once per group, so the row is written once.
  const renderRow = (eventType: DiscordEventType) => {
    const route = routeFor(eventType);
    const current = route?.channelId ?? OFF;
    return (
      <div
        key={eventType}
        className="flex flex-wrap items-center justify-between gap-2 rounded-md border p-3"
      >
        <span className="text-sm font-medium">{t(DISCORD_EVENT_LABEL_KEYS[eventType])}</span>
        <div className="flex items-center gap-2">
          <SearchableSelect
            value={current}
            onValueChange={(channelId) =>
              setRoute.mutate({
                eventType,
                channelId,
                channelName: channels?.find((c) => c.id === channelId)?.name,
              })
            }
            options={channelOptions}
            className="w-56"
            aria-label={t(DISCORD_EVENT_LABEL_KEYS[eventType])}
          />
          <Button
            variant="ghost"
            size="icon"
            // Nothing to test while the event is switched off.
            disabled={current === OFF || sendTest.isPending}
            onClick={() => sendTest.mutate(current)}
            title={t('discord.test')}
            aria-label={t('discord.test')}
          >
            <Send className="h-4 w-4" />
          </Button>
        </div>
      </div>
    );
  };

  // Driven by the server's list, not a local copy: an event type added later
  // appears here without a frontend change.
  const additions = status.eventTypes.filter((e) => !DISCORD_REMOVAL_EVENTS.includes(e));
  const removals = status.eventTypes.filter((e) => DISCORD_REMOVAL_EVENTS.includes(e));

  const channelOptions: SearchableSelectOption[] = [
    { value: OFF, label: t('discord.off') },
    ...(channels ?? []).map((c) => ({
      value: c.id,
      label: `#${c.name}`,
      hint: c.parentName ?? undefined,
    })),
  ];

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <MessageSquare className="h-5 w-5" />
            {t('discord.title')}
          </CardTitle>
          <p className="text-sm text-muted-foreground">{t('discord.subtitle')}</p>
        </CardHeader>
        <CardContent className="space-y-4">
          {!linked ? (
            <>
              <EmptyState
                icon={Link2}
                title={t('discord.notLinked')}
                hint={t('discord.notLinkedBody')}
              />
              <div className="flex justify-center">
                <Button onClick={() => connect.mutate()} disabled={connect.isPending}>
                  <Link2 className="mr-2 h-4 w-4" />
                  {t('discord.connect')}
                </Button>
              </div>
              <p className="text-center text-xs text-muted-foreground">
                {t('discord.permissionsNote')}
              </p>
            </>
          ) : (
            <>
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="space-y-1">
                  <div className="flex items-center gap-2">
                    <Badge variant="secondary">
                      {t('discord.connectedTo', { guild: status.integration!.guildName ?? status.integration!.guildId })}
                    </Badge>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    {t('discord.linkedBy', {
                      name: status.integration!.linkedByName,
                      date: new Date(status.integration!.linkedAt).toLocaleDateString(locale),
                    })}
                  </p>
                </div>
                <div className="flex gap-2">
                  <Button variant="outline" onClick={() => connect.mutate()} disabled={connect.isPending}>
                    {t('discord.reconnect')}
                  </Button>
                  <Button
                    variant="destructive"
                    onClick={() => { setAlsoLeave(false); setConfirmUnlink(true); }}
                  >
                    <Unlink className="mr-2 h-4 w-4" />
                    {t('discord.disconnect')}
                  </Button>
                </div>
              </div>

              {/* Disabled, and honest about why. A Discord message is one text
                  read by everyone in the channel, so it cannot follow each
                  member's own language the way the interface does — the
                  faction will pick one, once there is a second to pick. */}
              <div className="flex flex-wrap items-center justify-between gap-2 rounded-md border p-3">
                <div className="space-y-1">
                  <span className="text-sm font-medium">{t('discord.language')}</span>
                  <p className="text-xs text-muted-foreground">{t('discord.languageHint')}</p>
                </div>
                <SearchableSelect
                  value={status.integration!.locale}
                  onValueChange={() => {}}
                  options={[{ value: 'en', label: t('discord.languageEnglish') }]}
                  disabled
                  className="w-56"
                  aria-label={t('discord.language')}
                />
              </div>

              {/* A link that quietly stopped working still reads as connected
                  everywhere else, so the last failure is surfaced here. */}
              {status.integration!.lastError && (
                <div className="flex items-start gap-2 rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm">
                  <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-destructive" />
                  <div>
                    <p className="font-medium">
                      {t('discord.lastError', { error: status.integration!.lastError })}
                    </p>
                    <p className="text-xs text-muted-foreground">{t('discord.lastErrorHint')}</p>
                  </div>
                </div>
              )}
            </>
          )}
        </CardContent>
      </Card>

      {linked && (
        <Card>
          <CardHeader>
            <CardTitle>{t('discord.routing')}</CardTitle>
            <p className="text-sm text-muted-foreground">
              {t('discord.routingHint', { off: t('discord.off') })}
            </p>
          </CardHeader>
          <CardContent>
            {channelsError ? (
              <div>
                <p className="text-center text-sm font-medium">{t('discord.channelsFailed')}</p>
                <ErrorState error={channelsError} compact />
              </div>
            ) : channelsLoading ? (
              <Skeleton className="h-48 w-full" />
            ) : (
              <div className="space-y-6">
                {/* Two groups, because they are two different decisions. Most
                    factions want activity in a public log; "somebody took that
                    back out" is the one leadership needs to see. */}
                <div className="space-y-2">
                  <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                    {t('discord.routingAdditions')}
                  </p>
                  {additions.map(renderRow)}
                </div>

                <div className="space-y-2">
                  <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                    {t('discord.routingRemovals')}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {t('discord.routingRemovalsHint')}
                  </p>
                  {removals.map(renderRow)}
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* Reminders need a channel list too, so they share the one already
          fetched above rather than asking Discord a second time. */}
      {linked && <DiscordRemindersSection factionId={factionId} channels={channels} />}

      <AlertDialog open={confirmUnlink} onOpenChange={setConfirmUnlink}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {t('discord.disconnectTitle', {
                guild: status.integration?.guildName ?? status.integration?.guildId ?? '',
              })}
            </AlertDialogTitle>
            <AlertDialogDescription>{t('discord.disconnectBody')}</AlertDialogDescription>
          </AlertDialogHeader>

          {/* Off by default, and the warning sits with the switch rather than
              in the paragraph above: the same bot may be doing other work in
              that server, and this is the moment to think about it. */}
          <div className="flex items-start justify-between gap-4 rounded-md border p-3">
            <div className="space-y-1">
              <Label htmlFor="discord-also-leave" className="text-sm font-medium">
                {t('discord.alsoLeave')}
              </Label>
              <p className="text-xs text-muted-foreground">{t('discord.alsoLeaveHint')}</p>
            </div>
            <Switch
              id="discord-also-leave"
              checked={alsoLeave}
              onCheckedChange={setAlsoLeave}
            />
          </div>

          <AlertDialogFooter>
            <AlertDialogCancel>{t('common.cancel')}</AlertDialogCancel>
            <AlertDialogAction onClick={() => unlink.mutate(alsoLeave)} disabled={unlink.isPending}>
              {t('discord.disconnect')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
