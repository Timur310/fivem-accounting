// ── API Response wrappers (matches backend lib/types.ts) ──

export interface ApiSuccessResponse<T> {
  data: T;
  meta?: {
    page: number;
    page_size: number;
    total_count: number;
  };
}

export interface ApiErrorResponse {
  error: {
    code: string;
    message: string;
  };
}

// ── User & Auth ──

export interface User {
  id: string;
  discordId: string;
  username: string;
  avatarUrl: string | null;
  role: 'superadmin' | 'faction_admin' | 'member';
  createdAt: string;
  lastLogin: string | null;
  factions: FactionMembership[];
}

export interface FactionMembership {
  id: string;
  factionId: string;
  role: 'admin' | 'member';
  joinedAt: string;
  factionName: string;
  factionActive: boolean;
}

// ── Factions ──

export interface Faction {
  id: string;
  name: string;
  description: string | null;
  brandColor: string | null;
  customFields: { name: string; required: boolean }[] | null;
  isActive: boolean;
  createdAt: string;
  memberCount: number;
  entryCount: number;
}

export interface FactionDetail extends Faction {
 members: Member[];
  itemTypes: ItemType[];
}

export interface CreateFactionInput {
  name: string;
  description?: string;
  initialAdminDiscordId: string;
}

export interface UpdateFactionInput {
  name?: string;
  description?: string | null;
  isActive?: boolean;
  brandColor?: string;
  customFields?: { name: string; required: boolean }[];
}

// ── Members ──

export interface Member {
  id: string;
  userId: string;
  role: 'admin' | 'member';
  joinedAt: string;
  username: string;
  avatarUrl: string | null;
  discordId: string;
  entryCount?: number;
}

// ── Item Types ──

export interface ItemType {
  id: string;
  name: string;
  unit: string;
  isActive: boolean;
  createdAt: string;
  entryCount?: number;
}

export interface CreateItemTypeInput {
  name: string;
  unit?: string;
}

export interface UpdateItemTypeInput {
  name?: string;
  unit?: string;
  isActive?: boolean;
}

// ── Entries ──

export interface Entry {
  id: string;
  amount: string;
  description: string | null;
  entryDate: string;
  createdAt: string;
  updatedAt: string | null;
  customValues: Record<string, string> | null;
  userId: string;
  username: string;
  avatarUrl: string | null;
  itemTypeName: string;
  itemUnit: string;
}

export interface CreateEntryInput {
  itemTypeId: string;
  amount: string;
  description?: string;
  entryDate?: string;
  customValues?: Record<string, string>;
}

export interface UpdateEntryInput {
  amount?: string;
  description?: string | null;
  entryDate?: string;
  customValues?: Record<string, string>;
}

// ── Dashboard ──

export interface DashboardData {
  faction: {
    id: string;
    name: string;
    description: string | null;
  };
  totalsByType: {
    itemTypeId: string;
    itemTypeName: string;
    unit: string;
    total: number;
  }[];
  grandTotal: number;
  memberCount: number;
  adminCount: number;
  totalEntries: number;
  topContributors: {
    userId: string;
    username: string;
    avatarUrl: string | null;
    totalContributed: number;
    entryCount: number;
  }[];
  recentEntries: {
    id: string;
    amount: string;
    description: string | null;
    entryDate: string;
    createdAt: string;
    username: string;
    avatarUrl: string | null;
    itemTypeName: string;
    itemUnit: string;
  }[];
}

// ── Quotas ──

export interface Quota {
  id: string;
  itemTypeId: string;
  itemTypeName: string;
  itemUnit: string;
  targetAmount: string;
  periodType: 'weekly' | 'monthly';
  periodStart: string;
  isActive: boolean;
  createdAt: string;
  currentAmount?: number;
  percentage?: number;
  periodActive?: boolean;
  periodStartComputed?: string;
  periodEndComputed?: string;
}

export interface CreateQuotaInput {
  itemTypeId: string;
  targetAmount: string;
  periodType: 'weekly' | 'monthly';
  periodStart: string;
}

export interface UpdateQuotaInput {
  targetAmount?: string;
  periodType?: 'weekly' | 'monthly';
  periodStart?: string;
  isActive?: boolean;
}

// ── Audit Logs ──

export interface AuditLog {
  id: number;
  action: string;
  entityType: string;
  entityId: string | null;
  details: Record<string, unknown> | null;
  ipAddress: string | null;
  createdAt: string;
  actorUsername: string;
  actorDiscordId: string;
}

// ── Charts ─────────────────────────────────────────────

export interface ChartData {
  range: { days: number; from: string; to: string };
  memberContributions: {
    userId: string;
    username: string;
    avatarUrl: string | null;
    total: number;
    entryCount: number;
  }[];
  itemDistribution: {
    itemTypeId: string;
    itemTypeName: string;
    unit: string;
    total: number;
    entryCount: number;
  }[];
  dailyTrend: {
    date: string;
    total: number;
    entryCount: number;
  }[];
  memberItemBreakdown: {
    userId: string;
    username: string;
    itemTypeId: string;
    itemTypeName: string;
    unit: string;
    total: number;
  }[];
}

// ── Admin Analytics ─────────────────────────────────

export interface AdminAnalytics {
  overview: {
    totalFactions: number;
    activeFactions: number;
    totalUsers: number;
    totalEntries: number;
    entriesLast7d: number;
    entriesLast30d: number;
    totalMemberships: number;
    activeQuotas: number;
  };
  recentSignups: {
    id: string;
    username: string;
    avatarUrl: string | null;
    role: string;
    createdAt: string;
  }[];
  factionStats: {
    factionId: string;
    name: string;
    isActive: boolean;
    memberCount: number;
    entryCount: number;
    totalAmount: number;
    itemTypeCount: number;
  }[];
  topFactionsByAmount: {
    factionId: string;
    name: string;
    totalAmount: number;
  }[];
  dailySignupsTrend: { date: string; count: number; total: number }[];
  dailyEntriesTrend: { date: string; count: number; total: number }[];
}

// ── Reports ──────────────────────────────────────────

export interface ReportSummary {
  period: string;
  from: string;
  to: string;
  overview: {
    totalAmount: number;
    entryCount: number;
    uniqueMembers: number;
    avgPerEntry: number;
  };
  byType: {
    itemTypeName: string;
    unit: string;
    total: number;
    count: number;
    avg: number;
    max: number;
  }[];
  memberRanking: {
    username: string;
    avatarUrl: string | null;
    total: number;
    count: number;
    avg: number;
  }[];
  dailyBreakdown: {
    date: string;
    total: number;
    count: number;
  }[];
}

export interface ReportComparison {
  periodA: { label: string; from: string; to: string; total: number; count: number; members: number; byType: { itemTypeName: string; total: number; count: number }[] };
  periodB: { label: string; from: string; to: string; total: number; count: number; members: number; byType: { itemTypeName: string; total: number; count: number }[] };
  deltas: {
    totalAmount: number;
    totalAmountPercent: number;
    entryCount: number;
    memberActivity: number;
  };
}

// ── Bulk Operations ───────────────────────────────────

export interface BulkAddResult {
  added: number;
  skipped: {
    notFound: string[];
    alreadyMembers: number;
  };
}

export interface BulkDeleteResult {
  deletedCount: number;
}

export interface CsvImportResult {
  imported: number;
  skipped: number;
  errors: string[];
}
