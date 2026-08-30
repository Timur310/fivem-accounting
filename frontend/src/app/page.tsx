'use client';
import { useEffect, useCallback } from 'react';
import { useAppStore } from '@/lib/store';
import { authApi } from '@/lib/api-client';
import { AppShell } from '@/components/app-shell';
import { LoginPage } from '@/components/login-page';
import { InGameNameModal } from '@/components/in-game-name-modal';

export default function Home() {
  const user = useAppStore((s) => s.user);
  const setUser = useAppStore((s) => s.setUser);
  const setCurrentView = useAppStore((s) => s.setCurrentView);
  const setSelectedFactionId = useAppStore((s) => s.setSelectedFactionId);

  const checkAuth = useCallback(async () => {
    try {
      const me = await authApi.getMe();
      setUser(me);
      const activeFaction = me.factions.find((f) => f.factionActive);
      if (activeFaction) {
        setSelectedFactionId(activeFaction.factionId);
        setCurrentView('dashboard');
      } else if (me.role === 'superadmin') {
        // No active membership — but a superadmin might still have browseable
        // factions. Drop them into the first one if available, otherwise the
        // admin factions list view.
        if (me.browseableFactions && me.browseableFactions.length > 0) {
          setSelectedFactionId(me.browseableFactions[0]!.id);
          setCurrentView('dashboard');
        } else {
          setSelectedFactionId(null);
          setCurrentView('admin-factions');
        }
      } else {
        setSelectedFactionId(null);
        setCurrentView('login');
      }
    } catch {
      setUser(null);
      setCurrentView('login');
    }
  }, [setUser, setCurrentView, setSelectedFactionId]);

  useEffect(() => { checkAuth(); }, [checkAuth]);

  if (!user) return <LoginPage onLogin={checkAuth} />;

  return (
    <>
      <AppShell />
      <InGameNameModal />
    </>
  );
}
