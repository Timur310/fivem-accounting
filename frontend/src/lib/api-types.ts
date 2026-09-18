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
  'manage_discord', 'manage_crafting', 'craft', 'manage_map', 'manage_prices', 'sell', 'manage_vehicles',
  'log_operations', 'manage_operations',
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
  manage_discord: 'permission.manageDiscord',
  manage_crafting: 'permission.manageCrafting',
  craft: 'permission.craft',
  manage_map: 'permission.manageMap',
  manage_prices: 'permission.managePrices',
  sell: 'permission.sell',
  manage_vehicles: 'permission.manageVehicles',
  log_operations: 'permission.logOperations',
  manage_operations: 'permission.manageOperations',
};

// ── Provisional users (superadmin) ─────────────────────

/** Someone registered by Discord ID who has never logged in. */
/**
 * A row in the superadmin's roster: everyone the system knows about, whether
 * they have ever signed in or were registered by Discord ID and are still
 * waiting. `isProvisional` is what separates the two, and `lastLogin` is null
 * for exactly those.
 */
/**
 * What the backup screen needs to know before it offers a button.
 *
 * `available` is false on a deployment whose backend image was built without
 * postgresql-client, and `pooledConnection` is true when the tools would be
 * pointed at pgbouncer, which cannot carry a dump.
 */
// ── Vehicles ───────────────────────────────────────────

export const VEHICLE_STATUSES = [
  'in_service', 'in_repair', 'impounded', 'stolen', 'sold', 'scrapped',
] as const;
export type VehicleStatus = (typeof VEHICLE_STATUSES)[number];

export const VEHICLE_CATEGORIES = [
  'car', 'suv', 'motorcycle', 'van', 'truck', 'boat', 'aircraft', 'other',
] as const;
export type VehicleCategory = (typeof VEHICLE_CATEGORIES)[number];

export const VEHICLE_STATUS_KEYS: Record<VehicleStatus, TranslationKey> = {
  in_service: 'vehicle.status.in_service',
  in_repair: 'vehicle.status.in_repair',
  impounded: 'vehicle.status.impounded',
  stolen: 'vehicle.status.stolen',
  sold: 'vehicle.status.sold',
  scrapped: 'vehicle.status.scrapped',
};

export const VEHICLE_CATEGORY_KEYS: Record<VehicleCategory, TranslationKey> = {
  car: 'vehicle.category.car',
  suv: 'vehicle.category.suv',
  motorcycle: 'vehicle.category.motorcycle',
  van: 'vehicle.category.van',
  truck: 'vehicle.category.truck',
  boat: 'vehicle.category.boat',
  aircraft: 'vehicle.category.aircraft',
  other: 'vehicle.category.other',
};

export interface Vehicle {
  id: string;
  plate: string;
  make: string | null;
  model: string | null;
  color: string | null;
  category: VehicleCategory;
  year: number | null;
  status: VehicleStatus;
  statusNote: string | null;
  /** Set when the owner is on the roster; `ownerName` covers everyone else. */
  ownerUserId: string | null;
  ownerName: string | null;
  /** The linked member's name, or the typed one — whichever exists. */
  ownerDisplay: string | null;
  notes: string | null;
  createdBy: string;
  createdAt: string;
  updatedBy: string;
  updatedAt: string;
}

export interface VehicleListResult {
  vehicles: Vehicle[];
  total: number;
  page: number;
  pageSize: number;
  /** Counts over the whole registry, not the page — the filter chips show them. */
  statusCounts: Partial<Record<VehicleStatus, number>>;
}

export interface VehicleInput {
  plate: string;
  make?: string | null;
  model?: string | null;
  color?: string | null;
  category?: VehicleCategory;
  year?: number | null;
  status?: VehicleStatus;
  statusNote?: string | null;
  ownerUserId?: string | null;
  ownerName?: string | null;
  notes?: string | null;
}

/** One line of a vehicle's history, read out of the audit log. */
export interface VehicleHistoryEntry {
  id: number;
  action: 'create' | 'update' | 'delete';
  actorName: string;
  createdAt: string;
  details: {
    plate?: string;
    changes?: Record<string, { from: unknown; to: unknown }>;
  } | null;
}

// ── Pricing ────────────────────────────────────────────
//
// The price list and the calculator that reads it. Every amount is a decimal
// string, as everywhere else in this file: the arithmetic happens on the
// server, in integers, and the browser only ever displays what comes back.

export interface ProductAddon {
  id: string;
  name: string;
  price: string;
  /** Set when the add-on is a thing the faction stocks rather than a fee. */
  itemTypeId: string | null;
  sortOrder: number;
  isActive: boolean;
}

export interface ProductPrice {
  id: string;
  itemTypeId: string;
  itemTypeName: string;
  unit: string;
  isCurrency: boolean;
  icon: string | null;
  category: string;
  unitPrice: string;
  currencyItemTypeId: string;
  floorPrice: string | null;
  note: string | null;
  isActive: boolean;
  updatedAt: string;
  addons: ProductAddon[];
  /** What it costs the faction to make, from its recipes. Absent when the
   *  viewer's rank may not see margins, or no recipe prices it. */
  unitCost?: string;
  costRecipeName?: string;
}

/**
 * What one currency is worth in another, for this faction.
 *
 * Directional: a row saying dirty → clean does not let the app quote the other
 * way. Rates here are rarely symmetric, so the reverse is its own agreement.
 */
export interface CurrencyRate {
  id: string;
  fromItemTypeId: string;
  toItemTypeId: string;
  rate: string;
}

export interface Counterparty {
  id: string;
  name: string;
  discountPercent: string;
  note: string | null;
  color: string | null;
  icon: string | null;
  isActive: boolean;
}

/** A rung of the buy-more-pay-less ladder. Null item means faction-wide. */
export interface QuantityBreak {
  id: string;
  itemTypeId: string | null;
  minQuantity: string;
  discountPercent: string;
}

export interface PriceBook {
  prices: ProductPrice[];
  breaks: QuantityBreak[];
  parties: Counterparty[];
  rates: CurrencyRate[];
  /** Whether this viewer's rank may see cost and margin at all. */
  canSeeMargins: boolean;
  /** Lowest rank level allowed to see them; null means everyone. */
  marginMinRankLevel: number | null;
}

export interface QuoteLineInput {
  itemTypeId: string;
  quantity: string;
  addonIds?: string[];
}

export interface QuoteInput {
  counterpartyId?: string | null;
  lines: QuoteLineInput[];
  /** Quote in this currency, converting anything priced in another. */
  currencyItemTypeId?: string | null;
}

export interface QuotedLine {
  itemTypeId: string;
  itemTypeName: string;
  unit: string;
  icon: string | null;
  isCurrency: boolean;
  quantity: string;
  unitPrice: string;
  addons: { id: string; name: string; price: string }[];
  /** One unit with its add-ons — the answer to "how much each?". */
  unitTotal: string;
  gross: string;
  counterpartyPercent: string;
  quantityBreakPercent: string;
  discountPercent: string;
  discount: string;
  total: string;
  floorPrice: string | null;
  belowFloor: boolean;
  unitCost?: string;
  cost?: string;
  margin?: string;
  marginPercent?: string | null;
  costRecipeName?: string;
  /** Set when the line was priced in another currency and converted. */
  convertedFrom?: { itemTypeId: string; name: string } | null;
}

export interface Quote {
  currency: {
    itemTypeId: string;
    name: string;
    unit: string;
    isCurrency: boolean;
    icon: string | null;
  };
  counterparty: { id: string; name: string; discountPercent: string } | null;
  lines: QuotedLine[];
  subtotal: string;
  discountTotal: string;
  total: string;
  belowFloor: boolean;
  costTotal?: string;
  marginTotal?: string;
  marginPercent?: string | null;
  /** Some line has no known cost, so the margin shown is only part of it. */
  costIncomplete?: boolean;
}

/** A line of a booked sale, frozen as it read on the day. */
export interface SaleLine {
  id: string;
  saleId: string;
  itemTypeId: string;
  itemTypeName: string;
  quantity: string;
  unitPrice: string;
  addons: { name: string; price: string; itemTypeId: string | null }[] | null;
  discountPercent: string;
  gross: string;
  discount: string;
  total: string;
}

/**
 * One accepted quote, booked into the ledger.
 *
 * Every figure is a snapshot: a sale from six weeks ago keeps saying what was
 * actually charged after the price list has moved on.
 */
export interface Sale {
  id: string;
  counterpartyName: string | null;
  counterpartyDiscountPercent: string;
  currencyItemTypeId: string;
  currencyName: string;
  currencyUnit: string;
  currencyIsCurrency: boolean;
  subtotal: string;
  discountTotal: string;
  total: string;
  creditSaleTo: 'nobody' | 'seller';
  saleDate: string;
  notes: string | null;
  soldBy: string;
  sellerName: string;
  revertedAt: string | null;
  createdAt: string;
  lines: SaleLine[];
}

export interface SaleInput extends QuoteInput {
  notes?: string;
  date?: string;
  creditSaleTo?: 'nobody' | 'seller';
}

export interface SaleResult {
  sale: Sale;
  quote: Quote;
  /** Items the vault could not cover. Reported, never blocking. */
  shortfalls: { itemTypeId: string; itemTypeName: string; available: string }[];
}

export interface ProductPriceInput {
  itemTypeId: string;
  unitPrice: string;
  currencyItemTypeId: string;
  floorPrice?: string | null;
  note?: string | null;
  isActive?: boolean;
}

export interface ProductAddonInput {
  name: string;
  price: string;
  itemTypeId?: string | null;
  sortOrder?: number;
  isActive?: boolean;
}

export interface CounterpartyInput {
  name: string;
  discountPercent?: string;
  note?: string | null;
  color?: string | null;
  icon?: string | null;
  isActive?: boolean;
}

export interface QuantityBreakInput {
  itemTypeId?: string | null;
  minQuantity: string;
  discountPercent: string;
}

export interface BackupStatus {
  available: boolean;
  pgDumpVersion: string | null;
  pgRestoreVersion: string | null;
  serverVersion: string | null;
  databaseSizeBytes: number | null;
  target: string;
  pooledConnection: boolean;
  maxUploadBytes: number;
  lastBackupAt: string | null;
}

export interface RestoreResult {
  restoredBytes: number;
  /** Where the server put the copy it took of what the restore replaced. */
  safetyBackup: string;
  warnings: string[];
}

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
  /** Which modules this faction uses; null means all of them. */
  enabledModules: string[] | null;
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
  'announcement_posted',
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

// ── Announcements ──

export const ANNOUNCEMENT_PRIORITIES = ['low', 'normal', 'high', 'urgent'] as const;
export type AnnouncementPriority = (typeof ANNOUNCEMENT_PRIORITIES)[number];

export interface Announcement {
  id: string;
  title: string;
  /** Markdown, rendered with the same pipeline as the in-app guide. */
  body: string;
  priority: AnnouncementPriority;
  isPinned: boolean;
  expiresAt: string | null;
  createdAt: string;
  updatedAt: string;
  authorId: string;
  authorUsername: string;
  authorInGameName: string | null;
  authorAvatarUrl: string | null;
  readCount: number;
  isReadByMe: boolean;
}

/** One roster row against an announcement — `readAt` is null for unread. */
export interface AnnouncementRead {
  userId: string;
  username: string;
  inGameName: string | null;
  avatarUrl: string | null;
  readAt: string | null;
}

export interface CreateAnnouncementInput {
  title: string;
  body: string;
  priority?: AnnouncementPriority;
  isPinned?: boolean;
  expiresAt?: string | null;
}

export type UpdateAnnouncementInput = Partial<CreateAnnouncementInput>;

// ── Activity feed ──

export const FEED_TYPES = [
  'entry', 'payout', 'announcement', 'strike', 'member_join', 'rank_change',
] as const;
export type FeedType = (typeof FEED_TYPES)[number];

/**
 * One line of the faction timeline.
 *
 * No rendered sentence is stored or sent: the interface is bilingual, so the
 * client renders `feed.<type>` through the i18n layer and interpolates `data`.
 * The architecture doc's original spec had a `summary` string here; see §8.12.
 */
export interface FeedItem {
  id: string;
  type: FeedType;
  createdAt: string;
  actorId: string;
  actorUsername: string;
  actorInGameName: string | null;
  actorAvatarUrl: string | null;
  /** The shared placeholder that carries anonymous entries and laundering. */
  actorIsSystem: boolean;
  data: Record<string, string | number | boolean | null>;
}

// ── Discord integration ────────────────────────────────

/**
 * Faction activity a Discord channel can be subscribed to. Mirrors
 * DISCORD_EVENT_TYPES on the server; the order here is the order the settings
 * screen lists them in, grouped loosely by what a reader would go looking for.
 */
export const DISCORD_EVENT_TYPES = [
  'entry_logged',
  'payout_requested',
  'payout_approved',
  'payout_rejected',
  'payout_completed',
  'expense_recorded',
  'strike_issued',
  'announcement_posted',
  'member_joined',
  'member_left',
  'laundering_completed',
  'craft_completed',
  'entry_deleted',
  'payout_deleted',
  'expense_deleted',
  'strike_revoked',
  'announcement_removed',
  'craft_reverted',
  'vehicle_removed',
  'vehicle_added',
  'operation_reverted',
  'operation_logged',
] as const;
export type DiscordEventType = (typeof DISCORD_EVENT_TYPES)[number];

/**
 * Where the settings list breaks in two.
 *
 * Removals are routed separately from additions on purpose: a faction may want
 * the ledger in a busy public channel and "somebody took that back" somewhere
 * leadership actually reads.
 */
export const DISCORD_REMOVAL_EVENTS: readonly DiscordEventType[] = [
  'entry_deleted',
  'payout_deleted',
  'expense_deleted',
  'strike_revoked',
  'announcement_removed',
  'craft_reverted',
  'vehicle_removed',
  'operation_reverted',
];

export const DISCORD_EVENT_LABEL_KEYS: Record<DiscordEventType, TranslationKey> = {
  entry_logged: 'discord.event.entryLogged',
  payout_requested: 'discord.event.payoutRequested',
  payout_approved: 'discord.event.payoutApproved',
  payout_rejected: 'discord.event.payoutRejected',
  payout_completed: 'discord.event.payoutCompleted',
  expense_recorded: 'discord.event.expenseRecorded',
  strike_issued: 'discord.event.strikeIssued',
  announcement_posted: 'discord.event.announcementPosted',
  member_joined: 'discord.event.memberJoined',
  member_left: 'discord.event.memberLeft',
  laundering_completed: 'discord.event.launderingCompleted',
  craft_completed: 'discord.event.craftCompleted',
  entry_deleted: 'discord.event.entryDeleted',
  payout_deleted: 'discord.event.payoutDeleted',
  expense_deleted: 'discord.event.expenseDeleted',
  strike_revoked: 'discord.event.strikeRevoked',
  announcement_removed: 'discord.event.announcementRemoved',
  craft_reverted: 'discord.event.craftReverted',
  vehicle_added: 'discord.event.vehicleAdded',
  vehicle_removed: 'discord.event.vehicleRemoved',
  operation_logged: 'discord.event.operationLogged',
  operation_reverted: 'discord.event.operationReverted',
};

export interface DiscordIntegration {
  guildId: string;
  guildName: string | null;
  linkedAt: string;
  linkedByName: string;
  /**
   * The language the bot writes in. Only 'en' is rendered today — a Discord
   * message has no viewer to follow, so the faction picks one for everybody
   * and the picker stays disabled until a second language exists.
   */
  locale: string;
  /** The last delivery failure, so a link that quietly broke says so. */
  lastError: string | null;
  lastErrorAt: string | null;
}

export interface DiscordChannelRoute {
  eventType: DiscordEventType;
  channelId: string;
  channelName: string | null;
  isEnabled: boolean;
}

export interface DiscordStatus {
  /** Whether this deployment has a bot token at all — not a faction setting. */
  configured: boolean;
  integration: DiscordIntegration | null;
  routes: DiscordChannelRoute[];
  eventTypes: readonly DiscordEventType[];
}

export interface DiscordChannel {
  id: string;
  name: string;
  parentName: string | null;
  position: number;
}

// ── Discord reminders ──────────────────────────────────

export const REMINDER_SCHEDULE_TYPES = ['once', 'daily', 'weekly', 'monthly'] as const;
export type ReminderScheduleType = (typeof REMINDER_SCHEDULE_TYPES)[number];

export const REMINDER_SCHEDULE_LABEL_KEYS: Record<ReminderScheduleType, TranslationKey> = {
  once: 'reminder.schedule.once',
  daily: 'reminder.schedule.daily',
  weekly: 'reminder.schedule.weekly',
  monthly: 'reminder.schedule.monthly',
};

/**
 * A scheduled message a faction sends to one of its Discord channels.
 *
 * Times are server local, the same clock quotas reset on. `nextRunAt` is null
 * when nothing is pending: switched off, or a one-off that has been sent.
 */
export interface DiscordRole {
  id: string;
  name: string;
  /**
   * Whether anybody can ping it. A role that is not mentionable cannot be
   * pinged by this bot — it was never given MENTION_EVERYONE — so the picker
   * has to say so rather than let somebody pick a ping that silently does
   * nothing.
   */
  mentionable: boolean;
  position: number;
}

export interface DiscordReminder {
  id: string;
  channelId: string;
  channelName: string | null;
  title: string | null;
  message: string;
  scheduleType: ReminderScheduleType;
  /** `HH:MM`, 24-hour. Null for a one-off. */
  timeOfDay: string | null;
  /** 0-6 with Sunday = 0. Weekly only. */
  weekdays: number[] | null;
  dayOfMonth: number | null;
  runAt: string | null;
  /** Discord role snowflakes. */
  mentionRoleIds: string[] | null;
  /** This app's user ids, resolved to a Discord ping when the message goes. */
  mentionUserIds: string[] | null;
  isEnabled: boolean;
  nextRunAt: string | null;
  lastRunAt: string | null;
  lastError: string | null;
}

/**
 * A tagged member whose ping will not actually reach them.
 *
 * Returned when a reminder is saved, not stored: it stops being true the
 * moment they join the server, and a warning that outlives its cause is worse
 * than no warning.
 */
export interface UnpingableMember {
  userId: string;
  name: string;
  reason: 'not_in_server';
}

/** What a save answers with: the reminder, plus any tag that will go nowhere. */
export interface SavedReminder extends DiscordReminder {
  unpingable?: UnpingableMember[];
}

export interface ReminderInput {
  channelId: string;
  channelName?: string;
  title?: string;
  message: string;
  scheduleType: ReminderScheduleType;
  timeOfDay?: string;
  weekdays?: number[];
  dayOfMonth?: number;
  runAt?: string;
  mentionRoleIds?: string[];
  mentionUserIds?: string[];
  isEnabled?: boolean;
}

// ── Crafting ───────────────────────────────────────────

/** Whose contribution a recipe's output counts as. */
export type CreditOutputTo = 'nobody' | 'crafter';

/** One line of a recipe. `available` is present on inputs only. */
export interface RecipeLine {
  itemTypeId: string;
  itemTypeName: string;
  unit: string;
  isCurrency: boolean;
  icon: string | null;
  isActive: boolean;
  /** Per single craft. A batch multiplies it. */
  quantity: string;
  /** What the vault holds of this material right now. Inputs only. */
  available?: string;
}

export interface CraftingRecipe {
  id: string;
  name: string;
  description: string | null;
  creditOutputTo: CreditOutputTo;
  isActive: boolean;
  inputs: RecipeLine[];
  outputs: RecipeLine[];
  /** How many times this can be run against the current treasury. */
  maxCraftable: number;
}

export interface CraftMovementRow {
  craftId: string;
  role: 'input' | 'output';
  itemTypeId: string;
  quantity: string;
  itemTypeName: string;
  unit: string;
  isCurrency: boolean;
  icon: string | null;
}

export interface CraftRecord {
  id: string;
  recipeId: string | null;
  /** Snapshotted, so it survives the recipe being renamed or deleted. */
  recipeName: string;
  quantity: number;
  craftDate: string;
  notes: string | null;
  createdAt: string;
  revertedAt: string | null;
  craftedBy: string;
  crafterName: string;
  inputs: CraftMovementRow[];
  outputs: CraftMovementRow[];
}

export interface RecipeLineInput {
  itemTypeId: string;
  quantity: string;
}

export interface RecipeInput {
  name: string;
  description?: string;
  creditOutputTo?: CreditOutputTo;
  isActive?: boolean;
  inputs?: RecipeLineInput[];
  outputs?: RecipeLineInput[];
}

export interface CraftInput {
  recipeId: string;
  quantity: number;
  notes?: string;
  date?: string;
}

// ── Map ────────────────────────────────────────────────

export const MAP_MARKER_KINDS = ['point', 'area', 'route'] as const;
export type MapMarkerKind = (typeof MAP_MARKER_KINDS)[number];

/** A coordinate in game space, as `/coords` prints it. */
export interface GameCoordinate {
  x: number;
  y: number;
  z?: number;
}

/** One named map. Permission lives here, not on the markers inside it. */
export interface MapLayer {
  id: string;
  name: string;
  description: string | null;
  color: string | null;
  icon: string | null;
  /**
   * Lowest rank level allowed to open it, or null for everybody. Lower level
   * means higher rank, so 2 is open to levels 1 and 2. It gates editing as
   * well as reading.
   */
  minRankLevel: number | null;
  createdBy: string;
  createdAt: string;
  creatorName: string;
  markerCount: number;
}

export interface MapLayerInput {
  name: string;
  description?: string;
  color?: string;
  icon?: string;
  minRankLevel?: number | null;
}

export interface MapMarker {
  id: string;
  layerId: string;
  kind: MapMarkerKind;
  name: string;
  description: string | null;
  category: string | null;
  color: string | null;
  icon: string | null;
  points: GameCoordinate[];
  createdBy: string;
  createdAt: string;
  creatorName: string;
}

export interface MapMarkerInput {
  layerId: string;
  kind: MapMarkerKind;
  name: string;
  description?: string;
  category?: string;
  color?: string;
  icon?: string;
  points: GameCoordinate[];
}


// ── operations ─────────────────────────────────────────
// A job the crew ran together, and the split of what they brought back.

export const OPERATION_KINDS = [
  'bank', 'jewelry', 'store', 'house', 'convoy', 'contract', 'territory', 'other',
] as const;
export type OperationKind = (typeof OPERATION_KINDS)[number];

export const OPERATION_KIND_KEYS: Record<OperationKind, TranslationKey> = {
  bank: 'operation.kind.bank',
  jewelry: 'operation.kind.jewelry',
  store: 'operation.kind.store',
  house: 'operation.kind.house',
  convoy: 'operation.kind.convoy',
  contract: 'operation.kind.contract',
  territory: 'operation.kind.territory',
  other: 'operation.kind.other',
};

/** One person on the crew: their share, and how the night went for them. */
export interface OperationParticipantInput {
  userId: string;
  /** A weight, not a percentage. Everybody on 1 is an even split. */
  share?: number;
  /** 1 to 5, or null for not rated — which is the usual case. */
  rating?: number | null;
  ratingNote?: string | null;
}

/** Who the haul goes to: divided between the crew, or all to the faction. */
export const OPERATION_CREDIT = ['crew', 'faction'] as const;
export type OperationCredit = (typeof OPERATION_CREDIT)[number];

export interface OperationLootInput {
  itemTypeId: string;
  quantity: string;
}

export interface OperationSplitInput {
  participants: OperationParticipantInput[];
  /** May be empty: plenty of jobs are worth recording and take nothing. */
  loot: OperationLootInput[];
  creditTo?: OperationCredit;
  factionCutPercent?: string;
}

export interface OperationInput extends OperationSplitInput {
  name: string;
  kind?: OperationKind;
  location?: string | null;
  /** ISO instant. Omitted means now, which is the usual case. */
  occurredAt?: string;
  notes?: string | null;
}

/** One loot line, divided. The cut plus the shares equals the quantity. */
export interface OperationSplitLine {
  itemTypeId: string;
  itemTypeName?: string;
  unit?: string;
  isCurrency?: boolean;
  quantity: string;
  factionCut: string;
  shares: { userId: string; quantity: string }[];
}

export interface OperationSplit {
  lines: OperationSplitLine[];
  perMember: { userId: string; items: { itemTypeId: string; quantity: string }[] }[];
}

export interface Operation {
  id: string;
  name: string;
  kind: OperationKind;
  location: string | null;
  occurredAt: string;
  factionCutPercent: string;
  creditTo: OperationCredit;
  notes: string | null;
  loggedBy: string;
  loggedByName: string;
  revertedAt: string | null;
  createdAt: string;
  loot: {
    id: string;
    itemTypeId: string;
    itemTypeName: string;
    quantity: string;
    unit: string;
    isCurrency: boolean;
  }[];
  crew: {
    userId: string;
    share: number;
    name: string;
    rating: number | null;
    ratingNote: string | null;
  }[];
  /** The ledger rows the split wrote: who was credited with what. */
  movements: {
    role: 'share' | 'faction_cut';
    userId: string;
    itemTypeId: string;
    quantity: string;
  }[];
}

/** One member's record on the operations board. */
export interface OperationRanking {
  rank: number;
  userId: string;
  username: string;
  inGameName: string | null;
  avatarUrl: string | null;
  operationCount: number;
  /** Ratings given by somebody other than the member themselves. */
  ratingCount: number;
  /** How many different people those ratings came from. */
  raterCount: number;
  /** The plain average, or null when nobody has rated them. */
  ratingAverage: number | null;
  /** The weighted score the board is ordered by. Null until rated. */
  ratingScore: number | null;
  /** True while the score rests on fewer than three ratings. */
  provisional: boolean;
  /** How many of each star, '1' through '5'. */
  stars: Record<string, number>;
  lastOperationAt: string | null;
  haul: { itemTypeName: string; unit: string; isCurrency: boolean; total: string }[];
  isMe: boolean;
}

export interface OperationLeaderboard {
  period: { from: string | null; to: string | null; key: 'week' | 'month' | 'all' };
  sort: 'operations' | 'rating';
  /** The faction's own average rating for the window, or null if nothing is rated. */
  factionAverage: number | null;
  ratedCount: number;
  rankings: OperationRanking[];
  myRank: number | null;
}


// ── faction modules ────────────────────────────────────
// Which parts of the app a faction uses. See backend lib/modules.ts: the two
// lists are the same list, and the rank editor and navigation filter through
// this one.

export const FACTION_MODULES = [
  'entries', 'payouts', 'treasury', 'expenses', 'quotas', 'strikes',
  'laundering', 'crafting', 'pricing', 'operations', 'vehicles', 'map',
  'leaderboard', 'announcements', 'feed', 'reports',
] as const;
export type FactionModule = (typeof FACTION_MODULES)[number];

export const MODULE_LABEL_KEYS: Record<FactionModule, TranslationKey> = {
  entries: 'nav.entries',
  payouts: 'nav.withdrawals',
  treasury: 'nav.treasury',
  expenses: 'module.expenses',
  quotas: 'module.quotas',
  strikes: 'nav.strikes',
  laundering: 'nav.laundering',
  crafting: 'nav.crafting',
  pricing: 'nav.pricing',
  operations: 'nav.operations',
  vehicles: 'nav.vehicles',
  map: 'nav.map',
  leaderboard: 'nav.leaderboard',
  announcements: 'nav.announcements',
  feed: 'nav.feed',
  reports: 'nav.reports',
};

export const MODULE_HINT_KEYS: Record<FactionModule, TranslationKey> = {
  entries: 'module.hint.entries',
  payouts: 'module.hint.payouts',
  treasury: 'module.hint.treasury',
  expenses: 'module.hint.expenses',
  quotas: 'module.hint.quotas',
  strikes: 'module.hint.strikes',
  laundering: 'module.hint.laundering',
  crafting: 'module.hint.crafting',
  pricing: 'module.hint.pricing',
  operations: 'module.hint.operations',
  vehicles: 'module.hint.vehicles',
  map: 'module.hint.map',
  leaderboard: 'module.hint.leaderboard',
  announcements: 'module.hint.announcements',
  feed: 'module.hint.feed',
  reports: 'module.hint.reports',
};

/** Which module each permission belongs to; the rest govern the faction itself. */
export const PERMISSION_MODULE: Partial<Record<FactionPermission, FactionModule>> = {
  manage_entries: 'entries',
  manage_payouts: 'payouts',
  manage_quotas: 'quotas',
  manage_strikes: 'strikes',
  manage_expenses: 'expenses',
  manage_laundering: 'laundering',
  manage_crafting: 'crafting',
  craft: 'crafting',
  manage_prices: 'pricing',
  sell: 'pricing',
  log_operations: 'operations',
  manage_operations: 'operations',
  manage_vehicles: 'vehicles',
  manage_map: 'map',
  view_reports: 'reports',
};

/**
 * Is this module on for this faction?
 *
 * `null` means all of them — what every faction had before this existed, and
 * what a faction that has never opened the setting still has.
 */
export function isModuleEnabled(
  enabled: string[] | null | undefined,
  module: FactionModule,
): boolean {
  return enabled == null || enabled.includes(module);
}


// ── rank templates ─────────────────────────────────────
// A starting point for a faction's rank list, computed by the server from the
// modules that faction runs. Nothing is stored: applying one fills the rank
// editor, and saving it is an ordinary settings save.

export interface RankTemplateRank {
  /** A key, not a name: the suggested titles follow the interface language. */
  nameKey: string;
  level: number;
  tier: 'none' | 'crew' | 'officer' | 'leadership';
  permissions: FactionPermission[];
}

export interface RankTemplate {
  key: string;
  ranks: RankTemplateRank[];
}

/** The suggested rank titles, and the shapes they come in. */
export const RANK_TEMPLATE_LABEL_KEYS: Record<string, TranslationKey> = {
  crew: 'rankTemplate.crew',
  organisation: 'rankTemplate.organisation',
  business: 'rankTemplate.business',
};

export const RANK_TEMPLATE_HINT_KEYS: Record<string, TranslationKey> = {
  crew: 'rankTemplate.crewHint',
  organisation: 'rankTemplate.organisationHint',
  business: 'rankTemplate.businessHint',
};

export const RANK_NAME_KEYS: Record<string, TranslationKey> = {
  boss: 'rankTemplate.role.boss',
  underboss: 'rankTemplate.role.underboss',
  rightHand: 'rankTemplate.role.rightHand',
  lieutenant: 'rankTemplate.role.lieutenant',
  soldier: 'rankTemplate.role.soldier',
  member: 'rankTemplate.role.member',
  associate: 'rankTemplate.role.associate',
  recruit: 'rankTemplate.role.recruit',
  owner: 'rankTemplate.role.owner',
  manager: 'rankTemplate.role.manager',
  staff: 'rankTemplate.role.staff',
  trainee: 'rankTemplate.role.trainee',
};
