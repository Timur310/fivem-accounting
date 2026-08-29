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
  payoutApprovalRequired: boolean;
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
  payoutApprovalRequired?: boolean;
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
  isCurrency: boolean;
  isActive: boolean;
  createdAt: string;
  entryCount?: number;
}

export interface CreateItemTypeInput {
  name: string;
  unit?: string;
  isCurrency?: boolean;
}

export interface UpdateItemTypeInput {
  name?: string;
  unit?: string;
  isCurrency?: boolean;
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
  itemIsCurrency: boolean;
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
    isCurrency: boolean;
    total: number;
  }[];
  grandTotal: number;
  treasuryBalances: TreasuryBalanceItem[];
  netBalance: number;
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
    itemIsCurrency: boolean;
  }[];
}

// ── Quotas ──

export interface Quota {
  id: string;
  itemTypeId: string;
  itemTypeName: string;
  itemUnit: string;
  itemIsCurrency: boolean;
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
    isCurrency: boolean;
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
    isCurrency: boolean;
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
    /** Money and goods are kept apart — they share no unit. */
    currencyTotal: number;
    itemTotal: number;
    currencyEntryCount: number;
    itemEntryCount: number;
    entryCount: number;
    uniqueMembers: number;
    avgPerCurrencyEntry: number;
    avgPerItemEntry: number;
  };
  byType: {
    itemTypeName: string;
    unit: string;
    isCurrency: boolean;
    total: number;
    count: number;
    avg: number;
    max: number;
  }[];
  memberRanking: {
    username: string;
    avatarUrl: string | null;
    /** Ranked on currencyTotal; itemTotal is reported alongside. */
    currencyTotal: number;
    itemTotal: number;
    count: number;
  }[];
  dailyBreakdown: {
    date: string;
    currencyTotal: number;
    itemTotal: number;
    count: number;
  }[];
}

interface ComparisonPeriod {
  label: string;
  from: string;
  to: string;
  currencyTotal: number;
  itemTotal: number;
  count: number;
  members: number;
  byType: { itemTypeName: string; unit: string; isCurrency: boolean; total: number; count: number }[];
}

export interface ReportComparison {
  periodA: ComparisonPeriod;
  periodB: ComparisonPeriod;
  deltas: {
    currencyTotal: number;
    /** null when the earlier period was zero — no baseline, not 0%. */
    currencyTotalPercent: number | null;
    itemTotal: number;
    itemTotalPercent: number | null;
    entryCount: number;
    memberActivity: number;
  };
}

// ── Payouts ────────────────────────────────────────

export type PayoutStatus = 'pending' | 'approved' | 'rejected' | 'completed';

export interface Payout {
  id: string;
  amount: string;
  description: string | null;
  payoutDate: string;
  status: PayoutStatus;
  createdAt: string;
  updatedAt: string | null;
  approvedAt: string | null;
  recipientUserId: string;
  recipientUsername: string;
  recipientAvatarUrl: string | null;
  itemTypeId: string;
  itemTypeName: string;
  itemUnit: string;
  itemIsCurrency: boolean;
  createdBy: string;
  approvedBy: string | null;
}

export interface CreatePayoutInput {
  recipientUserId: string;
  itemTypeId: string;
  amount: string;
  description?: string;
  payoutDate?: string;
}

export interface UpdatePayoutInput {
  amount?: string;
  description?: string | null;
  payoutDate?: string;
  status?: PayoutStatus;
}

export interface EvenSplitInput {
  itemTypeId: string;
  totalAmount: string;
  description?: string;
  payoutDate?: string;
}

export interface EvenSplitResult {
  created: number;
  perMember: number;
  distributedTotal: number;
  remainder: number;
  status: PayoutStatus;
  payoutIds: string[];
}

// ── Treasury ─────────────────────────────────────────

export interface TreasuryBalanceItem {
  itemTypeId: string;
  itemTypeName: string;
  unit: string;
  isCurrency: boolean;
  inflow: number;
  outflow: number;
  balance: number;
  outflowTrend: { date: string; total: number }[];
}

export interface TreasuryData {
  balances: TreasuryBalanceItem[];
  netBalance: number;
  totalInflow: number;
  totalOutflow: number;
  /** What the three totals above cover — currency item types only. */
  totals: {
    currencyTypeCount: number;
    nonCurrencyTypeCount: number;
  };
  pending: {
    count: number;
    total: number;
  };
  outflowTrend: { date: string; total: number }[];
  trendDays: number;
  recentPayouts: {
    id: string;
    amount: string;
    description: string | null;
    payoutDate: string;
    status: PayoutStatus;
    recipientUsername: string;
    recipientAvatarUrl: string | null;
    itemTypeName: string;
    itemUnit: string;
    itemIsCurrency: boolean;
  }[];
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
