'use client';

import { create } from 'zustand';
import type { User } from './api-types';

export type AppView =
  | 'login'
  | 'dashboard'
  | 'entries'
  | 'members'
  | 'settings'
  | 'audit-logs'
  | 'admin-factions'
  | 'admin-faction-detail';

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

  currentView: 'login',
  setCurrentView: (view) => set({ currentView: view }),

  selectedFactionId: null,
  setSelectedFactionId: (id) => set({ selectedFactionId: id }),

  adminDetailFactionId: null,
  setAdminDetailFactionId: (id) => set({ adminDetailFactionId: id }),

  sidebarOpen: true,
  setSidebarOpen: (open) => set({ sidebarOpen: open }),
  toggleSidebar: () => set((s) => ({ sidebarOpen: !s.sidebarOpen })),
}));
