'use client';

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { discordApi, apiErrorMessage } from '@/lib/api-client';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
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
  type DiscordChannelRoute,
  type DiscordEventType,
} from '@/lib/api-types';
import { MessageSquare, Link2, Unlink, Send, AlertTriangle } from 'lucide-react';

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
    mutationFn: () => discordApi.unlink(factionId),
    onSuccess: () => {
      setConfirmUnlink(false);
      invalidate();
      toast({ title: t('discord.disconnected') });
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
                  <Button variant="destructive" onClick={() => setConfirmUnlink(true)}>
                    <Unlink className="mr-2 h-4 w-4" />
                    {t('discord.disconnect')}
                  </Button>
                </div>
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
              <div className="space-y-2">
                {status.eventTypes.map((eventType) => {
                  const route = routeFor(eventType);
                  const current = route?.channelId ?? OFF;
                  return (
                    <div
                      key={eventType}
                      className="flex flex-wrap items-center justify-between gap-2 rounded-md border p-3"
                    >
                      <span className="text-sm font-medium">
                        {t(DISCORD_EVENT_LABEL_KEYS[eventType])}
                      </span>
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
                })}
              </div>
            )}
          </CardContent>
        </Card>
      )}

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
          <AlertDialogFooter>
            <AlertDialogCancel>{t('common.cancel')}</AlertDialogCancel>
            <AlertDialogAction onClick={() => unlink.mutate()} disabled={unlink.isPending}>
              {t('discord.disconnect')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
