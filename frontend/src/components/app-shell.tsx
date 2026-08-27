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
} from 'lucide-react';
import { DashboardView } from '@/views/dashboard-view';
import { EntriesView } from '@/views/entries-view';
import { MembersView } from '@/views/members-view';
import { SettingsView } from '@/views/settings-view';
import { AuditLogsView } from '@/views/audit-logs-view';
import { ReportsView } from '@/views/reports-view';
import { AdminFactionsView } from '@/views/admin-factions-view';
import { AdminFactionDetailView } from '@/views/admin-faction-detail-view';
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
  // Can log entries if the user is an actual member of the selected faction
  // (superadmins who are just browsing without membership cannot log entries)
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
      view: 'members' as const,
      label: 'Members',
      icon: Users,
      adminOnly: true,
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
    if (!selectedFactionId && view !== 'admin-factions' && view !== 'admin-faction-detail') {
      // No faction selected — superadmins go to admin panel, others see message
      if (isSuperadmin) {
        setCurrentView('admin-factions');
        return;
      }
    }
    setCurrentView(view as AppView);
  };

  const renderView = () => {
    // Superadmin with no faction selected — auto-redirect to admin panel
    if (!selectedFactionId && currentView !== 'admin-factions' && currentView !== 'admin-faction-detail') {
      if (isSuperadmin) {
        // Defer redirect to avoid setState during render
        requestAnimationFrame(() => setCurrentView('admin-factions'));
        return null;
      }
      return (
        <div className="flex items-center justify-center h-full text-muted-foreground">
          <p>You are not a member of any faction. Contact a superadmin.</p>
        </div>
      );
    }

    switch (currentView) {
      case 'dashboard':
        return selectedFactionId ? <DashboardView factionId={selectedFactionId} /> : null;
      case 'entries':
        return selectedFactionId ? <EntriesView factionId={selectedFactionId} isAdmin={!!isAdmin} canLogEntries={canLogEntries} /> : null;
      case 'members':
        return selectedFactionId ? <MembersView factionId={selectedFactionId} /> : null;
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

  // Inject brand color as CSS custom property on the root div
  const brandStyle = {
    '--brand-color': brandColor,
    '--brand-color-light': `${brandColor}20`,
    '--brand-color-medium': `${brandColor}40`,
  } as React.CSSProperties;

  return (
    <div className="min-h-screen flex bg-background" style={brandStyle}>
      {/* Sidebar */}
      <aside
        className={`fixed inset-y-0 left-0 z-50 flex flex-col border-r bg-card transition-all duration-300 lg:relative lg:z-auto ${sidebarOpen ? 'w-64' : 'w-0 lg:w-16'}`}
      >
        {/* Sidebar Header */}
        <div className="flex h-16 items-center gap-2 border-b px-4">
          {sidebarOpen && (
            <div className="flex items-center gap-2 overflow-hidden">
              <Coins className="h-6 w-6 shrink-0" style={{ color: brandColor }} />
              <span className="font-bold text-lg truncate">Faction Accountant</span>
            </div>
          )}
          {!sidebarOpen && (
            <Coins className="h-6 w-6 mx-auto" style={{ color: brandColor }} />
          )}
        </div>

        {/* Faction Selector */}
        {activeFactions.length > 0 && (
          <div className="px-3 py-3 border-b">
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
                <SelectTrigger className="w-full border-[var(--brand-color)]/30 focus:ring-[var(--brand-color)]/30">
                  <SelectValue placeholder="Select faction" />
                </SelectTrigger>
                <SelectContent>
                  {activeFactions.map((f) => (
                    <SelectItem key={f.factionId} value={f.factionId}>
                      <span className="flex items-center gap-2">
                        <span>{f.factionName}</span>
                        {f.role === 'admin' && (
                          <span className="text-xs px-1.5 py-0.5 rounded" style={{ backgroundColor: `${brandColor}15`, color: brandColor }}>Admin</span>
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
                <Coins className="h-5 w-5 text-muted-foreground" />
              </button>
            )}
          </div>
        )}

        {/* Nav Items */}
        <nav className="flex-1 py-2 px-2 space-y-1 overflow-y-auto">
          {navItems.map((item) => {
            if (item.adminOnly && !isAdmin) return null;
            if (item.superadminOnly && !isSuperadmin) return null;
            const active = currentView === item.view;
            return (
              <button
                key={item.view}
                onClick={() => handleNavClick(item.view)}
                className={`w-full flex items-center gap-3 rounded-md px-3 py-2.5 text-sm font-medium transition-colors ${
                  active
                    ? 'bg-[var(--brand-color)] text-white'
                    : 'text-muted-foreground hover:bg-accent hover:text-accent-foreground'
                } ${!sidebarOpen ? 'justify-center' : ''}`}
                title={!sidebarOpen ? item.label : undefined}
              >
                <item.icon className="h-5 w-5 shrink-0" />
                {sidebarOpen && <span className="truncate">{item.label}</span>}
              </button>
            );
          })}
        </nav>

        {/* Collapse button */}
        <div className="border-t p-2 hidden lg:block">
          <Button
            variant="ghost"
            size="sm"
            className="w-full"
            onClick={toggleSidebar}
          >
            <ChevronLeft className={`h-4 w-4 transition-transform ${!sidebarOpen ? 'rotate-180' : ''}`} />
            {sidebarOpen && <span className="ml-2">Collapse</span>}
          </Button>
        </div>
      </aside>

      {/* Mobile overlay */}
      {sidebarOpen && (
        <div
          className="fixed inset-0 z-40 bg-black/50 lg:hidden"
          onClick={() => setSidebarOpen(false)}
        />
      )}

      {/* Main Content */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* Header */}
        <header className="h-16 border-b bg-card flex items-center justify-between px-4 shrink-0">
          <div className="flex items-center gap-3">
            <Button
              variant="ghost"
              size="icon"
              className="lg:hidden"
              onClick={toggleSidebar}
            >
              <Menu className="h-5 w-5" />
            </Button>
            <h1 className="text-lg font-semibold">
              {navItems.find((i) => i.view === currentView)?.label ?? 'Faction Accountant'}
            </h1>
          </div>

          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" className="flex items-center gap-2">
                <Avatar className="h-8 w-8">
                  <AvatarImage src={user?.avatarUrl ?? undefined} />
                  <AvatarFallback>
                    {user?.username?.slice(0, 2).toUpperCase() ?? 'U'}
                  </AvatarFallback>
                </Avatar>
                <span className="hidden sm:inline text-sm font-medium">
                  {user?.username}
                </span>
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuLabel>
                <div>{user?.username}</div>
                <div className="text-xs text-muted-foreground font-normal">
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
        <main className="flex-1 p-4 md:p-6 overflow-auto">{renderView()}</main>
      </div>
    </div>
  );
}
