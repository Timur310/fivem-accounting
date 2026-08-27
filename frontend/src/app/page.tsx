'use client';

import { useEffect, useCallback } from 'react';
import { useAppStore } from '@/lib/store';
import { authApi } from '@/lib/api-client';
import { AppShell } from '@/components/app-shell';
import { LoginPage } from '@/components/login-page';

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
      }
      setCurrentView(
        me.role === 'superadmin' && !activeFaction
          ? 'admin-factions'
          : 'dashboard'
      );
    } catch {
      setUser(null);
      setCurrentView('login');
    }
  }, [setUser, setCurrentView]);

  useEffect(() => {
    checkAuth();
  }, [checkAuth]);

  if (!user) return <LoginPage onLogin={checkAuth} />;

  return <AppShell />;
}
