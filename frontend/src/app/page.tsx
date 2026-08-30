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

  const checkAuth = useCallback(async () => {
    try {
      const me = await authApi.getMe();
      setUser(me);
      // Auto-select first active faction
      const activeFaction = me.factions.find((f) => f.factionActive);
      if (activeFaction) {
        useAppStore.getState().setSelectedFactionId(activeFaction.factionId);
        setCurrentView('dashboard');
      } else if (me.role === 'superadmin') {
        // Superadmin with no memberships: drop them on the admin-factions
        // view, but auto-select the first faction they're allowed to browse
        // (if any) so the rest of the app has a context to render into.
        const firstBrowseable = me.browseableFactions?.[0];
        if (firstBrowseable) {
          useAppStore.getState().setSelectedFactionId(firstBrowseable.id);
          setCurrentView('dashboard');
        } else {
          useAppStore.getState().setSelectedFactionId(null);
          setCurrentView('admin-factions');
        }
      } else {
        setCurrentView('dashboard');
      }
    } catch {
      setUser(null);
      setCurrentView('login');
    }
  }, [setUser, setCurrentView]);

  useEffect(() => {
    checkAuth();
  }, [checkAuth]);

  if (!user) return <LoginPage onLogin={checkAuth} />;

  return (
    <>
      <AppShell />
      <InGameNameModal />
    </>
  );
}
