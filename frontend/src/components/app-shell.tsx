'use client';

import { useAppStore } from '@/lib/store';
import { authApi, factionsApi } from '@/lib/api-client';
import { useRouter } from 'next/navigation';
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
import type { AppView } from '@/lib/store';

export function AppShell() {
  const user = useAppStore((s) => s.user);
  const currentView = useAppStore((s) => s.currentView);
  const setCurrentView = useAppStore((s) => s.setCurrentView);
  const selectedFactionId = useAppStore((s) => s.selectedFactionId);
  const setSelectedFactionId = useAppStore((s) => s.setSelectedFactionId);
  const brandColor = useAppStore((s) => s.brandColor);
  const setBrandColor = useAppStore((s) => s.setBrandColor);
  const sidebarOpen = useAppStore((s) => s.sidebarOpen);
  const toggleSidebar = useAppStore((s) => s.toggleSidebar);
  const setSidebarOpen = useAppStore((s) => s.setSidebarOpen);
  const setUser = useAppStore((s) => s.setUser);
  const [loggingOut, setLoggingOut] = useState(false);
  const selectedMemberUserId = useAppStore((s) => s.selectedMemberUserId);

  // Fetch faction detail for brand color on faction switch
  const { data: factionDetail } = useQuery({
    queryKey: ['faction-brand', selectedFactionId],
    queryFn: () => factionsApi.get(selectedFactionId!),
    enabled: !!selectedFactionId,
    staleTime: 5 * 60 * 1000,
  });

  useEffect(() => {
    if (factionDetail?.brandColor) {
      setBrandColor(factionDetail.brandColor);
    }
  }, [factionDetail?.brandColor, setBrandColor]);

  const router = useRouter();

  const handleLogout = async () => {
    setLoggingOut(true);
    try {
      await authApi.logout();
    } catch { /* ignore */ }
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
  const isSuperadmin = user?.role === 'superadmin';
  const canLogEntries = !!currentFactionMembership;

  const navItems = [
    {
      view: 'dashboard' as const,
      label: 'Dashboard',
      icon: LayoutDashboard,
    },
    {
      view: 'entries' as const,
      label: 'Entries',
      icon: List,
    },
    {
      view: 'payouts' as const,
      label: 'Payouts',
      icon: ArrowDownToLine,
    },
    {
      view: 'treasury' as const,
      label: 'Treasury',
      icon: Wallet,
    },
    {
      view: 'members' as const,
      label: 'Members',
      icon: Users,
    },
    {
      view: 'leaderboard' as const,
      label: 'Leaderboard',
      icon: Trophy,
    },
    {
      view: 'strikes' as const,
      label: 'Strikes',
      icon: AlertTriangle,
    },
    {
      view: 'settings' as const,
      label: 'Settings',
      icon: Settings,
      adminOnly: true,
    },
    {
      view: 'audit-logs' as const,
      label: 'Audit Logs',
      icon: ScrollText,
      adminOnly: true,
    },
    {
      view: 'reports' as const,
      label: 'Reports',
      icon: FileBarChart,
      adminOnly: true,
    },
    {
      view: 'admin-factions' as const,
      label: 'Faction Admin',
      icon: Shield,
      superadminOnly: true,
    },
  ];

  const handleNavClick = (view: string) => {
    if (view === 'member-profile') return;
    if (!selectedFactionId && view !== 'admin-factions' && view !== 'admin-faction-detail') {
      if (isSuperadmin) {
        setCurrentView('admin-factions');
        return;
      }
    }
    setCurrentView(view as AppView);
  };

  const renderView = () => {
    if (!selectedFactionId && currentView !== 'admin-factions' && currentView !== 'admin-faction-detail') {
      if (isSuperadmin) {
        requestAnimationFrame(() => setCurrentView('admin-factions'));
        return null;
      }
      return (
        <div className="flex items-center justify-center h-full text-zinc-500">
          <p>You are not a member of any faction. Contact a superadmin.</p>
        </div>
      );
    }

    switch (currentView) {
      case 'dashboard':
        return selectedFactionId ? <DashboardView factionId={selectedFactionId} /> : null;
      case 'entries':
        return selectedFactionId ? <EntriesView factionId={selectedFactionId} isAdmin={!!isAdmin} canLogEntries={canLogEntries} /> : null;
      case 'payouts':
        return selectedFactionId ? <PayoutsView factionId={selectedFactionId} /> : null;
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
        return selectedFactionId ? <SettingsView factionId={selectedFactionId} /> : null;
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
              onClick={toggleSidebar}
              className="w-full flex justify-center py-1"
              title="Expand sidebar"
            >
              <Coins className="h-4.5 w-4.5" style={{ color: brandColor }} />
            </button>
          )}
        </div>

        {/* Faction Selector */}
        {activeFactions.length > 0 && (
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
                  {activeFactions.map((f) => (
                    <SelectItem key={f.factionId} value={f.factionId}>
                      <span className="flex items-center gap-2">
                        <span>{f.factionName}</span>
                        {f.role === 'admin' && (
                          <span
                            className="text-[10px] px-1.5 py-0.5 rounded font-medium"
                            style={{ backgroundColor: `${brandColor}15`, color: brandColor }}
                          >
                            Admin
                          </span>
                        )}
                      </span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            ) : (
              <button
                onClick={toggleSidebar}
                className="w-full flex justify-center py-1"
                title="Expand sidebar"
              >
                <Coins className="h-4 w-4 text-zinc-500" />
              </button>
            )}
          </div>
        )}

        {/* Nav Items */}
        <nav className="flex-1 py-2 px-2 space-y-0.5 overflow-y-auto">
          {navItems.map((item) => {
            if (item.adminOnly && !isAdmin) return null;
            if (item.superadminOnly && !isSuperadmin) return null;
            const active = currentView === item.view;
            return (
              <button
                key={item.view}
                onClick={() => handleNavClick(item.view)}
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
            onClick={toggleSidebar}
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
              onClick={toggleSidebar}
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
                    {user?.username?.slice(0, 2).toUpperCase() ?? 'U'}
                  </AvatarFallback>
                </Avatar>
                <span className="hidden sm:inline text-sm text-zinc-300">
                  {user?.username}
                </span>
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuLabel>
                <div className="text-zinc-200">{user?.username}</div>
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
