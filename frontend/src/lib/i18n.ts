'use client';

// ── Simple i18n framework ───────────────────────────
// No external dependencies. Supports nested keys,
// parameter interpolation, and easy extension for new languages.

export type TranslationMap = Record<string, string>;

const translations: Record<string, TranslationMap> = {
  en: {
    // ── Common ──
    'common.save': 'Save',
    'common.cancel': 'Cancel',
    'common.delete': 'Delete',
    'common.edit': 'Edit',
    'common.create': 'Create',
    'common.search': 'Search',
    'common.loading': 'Loading...',
    'common.noData': 'No data',
    'common.actions': 'Actions',
    'common.status': 'Status',
    'common.name': 'Name',
    'common.date': 'Date',
    'common.amount': 'Amount',
    'common.description': 'Description',
    'common.active': 'Active',
    'common.inactive': 'Inactive',
    'common.confirm': 'Confirm',
    'common.close': 'Close',
    'common.export': 'Export',
    'common.import': 'Import',
    'common.total': 'Total',
    'common.page': 'Page',
    'common.of': 'of',

    // ── Navigation ──
    'nav.dashboard': 'Dashboard',
    'nav.entries': 'Entries',
    'nav.members': 'Members',
    'nav.settings': 'Settings',
    'nav.auditLogs': 'Audit Logs',
    'nav.factionAdmin': 'Faction Admin',
    'nav.analytics': 'Analytics',
    'nav.reports': 'Reports',

    // ── Dashboard ──
    'dashboard.grandTotal': 'Grand Total',
    'dashboard.totalEntries': 'Total Entries',
    'dashboard.members': 'Members',
    'dashboard.itemTypes': 'Item Types',
    'dashboard.quotaProgress': 'Quota Progress',
    'dashboard.totalsByType': 'Totals by Item Type',
    'dashboard.topContributors': 'Top Contributors',
    'dashboard.recentActivity': 'Recent Activity',
    'dashboard.viewAll': 'View All',
    'dashboard.analytics': 'Analytics',
    'dashboard.exportData': 'Export Data',
    'dashboard.exportEntries': 'Export Entries CSV',
    'dashboard.exportQuotaReport': 'Export Quota Report CSV',
    'dashboard.memberContributions': 'Member Contributions',
    'dashboard.itemDistribution': 'Item Distribution',
    'dashboard.dailyTrend': 'Daily Trend',
    'dashboard.memberBreakdown': 'Member Breakdown by Item Type',
    'dashboard.range': 'Range',

    // ── Entries ──
    'entries.logEntry': 'Log Entry',
    'entries.logNew': 'Log New Entry',
    'entries.editEntry': 'Edit Entry',
    'entries.deleteEntry': 'Delete Entry',
    'entries.itemType': 'Item Type',
    'entries.allTypes': 'All Types',
    'entries.from': 'From',
    'entries.to': 'To',
    'entries.searchPlaceholder': 'Search descriptions...',
    'entries.noEntries': 'No entries found.',
    'entries.logged': 'Entry logged successfully',
    'entries.updated': 'Entry updated',
    'entries.deleted': 'Entry deleted',
    'entries.logging': 'Logging...',
    'entries.saving': 'Saving...',
    'entries.deleting': 'Deleting...',
    'entries.deleteConfirm': 'This action will soft-delete this entry. It can be restored from the database if needed.',
    'entries.csv': 'CSV',
    'entries.bulkDelete': 'Bulk Delete',
    'entries.csvImport': 'CSV Import',
    'entries.csvImportHint': 'Paste CSV with columns: Item Type, Amount, Date (YYYY-MM-DD), Description, Member (optional)',

    // ── Members ──
    'members.addMember': 'Add Member',
    'members.discordId': 'Discord ID',
    'members.discordIdPlaceholder': 'Enter Discord user ID',
    'members.role': 'Role',
    'members.admin': 'Admin',
    'members.member': 'Member',
    'members.joinedAt': 'Joined',
    'members.entries': 'entries',
    'members.removeConfirm': 'Remove this member? Their entries will be preserved.',
    'members.lastAdmin': 'Cannot remove the last admin of a faction.',
    'members.bulkAdd': 'Bulk Add Members',
    'members.bulkAddHint': 'Enter Discord IDs, one per line',
    'members.added': 'Member added',
    'members.bulkAdded': '{count} members added',
    'members.removed': 'Member removed',

    // ── Settings ──
    'settings.itemTypes': 'Item Types',
    'settings.quotas': 'Quotas',
    'settings.customization': 'Customization',
    'settings.createItemType': 'Create Item Type',
    'settings.editItemType': 'Edit Item Type',
    'settings.createQuota': 'Create Quota',
    'settings.editQuota': 'Edit Quota',
    'settings.brandColor': 'Brand Color',
    'settings.brandColorHint': 'Hex color for accent elements (e.g. #3b82f6)',
    'settings.customFields': 'Custom Entry Fields',
    'settings.customFieldsHint': 'Add extra fields that members fill when logging entries',
    'settings.addField': 'Add Field',
    'settings.fieldName': 'Field Name',
    'settings.required': 'Required',

    // ── Reports ──
    'reports.periodSummary': 'Period Summary',
    'reports.periodComparison': 'Period Comparison',
    'reports.thisWeek': 'This Week',
    'reports.lastWeek': 'Last Week',
    'reports.thisMonth': 'This Month',
    'reports.lastMonth': 'Last Month',
    'reports.last30d': 'Last 30 Days',
    'reports.last90d': 'Last 90 Days',
    'reports.all': 'All Time',
    'reports.uniqueMembers': 'Unique Members',
    'reports.avgPerEntry': 'Avg per Entry',
    'reports.memberRanking': 'Member Ranking',
    'reports.dailyBreakdown': 'Daily Breakdown',
    'reports.change': 'Change',
    'reports.vs': 'vs',

    // ── Admin ──
    'admin.allFactions': 'All Factions',
    'admin.createFaction': 'Create Faction',
    'admin.systemAnalytics': 'System Analytics',
    'admin.totalFactions': 'Total Factions',
    'admin.activeFactions': 'Active Factions',
    'admin.totalUsers': 'Total Users',
    'admin.totalEntries': 'Total Entries',
    'admin.entriesLast7d': 'Entries (7d)',
    'admin.entriesLast30d': 'Entries (30d)',
    'admin.recentSignups': 'Recent Signups',
    'admin.topFactions': 'Top Factions by Amount',
    'admin.factionStats': 'Faction Statistics',

    // ── Auth ──
    'auth.signIn': 'Sign in with Discord',
    'auth.signOut': 'Sign out',
    'auth.signingOut': 'Signing out...',
    'auth.superadmin': 'Superadmin',
    'auth.factionAdmin': 'Faction Admin',
    'auth.member': 'Member',

    // ── Errors ──
    'error.failedLoad': 'Failed to load. Make sure the backend is running.',
    'error.rateLimited': 'Too many requests. Please slow down.',
  },
};

// ── Translation function ──

let currentLocale = 'en';

export function setLocale(locale: string) {
  if (translations[locale]) {
    currentLocale = locale;
  }
}

export function getLocale(): string {
  return currentLocale;
}

export function t(key: string, params?: Record<string, string | number>): string {
  const dict = translations[currentLocale] ?? translations['en'];
  let value = dict[key] ?? translations['en']?.[key] ?? key;
  if (params) {
    for (const [k, v] of Object.entries(params)) {
      value = value.replace(`{${k}}`, String(v));
    }
  }
  return value;
}

export function getAvailableLocales(): string[] {
  return Object.keys(translations);
}
