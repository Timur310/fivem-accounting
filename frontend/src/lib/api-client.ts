'use client';

import axios from 'axios';
import type {
  ApiSuccessResponse,
  User,
  Faction,
  FactionDetail,
  CreateFactionInput,
  UpdateFactionInput,
  Member,
  ItemType,
  CreateItemTypeInput,
  UpdateItemTypeInput,
  Entry,
  CreateEntryInput,
  UpdateEntryInput,
  DashboardData,
  AuditLog,
  Quota,
  CreateQuotaInput,
  QuotaHistoryData,
  UpdateQuotaInput,
  ChartData,
  AdminAnalytics,
  ReportSummary,
  ReportComparison,
  BulkAddResult,
  BulkDeleteResult,
  CsvImportResult,
  SupportTicket,
  SupportTicketAdminRow,
  SupportTicketKind,
  SupportTicketStatus,
  CreateSupportTicketInput,
  AppNotification,
  Announcement,
  FeedItem,
  FeedType,
  AnnouncementRead,
  CreateAnnouncementInput,
  UpdateAnnouncementInput,
  Payout,
  CreatePayoutInput,
  UpdatePayoutInput,
  EvenSplitInput,
  EvenSplitResult,
  ExpenseListData,
  Expense,
  CreateExpenseInput,
  UpdateExpenseInput,
  ConfigImportResult,
  TreasuryData,
  TreasuryChecksData,
  TreasuryCheckRow,
  CreateTreasuryCheckInput,
  MemberProfile,
  MemberHistoryEntry,
  MemberNote,
  CreateNoteInput,
  UpdateNoteInput,
  Strike,
  CreateStrikeInput,
  FactionStrikesData,
  FactionSettings,
  UpdateFactionSettingsInput,
  HeatmapResult,
  LeaderboardData,
  GlobalLeaderboardData,
  GrowthData,
  AdminUser,
  ProvisionalUser,
  CreateProvisionalUserInput,
  UpdateProvisionalUserInput,
  LaunderingOverview,
  LaunderInput,
  LaunderResult,
  DiscordStatus,
  DiscordChannel,
  DiscordEventType,
} from './api-types';

const API_BASE = process.env.NEXT_PUBLIC_API_URL || '';

const api = axios.create({
  baseURL: `${API_BASE}/api/v1`,
  withCredentials: true,
  timeout: 15_000,
  headers: { 'Content-Type': 'application/json' },
});

// 401 interceptor: clear any cached identity and bounce to the login page.
// We import the store lazily so axios (loaded first) doesn't create a cycle.
api.interceptors.response.use(
  (res) => res,
  (err: unknown) => {
    if (
      err &&
      typeof err === 'object' &&
      'response' in err &&
      (err as { response?: { status?: number } }).response?.status === 401
    ) {
      import('./store')
        .then(({ useAppStore }) => {
          useAppStore.getState().setUser(null);
          useAppStore.getState().setCurrentView('login');
        })
        .catch(() => {
          /* store not yet loaded — page.tsx will redirect on its own */
        });
    }
    return Promise.reject(err);
  },
);

// ── Helper ──
function unwrap<T>(res: { data: ApiSuccessResponse<T> }): T {
  return res.data.data;
}

/** Best-effort message extraction for axios-style errors. */
export function apiErrorMessage(err: unknown, fallback = 'Unknown error'): string {
  if (err && typeof err === 'object' && 'isAxiosError' in err) {
    const axiosErr = err as { response?: { data?: { error?: { message?: string } } }; message?: string };
    return axiosErr.response?.data?.error?.message ?? axiosErr.message ?? fallback;
  }
  if (err instanceof Error) return err.message;
  return fallback;
}

// ── Auth ──

export const authApi = {
  getMe: () => api.get<ApiSuccessResponse<User>>('/auth/me').then(unwrap),
  updateMe: (input: { inGameName: string }) =>
    api.patch<ApiSuccessResponse<User>>('/auth/me', input).then(unwrap),
  logout: () => api.post('/auth/logout'),
  getDiscordLoginUrl: () => `${API_BASE}/api/v1/auth/discord`,
};

// ── Factions (superadmin) ──

export const factionsApi = {
  list: (params?: { search?: string; page?: number; page_size?: number; active?: 'true' | 'false' }) =>
    api
      .get<ApiSuccessResponse<Faction[]>>('/factions', { params })
      .then((r) => ({ data: r.data.data, meta: r.data.meta })),

  get: (id: string) =>
    api.get<ApiSuccessResponse<FactionDetail>>(`/factions/${id}`).then(unwrap),

  create: (input: CreateFactionInput) =>
    api.post<ApiSuccessResponse<Faction>>('/factions', input).then(unwrap),

  update: (id: string, input: UpdateFactionInput) =>
    api.patch<ApiSuccessResponse<Faction>>(`/factions/${id}`, input).then(unwrap),

  remove: (id: string) => api.delete(`/factions/${id}`),
};

// ── Members ──

export const membersApi = {
  list: (factionId: string) =>
    api
      .get<ApiSuccessResponse<Member[]>>(`/factions/${factionId}/members`)
      .then(unwrap),

  add: (factionId: string, discordIdOrUserId: string) =>
    api
      .post<ApiSuccessResponse<Member>>(`/factions/${factionId}/members`, {
        ...(discordIdOrUserId.match(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i)
          ? { userId: discordIdOrUserId }
          : { discordId: discordIdOrUserId }),
      })
      .then(unwrap),

  search: (factionId: string, query: string) =>
    api
      .get<ApiSuccessResponse<{ id: string; username: string; inGameName: string | null; avatarUrl: string | null; discordId: string }[]>>(
        `/factions/${factionId}/members/search`,
        { params: { q: query } },
      )
      .then(unwrap),

  updateRole: (factionId: string, userId: string, role: 'admin' | 'member') =>
    api
      .patch<ApiSuccessResponse<Member>>(`/factions/${factionId}/members/${userId}`, {
        role,
      })
      .then(unwrap),

  updateRank: (factionId: string, userId: string, rank: string | null) =>
    api
      .patch<ApiSuccessResponse<Member>>(`/factions/${factionId}/members/${userId}`, {
        rank,
      })
      .then(unwrap),

  /** null clears it, which puts the Discord username back on screen. */
  updateInGameName: (factionId: string, userId: string, inGameName: string | null) =>
    api
      .patch<ApiSuccessResponse<Member>>(`/factions/${factionId}/members/${userId}`, {
        inGameName,
      })
      .then(unwrap),

  remove: (factionId: string, userId: string) =>
    api.delete(`/factions/${factionId}/members/${userId}`),

  // Phase 5: Member profile
  getProfile: (factionId: string, userId: string) =>
    api
      .get<ApiSuccessResponse<MemberProfile>>(`/factions/${factionId}/members/${userId}`)
      .then(unwrap),

  // Phase 5: Member history
  getHistory: (factionId: string, userId: string, page?: number, pageSize?: number) =>
    api
      .get<ApiSuccessResponse<MemberHistoryEntry[]>>(`/factions/${factionId}/members/${userId}/history`, {
        params: { page, page_size: pageSize },
      })
      .then((r) => ({ data: r.data.data, meta: r.data.meta })),

  // Phase 7: Heatmap
  getHeatmap: (factionId: string, userId: string, year?: number) =>
    api
      .get<ApiSuccessResponse<HeatmapResult>>(`/factions/${factionId}/members/${userId}/heatmap`, {
        params: year ? { year } : undefined,
      })
      .then(unwrap),
};

// ── Phase 5: Member Notes (admin only) ──

export const notesApi = {
  list: (factionId: string, userId: string, params?: { category?: string; flagged_only?: string }) =>
    api
      .get<ApiSuccessResponse<MemberNote[]>>(`/factions/${factionId}/members/${userId}/notes`, { params })
      .then(unwrap),

  create: (factionId: string, userId: string, input: CreateNoteInput) =>
    api
      .post<ApiSuccessResponse<MemberNote>>(`/factions/${factionId}/members/${userId}/notes`, input)
      .then(unwrap),

  update: (factionId: string, userId: string, noteId: string, input: UpdateNoteInput) =>
    api
      .patch<ApiSuccessResponse<MemberNote>>(`/factions/${factionId}/members/${userId}/notes/${noteId}`, input)
      .then(unwrap),

  remove: (factionId: string, userId: string, noteId: string) =>
    api.delete(`/factions/${factionId}/members/${userId}/notes/${noteId}`),
};

// ── Phase 5: Member Strikes ──

export const memberStrikesApi = {
  list: (factionId: string, userId: string) =>
    api
      .get<ApiSuccessResponse<Strike[]>>(`/factions/${factionId}/members/${userId}/strikes`)
      .then(unwrap),

  issue: (factionId: string, userId: string, input: CreateStrikeInput) =>
    api
      .post<ApiSuccessResponse<Strike>>(`/factions/${factionId}/members/${userId}/strikes`, input)
      .then(unwrap),

  update: (factionId: string, userId: string, strikeId: string, status: 'appealed' | 'revoked' | 'active') =>
    api
      .patch<ApiSuccessResponse<Strike>>(`/factions/${factionId}/members/${userId}/strikes/${strikeId}`, { status })
      .then(unwrap),
};

// ── Phase 5: Faction Strikes (admin overview) ──

export const factionStrikesApi = {
  list: (factionId: string, params?: {
    status?: string;
    severity?: string;
    sort?: string;
    dir?: 'asc' | 'desc';
    user_id?: string;
    page?: number;
    page_size?: number;
  }) =>
    api
      .get<ApiSuccessResponse<FactionStrikesData>>(`/factions/${factionId}/strikes`, { params })
      .then((r) => ({ data: r.data.data, meta: r.data.meta })),
};

// ── Phase 5: Faction Settings ──

export const factionSettingsApi = {
  get: (factionId: string) =>
    api
      .get<ApiSuccessResponse<FactionSettings>>(`/factions/${factionId}/settings`)
      .then(unwrap),

  update: (factionId: string, input: UpdateFactionSettingsInput) =>
    api
      .patch<ApiSuccessResponse<FactionSettings>>(`/factions/${factionId}/settings`, input)
      .then(unwrap),
};

// ── Item Types ──

export const itemTypesApi = {
  list: (factionId: string) =>
    api
      .get<ApiSuccessResponse<ItemType[]>>(`/factions/${factionId}/item-types`)
      .then(unwrap),

  create: (factionId: string, input: CreateItemTypeInput) =>
    api
      .post<ApiSuccessResponse<ItemType>>(`/factions/${factionId}/item-types`, input)
      .then(unwrap),

  update: (factionId: string, typeId: string, input: UpdateItemTypeInput) =>
    api
      .patch<ApiSuccessResponse<ItemType>>(
        `/factions/${factionId}/item-types/${typeId}`,
        input,
      )
      .then(unwrap),

  remove: (factionId: string, typeId: string) =>
    api.delete(`/factions/${factionId}/item-types/${typeId}`),
};

// ── Entries ──

export const entriesApi = {
  list: (
    factionId: string,
    params?: {
      item_type_id?: string;
      user_id?: string;
      date_from?: string;
      date_to?: string;
      search?: string;
      page?: number;
      page_size?: number;
      sort?: string;
      dir?: 'asc' | 'desc';
    },
  ) =>
    api
      .get<ApiSuccessResponse<Entry[]>>(`/factions/${factionId}/entries`, {
        params,
      })
      .then((r) => ({ data: r.data.data, meta: r.data.meta })),

  create: (factionId: string, input: CreateEntryInput) =>
    api
      .post<ApiSuccessResponse<Entry>>(`/factions/${factionId}/entries`, input)
      .then(unwrap),

  update: (factionId: string, entryId: string, input: UpdateEntryInput) =>
    api
      .patch<ApiSuccessResponse<Entry>>(
        `/factions/${factionId}/entries/${entryId}`,
        input,
      )
      .then(unwrap),

  remove: (factionId: string, entryId: string) =>
    api.delete(`/factions/${factionId}/entries/${entryId}`),
};

// ── Dashboard ──

export const dashboardApi = {
  get: (factionId: string) =>
    api
      .get<ApiSuccessResponse<DashboardData>>(`/factions/${factionId}/dashboard`)
      .then(unwrap),
};

// ── Audit Logs ──

export const auditLogsApi = {
  list: (
    factionId: string,
    params?: {
      action?: string;
      entity_type?: string;
      date_from?: string;
      date_to?: string;
      user_id?: string;
      page?: number;
      page_size?: number;
    },
  ) =>
    api
      .get<ApiSuccessResponse<AuditLog[]>>(`/factions/${factionId}/audit-logs`, {
        params,
      })
      .then((r) => ({ data: r.data.data, meta: r.data.meta })),
};

// ── Quotas ──

export const quotasApi = {
  list: (factionId: string) =>
    api
      .get<ApiSuccessResponse<Quota[]>>(`/factions/${factionId}/quotas`)
      .then(unwrap),

  history: (factionId: string, quotaId: string, userId?: string) =>
    api
      .get<ApiSuccessResponse<QuotaHistoryData>>(`/factions/${factionId}/quotas/${quotaId}/history`, {
        params: userId ? { user_id: userId } : undefined,
      })
      .then(unwrap),

  create: (factionId: string, input: CreateQuotaInput) =>
    api
      .post<ApiSuccessResponse<Quota>>(`/factions/${factionId}/quotas`, input)
      .then(unwrap),

  update: (factionId: string, quotaId: string, input: UpdateQuotaInput) =>
    api
      .patch<ApiSuccessResponse<Quota>>(
        `/factions/${factionId}/quotas/${quotaId}`,
        input,
      )
      .then(unwrap),

  remove: (factionId: string, quotaId: string) =>
    api.delete(`/factions/${factionId}/quotas/${quotaId}`),
};

// ── Payouts ──

export const payoutsApi = {
  list: (
    factionId: string,
    params?: {
      item_type_id?: string;
      recipient_user_id?: string;
      status?: string;
      date_from?: string;
      date_to?: string;
      page?: number;
      page_size?: number;
      sort?: string;
      dir?: 'asc' | 'desc';
    },
  ) =>
    api
      .get<ApiSuccessResponse<Payout[]>>(`/factions/${factionId}/payouts`, {
        params,
      })
      .then((r) => ({ data: r.data.data, meta: r.data.meta })),

  create: (factionId: string, input: CreatePayoutInput) =>
    api
      .post<ApiSuccessResponse<Payout>>(`/factions/${factionId}/payouts`, input)
      .then(unwrap),

  update: (factionId: string, payoutId: string, input: UpdatePayoutInput) =>
    api
      .patch<ApiSuccessResponse<Payout>>(
        `/factions/${factionId}/payouts/${payoutId}`,
        input,
      )
      .then(unwrap),

  remove: (factionId: string, payoutId: string) =>
    api.delete(`/factions/${factionId}/payouts/${payoutId}`),

  evenSplit: (factionId: string, input: EvenSplitInput) =>
    api
      .post<ApiSuccessResponse<EvenSplitResult>>(
        `/factions/${factionId}/payouts/even-split`,
        input,
      )
      .then(unwrap),
};

// ── Treasury ──

export const treasuryApi = {
  get: (factionId: string, trendDays?: number) =>
    api
      .get<ApiSuccessResponse<TreasuryData>>(`/factions/${factionId}/treasury`, {
        params: trendDays ? { trend_days: trendDays } : undefined,
      })
      .then(unwrap),

  listChecks: (factionId: string) =>
    api
      .get<ApiSuccessResponse<TreasuryChecksData>>(`/factions/${factionId}/treasury/checks`)
      .then(unwrap),

  createCheck: (factionId: string, input: CreateTreasuryCheckInput) =>
    api
      .post<ApiSuccessResponse<TreasuryCheckRow>>(`/factions/${factionId}/treasury/checks`, input)
      .then(unwrap),
};

// ── Expenses ──

export const expensesApi = {
  list: (factionId: string, params?: {
    category?: string;
    item_type_id?: string;
    date_from?: string;
    date_to?: string;
    page?: number;
    page_size?: number;
  }) =>
    api
      .get<ApiSuccessResponse<ExpenseListData>>(`/factions/${factionId}/expenses`, { params })
      .then(unwrap),

  create: (factionId: string, input: CreateExpenseInput) =>
    api
      .post<ApiSuccessResponse<Expense>>(`/factions/${factionId}/expenses`, input)
      .then(unwrap),

  update: (factionId: string, expenseId: string, input: UpdateExpenseInput) =>
    api
      .patch<ApiSuccessResponse<Expense>>(`/factions/${factionId}/expenses/${expenseId}`, input)
      .then(unwrap),

  remove: (factionId: string, expenseId: string) =>
    api.delete<ApiSuccessResponse<{ id: string; deleted: boolean }>>(
      `/factions/${factionId}/expenses/${expenseId}`,
    ),
};

// ── Provisional users (superadmin) ──

/** The whole population, for the superadmin roster. Superadmin only. */
export const adminUsersApi = {
  list: () =>
    api
      .get<ApiSuccessResponse<AdminUser[]>>('/admin/users')
      .then(unwrap),
};

export const provisionalUsersApi = {
  list: () =>
    api
      .get<ApiSuccessResponse<ProvisionalUser[]>>('/admin/provisional-users')
      .then(unwrap),

  create: (input: CreateProvisionalUserInput) =>
    api
      .post<ApiSuccessResponse<ProvisionalUser>>('/admin/provisional-users', input)
      .then(unwrap),

  update: (userId: string, input: UpdateProvisionalUserInput) =>
    api
      .patch<ApiSuccessResponse<ProvisionalUser>>(`/admin/provisional-users/${userId}`, input)
      .then(unwrap),

  remove: (userId: string) => api.delete(`/admin/provisional-users/${userId}`),
};

// ── Laundering ──

export const launderingApi = {
  get: (factionId: string) =>
    api
      .get<ApiSuccessResponse<LaunderingOverview>>(`/factions/${factionId}/laundering`)
      .then(unwrap),

  launder: (factionId: string, input: LaunderInput) =>
    api
      .post<ApiSuccessResponse<LaunderResult>>(`/factions/${factionId}/laundering`, input)
      .then(unwrap),
};

// ── Charts ──

export const chartsApi = {
  get: (factionId: string, range?: string) =>
    api
      .get<ApiSuccessResponse<ChartData>>(`/factions/${factionId}/charts`, {
        params: range ? { range } : undefined,
      })
      .then(unwrap),
};

// ── Export (CSV download) ──

export const exportApi = {
  /** Returns the full URL for the browser to download directly */
  entriesUrl: (factionId: string, params?: { date_from?: string; date_to?: string; item_type_id?: string; user_id?: string }) => {
    const base = `${API_BASE}/api/v1/factions/${factionId}/export/entries`;
    const query = new URLSearchParams();
    if (params?.date_from) query.set('date_from', params.date_from);
    if (params?.date_to) query.set('date_to', params.date_to);
    if (params?.item_type_id) query.set('item_type_id', params.item_type_id);
    if (params?.user_id) query.set('user_id', params.user_id);
    const qs = query.toString();
    return qs ? `${base}?${qs}` : base;
  },

  quotaReportUrl: (factionId: string) =>
    `${API_BASE}/api/v1/factions/${factionId}/export/quota-report`,
};

// ── Config import/export (settings: item types, quotas, ranks) ──

export const configApi = {
  itemTypesUrl: (factionId: string) =>
    `${API_BASE}/api/v1/factions/${factionId}/config/item-types`,
  quotasUrl: (factionId: string) =>
    `${API_BASE}/api/v1/factions/${factionId}/config/quotas`,
  ranksUrl: (factionId: string) =>
    `${API_BASE}/api/v1/factions/${factionId}/config/ranks`,

  importItemTypes: (factionId: string, csv: string) =>
    api
      .post<ApiSuccessResponse<ConfigImportResult>>(`/factions/${factionId}/config/item-types`, { csv })
      .then(unwrap),

  importQuotas: (factionId: string, csv: string) =>
    api
      .post<ApiSuccessResponse<ConfigImportResult>>(`/factions/${factionId}/config/quotas`, { csv })
      .then(unwrap),

  importRanks: (factionId: string, csv: string) =>
    api
      .post<ApiSuccessResponse<ConfigImportResult>>(`/factions/${factionId}/config/ranks`, { csv })
      .then(unwrap),
};

// ── Admin Analytics ──

export const adminAnalyticsApi = {
  get: () =>
    api.get<ApiSuccessResponse<AdminAnalytics>>('/admin/analytics').then(unwrap),
};

// ── Reports ──

export const reportsApi = {
  summary: (factionId: string, period?: string) =>
    api
      .get<ApiSuccessResponse<ReportSummary>>(`/factions/${factionId}/reports/summary`, {
        params: period ? { period } : undefined,
      })
      .then(unwrap),

  comparison: (factionId: string, periodA?: string, periodB?: string) =>
    api
      .get<ApiSuccessResponse<ReportComparison>>(`/factions/${factionId}/reports/comparison`, {
        params: { period_a: periodA, period_b: periodB },
      })
      .then(unwrap),

  // Phase 7: Growth report
  growth: (factionId: string, periods?: number, granularity?: 'week' | 'month') =>
    api
      .get<ApiSuccessResponse<GrowthData>>(`/factions/${factionId}/reports/growth`, {
        params: {
          ...(periods ? { periods } : {}),
          ...(granularity ? { granularity } : {}),
        },
      })
      .then(unwrap),
};

// ── Phase 7: Leaderboard ──

export const leaderboardApi = {
  get: (factionId: string, params?: { period?: string; item_type_id?: string; limit?: number }) =>
    api
      .get<ApiSuccessResponse<LeaderboardData>>(`/factions/${factionId}/leaderboard`, { params })
      .then(unwrap),
};

// ── Phase 7: Global Leaderboard (superadmin) ──

export const globalLeaderboardApi = {
  get: (params?: { period?: string; limit?: number }) =>
    api
      .get<ApiSuccessResponse<GlobalLeaderboardData>>('/leaderboard', { params })
      .then(unwrap),
};

// ── Bulk Operations ──

export const bulkApi = {
  addMembers: (factionId: string, discordIds: string[]) =>
    api
      .post<ApiSuccessResponse<BulkAddResult>>(`/factions/${factionId}/bulk/members`, { discordIds })
      .then(unwrap),

  deleteEntries: (factionId: string, entryIds: string[]) =>
    api
      .post<ApiSuccessResponse<BulkDeleteResult>>(`/factions/${factionId}/bulk/entries/bulk-delete`, { entryIds })
      .then(unwrap),

  importCsv: (factionId: string, csv: string) =>
    api
      .post<ApiSuccessResponse<CsvImportResult>>(`/factions/${factionId}/bulk/entries/import`, { csv })
      .then(unwrap),
};

// ── Support tickets ──
//
// Not faction-scoped: sending one needs an account and nothing else, and only
// the superadmin can read anybody else's.

export const supportApi = {
  create: (input: CreateSupportTicketInput) =>
    api.post<ApiSuccessResponse<SupportTicket>>('/support', input).then(unwrap),

  listMine: () =>
    api.get<ApiSuccessResponse<SupportTicket[]>>('/support/mine').then(unwrap),

  list: (params?: {
    status?: SupportTicketStatus;
    kind?: SupportTicketKind;
    page?: number;
    page_size?: number;
  }) =>
    api
      .get<ApiSuccessResponse<SupportTicketAdminRow[]>>('/support', { params })
      .then((r) => ({ data: r.data.data, meta: r.data.meta })),

  openCount: () =>
    api.get<ApiSuccessResponse<{ open: number }>>('/support/open-count').then(unwrap),

  update: (ticketId: string, input: { status: 'resolved' | 'declined' | 'cancelled'; resolutionNote?: string }) =>
    api.patch<ApiSuccessResponse<SupportTicket>>(`/support/${ticketId}`, input).then(unwrap),

  remove: (ticketId: string) =>
    api.delete<ApiSuccessResponse<{ id: string }>>(`/support/${ticketId}`).then(unwrap),
};

// ── Notifications ──
// Scoped to the caller by the server; there is no faction or id to pass.

export const notificationsApi = {
  list: (params?: { unread?: boolean; limit?: number }) =>
    api
      .get<ApiSuccessResponse<AppNotification[]>>('/notifications', {
        params: { ...(params?.unread ? { unread: 'true' } : {}), ...(params?.limit ? { limit: params.limit } : {}) },
      })
      .then(unwrap),

  unreadCount: () =>
    api.get<ApiSuccessResponse<{ unread: number }>>('/notifications/unread-count').then(unwrap),

  markRead: (id: string) =>
    api.post<ApiSuccessResponse<{ id: string }>>(`/notifications/${id}/read`).then(unwrap),

  markAllRead: () =>
    api.post<ApiSuccessResponse<{ readAt: string }>>('/notifications/read-all').then(unwrap),

  clear: () => api.delete<ApiSuccessResponse<{ cleared: boolean }>>('/notifications').then(unwrap),
};

// ── Announcements ──

export const announcementsApi = {
  list: (factionId: string, params?: { include_expired?: boolean }) =>
    api
      .get<ApiSuccessResponse<Announcement[]>>(`/factions/${factionId}/announcements`, {
        params: params?.include_expired ? { include_expired: 'true' } : undefined,
      })
      .then(unwrap),

  create: (factionId: string, input: CreateAnnouncementInput) =>
    api
      .post<ApiSuccessResponse<Announcement>>(`/factions/${factionId}/announcements`, input)
      .then(unwrap),

  update: (factionId: string, id: string, input: UpdateAnnouncementInput) =>
    api
      .patch<ApiSuccessResponse<Announcement>>(`/factions/${factionId}/announcements/${id}`, input)
      .then(unwrap),

  remove: (factionId: string, id: string) =>
    api.delete(`/factions/${factionId}/announcements/${id}`),

  markRead: (factionId: string, id: string) =>
    api.post(`/factions/${factionId}/announcements/${id}/read`),

  reads: (factionId: string, id: string) =>
    api
      .get<ApiSuccessResponse<AnnouncementRead[]>>(`/factions/${factionId}/announcements/${id}/reads`)
      .then(unwrap),
};

// ── Activity feed ──

export const feedApi = {
  list: (factionId: string, params?: { page?: number; page_size?: number; type?: FeedType }) =>
    api
      .get<ApiSuccessResponse<FeedItem[]>>(`/factions/${factionId}/feed`, { params })
      .then((r) => ({ data: r.data.data, meta: r.data.meta })),
};

// ── Discord integration ──

export const discordApi = {
  status: (factionId: string) =>
    api.get<ApiSuccessResponse<DiscordStatus>>(`/factions/${factionId}/discord`).then(unwrap),

  inviteUrl: (factionId: string) =>
    api
      .get<ApiSuccessResponse<{ url: string }>>(`/factions/${factionId}/discord/invite-url`)
      .then(unwrap),

  channels: (factionId: string) =>
    api
      .get<ApiSuccessResponse<{ channels: DiscordChannel[] }>>(`/factions/${factionId}/discord/channels`)
      .then((r) => r.data.data.channels),

  // `leave` also removes the bot from the guild. Opt-in: the same bot may be
  // doing other work in that server.
  unlink: (factionId: string, leave = false) =>
    api
      .delete<ApiSuccessResponse<{ unlinked: boolean; left: boolean | null; leaveError?: string }>>(
        `/factions/${factionId}/discord`,
        { params: leave ? { leave: 'true' } : undefined },
      )
      .then(unwrap),

  setRoute: (
    factionId: string,
    eventType: DiscordEventType,
    input: { channelId: string; channelName?: string; isEnabled?: boolean },
  ) => api.put(`/factions/${factionId}/discord/routes/${eventType}`, input),

  clearRoute: (factionId: string, eventType: DiscordEventType) =>
    api.delete(`/factions/${factionId}/discord/routes/${eventType}`),

  // Resolves with ok:false when Discord refused, which is a result to render
  // rather than an error to throw — the reason is the useful part.
  test: (factionId: string, channelId: string) =>
    api
      .post<ApiSuccessResponse<{ ok: boolean; error?: string }>>(
        `/factions/${factionId}/discord/test`,
        { channelId },
      )
      .then(unwrap),
};

export { api };
