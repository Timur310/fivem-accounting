'use client';

import { useAppStore, DEFAULT_BRAND_COLOR } from '@/lib/store';
import { APP_COPYRIGHT, APP_VERSION, APP_VERSION_LABEL } from '@/lib/app-meta';
import { authApi, factionSettingsApi, supportApi } from '@/lib/api-client';
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
  SearchableSelect, type SearchableSelectOption,
} from '@/components/ui/searchable-select';
import {
  LayoutDashboard,
  LifeBuoy,
  Megaphone,
  Activity,
  Inbox,
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
  WashingMachine,
  BookOpen,
  Search,
} from 'lucide-react';
import { DashboardView } from '@/views/dashboard-view';
import { EntriesView } from '@/views/entries-view';
import { PayoutsView } from '@/views/payouts-view';
import { TreasuryView } from '@/views/treasury-view';
import { GuideView } from '@/views/guide-view';
import { CommandPalette } from '@/components/command-palette';
import { MembersView } from '@/views/members-view';
import { useToast } from '@/hooks/use-toast';
import { SettingsView } from '@/views/settings-view';
import { AuditLogsView } from '@/views/audit-logs-view';
import { ReportsView } from '@/views/reports-view';
import { AdminFactionsView } from '@/views/admin-factions-view';
import { AdminFactionDetailView } from '@/views/admin-faction-detail-view';
import { MemberProfileView } from '@/views/member-profile-view';
import { StrikesView } from '@/views/strikes-view';
import { LaunderingView } from '@/views/laundering-view';
import { LeaderboardView } from '@/views/leaderboard-view';
import { SupportView } from '@/views/support-view';
import { AnnouncementsView } from '@/views/announcements-view';
import { FeedView } from '@/views/feed-view';
import { AdminSupportView } from '@/views/admin-support-view';
import { useMemo, useState, useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { displayName } from '@/lib/format';
import type { AppView } from '@/lib/store';
import { LanguageSwitcher } from '@/components/language-switcher';
import { NotificationBell } from '@/components/notification-bell';
import { useTranslation } from '@/providers/i18n-provider';
import type { TranslationKey } from '@/lib/i18n';

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

type NavGroup = 'play' | 'manage' | 'admin';

interface NavItem {
  group: NavGroup;
  view: AppView;
  /** Translation key rather than text: the sidebar has to follow the language. */
  label: TranslationKey;
  icon: typeof LayoutDashboard;
  /** Any one of these is enough to see the item. */
  anyPermission?: FactionPermission[];
  /** Hide unless the user actually belongs to the selected faction. */
  membersOnly?: boolean;
  superadminOnly?: boolean;
  /** Unread-style count rendered on the right of the item, when above zero. */
  badgeCount?: number;
}

export function AppShell() {
  const { t } = useTranslation();
  const { toast } = useToast();
  const user = useAppStore((s) => s.user);
  const currentView = useAppStore((s) => s.currentView);
  const setCurrentView = useAppStore((s) => s.setCurrentView);
  const selectedFactionId = useAppStore((s) => s.selectedFactionId);
  const setSelectedFactionId = useAppStore((s) => s.setSelectedFactionId);
  const brandColor = useAppStore((s) => s.brandColor);
  const setBrandColor = useAppStore((s) => s.setBrandColor);
  const sidebarOpen = useAppStore((s) => s.sidebarOpen);
  const [paletteOpen, setPaletteOpen] = useState(false);
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

  // Keyed on the faction as well as the colour: two factions can share an
  // accent, and re-selecting has to re-apply it either way.
  useEffect(() => {
    if (factionSettings?.brandColor) {
      setBrandColor(factionSettings.brandColor);
    }
  }, [factionSettings?.brandColor, selectedFactionId, setBrandColor]);

  // ── Coming back from Discord ──
  // The bot-invite callback can only redirect to a fixed URL, so it says what
  // happened in a query parameter and the app turns that into a sentence. The
  // parameter is stripped afterwards: leaving it in the URL would replay the
  // toast on every refresh, and "connected!" on a reload is a lie half the
  // time.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const outcome = params.get('discord');
    if (!outcome) return;

    const messages: Record<string, { key: TranslationKey; ok: boolean }> = {
      linked: { key: 'discord.linked', ok: true },
      cancelled: { key: 'discord.linkCancelled', ok: false },
      expired: { key: 'discord.linkExpired', ok: false },
      forbidden: { key: 'discord.linkForbidden', ok: false },
      mismatch: { key: 'discord.linkMismatch', ok: false },
      guild_taken: { key: 'discord.linkGuildTaken', ok: false },
    };
    const message = messages[outcome] ?? { key: 'discord.linkFailed' as TranslationKey, ok: false };

    toast({
      title: t(message.key),
      variant: message.ok ? undefined : 'destructive',
    });

    // Land them back where they started, rather than on whichever screen the
    // app happened to open on.
    setCurrentView('settings');
    queryClient.invalidateQueries({ queryKey: ['discord-status'] });

    params.delete('discord');
    const query = params.toString();
    window.history.replaceState({}, '', `${window.location.pathname}${query ? `?${query}` : ''}`);
    // Runs once on mount: the parameter is consumed the first time it is seen.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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

  const isSuperadmin = user?.role === 'superadmin';

  /**
   * What the caller may do in the selected faction. Members carry the list
   * their rank grants.
   *
   * A superadmin holds everything, everywhere, membership or not — which is
   * what the API does too: `requireFactionMember` hands them the full
   * permission set on their global role alone. Reading it off the membership
   * instead used to make this screen stricter than the server, and in exactly
   * the case that bites: a superadmin who joins a faction as a plain member
   * gains a membership row with a rank that grants nothing, and lost menus the
   * API would have opened for them.
   */
  const hasPermission = (permission: FactionPermission) =>
    isSuperadmin || (currentFactionMembership?.permissions.includes(permission) ?? false);
  // A superadmin can book an entry into any faction, but only onto a member or
  // onto the faction itself — they are not on this roster, so there is nobody
  // for a self-credited entry to belong to. The API enforces the same rule.
  const canCreditSelf = !!currentFactionMembership;
  const canLogEntries = canCreditSelf || isSuperadmin;

  // Superadmins with no memberships can still browse any faction. Surface
  // those alongside active memberships so the selector is never empty.
  const browseableFactions = user?.browseableFactions ?? [];
  const browseableOnly = browseableFactions.filter(
    (b) => !activeFactions.some((m) => m.factionId === b.id),
  );

  // Every row wears its own faction's colour. Using the store value here
  // painted the whole list in the selected faction's colour, which told you
  // nothing.
  const factionOptions = useMemo<SearchableSelectOption[]>(() => {
    const swatch = (color: string) => (
      <span
        className="h-2.5 w-2.5 shrink-0 rounded-full"
        style={{ backgroundColor: color }}
        aria-hidden="true"
      />
    );
    return [
      ...activeFactions.map((f) => {
        const rowColor = f.factionBrandColor ?? DEFAULT_BRAND_COLOR;
        return {
          value: f.factionId,
          label: f.factionName,
          icon: swatch(rowColor),
          badge: f.role === 'admin' ? (
            <span
              className="shrink-0 rounded px-1.5 py-0.5 text-[10px] font-medium"
              style={{ backgroundColor: `${rowColor}15`, color: rowColor }}
            >
              {t('role.admin')}
            </span>
          ) : undefined,
        };
      }),
      ...browseableOnly.map((b) => ({
        value: b.id,
        label: b.name,
        icon: swatch(b.brandColor ?? DEFAULT_BRAND_COLOR),
        badge: (
          <span className="shrink-0 rounded bg-white/[0.06] px-1.5 py-0.5 text-[10px] font-medium text-zinc-400">
            {t('faction.browse')}
          </span>
        ),
      })),
    ];
  }, [activeFactions, browseableOnly, t]);

  // How many tickets are still waiting, for the inbox badge. Superadmin-only
  // endpoint, so it is not even asked for by anyone else.
  const { data: openTickets } = useQuery({
    queryKey: ['support-open-count'],
    queryFn: () => supportApi.openCount(),
    enabled: !!isSuperadmin,
    staleTime: 60 * 1000,
  });
  const openTicketCount = openTickets?.open ?? 0;

  const navItems: NavItem[] = [
    { group: 'play', view: 'dashboard', label: 'nav.dashboard', icon: LayoutDashboard },
    { group: 'play', view: 'entries', label: 'nav.entries', icon: List },
    { group: 'play', view: 'payouts', label: 'nav.withdrawals', icon: ArrowDownToLine },
    { group: 'manage', view: 'treasury', label: 'nav.treasury', icon: Wallet },
    {
      group: 'manage',
      view: 'laundering',
      label: 'nav.laundering',
      icon: WashingMachine,
      anyPermission: ['manage_laundering'],
    },
    { group: 'manage', view: 'members', label: 'nav.members', icon: Users },
    { group: 'play', view: 'leaderboard', label: 'nav.leaderboard', icon: Trophy },
    // Everyone reads the board; posting is gated inside the view.
    { group: 'play', view: 'announcements', label: 'nav.announcements', icon: Megaphone },
    // The timeline is scoped per source inside the query, so it needs no
    // permission of its own: everyone sees their own slice of it.
    { group: 'play', view: 'feed', label: 'nav.feed', icon: Activity },
    { group: 'manage', view: 'strikes', label: 'nav.strikes', icon: AlertTriangle },
    {
      group: 'manage',
      view: 'settings',
      label: 'nav.settings',
      icon: Settings,
      // Mirrors the PATCH guard: either permission opens the settings screen.
      anyPermission: ['manage_settings', 'manage_customization'],
    },
    {
      group: 'manage',
      view: 'audit-logs',
      label: 'nav.auditLogs',
      icon: ScrollText,
      anyPermission: ['view_audit_logs'],
      // Only ever your own faction's history — a superadmin passing through a
      // faction they do not belong to has no business reading it.
      membersOnly: true,
    },
    { group: 'manage', view: 'reports', label: 'nav.reports', icon: FileBarChart, anyPermission: ['view_reports'] },
    { group: 'admin', view: 'admin-factions', label: 'nav.factionAdmin', icon: Shield, superadminOnly: true },
    // The guide is for everyone, in every faction — the last item, never hidden.
    // Support sits with the player screens and carries no permission: the
    // people most likely to hit a bug are the ones with the fewest rights.
    { group: 'play', view: 'support', label: 'nav.support', icon: LifeBuoy },
    { group: 'play', view: 'guide', label: 'nav.guide', icon: BookOpen },
    {
      group: 'admin',
      view: 'admin-support',
      label: 'nav.supportInbox',
      icon: Inbox,
      superadminOnly: true,
      badgeCount: openTicketCount,
    },
  ];

  const isNavItemVisible = (item: NavItem) => {
    // Every screen, in every faction. `membersOnly` guards a faction's own
    // history from people passing through, and a superadmin is not passing
    // through — the audit log route lets them read it either way, so hiding
    // the menu only made them wonder where it went.
    if (isSuperadmin) return true;
    if (item.superadminOnly) return false;
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

  /**
   * Screens that do not belong to a faction and must stay reachable when none
   * is selected. Support is on this list for a concrete reason: a superadmin
   * with no membership anywhere would otherwise be bounced to the faction list
   * every time they tried to open their own ticket inbox.
   */
  const FACTIONLESS_VIEWS: AppView[] = [
    'admin-factions', 'admin-faction-detail', 'support', 'admin-support', 'guide',
  ];

  const handleNavClick = (view: AppView) => {
    if (view === 'member-profile') return;
    // Closing after navigation is a mobile affordance: there the sidebar covers
    // the page. Beside the content it is not in the way, and collapsing it on
    // every click threw away whatever the user had chosen.
    if (!isDesktop()) setSidebarOpen(false);
    if (!selectedFactionId && !FACTIONLESS_VIEWS.includes(view)) {
      if (isSuperadmin) {
        setCurrentView('admin-factions');
        return;
      }
    }
    setCurrentView(view);
  };

  const renderView = () => {
    if (!selectedFactionId && !FACTIONLESS_VIEWS.includes(currentView)) {
      if (isSuperadmin) {
        queueMicrotask(() => setCurrentView('admin-factions'));
        return null;
      }
      return (
        <div className="flex flex-col items-center justify-center h-full text-zinc-500 gap-3 py-12">
          <p>{t('faction.noneForYou')}</p>
          <Button variant="outline" size="sm" onClick={handleLogout} disabled={loggingOut}>
            <LogOut className="mr-2 h-4 w-4" /> {t('auth.signOut')}
          </Button>
        </div>
      );
    }

    switch (currentView) {
      case 'guide':
        return <GuideView />;
      // Neither of these is faction-scoped, so both sit above the
      // selected-faction guard alongside the guide.
      case 'support':
        return <SupportView />;
      case 'feed':
        return selectedFactionId ? <FeedView factionId={selectedFactionId} /> : null;
      case 'announcements':
        return selectedFactionId ? <AnnouncementsView factionId={selectedFactionId} canManage={hasPermission('manage_settings')} /> : null;
      case 'admin-support':
        return <AdminSupportView />;
      case 'dashboard':
        return selectedFactionId ? <DashboardView factionId={selectedFactionId} canLogEntries={canLogEntries} isFactionMember={canCreditSelf} /> : null;
      case 'entries':
        return selectedFactionId ? <EntriesView factionId={selectedFactionId} isAdmin={!!isAdmin} canLogEntries={canLogEntries} canCreditSelf={canCreditSelf} canManageEntries={hasPermission('manage_entries')} /> : null;
      case 'payouts':
        return selectedFactionId ? <PayoutsView factionId={selectedFactionId} canManagePayouts={hasPermission('manage_payouts')} /> : null;
      case 'laundering':
        return selectedFactionId ? <LaunderingView factionId={selectedFactionId} /> : null;
      case 'treasury':
        return selectedFactionId ? <TreasuryView factionId={selectedFactionId} canManageExpenses={hasPermission('manage_expenses')} canManageChecks={hasPermission('manage_payouts')} /> : null;
      case 'members':
        return selectedFactionId ? <MembersView factionId={selectedFactionId} isFactionAdmin={!!isAdmin} canManageMembers={hasPermission('manage_members')} /> : null;
      case 'member-profile':
        return (selectedFactionId && selectedMemberUserId) ? <MemberProfileView
            factionId={selectedFactionId}
            userId={selectedMemberUserId}
            canManageStrikes={hasPermission('manage_strikes')}
          /> : null;
      case 'strikes':
        return selectedFactionId ? <StrikesView factionId={selectedFactionId} canManageStrikes={hasPermission('manage_strikes')} /> : null;
      case 'leaderboard':
        return selectedFactionId ? <LeaderboardView factionId={selectedFactionId} isSuperadmin={!!isSuperadmin} /> : null;
      case 'settings':
        return selectedFactionId ? <SettingsView
            factionId={selectedFactionId}
            isFactionAdmin={!!isAdmin}
            canManageItemTypes={hasPermission('manage_item_types')}
            canManageQuotas={hasPermission('manage_quotas')}
            canManageSettings={hasPermission('manage_settings')}
            canManageDiscord={hasPermission('manage_discord')}
          /> : null;
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

  // Radix renders dialogs, selects and dropdowns into a portal on <body>,
  // which is outside this subtree. Scoped to the shell alone, the brand
  // variables never reached them: `var(--brand-color, #6366f1)` fell through
  // to the hardcoded default, so a selected button inside a dialog came out
  // indigo while the rest of the app wore the faction's colour. The document
  // element is the one ancestor every portal shares.
  //
  // The inline style above stays: it covers the shell's own first paint,
  // before this effect has run.
  useEffect(() => {
    const root = document.documentElement;
    root.style.setProperty('--brand-color', brandColor);
    root.style.setProperty('--brand-color-light', `${brandColor}20`);
    root.style.setProperty('--brand-color-medium', `${brandColor}40`);
    return () => {
      // Do not leave a faction's colour behind on the login screen.
      root.style.removeProperty('--brand-color');
      root.style.removeProperty('--brand-color-light');
      root.style.removeProperty('--brand-color-medium');
    };
  }, [brandColor]);

  // The selector combines memberships (admin/member) and browseable factions
  // (superadmin-only, marked with a Browse badge so the role is clear).
  const showFactionSelector = activeFactions.length > 0 || browseableOnly.length > 0;

  return (
    <div className="min-h-screen flex bg-background dot-grid" style={brandStyle}>
      {/* Sidebar */}
      <aside
        className={`fixed inset-y-0 left-0 z-50 flex flex-col border-r border-white/[0.06] bg-[#09090b] transition-all duration-300 lg:sticky lg:top-0 lg:h-screen lg:z-auto ${sidebarOpen ? 'w-60' : 'w-0 lg:w-[52px]'}`}>
        {/* Nav scrolls inside the sidebar; the rail itself stays pinned, so the
            collapse button is reachable on pages of any length. */}
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
                {t('app.name')}
              </span>
            </div>
          )}
          {!sidebarOpen && (
            <button
              onClick={handleSidebarToggle}
              className="w-full flex justify-center py-1"
              title={t('nav.expandSidebar')}
              aria-label={t('nav.expandSidebar')}
            >
              <Coins className="h-4.5 w-4.5" style={{ color: brandColor }} />
            </button>
          )}
        </div>

        {/* Faction Selector */}
        {showFactionSelector && (
          <div className="px-2.5 py-2.5 border-b border-white/[0.06]">
            {sidebarOpen ? (
              <SearchableSelect
                aria-label={t('faction.select')}
                value={selectedFactionId ?? ''}
                onValueChange={(val) => {
                  setSelectedFactionId(val);
                  if (currentView === 'admin-factions' || currentView === 'admin-faction-detail') {
                    setCurrentView('dashboard');
                  }
                }}
                options={factionOptions}
                placeholder={t('faction.select')}
                searchPlaceholder={t('faction.search')}
                emptyMessage={t('faction.noneMatch')}
              />
            ) : (
              <button
                onClick={handleSidebarToggle}
                className="w-full flex justify-center py-1"
                title={t('nav.expandSidebar')}
                aria-label={t('nav.expandSidebar')}
              >
                <Coins className="h-4 w-4 text-zinc-500" />
              </button>
            )}
          </div>
        )}

        {/* Nav Items */}
        <nav className="flex-1 py-2 px-2 space-y-0.5 overflow-y-auto">
          {(['play', 'manage', 'admin'] as const).map((group) => {
            const items = navItems.filter((g) => g.group === group && isNavItemVisible(g));
            if (items.length === 0) return null;
            const groupLabel = group === 'play' ? t('nav.groupPlay') : group === 'manage' ? t('nav.groupManage') : t('nav.groupAdmin');
            return (
              <div key={group} className="mb-1">
                {sidebarOpen && (
                  <p className="px-2.5 pt-2 pb-1 text-[10px] uppercase tracking-wider text-zinc-600">{groupLabel}</p>
                )}
                {!sidebarOpen && <div className="mx-2 my-2 border-t border-white/[0.06]" />}
                {items.map((item) => {
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
                      title={!sidebarOpen ? t(item.label) : undefined}
                    >
                      <item.icon className={`h-4 w-4 shrink-0 ${active ? '' : 'opacity-60'}`} />
                      {sidebarOpen && <span className="truncate">{t(item.label)}</span>}
                      {!!item.badgeCount && (
                        <span
                          className={`ml-auto shrink-0 rounded-full bg-amber-500/15 text-amber-300 text-[10px] tabular-nums ${
                            sidebarOpen ? 'px-1.5 py-0.5' : 'absolute translate-x-3 -translate-y-2 px-1'
                          }`}
                        >
                          {item.badgeCount}
                        </span>
                      )}
                    </button>
                  );
                })}
              </div>
            );
          })}
        </nav>

        {/* Build and attribution. Collapsed to the version alone in the icon
            rail, where there is no room for a name — and dropped entirely on
            mobile, where the sidebar is an overlay over the page. */}
        <div className="border-t border-white/[0.06] px-3 py-2 hidden lg:block">
          {sidebarOpen ? (
            <div className="space-y-0.5 text-[10px] leading-relaxed text-zinc-600">
              <p className="tabular-nums">{t('app.version', { version: APP_VERSION })}</p>
              <p>{APP_COPYRIGHT}</p>
              <p>{t('app.allRightsReserved')}</p>
            </div>
          ) : (
            <p
              className="text-center text-[10px] tabular-nums text-zinc-600"
              title={`${APP_VERSION_LABEL} · ${APP_COPYRIGHT} ${t('app.allRightsReserved')}`}
            >
              {APP_VERSION_LABEL}
            </p>
          )}
        </div>

        {/* Collapse button */}
        <div className="border-t border-white/[0.06] p-1.5 hidden lg:block">
          <Button
            variant="ghost"
            size="sm"
            className="w-full text-zinc-500 hover:text-zinc-300"
            onClick={handleSidebarToggle}
          >
            <ChevronLeft className={`h-3.5 w-3.5 transition-transform duration-200 ${!sidebarOpen ? 'rotate-180' : ''}`} />
            {sidebarOpen && <span className="ml-2 text-xs">{t('nav.collapse')}</span>}
          </Button>
        </div>
      </aside>

      <CommandPalette
        open={paletteOpen}
        onOpenChange={setPaletteOpen}
        views={navItems.filter(isNavItemVisible).map((i) => ({ view: i.view, label: i.label }))}
      />

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
              aria-label={t('nav.toggle')}
            >
              <Menu className="h-5 w-5" />
            </Button>
            <h1 className="text-sm font-medium text-zinc-300">
              {currentView === 'member-profile'
                ? t('nav.memberProfile')
                : t(navItems.find((i) => i.view === currentView)?.label ?? 'app.name')}
            </h1>
          </div>

          <div className="flex items-center gap-1">
          <Button
            variant="ghost"
            size="sm"
            className="hidden md:flex items-center gap-2 text-xs text-zinc-500 hover:text-zinc-300 border border-white/[0.06] rounded-md px-2 h-7"
            onClick={() => setPaletteOpen(true)}
            aria-label={t('palette.placeholder')}
          >
            <Search className="h-3.5 w-3.5" />
            {t('palette.search')}
            <kbd className="text-[10px] text-zinc-600 border border-white/[0.08] rounded px-1">Ctrl K</kbd>
          </Button>
          {/* Left of the language switcher and the avatar: the bell is a thing
              that changes on its own, so it sits where the eye already goes
              for the account controls rather than competing with navigation. */}
          <NotificationBell />
          <LanguageSwitcher className="text-zinc-400" />

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
                    ? t('role.superadmin')
                    : user?.role === 'faction_admin'
                      ? t('role.factionAdmin')
                      : t('role.member')}
                </div>
              </DropdownMenuLabel>
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={handleLogout} disabled={loggingOut}>
                <LogOut className="mr-2 h-4 w-4" />
                {loggingOut ? t('auth.signingOut') : t('auth.signOut')}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
          </div>
        </header>

        {/* Page Content */}
        <main className="flex-1 p-4 md:p-6 overflow-auto">
          {/* Capped reading width: on a wide desktop the views otherwise
              stretch edge-to-edge and the first glance has nowhere to land. */}
          <div className="animate-fade-in w-full max-w-7xl mx-auto">
            {renderView()}
          </div>
        </main>
      </div>
    </div>
  );
}
