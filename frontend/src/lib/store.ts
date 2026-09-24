'use client';

import { create } from 'zustand';
import type { User } from './api-types';

export type AppView =
  | 'login'
  | 'dashboard'
  | 'entries'
  | 'payouts'
  | 'treasury'
  | 'laundering'
  | 'crafting'
  | 'pricing'
  | 'vehicles'
  | 'operations'
  | 'shifts'
  | 'complaints'
  | 'map'
  | 'members'
  | 'member-profile'
  | 'strikes'
  | 'leaderboard'
  | 'settings'
  | 'audit-logs'
  | 'admin-factions'
  | 'admin-faction-detail'
  | 'reports'
  | 'support'
  | 'announcements'
  | 'feed'
  | 'admin-support'
  | 'admin-backup'
  | 'guide';

export const DEFAULT_BRAND_COLOR = '#3b82f6';

interface AppState {
  // Auth
  user: User | null;
  setUser: (user: User | null) => void;
  inGameNamePromptDismissed: boolean;
  setInGameNamePromptDismissed: (v: boolean) => void;

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
}

export const useAppStore = create<AppState>((set) => ({
  user: null,
  setUser: (user) => set({ user }),
  inGameNamePromptDismissed: false,
  setInGameNamePromptDismissed: (v) => set({ inGameNamePromptDismissed: v }),

  currentView: 'login',
  setCurrentView: (view) => set({ currentView: view }),

  selectedFactionId: null,
  // Switching factions drops the colour back to the default so the previous
  // faction's accent does not linger over the new one while its settings load.
  // Re-picking the faction you are already on is not a switch: the settings
  // query answers from cache with the same value, so the effect that restores
  // the colour never re-runs and clearing it here would strand the UI on the
  // default until something else refetched.
  setSelectedFactionId: (id) => set((state) => (
    state.selectedFactionId === id
      ? { selectedFactionId: id }
      : { selectedFactionId: id, brandColor: DEFAULT_BRAND_COLOR }
  )),

  selectedMemberUserId: null,
  setSelectedMemberUserId: (id) => set({ selectedMemberUserId: id }),

  brandColor: DEFAULT_BRAND_COLOR,
  setBrandColor: (color) => set({ brandColor: color }),

  adminDetailFactionId: null,
  setAdminDetailFactionId: (id) => set({ adminDetailFactionId: id }),

  sidebarOpen: true,
  setSidebarOpen: (open) => set({ sidebarOpen: open }),
  toggleSidebar: () => set((s) => ({ sidebarOpen: !s.sidebarOpen })),
}));
