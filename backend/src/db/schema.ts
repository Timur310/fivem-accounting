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
  isActive:  boolean('is_active').notNull().default(true),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

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
  // null means the quota applies faction-wide; a user id scopes it to that
  // member only — used for per-member targets on top of the faction target.
  targetUserId: uuid('target_user_id').references(() => users.id, { onDelete: 'cascade' }),
  targetAmount: decimal('target_amount', { precision: 15, scale: 2 }).notNull(),
  periodType:   varchar('period_type', { length: 10 }).notNull(),
  periodStart:  date('period_start').notNull(),
  isActive:     boolean('is_active').notNull().default(true),
  createdAt:    timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const quotasRelations = relations(quotas, ({ one }) => ({
  faction:    one(factions,  { fields: [quotas.factionId],    references: [factions.id] }),
  itemType:   one(itemTypes, { fields: [quotas.itemTypeId],   references: [itemTypes.id] }),
  targetUser: one(users,    { fields: [quotas.targetUserId], references: [users.id] }),
}));

export type Quota = typeof quotas.$inferSelect;
export type NewQuota = typeof quotas.$inferInsert;

// ── audit_logs ─────────────────────────────────────────
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
