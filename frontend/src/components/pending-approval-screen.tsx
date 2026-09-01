'use client';

import { useCallback, useEffect, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Hourglass, Copy, LogOut, RefreshCw } from 'lucide-react';
import { authApi } from '@/lib/api-client';
import { useAppStore } from '@/lib/store';
import { useToast } from '@/hooks/use-toast';
import { displayName } from '@/lib/format';
import { Button } from '@/components/ui/button';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { LanguageSwitcher } from '@/components/language-switcher';
import { useTranslation } from '@/providers/i18n-provider';

/** How often to ask the API whether a membership has appeared yet. */
const POLL_INTERVAL_MS = 15_000;

interface PendingApprovalScreenProps {
  /**
   * Re-reads the session. Whoever owns the routing decision passes their own
   * auth check here, so that the moment it reports a membership this screen
   * unmounts on its own — there is no "you are in now" state to coordinate.
   */
  onRecheck: () => Promise<void>;
}

/**
 * What a player sees between signing in and being put in a faction.
 *
 * Everything past this point is scoped to a faction — entries, the treasury,
 * quotas, the roster — so an account with no membership had nothing to render
 * and used to land on the full shell with a sidebar of screens that all
 * refused to load. This is the honest version of that state: it says what is
 * missing, hands over the one thing an admin needs to fix it, and gets out of
 * the way by itself once they have.
 */
export function PendingApprovalScreen({ onRecheck }: PendingApprovalScreenProps) {
  const { t } = useTranslation();
  const user = useAppStore((s) => s.user);
  const setUser = useAppStore((s) => s.setUser);
  const setCurrentView = useAppStore((s) => s.setCurrentView);
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const [checking, setChecking] = useState(false);
  const [loggingOut, setLoggingOut] = useState(false);

  // Poll rather than make the player refresh: being added happens in Discord,
  // on someone else's screen, and there is no signal back to this tab. Also on
  // focus, for the common case of alt-tabbing back after asking an admin.
  useEffect(() => {
    const tick = () => { void onRecheck(); };
    const timer = window.setInterval(tick, POLL_INTERVAL_MS);
    window.addEventListener('focus', tick);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener('focus', tick);
    };
  }, [onRecheck]);

  const handleCheckNow = async () => {
    setChecking(true);
    try {
      await onRecheck();
    } finally {
      setChecking(false);
    }
  };

  const handleCopyId = useCallback(async () => {
    if (!user) return;
    try {
      await navigator.clipboard.writeText(user.discordId);
      toast({ title: t('pending.idCopied') });
    } catch {
      // Clipboard access is refused outside a secure context, and the ID is
      // right there on screen — say so rather than failing silently.
      toast({ title: t('pending.copyFailed'), variant: 'destructive' });
    }
  }, [user, toast, t]);

  const handleLogout = async () => {
    setLoggingOut(true);
    try {
      await authApi.logout();
    } catch { /* ignore — the session is being dropped either way */ }
    queryClient.clear();
    setUser(null);
    setCurrentView('login');
  };

  if (!user) return null;

  return (
    <div className="min-h-screen flex items-center justify-center bg-background dot-grid p-4">
      <div className="absolute top-4 right-4">
        <LanguageSwitcher variant="full" className="text-zinc-400" />
      </div>

      <Card className="w-full max-w-md">
        <CardHeader className="text-center">
          <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-white/[0.04]">
            <Hourglass className="h-7 w-7 text-zinc-400" />
          </div>
          <CardTitle className="text-xl">{t('pending.title')}</CardTitle>
          <CardDescription>{t('pending.body')}</CardDescription>
        </CardHeader>

        <CardContent className="space-y-4">
          {/* Which account they are waiting on — they may well have more than
              one Discord, and an admin invited exactly one of them. */}
          <div className="flex items-center gap-3 rounded-lg border border-white/[0.06] p-3">
            <Avatar className="h-9 w-9">
              <AvatarImage src={user.avatarUrl ?? undefined} />
              <AvatarFallback className="text-[11px]">
                {displayName(user).slice(0, 2).toUpperCase()}
              </AvatarFallback>
            </Avatar>
            <div className="min-w-0 flex-1">
              <p className="text-[11px] text-zinc-500">{t('pending.signedInAs')}</p>
              <p className="truncate text-sm text-zinc-200">{displayName(user)}</p>
            </div>
          </div>

          <div className="space-y-1.5">
            <p className="text-[11px] text-zinc-500">{t('members.discordId')}</p>
            <div className="flex items-center gap-2">
              <code className="flex-1 select-all truncate rounded-md border border-white/[0.06] bg-white/[0.02] px-2.5 py-2 font-mono text-sm tabular-nums text-zinc-300">
                {user.discordId}
              </code>
              <Button
                variant="outline"
                size="icon"
                onClick={handleCopyId}
                title={t('pending.copyId')}
                aria-label={t('pending.copyId')}
              >
                <Copy className="h-4 w-4" />
              </Button>
            </div>
          </div>

          <div className="flex items-center gap-2 pt-1">
            <Button
              variant="outline"
              className="flex-1"
              onClick={handleCheckNow}
              disabled={checking}
            >
              <RefreshCw className={`mr-2 h-4 w-4 ${checking ? 'animate-spin' : ''}`} />
              {checking ? t('pending.checking') : t('pending.checkNow')}
            </Button>
            <Button variant="ghost" onClick={handleLogout} disabled={loggingOut}>
              <LogOut className="mr-2 h-4 w-4" />
              {loggingOut ? t('auth.signingOut') : t('auth.signOut')}
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
