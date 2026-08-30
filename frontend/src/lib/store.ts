'use client';

import { create } from 'zustand';
import type { User } from './api-types';

export type AppView =
  | 'login'
  | 'dashboard'
  | 'entries'
  | 'payouts'
  | 'treasury'
  | 'members'
  | 'member-profile'
  | 'strikes'
  | 'leaderboard'
  | 'settings'
  | 'audit-logs'
  | 'admin-factions'
  | 'admin-faction-detail'
  | 'reports';

const DEFAULT_BRAND_COLOR = '#3b82f6';

/**
 * Sidebar should be open by default on desktop and collapsed on mobile/tablet.
 * Guarded for SSR where `window` is undefined — the layout is server-rendered
 * with the sidebar open and reconciled on mount.
 */
function defaultSidebarOpen(): boolean {
  if (typeof window === 'undefined') return true;
  return window.matchMedia('(min-width: 1024px)').matches;
}

interface AppState {
  // Auth
  user: User | null;
  setUser: (user: User | null) => void;

  // Navigation
  currentView: AppView;
  setCurrentView: (view: AppView) => void;

  // Selected faction
  selectedFactionId: string | null;
  setSelectedFactionId: (id: string | null) => void;

  // Selected member (for profile view)
  selectedMemberUserId: string | null;
  setSelectedMemberUserId: (id: string | null) => void;

  // Brand color
  brandColor: string;
  setBrandColor: (color: string) => void;

  // Admin detail view
  adminDetailFactionId: string | null;
  setAdminDetailFactionId: (id: string | null) => void;

  // Sidebar
  sidebarOpen: boolean;
  setSidebarOpen: (open: boolean) => void;
  toggleSidebar: () => void;

  // In-game name prompt — controls whether the one-time modal re-appears
  // this session. The modal shows when user.inGameName === null AND the
  // prompt hasn't been dismissed this session.
  inGameNamePromptDismissed: boolean;
  setInGameNamePromptDismissed: (v: boolean) => void;
}

export const useAppStore = create<AppState>((set) => ({
  user: null,
  setUser: (user) => set({ user }),

  currentView: 'login',
  setCurrentView: (view) => set({ currentView: view }),

  selectedFactionId: null,
  // Reset brand color on faction switch so the new faction's brand doesn't
  // briefly inherit the previous one's colour before its detail loads.
  setSelectedFactionId: (id) => set({ selectedFactionId: id, brandColor: DEFAULT_BRAND_COLOR }),

  selectedMemberUserId: null,
  setSelectedMemberUserId: (id) => set({ selectedMemberUserId: id }),

  brandColor: DEFAULT_BRAND_COLOR,
  setBrandColor: (color) => set({ brandColor: color }),

  adminDetailFactionId: null,
  setAdminDetailFactionId: (id) => set({ adminDetailFactionId: id }),

  sidebarOpen: defaultSidebarOpen(),
  setSidebarOpen: (open) => set({ sidebarOpen: open }),
  toggleSidebar: () => set((s) => ({ sidebarOpen: !s.sidebarOpen })),

  inGameNamePromptDismissed: false,
  setInGameNamePromptDismissed: (v) => set({ inGameNamePromptDismissed: v }),
}));
