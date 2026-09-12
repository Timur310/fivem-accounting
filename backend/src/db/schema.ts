import {
  pgTable,
  uuid,
  varchar,
  text,
  boolean,
  timestamp,
  bigserial,
  integer,
  decimal,
  date,
  jsonb,
  inet,
  uniqueIndex,
  primaryKey,
} from 'drizzle-orm/pg-core';
import { relations } from 'drizzle-orm';

// ── users ──────────────────────────────────────────────
export const users = pgTable('users', {
  id:        uuid('id').defaultRandom().primaryKey(),
  discordId: varchar('discord_id', { length: 20 }).notNull().unique(),
  username:  varchar('username', { length: 32 }).notNull(),
  // Player-chosen display name, set once after first login. null until they
  // either save one or dismiss the prompt — both are valid client states.
  inGameName: varchar('in_game_name', { length: 50 }),
  avatarUrl: text('avatar_url'),
  role:      varchar('role', { length: 20 }).notNull().default('member'),
  // Not a person. Marks the placeholder that anonymous entries are logged
  // against, so per-member rankings can leave it out without matching on a
  // magic username.
  isSystem:  boolean('is_system').notNull().default(false),
  // A person a superadmin registered by Discord ID before they ever logged in.
  // The row is a full user from the start — it can hold entries, payouts and
  // strikes — and the OAuth callback clears the flag the first time they sign
  // in, so their history carries over rather than starting again. Until then
  // there is nobody behind it, so inactivity does not apply.
  isProvisional: boolean('is_provisional').notNull().default(false),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  lastLogin: timestamp('last_login', { withTimezone: true }),
});

/** Discord id of the placeholder that owns anonymous entries. */
export const ANONYMOUS_DISCORD_ID = 'system:anonymous';
export const ANONYMOUS_USERNAME = 'Anonymous';

export const usersRelations = relations(users, ({ many }) => ({
  factionMembers: many(factionMembers),
  entries:        many(entries),
  payouts:        many(payouts),
  memberNotes:    many(memberNotes),
  strikes:        many(strikes),
  auditLogs:      many(auditLogs),
}));

export type User = typeof users.$inferSelect;
export type NewUser = typeof users.$inferInsert;

// ── factions ───────────────────────────────────────────
export const factions = pgTable('factions', {
  id:           uuid('id').defaultRandom().primaryKey(),
  name:         varchar('name', { length: 100 }).notNull().unique(),
  description:  text('description'),
  brandColor:   varchar('brand_color', { length: 7 }),
  customFields: jsonb('custom_fields').$type<{ name: string; required: boolean }[]>(),
  // Display-only rank hierarchy (Boss, Underboss, Capo, ...). Access control
  // still runs off faction_members.role; `permissions` here is the list of
  // FACTION_PERMISSIONS granted to anyone holding the rank.
  ranks: jsonb('ranks').$type<{ name: string; level: number; permissions: string[] }[]>(),
  // Days without a logged entry before a member is flagged as inactive.
  inactivityThresholdDays: integer('inactivity_threshold_days').notNull().default(7),
  // Per-severity strike lifetime in days; null means the strike never expires.
  strikeExpiryDays: jsonb('strike_expiry_days').$type<{
    warning: number | null;
    minor: number | null;
    major: number | null;
  }>(),
  // Discipline escalation: when a member's ACTIVE strikes of a severity reach
  // the threshold, the roster flags them for kick consideration. null disables
  // the check for that severity.
  strikeEscalation: jsonb('strike_escalation').$type<{
    warning: number | null;
    minor: number | null;
    major: number | null;
  }>(),
  // Monthly spending cap per expense category. null = no budget for that
  // category; the treasury warns as spending approaches the cap.
  expenseBudgets: jsonb('expense_budgets').$type<{
    warehouse: number | null;
    utilities: number | null;
    supplies: number | null;
    other: number | null;
  }>(),
  createdBy:    uuid('created_by').notNull().references(() => users.id),
  createdAt:    timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  isActive:     boolean('is_active').notNull().default(true),
});

export const factionsRelations = relations(factions, ({ one, many }) => ({
  creator:        one(users, { fields: [factions.createdBy], references: [users.id] }),
  factionMembers: many(factionMembers),
  itemTypes:      many(itemTypes),
  entries:        many(entries),
  payouts:        many(payouts),
  quotas:         many(quotas),
  memberNotes:    many(memberNotes),
  strikes:        many(strikes),
  auditLogs:      many(auditLogs),
}));

export type Faction = typeof factions.$inferSelect;
export type NewFaction = typeof factions.$inferInsert;

// ── Faction permissions ───────────────────────────────
// Members get these per-rank via factions.ranks[].permissions.
// Admins and superadmins implicitly hold every permission.
export const FACTION_PERMISSIONS = [
  'manage_members',
  'manage_payouts',
  'manage_entries',
  'manage_strikes',
  'manage_quotas',
  'manage_item_types',
  'manage_settings',
  'manage_customization',
  'view_audit_logs',
  'view_reports',
  'manage_laundering',
  'manage_expenses',
] as const;
export type FactionPermission = (typeof FACTION_PERMISSIONS)[number];

/** Human-readable labels for the permission enum. */
export const PERMISSION_LABELS: Record<FactionPermission, string> = {
  manage_members: 'Manage Members',
  manage_payouts: 'Manage Payouts',
  manage_entries: 'Edit/Delete Entries',
  manage_strikes: 'Manage Strikes',
  manage_quotas: 'Manage Quotas',
  manage_item_types: 'Manage Item Types',
  manage_settings: 'Manage Settings',
  manage_customization: 'Manage Customization',
  view_audit_logs: 'View Audit Logs',
  view_reports: 'View Reports',
  manage_laundering: 'Launder Money',
  manage_expenses: 'Manage Expenses',
};

// ── faction_members ────────────────────────────────────
export const factionMembers = pgTable('faction_members', {
  id:        uuid('id').defaultRandom().primaryKey(),
  factionId: uuid('faction_id').notNull().references(() => factions.id, { onDelete: 'cascade' }),
  userId:    uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  role:      varchar('role', { length: 20 }).notNull().default('member'),
  // Display-only rank name, must match one of factions.ranks[].name.
  // Deliberately separate from `role`, which drives access control.
  rank:      varchar('rank', { length: 100 }),
  joinedAt:  timestamp('joined_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => ({
  uniqueFactionUser: uniqueIndex('faction_member_unique').on(table.factionId, table.userId),
}));

export const factionMembersRelations = relations(factionMembers, ({ one }) => ({
  faction: one(factions, { fields: [factionMembers.factionId], references: [factions.id] }),
  user:    one(users,    { fields: [factionMembers.userId],    references: [users.id] }),
}));

export type FactionMember = typeof factionMembers.$inferSelect;
export type NewFactionMember = typeof factionMembers.$inferInsert;

// ── item_types ─────────────────────────────────────────
export const itemTypes = pgTable('item_types', {
  id:        uuid('id').defaultRandom().primaryKey(),
  factionId: uuid('faction_id').notNull().references(() => factions.id, { onDelete: 'cascade' }),
  name:      varchar('name', { length: 100 }).notNull(),
  unit:      varchar('unit', { length: 20 }).notNull().default('$'),
  // Whether this type holds money rather than countable goods. Amounts are
  // stored identically either way; this only tells clients how to present them
  // (currency formatting and decimals vs. plain counts).
  isCurrency: boolean('is_currency').notNull().default(false),
  // Optional icon for the item, stored as a link rather than a file: the
  // backend hosts nothing, it only hands the URL to whoever renders it.
  imageUrl:  text('image_url'),
  // An emoji standing in for the item — the cheap version of the image URL,
  // and the one most factions will actually use. Kept alongside `imageUrl`
  // rather than replacing it: a faction with real artwork should not lose it,
  // and the renderer prefers the image when both are set.
  //
  // Wide enough for a multi-codepoint emoji with modifiers, which can run to
  // several characters even though it reads as one glyph.
  icon:      varchar('icon', { length: 16 }),
  // What kind of thing this is, for colour coding only. It changes no
  // arithmetic anywhere — `isCurrency` remains the only flag that affects how
  // an amount is computed or formatted.
  category:  varchar('category', { length: 20 }).notNull().default('other'),
  isActive:  boolean('is_active').notNull().default(true),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

/**
 * Item categories, for colour coding and nothing else.
 *
 * Deliberately not derived from `isCurrency`: a faction can hold clean money
 * and dirty money that are both currency but read very differently across a
 * table, and contraband is the distinction people actually care about at a
 * glance.
 */
export const ITEM_CATEGORIES = ['cash', 'goods', 'contraband', 'other'] as const;
export type ItemCategory = (typeof ITEM_CATEGORIES)[number];

export const itemTypesRelations = relations(itemTypes, ({ one, many }) => ({
  faction: one(factions, { fields: [itemTypes.factionId], references: [factions.id] }),
  entries: many(entries),
  payouts: many(payouts),
  quotas:  many(quotas),
}));

export type ItemType = typeof itemTypes.$inferSelect;
export type NewItemType = typeof itemTypes.$inferInsert;

// ── entries ────────────────────────────────────────────
export const entries = pgTable('entries', {
  id:         uuid('id').defaultRandom().primaryKey(),
  factionId:  uuid('faction_id').notNull().references(() => factions.id, { onDelete: 'cascade' }),
  userId:     uuid('user_id').notNull().references(() => users.id),
  itemTypeId: uuid('item_type_id').notNull().references(() => itemTypes.id),
  amount:     decimal('amount', { precision: 15, scale: 2 }).notNull(),
  description:  text('description'),
  customValues: jsonb('custom_values').$type<Record<string, string>>(),
  entryDate:  date('entry_date').notNull().defaultNow(),
  createdAt:  timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt:  timestamp('updated_at', { withTimezone: true }),
  isDeleted:  boolean('is_deleted').notNull().default(false),
});

export const entriesRelations = relations(entries, ({ one }) => ({
  faction:  one(factions,  { fields: [entries.factionId],  references: [factions.id] }),
  user:     one(users,     { fields: [entries.userId],     references: [users.id] }),
  itemType: one(itemTypes, { fields: [entries.itemTypeId], references: [itemTypes.id] }),
}));

export type Entry = typeof entries.$inferSelect;
export type NewEntry = typeof entries.$inferInsert;

// ── payouts ────────────────────────────────────────────
// Resources distributed OUT of the faction treasury to members.
// Only 'completed' payouts count against the treasury balance.
export const payouts = pgTable('payouts', {
  id:              uuid('id').defaultRandom().primaryKey(),
  factionId:       uuid('faction_id').notNull().references(() => factions.id, { onDelete: 'cascade' }),
  recipientUserId: uuid('recipient_user_id').notNull().references(() => users.id),
  createdBy:       uuid('created_by').notNull().references(() => users.id),
  itemTypeId:      uuid('item_type_id').notNull().references(() => itemTypes.id),
  amount:          decimal('amount', { precision: 15, scale: 2 }).notNull(),
  description:     text('description'),
  payoutDate:      date('payout_date').notNull().defaultNow(),
  status:          varchar('status', { length: 20 }).notNull().default('pending'),
  approvedBy:      uuid('approved_by').references(() => users.id),
  approvedAt:      timestamp('approved_at', { withTimezone: true }),
  createdAt:       timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt:       timestamp('updated_at', { withTimezone: true }),
  isDeleted:       boolean('is_deleted').notNull().default(false),
});

export const payoutsRelations = relations(payouts, ({ one }) => ({
  faction:   one(factions,  { fields: [payouts.factionId],       references: [factions.id] }),
  recipient: one(users,     { fields: [payouts.recipientUserId], references: [users.id] }),
  creator:   one(users,     { fields: [payouts.createdBy],       references: [users.id] }),
  approver:  one(users,     { fields: [payouts.approvedBy],      references: [users.id] }),
  itemType:  one(itemTypes, { fields: [payouts.itemTypeId],      references: [itemTypes.id] }),
}));

export type Payout = typeof payouts.$inferSelect;
export type NewPayout = typeof payouts.$inferInsert;

/** Payout lifecycle states. Only 'completed' affects the treasury balance. */
export const PAYOUT_STATUSES = ['pending', 'approved', 'rejected', 'completed'] as const;
export type PayoutStatus = (typeof PAYOUT_STATUSES)[number];

// ── expenses ───────────────────────────────────────────
// Faction running costs — warehouse rent, utilities, supplies. Not payouts:
// no member receives anything, and the vault is lighter for having paid them.
export const EXPENSE_CATEGORIES = ['warehouse', 'utilities', 'supplies', 'other'] as const;
export type ExpenseCategory = (typeof EXPENSE_CATEGORIES)[number];

export const expenses = pgTable('expenses', {
  id:          uuid('id').defaultRandom().primaryKey(),
  factionId:   uuid('faction_id').notNull().references(() => factions.id, { onDelete: 'cascade' }),
  createdBy:   uuid('created_by').notNull().references(() => users.id),
  itemTypeId:  uuid('item_type_id').notNull().references(() => itemTypes.id),
  category:    varchar('category', { length: 20 }).notNull().default('other'),
  amount:      decimal('amount', { precision: 15, scale: 2 }).notNull(),
  description: text('description'),
  expenseDate: date('expense_date').notNull().defaultNow(),
  createdAt:   timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt:   timestamp('updated_at', { withTimezone: true }),
  isDeleted:   boolean('is_deleted').notNull().default(false),
});

export const expensesRelations = relations(expenses, ({ one }) => ({
  faction:  one(factions,  { fields: [expenses.factionId],  references: [factions.id] }),
  creator:  one(users,     { fields: [expenses.createdBy],  references: [users.id] }),
  itemType: one(itemTypes, { fields: [expenses.itemTypeId], references: [itemTypes.id] }),
}));

export type Expense = typeof expenses.$inferSelect;
export type NewExpense = typeof expenses.$inferInsert;

// ── treasury_checks ────────────────────────────────────
// "Counted vs. recorded": an admin counts the real vault and records what the
// count found. The recorded balance for that day is derived on read, so a
// dispute has a number to argue about instead of a memory.
export const treasuryChecks = pgTable('treasury_checks', {
  id:          uuid('id').defaultRandom().primaryKey(),
  factionId:   uuid('faction_id').notNull().references(() => factions.id, { onDelete: 'cascade' }),
  createdBy:   uuid('created_by').notNull().references(() => users.id),
  itemTypeId:  uuid('item_type_id').notNull().references(() => itemTypes.id),
  countedAmount: decimal('counted_amount', { precision: 15, scale: 2 }).notNull(),
  checkDate:   date('check_date').notNull().defaultNow(),
  note:        text('note'),
  createdAt:   timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const treasuryChecksRelations = relations(treasuryChecks, ({ one }) => ({
  faction:  one(factions,  { fields: [treasuryChecks.factionId],  references: [factions.id] }),
  creator:  one(users,     { fields: [treasuryChecks.createdBy],  references: [users.id] }),
  itemType: one(itemTypes, { fields: [treasuryChecks.itemTypeId], references: [itemTypes.id] }),
}));

export type TreasuryCheck = typeof treasuryChecks.$inferSelect;
export type NewTreasuryCheck = typeof treasuryChecks.$inferInsert;

// ── member_notes ───────────────────────────────────────
// Private admin notes about a member. Never visible to the member themselves.
export const memberNotes = pgTable('member_notes', {
  id:           uuid('id').defaultRandom().primaryKey(),
  factionId:    uuid('faction_id').notNull().references(() => factions.id, { onDelete: 'cascade' }),
  targetUserId: uuid('target_user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  authorId:     uuid('author_id').notNull().references(() => users.id),
  category:     varchar('category', { length: 50 }).notNull().default('general'),
  content:      text('content').notNull(),
  isFlagged:    boolean('is_flagged').notNull().default(false),
  createdAt:    timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt:    timestamp('updated_at', { withTimezone: true }),
});

export const memberNotesRelations = relations(memberNotes, ({ one }) => ({
  faction: one(factions, { fields: [memberNotes.factionId],    references: [factions.id] }),
  target:  one(users,    { fields: [memberNotes.targetUserId], references: [users.id] }),
  author:  one(users,    { fields: [memberNotes.authorId],     references: [users.id] }),
}));

export type MemberNote = typeof memberNotes.$inferSelect;
export type NewMemberNote = typeof memberNotes.$inferInsert;

export const NOTE_CATEGORIES = [
  'general',
  'performance',
  'discipline',
  'positive',
  'promotion',
] as const;
export type NoteCategory = (typeof NOTE_CATEGORIES)[number];

// ── strikes ────────────────────────────────────────────
// Formal warnings issued to a member. Members can see their own strikes.
export const strikes = pgTable('strikes', {
  id:           uuid('id').defaultRandom().primaryKey(),
  factionId:    uuid('faction_id').notNull().references(() => factions.id, { onDelete: 'cascade' }),
  targetUserId: uuid('target_user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  issuedBy:     uuid('issued_by').notNull().references(() => users.id),
  reason:       text('reason').notNull(),
  severity:     varchar('severity', { length: 20 }).notNull(),
  status:       varchar('status', { length: 20 }).notNull().default('active'),
  expiresAt:    timestamp('expires_at', { withTimezone: true }),
  createdAt:    timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt:    timestamp('updated_at', { withTimezone: true }),
});

export const strikesRelations = relations(strikes, ({ one }) => ({
  faction: one(factions, { fields: [strikes.factionId],    references: [factions.id] }),
  target:  one(users,    { fields: [strikes.targetUserId], references: [users.id] }),
  issuer:  one(users,    { fields: [strikes.issuedBy],     references: [users.id] }),
}));

export type Strike = typeof strikes.$inferSelect;
export type NewStrike = typeof strikes.$inferInsert;

export const STRIKE_SEVERITIES = ['warning', 'minor', 'major'] as const;
export type StrikeSeverity = (typeof STRIKE_SEVERITIES)[number];

export const STRIKE_STATUSES = ['active', 'appealed', 'expired', 'revoked'] as const;
export type StrikeStatus = (typeof STRIKE_STATUSES)[number];

/** Default strike lifetime per severity, in days. `null` = never expires. */
export const DEFAULT_STRIKE_EXPIRY_DAYS: Record<StrikeSeverity, number | null> = {
  warning: 30,
  minor: 90,
  major: null,
};

// ── quotas ─────────────────────────────────────────────
export const quotas = pgTable('quotas', {
  id:           uuid('id').defaultRandom().primaryKey(),
  factionId:    uuid('faction_id').notNull().references(() => factions.id, { onDelete: 'cascade' }),
  itemTypeId:   uuid('item_type_id').notNull().references(() => itemTypes.id),
  // Scope of the target:
  //   'faction'  — null targetUserId, everyone's entries summed into one target
  //   'everyone' — null targetUserId, the SAME target applies to each member
  //                individually (progress reads only the viewer's entries)
  //   'member'   — targetUserId set, one member's personal target
  scope:        varchar('scope', { length: 10 }).notNull().default('faction'),
  // Set only when scope = 'member'.
  targetUserId: uuid('target_user_id').references(() => users.id, { onDelete: 'cascade' }),
  targetAmount: decimal('target_amount', { precision: 15, scale: 2 }).notNull(),
  periodType:   varchar('period_type', { length: 10 }).notNull(),
  periodStart:  date('period_start').notNull(),
  isActive:     boolean('is_active').notNull().default(true),
  createdAt:    timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

/** Quota scopes. 'everyone' is the per-person target handed to every member. */
export const QUOTA_SCOPES = ['faction', 'everyone', 'member'] as const;
export type QuotaScope = (typeof QUOTA_SCOPES)[number];


export const quotasRelations = relations(quotas, ({ one }) => ({
  faction:    one(factions,  { fields: [quotas.factionId],    references: [factions.id] }),
  itemType:   one(itemTypes, { fields: [quotas.itemTypeId],   references: [itemTypes.id] }),
  targetUser: one(users,    { fields: [quotas.targetUserId], references: [users.id] }),
}));

export type Quota = typeof quotas.$inferSelect;
export type NewQuota = typeof quotas.$inferInsert;

// ── audit_logs ─────────────────────────────────────────
// ── announcements ──────────────────────────────────────
// A faction's bulletin board. Announcements outlive the Discord messages they
// replace: "quota deadline is Friday" buried under three hours of chat is the
// problem this exists to solve.
export const announcements = pgTable('announcements', {
  id:        uuid('id').defaultRandom().primaryKey(),
  factionId: uuid('faction_id').notNull().references(() => factions.id, { onDelete: 'cascade' }),
  authorId:  uuid('author_id').notNull().references(() => users.id),
  title:     varchar('title', { length: 200 }).notNull(),
  // Markdown, rendered by the same pipeline as the in-app user guide.
  body:      text('body').notNull(),
  priority:  varchar('priority', { length: 20 }).notNull().default('normal'),
  isPinned:  boolean('is_pinned').notNull().default(false),
  // When set, the announcement stops being listed after this moment. Nothing
  // deletes it — an expired notice is still history, and a leader should be
  // able to prove what was posted and when.
  expiresAt: timestamp('expires_at', { withTimezone: true }),
  isDeleted: boolean('is_deleted').notNull().default(false),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export const announcementsRelations = relations(announcements, ({ one, many }) => ({
  faction: one(factions, { fields: [announcements.factionId], references: [factions.id] }),
  author:  one(users,    { fields: [announcements.authorId],  references: [users.id] }),
  reads:   many(announcementReads),
}));

export type Announcement = typeof announcements.$inferSelect;
export type NewAnnouncement = typeof announcements.$inferInsert;

export const ANNOUNCEMENT_PRIORITIES = ['low', 'normal', 'high', 'urgent'] as const;
export type AnnouncementPriority = (typeof ANNOUNCEMENT_PRIORITIES)[number];

// ── announcement_reads ─────────────────────────────────
// Who has seen what. The point is not surveillance: a leader posting "quota
// doubles on Friday" needs to know whether the people it applies to have
// actually read it before enforcing it.
export const announcementReads = pgTable('announcement_reads', {
  announcementId: uuid('announcement_id').notNull().references(() => announcements.id, { onDelete: 'cascade' }),
  userId:         uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  readAt:         timestamp('read_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  primaryKey({ columns: [table.announcementId, table.userId] }),
]);

export const announcementReadsRelations = relations(announcementReads, ({ one }) => ({
  announcement: one(announcements, { fields: [announcementReads.announcementId], references: [announcements.id] }),
  user:         one(users,         { fields: [announcementReads.userId],         references: [users.id] }),
}));

export type AnnouncementRead = typeof announcementReads.$inferSelect;

// ── notifications ──────────────────────────────────────
// Everything the app knows that somebody should be told.
//
// Only a `type` and a `data` bag are stored, never rendered text. The
// interface is bilingual and a member can switch language at any time, so a
// notification written in English at the moment it fired would be stuck that
// way forever. The client renders `type` through the same i18n layer as the
// rest of the app and interpolates `data`.
//
// `factionId` is where it happened, and is what the bell uses to switch the
// user into the right faction when they click through. Nullable because not
// every notification belongs to one — a support reply does not.
export const notifications = pgTable('notifications', {
  id:        uuid('id').defaultRandom().primaryKey(),
  userId:    uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  factionId: uuid('faction_id').references(() => factions.id, { onDelete: 'cascade' }),
  type:      varchar('type', { length: 40 }).notNull(),
  data:      jsonb('data').$type<Record<string, string | number | null>>(),
  // Where clicking it should take you, as an app view name. The row carries it
  // rather than the client mapping type -> view, so a type can be re-pointed
  // without a frontend release.
  linkView:  varchar('link_view', { length: 40 }),
  readAt:    timestamp('read_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const notificationsRelations = relations(notifications, ({ one }) => ({
  user:    one(users,    { fields: [notifications.userId],    references: [users.id] }),
  faction: one(factions, { fields: [notifications.factionId], references: [factions.id] }),
}));

export type Notification = typeof notifications.$inferSelect;
export type NewNotification = typeof notifications.$inferInsert;

/**
 * Every kind of notification the server can raise.
 *
 * Each one needs a matching `notification.<type>` translation key in both
 * locales; the client falls back to the raw type if one is missing, which
 * makes the omission visible rather than silent.
 */
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

// ── support_tickets ────────────────────────────────────
// Bug reports and feature requests, sent by anyone with an account to the
// superadmin who maintains the app. Deliberately not faction-scoped
// authority: reporting a broken screen is not a faction action, so no rank or
// permission gates it — the only thing you need is to be signed in.
//
// `factionId` records which faction the reporter was looking at when they sent
// it, purely as context for whoever reads it. It is nullable and survives the
// faction being deleted: the bug outlives the faction that happened to hit it.
export const supportTickets = pgTable('support_tickets', {
  id:         uuid('id').defaultRandom().primaryKey(),
  userId:     uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  factionId:  uuid('faction_id').references(() => factions.id, { onDelete: 'set null' }),
  kind:       varchar('kind', { length: 20 }).notNull(),
  subject:    varchar('subject', { length: 120 }).notNull(),
  message:    text('message').notNull(),
  status:     varchar('status', { length: 20 }).notNull().default('open'),
  // Written when the ticket is closed, and shown to the reporter: a declined
  // ticket with no reason is worse than no answer at all.
  resolutionNote: text('resolution_note'),
  resolvedBy: uuid('resolved_by').references(() => users.id),
  resolvedAt: timestamp('resolved_at', { withTimezone: true }),
  createdAt:  timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt:  timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export const supportTicketsRelations = relations(supportTickets, ({ one }) => ({
  user:     one(users,    { fields: [supportTickets.userId],     references: [users.id] }),
  faction:  one(factions, { fields: [supportTickets.factionId],  references: [factions.id] }),
  resolver: one(users,    { fields: [supportTickets.resolvedBy], references: [users.id] }),
}));

export type SupportTicket = typeof supportTickets.$inferSelect;
export type NewSupportTicket = typeof supportTickets.$inferInsert;

export const SUPPORT_TICKET_KINDS = ['bug', 'feature'] as const;
export type SupportTicketKind = (typeof SUPPORT_TICKET_KINDS)[number];

/**
 * `cancelled` is the reporter withdrawing their own ticket; `declined` is the
 * maintainer saying no. They are kept apart on purpose — collapsing them would
 * make "resolved" the only honest-looking outcome and drain the status of
 * meaning over time.
 */
export const SUPPORT_TICKET_STATUSES = ['open', 'resolved', 'declined', 'cancelled'] as const;
export type SupportTicketStatus = (typeof SUPPORT_TICKET_STATUSES)[number];

export const auditLogs = pgTable('audit_logs', {
  id:         bigserial('id', { mode: 'number' }).primaryKey(),
  userId:     uuid('user_id').notNull().references(() => users.id),
  factionId:  uuid('faction_id').references(() => factions.id),
  action:     varchar('action', { length: 50 }).notNull(),
  entityType: varchar('entity_type', { length: 50 }).notNull(),
  entityId:   uuid('entity_id'),
  details:    jsonb('details'),
  ipAddress:  inet('ip_address'),
  createdAt:  timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const auditLogsRelations = relations(auditLogs, ({ one }) => ({
  user:    one(users,    { fields: [auditLogs.userId],    references: [users.id] }),
  faction: one(factions, { fields: [auditLogs.factionId], references: [factions.id] }),
}));

export type AuditLog = typeof auditLogs.$inferSelect;
export type NewAuditLog = typeof auditLogs.$inferInsert;
