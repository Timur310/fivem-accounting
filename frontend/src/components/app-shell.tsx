'use client';

import { useAppStore, DEFAULT_BRAND_COLOR } from '@/lib/store';
import { authApi, factionSettingsApi } from '@/lib/api-client';
import type { FactionPermission } from '@/lib/api-types';
import { useRouter } from 'next/navigation';
import { useQueryClient } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  LayoutDashboard,
  List,
  Users,
  Settings,
  ScrollText,
  Shield,
  Menu,
  LogOut,
  ChevronLeft,
  Coins,
  FileBarChart,
  Wallet,
  ArrowDownToLine,
  Trophy,
  AlertTriangle,
} from 'lucide-react';
import { DashboardView } from '@/views/dashboard-view';
import { EntriesView } from '@/views/entries-view';
import { PayoutsView } from '@/views/payouts-view';
import { TreasuryView } from '@/views/treasury-view';
import { MembersView } from '@/views/members-view';
import { SettingsView } from '@/views/settings-view';
import { AuditLogsView } from '@/views/audit-logs-view';
import { ReportsView } from '@/views/reports-view';
import { AdminFactionsView } from '@/views/admin-factions-view';
import { AdminFactionDetailView } from '@/views/admin-faction-detail-view';
import { MemberProfileView } from '@/views/member-profile-view';
import { StrikesView } from '@/views/strikes-view';
import { LeaderboardView } from '@/views/leaderboard-view';
import { useState, useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { displayName } from '@/lib/format';
import type { AppView } from '@/lib/store';

/** Tailwind's `lg`: above this the sidebar sits beside the content. */
const DESKTOP_QUERY = '(min-width: 1024px)';
const SIDEBAR_STORAGE_KEY = 'faction-accountant:sidebar-open';

function isDesktop() {
  try {
    return window.matchMedia(DESKTOP_QUERY).matches;
  } catch {
    return true;
  }
}

interface NavItem {
  view: AppView;
  label: string;
  icon: typeof LayoutDashboard;
  /** Any one of these is enough to see the item. */
  anyPermission?: FactionPermission[];
  /** Hide unless the user actually belongs to the selected faction. */
  membersOnly?: boolean;
  superadminOnly?: boolean;
}

export function AppShell() {
  const user = useAppStore((s) => s.user);
  const currentView = useAppStore((s) => s.currentView);
  const setCurrentView = useAppStore((s) => s.setCurrentView);
  const selectedFactionId = useAppStore((s) => s.selectedFactionId);
  const setSelectedFactionId = useAppStore((s) => s.setSelectedFactionId);
  const brandColor = useAppStore((s) => s.brandColor);
  const setBrandColor = useAppStore((s) => s.setBrandColor);
  const sidebarOpen = useAppStore((s) => s.sidebarOpen);
  const setSidebarOpen = useAppStore((s) => s.setSidebarOpen);
  const setUser = useAppStore((s) => s.setUser);
  const [loggingOut, setLoggingOut] = useState(false);
  const selectedMemberUserId = useAppStore((s) => s.selectedMemberUserId);
  const queryClient = useQueryClient();

  // Brand colour comes from the faction settings endpoint, which any member
  // can read. It used to come from GET /factions/:id — that route is
  // superadmin-only, so for everyone else the request 403'd, factionDetail
  // stayed undefined and the colour silently fell back to the default no
  // matter what had been saved.
  const { data: factionSettings } = useQuery({
    queryKey: ['faction-brand', selectedFactionId],
    queryFn: () => factionSettingsApi.get(selectedFactionId!),
    enabled: !!selectedFactionId,
    staleTime: 5 * 60 * 1000,
  });

  useEffect(() => {
    if (factionSettings?.brandColor) {
      setBrandColor(factionSettings.brandColor);
    }
  }, [factionSettings?.brandColor, setBrandColor]);

  const router = useRouter();

  const handleLogout = async () => {
    setLoggingOut(true);
    try {
      await authApi.logout();
    } catch { /* ignore */ }
    // Purge every cached query so a different user logging in on the same
    // browser never sees the previous user's data — even before the queries
    // would refetch on their own.
    queryClient.clear();
    setUser(null);
    setCurrentView('login');
    router.refresh();
  };

  const activeFactions = user?.factions.filter((f) => f.factionActive) ?? [];
  const currentFactionMembership = activeFactions.find(
    (f) => f.factionId === selectedFactionId,
  );
  const isAdmin =
    user?.role === 'superadmin' || currentFactionMembership?.role === 'admin';

  /**
   * What the caller may do in the selected faction. Members carry the list
   * their rank grants; a superadmin browsing a faction they do not belong to
   * has no membership, and the API treats them as holding everything there.
   */
  const hasPermission = (permission: FactionPermission) =>
    currentFactionMembership
      ? currentFactionMembership.permissions.includes(permission)
      : user?.role === 'superadmin';
  const isSuperadmin = user?.role === 'superadmin';
  const canLogEntries = !!currentFactionMembership;

  // Superadmins with no memberships can still browse any faction. Surface
  // those alongside active memberships so the selector is never empty.
  const browseableFactions = user?.browseableFactions ?? [];
  const browseableOnly = browseableFactions.filter(
    (b) => !activeFactions.some((m) => m.factionId === b.id),
  );

  const navItems: NavItem[] = [
    { view: 'dashboard', label: 'Dashboard', icon: LayoutDashboard },
    { view: 'entries', label: 'Entries', icon: List },
    { view: 'payouts', label: 'Payouts', icon: ArrowDownToLine },
    { view: 'treasury', label: 'Treasury', icon: Wallet },
    { view: 'members', label: 'Members', icon: Users },
    { view: 'leaderboard', label: 'Leaderboard', icon: Trophy },
    { view: 'strikes', label: 'Strikes', icon: AlertTriangle },
    {
      view: 'settings',
      label: 'Settings',
      icon: Settings,
      // Mirrors the PATCH guard: either permission opens the settings screen.
      anyPermission: ['manage_settings', 'manage_customization'],
    },
    {
      view: 'audit-logs',
      label: 'Audit Logs',
      icon: ScrollText,
      anyPermission: ['view_audit_logs'],
      // Only ever your own faction's history — a superadmin passing through a
      // faction they do not belong to has no business reading it.
      membersOnly: true,
    },
    { view: 'reports', label: 'Reports', icon: FileBarChart, anyPermission: ['view_reports'] },
    { view: 'admin-factions', label: 'Faction Admin', icon: Shield, superadminOnly: true },
  ];

  const isNavItemVisible = (item: NavItem) => {
    if (item.superadminOnly) return isSuperadmin;
    if (item.membersOnly && !currentFactionMembership) return false;
    if (item.anyPermission) return item.anyPermission.some(hasPermission);
    return true;
  };

  // Switching factions can take away the permission that opened the current
  // screen. Drop back to the dashboard rather than leaving a page up that the
  // API will refuse to fill.
  useEffect(() => {
    const item = navItems.find((i) => i.view === currentView);
    if (item && !isNavItemVisible(item)) {
      setCurrentView('dashboard');
    }
    // navItems and isNavItemVisible are rebuilt every render; what actually
    // changes the answer is the view, the faction, and who is asking.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentView, selectedFactionId, user]);

  // Put the sidebar back the way it was left. Read after mount rather than as
  // the store's initial value: this renders on the server too, and reading
  // localStorage during render would make the two disagree.
  useEffect(() => {
    if (isDesktop()) {
      try {
        const saved = window.localStorage.getItem(SIDEBAR_STORAGE_KEY);
        if (saved !== null) setSidebarOpen(saved === 'true');
      } catch {
        // Storage can be unavailable (private mode); the default stands.
      }
    } else {
      // On a narrow screen the sidebar covers the page, so it starts out of
      // the way instead of over whatever the user came to look at.
      setSidebarOpen(false);
    }
  }, [setSidebarOpen]);

  // Remembered on the deliberate toggle rather than on every change of the
  // flag: on a narrow screen the sidebar is an overlay, and closing it is part
  // of navigating rather than a statement about how the app should look.
  const handleSidebarToggle = () => {
    const next = !sidebarOpen;
    setSidebarOpen(next);
    if (!isDesktop()) return;
    try {
      window.localStorage.setItem(SIDEBAR_STORAGE_KEY, String(next));
    } catch {
      // Nothing to do — the sidebar still works, it just will not be recalled.
    }
  };

  const handleNavClick = (view: AppView) => {
    if (view === 'member-profile') return;
    // Closing after navigation is a mobile affordance: there the sidebar covers
    // the page. Beside the content it is not in the way, and collapsing it on
    // every click threw away whatever the user had chosen.
    if (!isDesktop()) setSidebarOpen(false);
    if (!selectedFactionId && view !== 'admin-factions' && view !== 'admin-faction-detail') {
      if (isSuperadmin) {
        setCurrentView('admin-factions');
        return;
      }
    }
    setCurrentView(view);
  };

  const renderView = () => {
    if (!selectedFactionId && currentView !== 'admin-factions' && currentView !== 'admin-faction-detail') {
      if (isSuperadmin) {
        queueMicrotask(() => setCurrentView('admin-factions'));
        return null;
      }
      return (
        <div className="flex flex-col items-center justify-center h-full text-zinc-500 gap-3 py-12">
          <p>You are not a member of any faction. Contact a superadmin.</p>
          <Button variant="outline" size="sm" onClick={handleLogout} disabled={loggingOut}>
            <LogOut className="mr-2 h-4 w-4" /> Sign out
          </Button>
        </div>
      );
    }

    switch (currentView) {
      case 'dashboard':
        return selectedFactionId ? <DashboardView factionId={selectedFactionId} /> : null;
      case 'entries':
        return selectedFactionId ? <EntriesView factionId={selectedFactionId} isAdmin={!!isAdmin} canLogEntries={canLogEntries} canLogAnonymously={hasPermission('manage_entries')} /> : null;
      case 'payouts':
        return selectedFactionId ? <PayoutsView factionId={selectedFactionId} isSuperadmin={!!isSuperadmin} /> : null;
      case 'treasury':
        return selectedFactionId ? <TreasuryView factionId={selectedFactionId} /> : null;
      case 'members':
        return selectedFactionId ? <MembersView factionId={selectedFactionId} /> : null;
      case 'member-profile':
        return (selectedFactionId && selectedMemberUserId) ? <MemberProfileView factionId={selectedFactionId} userId={selectedMemberUserId} /> : null;
      case 'strikes':
        return selectedFactionId ? <StrikesView factionId={selectedFactionId} /> : null;
      case 'leaderboard':
        return selectedFactionId ? <LeaderboardView factionId={selectedFactionId} isSuperadmin={!!isSuperadmin} /> : null;
      case 'settings':
        return selectedFactionId ? <SettingsView factionId={selectedFactionId} isFactionAdmin={!!isAdmin} /> : null;
      case 'audit-logs':
        return selectedFactionId ? <AuditLogsView factionId={selectedFactionId} /> : null;
      case 'reports':
        return selectedFactionId ? <ReportsView factionId={selectedFactionId} /> : null;
      case 'admin-factions':
        return <AdminFactionsView />;
      case 'admin-faction-detail':
        return <AdminFactionDetailView />;
      default:
        return null;
    }
  };

  const brandStyle = {
    '--brand-color': brandColor,
    '--brand-color-light': `${brandColor}20`,
    '--brand-color-medium': `${brandColor}40`,
  } as React.CSSProperties;

  // The selector combines memberships (admin/member) and browseable factions
  // (superadmin-only, marked with a Browse badge so the role is clear).
  const showFactionSelector = activeFactions.length > 0 || browseableOnly.length > 0;

  return (
    <div className="min-h-screen flex bg-background dot-grid" style={brandStyle}>
      {/* Sidebar */}
      <aside
        className={`fixed inset-y-0 left-0 z-50 flex flex-col border-r border-white/[0.06] bg-[#09090b] transition-all duration-300 lg:relative lg:z-auto ${sidebarOpen ? 'w-60' : 'w-0 lg:w-[52px]'}`}
      >
        {/* Sidebar Header */}
        <div className="flex h-14 items-center gap-2.5 border-b border-white/[0.06] px-3">
          {sidebarOpen && (
            <div className="flex items-center gap-2.5 overflow-hidden">
              <div
                className="flex h-8 w-8 items-center justify-center rounded-lg"
                style={{ backgroundColor: `${brandColor}18` }}
              >
                <Coins className="h-4 w-4" style={{ color: brandColor }} />
              </div>
              <span className="font-medium text-sm tracking-tight truncate text-zinc-200">
                Faction Accountant
              </span>
            </div>
          )}
          {!sidebarOpen && (
            <button
              onClick={handleSidebarToggle}
              className="w-full flex justify-center py-1"
              title="Expand sidebar"
              aria-label="Expand sidebar"
            >
              <Coins className="h-4.5 w-4.5" style={{ color: brandColor }} />
            </button>
          )}
        </div>

        {/* Faction Selector */}
        {showFactionSelector && (
          <div className="px-2.5 py-2.5 border-b border-white/[0.06]">
            {sidebarOpen ? (
              <Select
                value={selectedFactionId ?? ''}
                onValueChange={(val) => {
                  setSelectedFactionId(val);
                  if (currentView === 'admin-factions' || currentView === 'admin-faction-detail') {
                    setCurrentView('dashboard');
                  }
                }}
              >
                <SelectTrigger className="w-full">
                  <SelectValue placeholder="Select faction" />
                </SelectTrigger>
                <SelectContent>
                  {activeFactions.map((f) => {
                    // Every row wears its own faction's colour. Using the store
                    // value here painted the whole list in the selected
                    // faction's colour, which told you nothing.
                    const rowColor = f.factionBrandColor ?? DEFAULT_BRAND_COLOR;
                    return (
                      <SelectItem key={f.factionId} value={f.factionId}>
                        <span className="flex items-center gap-2">
                          <span
                            className="h-2.5 w-2.5 shrink-0 rounded-full"
                            style={{ backgroundColor: rowColor }}
                            aria-hidden="true"
                          />
                          <span>{f.factionName}</span>
                          {f.role === 'admin' && (
                            <span
                              className="text-[10px] px-1.5 py-0.5 rounded font-medium"
                              style={{ backgroundColor: `${rowColor}15`, color: rowColor }}
                            >
                              Admin
                            </span>
                          )}
                        </span>
                      </SelectItem>
                    );
                  })}
                  {browseableOnly.map((b) => (
                    <SelectItem key={b.id} value={b.id}>
                      <span className="flex items-center gap-2">
                        <span
                          className="h-2.5 w-2.5 shrink-0 rounded-full"
                          style={{ backgroundColor: b.brandColor ?? DEFAULT_BRAND_COLOR }}
                          aria-hidden="true"
                        />
                        <span>{b.name}</span>
                        <span className="text-[10px] px-1.5 py-0.5 rounded font-medium bg-white/[0.06] text-zinc-400">
                          Browse
                        </span>
                      </span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            ) : (
              <button
                onClick={handleSidebarToggle}
                className="w-full flex justify-center py-1"
                title="Expand sidebar"
                aria-label="Expand sidebar"
              >
                <Coins className="h-4 w-4 text-zinc-500" />
              </button>
            )}
          </div>
        )}

        {/* Nav Items */}
        <nav className="flex-1 py-2 px-2 space-y-0.5 overflow-y-auto">
          {navItems.map((item) => {
            if (!isNavItemVisible(item)) return null;
            const active = currentView === item.view;
            return (
              <button
                key={item.view}
                onClick={() => handleNavClick(item.view)}
                aria-current={active ? 'page' : undefined}
                className={`w-full flex items-center gap-2.5 rounded-md px-2.5 py-2 text-sm font-normal transition-all duration-150 ${
                  active
                    ? 'text-white font-medium'
                    : 'text-zinc-500 hover:text-zinc-200 hover:bg-white/[0.04]'
                } ${!sidebarOpen ? 'justify-center' : ''}`}
                style={active ? {
                  backgroundColor: `${brandColor}12`,
                  boxShadow: `inset 0 0 0 1px ${brandColor}25`,
                  color: brandColor,
                } : undefined}
                title={!sidebarOpen ? item.label : undefined}
              >
                <item.icon className={`h-4 w-4 shrink-0 ${active ? '' : 'opacity-60'}`} />
                {sidebarOpen && <span className="truncate">{item.label}</span>}
              </button>
            );
          })}
        </nav>

        {/* Collapse button */}
        <div className="border-t border-white/[0.06] p-1.5 hidden lg:block">
          <Button
            variant="ghost"
            size="sm"
            className="w-full text-zinc-500 hover:text-zinc-300"
            onClick={handleSidebarToggle}
          >
            <ChevronLeft className={`h-3.5 w-3.5 transition-transform duration-200 ${!sidebarOpen ? 'rotate-180' : ''}`} />
            {sidebarOpen && <span className="ml-2 text-xs">Collapse</span>}
          </Button>
        </div>
      </aside>

      {/* Mobile overlay */}
      {sidebarOpen && (
        <div
          className="fixed inset-0 z-40 bg-black/60 backdrop-blur-sm lg:hidden"
          onClick={() => setSidebarOpen(false)}
        />
      )}

      {/* Main Content */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* Header */}
        <header className="h-14 border-b border-white/[0.06] bg-background/80 backdrop-blur-md flex items-center justify-between px-4 shrink-0 sticky top-0 z-30">
          <div className="flex items-center gap-3">
            <Button
              variant="ghost"
              size="icon"
              className="lg:hidden text-zinc-400"
              onClick={handleSidebarToggle}
              aria-label="Toggle navigation"
            >
              <Menu className="h-5 w-5" />
            </Button>
            <h1 className="text-sm font-medium text-zinc-300">
              {currentView === 'member-profile' ? 'Member Profile' : (navItems.find((i) => i.view === currentView)?.label ?? 'Faction Accountant')}
            </h1>
          </div>

          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" className="flex items-center gap-2 hover:bg-white/[0.04]">
                <Avatar className="h-7 w-7">
                  <AvatarImage src={user?.avatarUrl ?? undefined} />
                  <AvatarFallback className="text-[10px]">
                    {(user ? displayName(user) : 'U').slice(0, 2).toUpperCase()}
                  </AvatarFallback>
                </Avatar>
                <span className="hidden sm:inline text-sm text-zinc-300">
                  {user ? displayName(user) : ''}
                </span>
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuLabel>
                <div className="text-zinc-200">{user ? displayName(user) : ''}</div>
                <div className="text-xs text-zinc-500 font-normal">
                  {user?.role === 'superadmin'
                    ? 'Superadmin'
                    : user?.role === 'faction_admin'
                      ? 'Faction Admin'
                      : 'Member'}
                </div>
              </DropdownMenuLabel>
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={handleLogout} disabled={loggingOut}>
                <LogOut className="mr-2 h-4 w-4" />
                {loggingOut ? 'Signing out...' : 'Sign out'}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </header>

        {/* Page Content */}
        <main className="flex-1 p-4 md:p-6 overflow-auto">
          <div className="animate-fade-in">
            {renderView()}
          </div>
        </main>
      </div>
    </div>
  );
}
