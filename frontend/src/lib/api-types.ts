import type { TranslationKey } from './i18n';

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
  inGameName: string | null;
  browseableFactions?: { id: string; name: string; brandColor: string | null }[];
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
  /** This faction's own accent colour; null until an admin picks one. */
  factionBrandColor: string | null;
  rank: string | null;
  /**
   * What this user may do in this faction — resolved server-side exactly as
   * the API's own guard resolves it, so hiding a menu by this can never hide
   * something the API would have allowed, or offer something it refuses.
   */
  permissions: FactionPermission[];
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
  rank: string | null;
  joinedAt: string;
  username: string;
  inGameName: string | null;
  avatarUrl: string | null;
  discordId: string;
  /** Registered by a superadmin and never signed in. No inactivity clock. */
  isProvisional: boolean;
  entryCount: number;
  lastEntryDate: string | null;
  daysInactive: number | null;
  activeStrikeCount?: number;
  /** Admin only. Feeds the kick-suggestion escalation flag. */
  activeStrikesBySeverity?: { warning: number; minor: number; major: number };
}

// ── Item Types ──

export interface ItemType {
  id: string;
  name: string;
  unit: string;
  isCurrency: boolean;
  /** Link to an icon for this item; null until an admin sets one. */
  imageUrl: string | null;
  /** Emoji standing in for the item. The image wins when both are set. */
  icon: string | null;
  category: ItemCategory;
  isActive: boolean;
  createdAt: string;
  entryCount?: number;
}

/**
 * Colour coding only. Never derived from `isCurrency`: clean and dirty money
 * are both currency and read completely differently across a table.
 */
export const ITEM_CATEGORIES = ['cash', 'goods', 'contraband', 'other'] as const;
export type ItemCategory = (typeof ITEM_CATEGORIES)[number];

export interface CreateItemTypeInput {
  name: string;
  unit?: string;
  isCurrency?: boolean;
  imageUrl?: string;
  icon?: string;
  category?: ItemCategory;
}

export interface UpdateItemTypeInput {
  name?: string;
  unit?: string;
  isCurrency?: boolean;
  isActive?: boolean;
  /** null clears the image; omit the key to leave it untouched. */
  imageUrl?: string | null;
  /** An empty string or null clears the emoji. */
  icon?: string | null;
  category?: ItemCategory;
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
  inGameName: string | null;
  avatarUrl: string | null;
  itemTypeName: string;
  itemUnit: string;
  itemIsCurrency: boolean;
  itemImageUrl: string | null;
  itemIcon: string | null;
  itemCategory: ItemCategory;
}

export interface CreateEntryInput {
  itemTypeId: string;
  amount: string;
  description?: string;
  entryDate?: string;
  /** Credit another member instead of yourself — needs `manage_entries`. */
  userId?: string;
  customValues?: Record<string, string>;
  /** Credit the faction rather than the person logging it. */
  anonymous?: boolean;
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
    imageUrl: string | null;
    icon: string | null;
    category: ItemCategory;
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
    inGameName: string | null;
    avatarUrl: string | null;
    totalContributed: number;
    entryCount: number;
  }[];
  recentEntries: {
    id: string;
    userId: string;
    amount: string;
    description: string | null;
    entryDate: string;
    createdAt: string;
    username: string;
    inGameName: string | null;
    avatarUrl: string | null;
    itemTypeName: string;
    itemUnit: string;
    itemIsCurrency: boolean;
    itemImageUrl: string | null;
    itemIcon: string | null;
    itemCategory: ItemCategory;
  }[];
  /**
   * The caller's own last three item types, newest first, for the quick-log
   * chips. Server-derived rather than filtered out of `recentEntries`: that
   * list is the faction's last ten rows overall, so a member in a busy faction
   * was simply absent from it.
   */
  myRecentItems: {
    itemTypeId: string;
    itemTypeName: string;
    itemUnit: string;
    itemIsCurrency: boolean;
    itemImageUrl: string | null;
    itemIcon: string | null;
    itemCategory: ItemCategory;
    amount: string;
  }[];
  inactiveMembers?: {
    userId: string;
    username: string;
    inGameName: string | null;
    avatarUrl: string | null;
    lastEntryDate: string | null;
    daysInactive: number | null;
  }[];
  inactivityThresholdDays?: number;
}

// ── Quotas ──

export interface Quota {
  id: string;
  itemTypeId: string;
  itemTypeName: string;
  itemUnit: string;
  itemIsCurrency: boolean;
  itemImageUrl: string | null;
  itemIcon: string | null;
  itemCategory: ItemCategory;
  targetAmount: string;
  periodType: 'weekly' | 'monthly';
  periodStart: string;
  isActive: boolean;
  createdAt: string;
  /** 'faction' sums everyone into one target; 'everyone' measures each member separately; 'member' targets one. */
  scope?: 'faction' | 'everyone' | 'member';
  targetUserId: string | null;
  targetUsername: string | null;
  targetAvatarUrl: string | null;
  currentAmount?: number;
  percentage?: number;
  periodActive?: boolean;
  periodStartComputed?: string;
  periodEndComputed?: string;
  /** Outcome of the period before the current one — how a just-ended quota is remembered. */
  previousPeriod?: {
    periodStart: string;
    periodEnd: string;
    currentAmount: number;
    targetAmount: number;
    met: boolean;
  } | null;
}

export interface CreateQuotaInput {
  itemTypeId: string;
  targetAmount: string;
  periodType: 'weekly' | 'monthly';
  periodStart: string;
  scope?: 'faction' | 'everyone' | 'member';
  targetUserId?: string | null;
}

export interface QuotaHistoryPeriod {
  periodStart: string;
  periodEnd: string;
  currentAmount: number;
  targetAmount: number;
  met: boolean;
}

export interface QuotaHistoryData {
  periods: QuotaHistoryPeriod[];
  summary: { met: number; total: number };
}

export interface UpdateQuotaInput {
  targetAmount?: string;
  periodType?: 'weekly' | 'monthly';
  periodStart?: string;
  isActive?: boolean;
  scope?: 'faction' | 'everyone' | 'member';
  targetUserId?: string | null;
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
  actorInGameName: string | null;
  actorDiscordId: string;
}

// ── Charts ─────────────────────────────────────────────

export interface ChartData {
  range: { days: number; from: string; to: string };
  memberContributions: {
    userId: string;
    username: string;
    inGameName: string | null;
    avatarUrl: string | null;
    total: number;
    entryCount: number;
  }[];
  itemDistribution: {
    itemTypeId: string;
    itemTypeName: string;
    unit: string;
    isCurrency: boolean;
    imageUrl: string | null;
    icon: string | null;
    category: ItemCategory;
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
    inGameName: string | null;
    itemTypeId: string;
    itemTypeName: string;
    unit: string;
    isCurrency: boolean;
    imageUrl: string | null;
    icon: string | null;
    category: ItemCategory;
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
    inGameName: string | null;
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
    imageUrl: string | null;
    icon: string | null;
    category: ItemCategory;
    total: number;
    count: number;
    avg: number;
    max: number;
  }[];
  memberRanking: {
    username: string;
    inGameName: string | null;
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
  byType: { itemTypeName: string; unit: string; isCurrency: boolean; imageUrl: string | null;
 icon: string | null;
 category: ItemCategory; total: number; count: number }[];
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
  recipientInGameName: string | null;
  recipientAvatarUrl: string | null;
  itemTypeId: string;
  itemTypeName: string;
  itemUnit: string;
  itemIsCurrency: boolean;
  itemImageUrl: string | null;
  itemIcon: string | null;
  itemCategory: ItemCategory;
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
  /** Omit to split across the whole roster; given, only these members share. */
  memberUserIds?: string[];
}

export interface EvenSplitResult {
  created: number;
  perMember: number;
  distributedTotal: number;
  remainder: number;
  status: PayoutStatus;
  payoutIds: string[];
}

// ── Expenses ─────────────────────────────────────────

export const EXPENSE_CATEGORIES = ['warehouse', 'utilities', 'supplies', 'other'] as const;
export type ExpenseCategory = (typeof EXPENSE_CATEGORIES)[number];

export interface Expense {
  id: string;
  amount: string;
  category: ExpenseCategory;
  description: string | null;
  expenseDate: string;
  createdAt: string;
  createdBy: string;
  creatorUsername: string;
  creatorInGameName: string | null;
  itemTypeId: string;
  itemTypeName: string;
  itemUnit: string;
  itemIsCurrency: boolean;
  itemImageUrl: string | null;
  itemIcon: string | null;
  itemCategory: ItemCategory;
}

export interface ExpenseListData {
  expenses: Expense[];
  categoryTotals: { category: ExpenseCategory; total: number }[];
}

export interface CreateExpenseInput {
  itemTypeId: string;
  amount: string;
  category: ExpenseCategory;
  description?: string;
  expenseDate?: string;
}

export interface UpdateExpenseInput {
  amount?: string;
  category?: ExpenseCategory;
  description?: string | null;
  expenseDate?: string;
}

// ── Config CSV import/export ─────────────────────────

export interface ConfigImportResult {
  imported: number;
  updated?: number;
  skipped: number;
  errors: string[];
  removedRanks?: string[];
}

// ── Treasury ─────────────────────────────────────────

export interface TreasuryBalanceItem {
  itemTypeId: string;
  itemTypeName: string;
  unit: string;
  isCurrency: boolean;
  imageUrl: string | null;
  icon: string | null;
  category: ItemCategory;
  inflow: number;
  outflow: number;
  balance: number;
  outflowTrend: { date: string; total: number }[];
}

export interface TreasuryCheckRow {
  id: string;
  countedAmount: string;
  checkDate: string;
  note: string | null;
  createdAt: string;
  createdBy: string;
  creatorUsername: string;
  creatorInGameName: string | null;
  itemTypeId: string;
  itemTypeName: string;
  itemUnit: string;
  itemIsCurrency: boolean;
  recordedBalance: number;
  variance: number;
}

export interface TreasuryChecksData {
  checks: TreasuryCheckRow[];
}

export interface CreateTreasuryCheckInput {
  itemTypeId: string;
  countedAmount: string;
  checkDate?: string;
  note?: string;
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
    recipientInGameName: string | null;
    recipientAvatarUrl: string | null;
    itemTypeName: string;
    itemUnit: string;
    itemIsCurrency: boolean;
    itemImageUrl: string | null;
    itemIcon: string | null;
    itemCategory: ItemCategory;
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

// ── Phase 5: Member Profile ─────────────────────────────

export interface MemberProfile {
  member: {
    id: string;
    role: 'admin' | 'member';
    rank: string | null;
    joinedAt: string;
    userId: string;
    username: string;
    inGameName: string | null;
    avatarUrl: string | null;
    discordId: string;
    lastLogin: string | null;
    isProvisional: boolean;
    daysInactive: number | null;
    /** When they moved into their current rank; null if it was never recorded. */
    rankSince: string | null;
    /** Whole days in the current rank, from rankSince. Null alongside it. */
    daysInRank: number | null;
  };
  contribution: {
    /** Money and goods kept apart — they share no unit. */
    currencyContributed: number;
    itemContributed: number;
    currencyEntryCount: number;
    itemEntryCount: number;
    entryCount: number;
    avgPerCurrencyEntry: number;
    avgPerItemEntry: number;
    lastEntryDate: string | null;
    byItemType: {
      itemTypeId: string;
      itemTypeName: string;
      unit: string;
      isCurrency: boolean;
      imageUrl: string | null;
      icon: string | null;
      category: ItemCategory;
      total: number;
      count: number;
    }[];
    mostActiveItemType: { itemTypeName: string; total: number } | null;
  };
  payouts: {
    currencyReceived: number;
    itemReceived: number;
    payoutCount: number;
  };
  quotaProgress: {
    quotaId: string;
    itemTypeName: string;
    unit: string;
    isCurrency: boolean;
    imageUrl: string | null;
    icon: string | null;
    category: ItemCategory;
    periodType: string;
    periodStart: string;
    periodEnd: string;
    targetAmount: number;
    contributed: number;
    percentage: number;
  }[];
  activeStrikeCount: number;
  recentEntries: {
    id: string;
    userId: string;
    amount: string;
    description: string | null;
    entryDate: string;
    createdAt: string;
    itemTypeName: string;
    itemUnit: string;
    itemIsCurrency: boolean;
    itemImageUrl: string | null;
    itemIcon: string | null;
    itemCategory: ItemCategory;
  }[];
  recentPayouts: {
    id: string;
    amount: string;
    description: string | null;
    payoutDate: string;
    status: string;
    itemTypeName: string;
    itemUnit: string;
    itemIsCurrency: boolean;
    itemImageUrl: string | null;
    itemIcon: string | null;
    itemCategory: ItemCategory;
  }[];
  streak: {
    current: number;
    best: number;
    lastEntryDate: string | null;
    activeToday: boolean;
  };
  performance: {
    score: number;
    breakdown: {
      quotaHitRate: number;
      consistency: number;
      totalVolume: number;
      streakBonus: number;
      seniorityBonus: number;
    };
  };
  /** May read and write the notes on this profile — `manage_members` only,
   *  never the member they are about. */
  canViewNotes: boolean;
  /** Your own history, or anyone's with `manage_members`. */
  canViewHistory: boolean;
}

export interface MemberHistoryEntry {
  id: number;
  action: string;
  details: Record<string, unknown> | null;
  createdAt: string;
  actorId: string;
  actorUsername: string;
  actorInGameName: string | null;
  actorAvatarUrl: string | null;
}

// ── Phase 5: Notes ──────────────────────────────────────

export type NoteCategory = 'general' | 'performance' | 'discipline' | 'positive' | 'promotion';

export interface MemberNote {
  id: string;
  category: NoteCategory;
  content: string;
  isFlagged: boolean;
  createdAt: string;
  updatedAt: string | null;
  authorId: string;
  authorUsername: string;
  authorInGameName: string | null;
  authorAvatarUrl: string | null;
}

export interface CreateNoteInput {
  category?: NoteCategory;
  content: string;
  isFlagged?: boolean;
}

export interface UpdateNoteInput {
  category?: NoteCategory;
  content?: string;
  isFlagged?: boolean;
}

// ── Phase 5: Strikes ────────────────────────────────────

export type StrikeSeverity = 'warning' | 'minor' | 'major';
export type StrikeStatus = 'active' | 'appealed' | 'revoked' | 'expired';
export type StrikeEffectiveStatus = 'active' | 'appealed' | 'revoked' | 'expired';

export interface Strike {
  id: string;
  reason: string;
  severity: StrikeSeverity;
  status: StrikeStatus;
  effectiveStatus: StrikeEffectiveStatus;
  expiresAt: string | null;
  createdAt: string;
  updatedAt: string | null;
  issuedBy: string;
  issuerUsername: string;
  issuerInGameName: string | null;
  issuerAvatarUrl: string | null;
  targetUserId?: string;
  targetUsername?: string;
  targetInGameName?: string | null;
  targetAvatarUrl?: string | null;
}

export interface CreateStrikeInput {
  reason: string;
  severity: StrikeSeverity;
}

export interface FactionStrikesData {
  strikes: Strike[];
  activeSummary: {
    warning: number;
    minor: number;
    major: number;
  };
}

// ── Phase 5: Faction Settings ───────────────────────────

export interface FactionRank {
  name: string;
  level: number;
  permissions: FactionPermission[];
}

export const FACTION_PERMISSIONS = [
  'manage_members', 'manage_payouts', 'manage_entries', 'manage_strikes',
  'manage_quotas', 'manage_item_types', 'manage_settings', 'manage_customization',
  'view_audit_logs', 'view_reports', 'manage_laundering', 'manage_expenses',
] as const;
export type FactionPermission = (typeof FACTION_PERMISSIONS)[number];
/**
 * What each permission is called on screen. Keys rather than text, because the
 * chips these name are rendered in whatever language the interface is in.
 */
export const PERMISSION_LABEL_KEYS: Record<FactionPermission, TranslationKey> = {
  manage_members: 'permission.manageMembers', manage_payouts: 'permission.managePayouts',
  manage_entries: 'permission.manageEntries', manage_strikes: 'permission.manageStrikes',
  manage_quotas: 'permission.manageQuotas', manage_item_types: 'permission.manageItemTypes',
  manage_settings: 'permission.manageSettings', manage_customization: 'permission.manageCustomization',
  view_audit_logs: 'permission.viewAuditLogs', view_reports: 'permission.viewReports',
  manage_laundering: 'permission.manageLaundering',
  manage_expenses: 'permission.manageExpenses',
};

// ── Provisional users (superadmin) ─────────────────────

/** Someone registered by Discord ID who has never logged in. */
/**
 * A row in the superadmin's roster: everyone the system knows about, whether
 * they have ever signed in or were registered by Discord ID and are still
 * waiting. `isProvisional` is what separates the two, and `lastLogin` is null
 * for exactly those.
 */
export interface AdminUser {
  id: string;
  discordId: string;
  username: string;
  inGameName: string | null;
  avatarUrl: string | null;
  role: 'superadmin' | 'faction_admin' | 'member';
  isProvisional: boolean;
  createdAt: string;
  lastLogin: string | null;
  factionCount: number;
  entryCount: number;
}

export interface ProvisionalUser {
  id: string;
  discordId: string;
  username: string;
  inGameName: string | null;
  avatarUrl: string | null;
  createdAt: string;
  factionCount: number;
  entryCount: number;
}

export interface CreateProvisionalUserInput {
  discordId: string;
  username: string;
  inGameName?: string;
}

export interface UpdateProvisionalUserInput {
  username?: string;
  inGameName?: string | null;
}

// ── Laundering ─────────────────────────────────────────

/** A currency the faction deals in, with what the vault holds of it. */
export interface LaunderableCurrency {
  itemTypeId: string;
  itemTypeName: string;
  unit: string;
  balance: number;
}

export interface LaunderingOverview {
  currencies: LaunderableCurrency[];
}

export interface LaunderInput {
  fromItemTypeId: string;
  amountIn: string;
  toItemTypeId: string;
  amountOut: string;
  description?: string;
  date?: string;
}

export interface LaunderResult {
  from: { itemTypeId: string; itemTypeName: string; unit: string; amount: string };
  to: { itemTypeId: string; itemTypeName: string; unit: string; amount: string };
  date: string;
  /** The completed payout that took the dirty currency out of the vault. */
  payoutId: string;
  /** The entry that put the clean currency back in. */
  entryId: string;
}

export interface FactionSettings {
  ranks: FactionRank[];
  inactivityThresholdDays: number;
  strikeExpiryDays: {
    warning: number | null;
    minor: number | null;
    major: number | null;
  };
  /** Active-strike counts that flag a member for kick consideration; null disables a severity. */
  strikeEscalation: {
    warning: number | null;
    minor: number | null;
    major: number | null;
  };
  /** Monthly spending cap per expense category; null disables that budget. */
  expenseBudgets: {
    warehouse: number | null;
    utilities: number | null;
    supplies: number | null;
    other: number | null;
  };
  brandColor: string | null;
  customFields: { name: string; required: boolean }[];
}

export interface UpdateFactionSettingsInput {
  ranks?: FactionRank[];
  inactivityThresholdDays?: number;
  strikeEscalation?: {
    warning: number | null;
    minor: number | null;
    major: number | null;
  };
  expenseBudgets?: {
    warehouse: number | null;
    utilities: number | null;
    supplies: number | null;
    other: number | null;
  };
  strikeExpiryDays?: {
    warning: number | null;
    minor: number | null;
    major: number | null;
  };
  brandColor?: string;
  customFields?: { name: string; required: boolean }[];
}

// ── Phase 7: Heatmap ────────────────────────────────────

export interface HeatmapDay {
  date: string;
  count: number;
  currencyTotal: number;
  itemTotal: number;
}

export interface HeatmapResult {
  year: number;
  data: HeatmapDay[];
  maxCount: number;
  maxCurrencyTotal: number;
}

// ── Phase 7: Leaderboard ───────────────────────────────

export interface LeaderboardRanking {
  rank: number;
  userId: string;
  username: string;
  inGameName: string | null;
  avatarUrl: string | null;
  total: number;
  entryCount: number;
  itemBreakdown: Record<string, number>;
  isMe: boolean;
  /** Rank change vs. the previous period; null = unranked then. Positive = up. */
  movement?: number | null;
  streakCurrent?: number;
  streakActiveToday?: boolean;
}

export interface LeaderboardData {
  period: { from: string | null; to: string | null; label: string };
  rankings: LeaderboardRanking[];
  myRank: number | null;
}

export interface GlobalLeaderboardRanking {
  rank: number;
  userId: string;
  username: string;
  inGameName: string | null;
  avatarUrl: string | null;
  factionId: string;
  factionName: string;
  total: number;
  entryCount: number;
}

export interface GlobalLeaderboardData {
  period: { from: string | null; to: string | null; label: string };
  rankings: GlobalLeaderboardRanking[];
}

// ── Phase 7: Growth ────────────────────────────────────

export interface GrowthPeriod {
  label: string;
  from: string;
  to: string;
  totalEntries: number;
  totalAmount: number;
  activeMembers: number;
  avgPerMember: number;
}

export interface GrowthData {
  granularity: string;
  periods: GrowthPeriod[];
  growth: {
    entriesChangePct: number | null;
    amountChangePct: number | null;
    memberChange: number;
    avgChangePct: number | null;
  } | null;
  partial: boolean;
}

// ── Support tickets ──

export const SUPPORT_TICKET_KINDS = ['bug', 'feature'] as const;
export type SupportTicketKind = (typeof SUPPORT_TICKET_KINDS)[number];

/**
 * `cancelled` is the reporter withdrawing; `declined` is the maintainer saying
 * no. Kept apart so "resolved" keeps meaning what it says.
 */
export const SUPPORT_TICKET_STATUSES = ['open', 'resolved', 'declined', 'cancelled'] as const;
export type SupportTicketStatus = (typeof SUPPORT_TICKET_STATUSES)[number];

/** A ticket as its own reporter sees it. */
export interface SupportTicket {
  id: string;
  kind: SupportTicketKind;
  subject: string;
  message: string;
  status: SupportTicketStatus;
  resolutionNote: string | null;
  resolvedAt: string | null;
  createdAt: string;
  updatedAt: string;
  factionId: string | null;
}

/** The same ticket in the maintainer's inbox, with who sent it and from where. */
export interface SupportTicketAdminRow extends SupportTicket {
  userId: string;
  reporterUsername: string;
  reporterInGameName: string | null;
  reporterAvatarUrl: string | null;
  factionName: string | null;
  resolvedBy: string | null;
}

export interface CreateSupportTicketInput {
  kind: SupportTicketKind;
  subject: string;
  message: string;
  factionId?: string;
}

// ── Notifications ──

export const NOTIFICATION_TYPES = [
  'payout_approved',
  'payout_rejected',
  'payout_completed',
  'strike_issued',
  'support_resolved',
  'support_declined',
] as const;
export type NotificationType = (typeof NOTIFICATION_TYPES)[number];

/**
 * Text is never stored server-side — only a type and a data bag — so the bell
 * renders through the same i18n layer as everything else and follows a
 * language switch like the rest of the interface.
 */
export interface AppNotification {
  id: string;
  type: NotificationType;
  data: Record<string, string | number | null> | null;
  linkView: string | null;
  readAt: string | null;
  createdAt: string;
  factionId: string | null;
  factionName: string | null;
}
