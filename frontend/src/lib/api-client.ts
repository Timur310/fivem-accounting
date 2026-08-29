'use client';

import axios from 'axios';
import type {
  ApiSuccessResponse,
  ApiErrorResponse,
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
  UpdateQuotaInput,
  ChartData,
  AdminAnalytics,
  ReportSummary,
  ReportComparison,
  BulkAddResult,
  BulkDeleteResult,
  CsvImportResult,
  Payout,
  CreatePayoutInput,
  UpdatePayoutInput,
  EvenSplitInput,
  EvenSplitResult,
  TreasuryData,
} from './api-types';

const API_BASE = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000';

const api = axios.create({
  baseURL: `${API_BASE}/api/v1`,
  withCredentials: true,
  headers: { 'Content-Type': 'application/json' },
});

// No redirect on 401 — the checkAuth() in page.tsx handles it gracefully.

// ── Helper ──
function unwrap<T>(res: { data: ApiSuccessResponse<T> }): T {
  return res.data.data;
}

// ── Auth ──

export const authApi = {
  getMe: () => api.get<ApiSuccessResponse<User>>('/auth/me').then(unwrap),
  logout: () => api.post('/auth/logout'),
  getDiscordLoginUrl: () => `${API_BASE}/api/v1/auth/discord`,
};

// ── Factions (superadmin) ──

export const factionsApi = {
  list: (params?: { search?: string; page?: number; page_size?: number }) =>
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

  add: (factionId: string, discordId: string) =>
    api
      .post<ApiSuccessResponse<Member>>(`/factions/${factionId}/members`, {
        discordId,
      })
      .then(unwrap),

  updateRole: (factionId: string, userId: string, role: 'admin' | 'member') =>
    api
      .patch<ApiSuccessResponse<Member>>(`/factions/${factionId}/members/${userId}`, {
        role,
      })
      .then(unwrap),

  remove: (factionId: string, userId: string) =>
    api.delete(`/factions/${factionId}/members/${userId}`),
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
  entriesUrl: (factionId: string, params?: { date_from?: string; date_to?: string; item_type_id?: string }) => {
    const base = `${API_BASE}/api/v1/factions/${factionId}/export/entries`;
    const query = new URLSearchParams();
    if (params?.date_from) query.set('date_from', params.date_from);
    if (params?.date_to) query.set('date_to', params.date_to);
    if (params?.item_type_id) query.set('item_type_id', params.item_type_id);
    const qs = query.toString();
    return qs ? `${base}?${qs}` : base;
  },

  quotaReportUrl: (factionId: string) =>
    `${API_BASE}/api/v1/factions/${factionId}/export/quota-report`,
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

export { api };
