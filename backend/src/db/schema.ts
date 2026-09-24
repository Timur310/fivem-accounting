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
  index,
  primaryKey,
} from 'drizzle-orm/pg-core';
import { relations, sql } from 'drizzle-orm';

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
  /**
   * The lowest rank level allowed to see what things cost the faction, or null
   * for everybody who can open the price screen.
   *
   * **Lower level means higher rank** — level 1 is the boss — so `2` shows
   * margins to the Boss and the Underboss and to nobody below them. A soldier
   * working the counter does not need to know the markup, and a screenshot
   * from them should not reveal it.
   */
  marginMinRankLevel: integer('margin_min_rank_level'),
  /**
   * Which parts of the app this faction uses, or null for all of them.
   *
   * Null rather than a filled-in default, and no backfill: every faction that
   * existed before modules did keeps every screen it had, and a module added
   * after a faction was configured arrives switched on rather than silently
   * missing. See lib/modules.ts.
   */
  enabledModules: jsonb('enabled_modules').$type<string[]>(),
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
  'manage_discord',
  // Writing recipes and running them are separate on purpose. A recipe says
  // what the faction's materials are worth converting into, which is a
  // leadership decision; running one is the shop floor. Handing both to the
  // same rank would mean anybody who crafts can also rewrite what a craft
  // costs.
  'manage_crafting',
  'craft',
  'manage_map',
  // Writing the price list is a leadership decision; reading it and quoting
  // from it is the counter. Only the first needs a permission — a price list
  // nobody may read is a price list nobody can sell from.
  'manage_prices',
  // Booking a sale into the books is the counter's job; reverting one is not.
  // The split mirrors crafting: `sell` runs the till, `manage_prices` is what
  // it takes to undo a booking, because a revert moves money back out.
  'sell',
  // The vehicle registry. Reading it is open to the faction — the people who
  // need to look a plate up are usually the ones with the fewest rights — so
  // only changing it needs saying.
  'manage_vehicles',
  // A job the crew ran together. Logging one is the crew's own business, so a
  // rank that may record entries can record an operation; undoing one moves
  // everybody's credit back out, which is leadership. Same division as the
  // till and the recipe book.
  'log_operations',
  'manage_operations',
  // The timesheet, and the one place in the app that needs three permissions
  // rather than two. Clocking yourself in is the shop floor. Reading everybody
  // else's hours is a different thing again — a rota is mildly sensitive, it
  // says who was around and when — and correcting somebody's hours after the
  // fact is a third. A faction that wants its crew to see the rota can grant
  // the middle one without handing out the ability to rewrite it.
  'log_shifts',
  'view_shifts',
  'manage_shifts',
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
  manage_discord: 'Manage Discord',
  manage_crafting: 'Manage Recipes',
  craft: 'Craft Items',
  manage_map: 'Manage Map',
  manage_prices: 'Manage Prices',
  sell: 'Record Sales',
  manage_vehicles: 'Manage Vehicles',
  log_operations: 'Log Operations',
  manage_operations: 'Revert Operations',
  log_shifts: 'Clock In and Out',
  view_shifts: "See Everyone's Shifts",
  manage_shifts: "Edit Everyone's Shifts",
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

// ── discord_integrations ───────────────────────────────
// Which Discord server a faction has connected, one row per faction.
//
// There is a single bot, living on the same Discord application the app
// already uses to sign people in. A faction leader invites that one bot into
// their own server; the operator never has to host anything per faction. The
// bot is push-only — it opens no gateway connection and reads no messages —
// so "connected" means nothing more than: we know a channel we may post to.
//
// `guildId` is unique across the whole table, not just per faction. Without
// that, two factions could both claim the same Discord server and each would
// be able to aim the other's notifications at it.
export const discordIntegrations = pgTable('discord_integrations', {
  id:        uuid('id').defaultRandom().primaryKey(),
  factionId: uuid('faction_id').notNull().unique().references(() => factions.id, { onDelete: 'cascade' }),
  // Discord snowflakes are 64-bit and arrive as strings; they must stay
  // strings. Parsing one into a JS number silently loses the low bits.
  guildId:   varchar('guild_id', { length: 32 }).notNull().unique(),
  guildName: varchar('guild_name', { length: 120 }),
  linkedBy:  uuid('linked_by').notNull().references(() => users.id),
  linkedAt:  timestamp('linked_at', { withTimezone: true }).notNull().defaultNow(),
  // The last delivery failure, kept so a link that quietly broke — the bot was
  // kicked, the channel was deleted — is visible on the settings screen
  // instead of presenting as "connected" while nothing arrives.
  lastError:   text('last_error'),
  lastErrorAt: timestamp('last_error_at', { withTimezone: true }),
  // The language the bot writes its messages in.
  //
  // A Discord message has no viewer: it is one text read by everyone in the
  // channel, so it cannot follow each member's own language the way the
  // interface does. The faction picks one. Only 'en' is rendered today — the
  // column and the (disabled) picker exist so adding Hungarian later is a
  // translation job and not a migration.
  locale:      varchar('locale', { length: 5 }).notNull().default('en'),
});

export const discordIntegrationsRelations = relations(discordIntegrations, ({ one, many }) => ({
  faction: one(factions, { fields: [discordIntegrations.factionId], references: [factions.id] }),
  linker:  one(users,    { fields: [discordIntegrations.linkedBy],  references: [users.id] }),
  routes:  many(discordChannelRoutes),
}));

export type DiscordIntegration = typeof discordIntegrations.$inferSelect;
export type NewDiscordIntegration = typeof discordIntegrations.$inferInsert;

/**
 * The faction activity a Discord channel can be subscribed to.
 *
 * Deliberately the same vocabulary the activity feed already speaks, so a
 * faction routing events to Discord is choosing from a list they have already
 * seen in the app rather than learning a second set of names.
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
  // ── Things being taken back ──
  // A channel that only ever reports additions is a channel that can be
  // gamed: log, get credit, quietly undo. These are separately routable, so a
  // faction can send removals somewhere leadership reads even when the
  // additions go to a busy public log.
  //
  // A strike is never deleted — it is revoked — and that is the same act from
  // the member's side, so it belongs in this group rather than missing.
  'entry_deleted',
  'payout_deleted',
  'expense_deleted',
  'strike_revoked',
  'announcement_removed',
  'craft_reverted',
  'vehicle_removed',
  'operation_reverted',
  // Not in the removals group above: the registry is a description of what the
  // faction has, so a car arriving is news in the same way a car leaving is,
  // and factions will want both in the same channel.
  'vehicle_added',
  'operation_logged',
  // Clocking in and out. Noisier than anything else here by some distance —
  // a restaurant with eight staff is sixteen messages an evening — which is
  // exactly why they are two separate routes: a faction can post the starts in
  // a duty channel and leave the finishes off, or send only the finishes,
  // where the hours are.
  'shift_started',
  'shift_ended',
] as const;
export type DiscordEventType = (typeof DISCORD_EVENT_TYPES)[number];

// ── discord_channel_routes ─────────────────────────────
// Where each kind of activity goes. One channel per event type per faction:
// the unique constraint is the feature, not a limitation — it is what makes
// the settings screen a plain list of choices instead of a rule engine.
//
// An event with no row here simply is not sent. That makes "off" the default
// for everything, including any event type added after a faction connected.
export const discordChannelRoutes = pgTable('discord_channel_routes', {
  id:          uuid('id').defaultRandom().primaryKey(),
  factionId:   uuid('faction_id').notNull().references(() => factions.id, { onDelete: 'cascade' }),
  eventType:   varchar('event_type', { length: 40 }).notNull(),
  channelId:   varchar('channel_id', { length: 32 }).notNull(),
  // Denormalised for display: rendering the settings screen should not need a
  // round trip to Discord, and a channel that has since been deleted still
  // wants a name to show next to the error.
  channelName: varchar('channel_name', { length: 120 }),
  isEnabled:   boolean('is_enabled').notNull().default(true),
  createdAt:   timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt:   timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => ({
  uniqueFactionEvent: uniqueIndex('discord_route_unique').on(table.factionId, table.eventType),
}));

export const discordChannelRoutesRelations = relations(discordChannelRoutes, ({ one }) => ({
  faction: one(factions, { fields: [discordChannelRoutes.factionId], references: [factions.id] }),
}));

export type DiscordChannelRoute = typeof discordChannelRoutes.$inferSelect;
export type NewDiscordChannelRoute = typeof discordChannelRoutes.$inferInsert;

// ── discord_reminders ──────────────────────────────────
// Scheduled messages a faction sends to its own Discord channels: quota
// deadlines, meeting times, "pay your rent". As many as they like.
//
// Unlike every other Discord message in the app, a reminder is not a reaction
// to something that happened — it is the first thing in the codebase that
// needed a **clock**, which is why Phase 8's automated reports sat blocked for
// so long. See §8.14.
//
// Times are server local. `nextRunAt` is the whole scheduling mechanism: the
// runner claims rows whose moment has arrived, sends them, and writes the next
// one. A null `nextRunAt` means nothing is pending — a finished one-off, or a
// schedule with no future occurrence.
export const discordReminders = pgTable('discord_reminders', {
  id:          uuid('id').defaultRandom().primaryKey(),
  factionId:   uuid('faction_id').notNull().references(() => factions.id, { onDelete: 'cascade' }),
  channelId:   varchar('channel_id', { length: 32 }).notNull(),
  channelName: varchar('channel_name', { length: 120 }),
  // What the faction wants said. Free text, not a template: a reminder is
  // theirs to word, and rendering it through the app's i18n layer would mean
  // translating sentences the app did not write.
  message:     text('message').notNull(),
  // A label for the settings list, so a faction with a dozen reminders can
  // tell them apart without reading every message.
  title:       varchar('title', { length: 120 }),

  scheduleType: varchar('schedule_type', { length: 10 }).notNull(),
  /** `HH:MM`, 24-hour, server local. Null for a one-off. */
  timeOfDay:    varchar('time_of_day', { length: 5 }),
  /** 0–6 with Sunday = 0, matching Date.getDay(). Weekly only. */
  weekdays:     jsonb('weekdays').$type<number[]>(),
  /** Clamped to the length of the month, so 31 means "the last day". */
  dayOfMonth:   integer('day_of_month'),
  /** The single moment a one-off fires. */
  runAt:        timestamp('run_at', { withTimezone: true }),

  // Who gets pinged. Roles are Discord's own snowflakes; people are *this
  // app's* user ids, resolved to a Discord id when the message goes out.
  //
  // Storing our ids rather than theirs keeps the picker able to show in-game
  // names, and means a reminder written against a member survives them being
  // renamed on Discord. A member who leaves the faction simply stops being
  // resolved — see resolveMentions.
  mentionRoleIds: jsonb('mention_role_ids').$type<string[]>(),
  mentionUserIds: jsonb('mention_user_ids').$type<string[]>(),

  isEnabled:   boolean('is_enabled').notNull().default(true),
  nextRunAt:   timestamp('next_run_at', { withTimezone: true }),
  lastRunAt:   timestamp('last_run_at', { withTimezone: true }),
  // Shown beside the reminder, so one that has been failing quietly for a week
  // says so instead of looking healthy.
  lastError:   text('last_error'),

  createdBy:   uuid('created_by').notNull().references(() => users.id),
  createdAt:   timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt:   timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => ({
  // The runner's only query is "what is due", across every faction at once.
  dueIndex: index('discord_reminder_due').on(table.nextRunAt),
}));

export const discordRemindersRelations = relations(discordReminders, ({ one }) => ({
  faction: one(factions, { fields: [discordReminders.factionId], references: [factions.id] }),
  creator: one(users,    { fields: [discordReminders.createdBy], references: [users.id] }),
}));

export type DiscordReminder = typeof discordReminders.$inferSelect;
export type NewDiscordReminder = typeof discordReminders.$inferInsert;

// ── crafting_recipes ───────────────────────────────────
// What the faction knows how to make.
//
// A recipe is a *definition*, never a movement: saving one changes no balance.
// It exists because the alternative is what factions do today — logging a
// withdrawal for every component and an entry for the result, by hand, every
// time, and getting one of them wrong eventually.
//
// Recipes are edited in place rather than versioned. A craft snapshots the
// name and writes real entries and payouts, so history stays truthful even
// after a recipe is renamed, re-costed or deleted; what a recipe means today
// is the only question the recipe table has to answer.
export const craftingRecipes = pgTable('crafting_recipes', {
  id:          uuid('id').defaultRandom().primaryKey(),
  factionId:   uuid('faction_id').notNull().references(() => factions.id, { onDelete: 'cascade' }),
  name:        varchar('name', { length: 100 }).notNull(),
  description: text('description'),

  /**
   * Whose contribution the output counts as: `nobody` or `crafter`.
   *
   * `nobody` writes the output against the anonymous placeholder, exactly as
   * laundering does — the treasury moves and no leaderboard does. `crafter`
   * credits whoever ran it, which is what a faction wants for a recipe that
   * represents real work.
   *
   * It is per recipe because both answers are right for different recipes and
   * wrong for the other. Worth knowing before switching it on: a recipe that
   * credits the crafter can be run in a loop against the faction's own
   * materials to farm a quota, so it belongs on recipes whose inputs are
   * genuinely scarce.
   */
  creditOutputTo: varchar('credit_output_to', { length: 10 }).notNull().default('nobody'),

  // Retired rather than deleted, where the faction wants the history without
  // the recipe showing up in the craft picker.
  isActive:    boolean('is_active').notNull().default(true),

  createdBy:   uuid('created_by').notNull().references(() => users.id),
  createdAt:   timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt:   timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => ({
  factionIndex: index('crafting_recipe_faction').on(table.factionId),
  // Two recipes with the same name in one faction is a mistake every time —
  // the craft picker is a list of names.
  uniqueName: uniqueIndex('crafting_recipe_unique_name').on(table.factionId, table.name),
}));

export const CREDIT_OUTPUT_TO = ['nobody', 'crafter'] as const;
export type CreditOutputTo = (typeof CREDIT_OUTPUT_TO)[number];

// ── crafting_recipe_items ──────────────────────────────
// The lines of a recipe: what goes in, what comes out, how much of each.
//
// Inputs and outputs share a table because they are the same shape and the
// craft transaction walks them together. `role` keeps them apart, and the
// unique index is per role so a recipe may legitimately consume and produce
// the same item type — a refining step that burns 10 crates to make 6 better
// ones is a real thing, and nothing here needs to forbid it.
export const craftingRecipeItems = pgTable('crafting_recipe_items', {
  id:         uuid('id').defaultRandom().primaryKey(),
  recipeId:   uuid('recipe_id').notNull().references(() => craftingRecipes.id, { onDelete: 'cascade' }),
  itemTypeId: uuid('item_type_id').notNull().references(() => itemTypes.id, { onDelete: 'restrict' }),
  role:       varchar('role', { length: 6 }).notNull(),
  // Per single craft. A batch multiplies this; see `crafts.quantity`.
  quantity:   decimal('quantity', { precision: 15, scale: 2 }).notNull(),
}, (table) => ({
  recipeIndex: index('crafting_recipe_item_recipe').on(table.recipeId),
  uniqueLine: uniqueIndex('crafting_recipe_item_unique').on(table.recipeId, table.itemTypeId, table.role),
}));

export const RECIPE_ITEM_ROLES = ['input', 'output'] as const;
export type RecipeItemRole = (typeof RECIPE_ITEM_ROLES)[number];

// ── crafts ─────────────────────────────────────────────
// One run of a recipe.
//
// The movements it creates are ordinary entries and completed payouts, because
// the treasury already knows how to count those and a craft must not need
// special-casing in every balance query in the app. This row is what makes
// those movements legible as *one act* afterwards: which recipe, how many, who
// ran it — and it is what a revert reverses.
//
// `recipeName` is a snapshot. A craft from six weeks ago should still say what
// it made after the recipe has been renamed or removed.
export const crafts = pgTable('crafts', {
  id:         uuid('id').defaultRandom().primaryKey(),
  factionId:  uuid('faction_id').notNull().references(() => factions.id, { onDelete: 'cascade' }),
  // Kept nullable and set null on delete: losing the link is acceptable,
  // losing the craft is not.
  recipeId:   uuid('recipe_id').references(() => craftingRecipes.id, { onDelete: 'set null' }),
  recipeName: varchar('recipe_name', { length: 100 }).notNull(),
  /** The batch multiplier. Every input and output line is scaled by it. */
  quantity:   integer('quantity').notNull().default(1),
  craftedBy:  uuid('crafted_by').notNull().references(() => users.id),
  craftDate:  date('craft_date').notNull(),
  notes:      text('notes'),

  // A craft is reverted once or not at all; the timestamp is the guard.
  revertedAt: timestamp('reverted_at', { withTimezone: true }),
  revertedBy: uuid('reverted_by').references(() => users.id),

  createdAt:  timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => ({
  factionIndex: index('craft_faction').on(table.factionId, table.createdAt),
}));

// ── craft_movements ────────────────────────────────────
// The rows a craft created, so a revert can undo exactly those and nothing
// else.
//
// An input is a completed payout and an output is an entry, which is why the
// two id columns are each nullable — a movement is one or the other. Storing
// the link here rather than as a `craft_id` column on entries and payouts
// keeps the two busiest tables in the app untouched.
export const craftMovements = pgTable('craft_movements', {
  id:         uuid('id').defaultRandom().primaryKey(),
  craftId:    uuid('craft_id').notNull().references(() => crafts.id, { onDelete: 'cascade' }),
  role:       varchar('role', { length: 6 }).notNull(),
  itemTypeId: uuid('item_type_id').notNull().references(() => itemTypes.id, { onDelete: 'restrict' }),
  /** The scaled amount actually moved, not the per-craft line. */
  quantity:   decimal('quantity', { precision: 15, scale: 2 }).notNull(),
  entryId:    uuid('entry_id').references(() => entries.id, { onDelete: 'set null' }),
  payoutId:   uuid('payout_id').references(() => payouts.id, { onDelete: 'set null' }),
}, (table) => ({
  craftIndex: index('craft_movement_craft').on(table.craftId),
}));

export const craftingRecipesRelations = relations(craftingRecipes, ({ one, many }) => ({
  faction: one(factions, { fields: [craftingRecipes.factionId], references: [factions.id] }),
  creator: one(users,    { fields: [craftingRecipes.createdBy], references: [users.id] }),
  items:   many(craftingRecipeItems),
  crafts:  many(crafts),
}));

export const craftingRecipeItemsRelations = relations(craftingRecipeItems, ({ one }) => ({
  recipe:   one(craftingRecipes, { fields: [craftingRecipeItems.recipeId], references: [craftingRecipes.id] }),
  itemType: one(itemTypes,       { fields: [craftingRecipeItems.itemTypeId], references: [itemTypes.id] }),
}));

export const craftsRelations = relations(crafts, ({ one, many }) => ({
  faction:   one(factions,        { fields: [crafts.factionId], references: [factions.id] }),
  recipe:    one(craftingRecipes, { fields: [crafts.recipeId], references: [craftingRecipes.id] }),
  crafter:   one(users,           { fields: [crafts.craftedBy], references: [users.id] }),
  movements: many(craftMovements),
}));

export const craftMovementsRelations = relations(craftMovements, ({ one }) => ({
  craft:    one(crafts,     { fields: [craftMovements.craftId], references: [crafts.id] }),
  itemType: one(itemTypes,  { fields: [craftMovements.itemTypeId], references: [itemTypes.id] }),
  entry:    one(entries,    { fields: [craftMovements.entryId], references: [entries.id] }),
  payout:   one(payouts,    { fields: [craftMovements.payoutId], references: [payouts.id] }),
}));

export type CraftingRecipe = typeof craftingRecipes.$inferSelect;
export type NewCraftingRecipe = typeof craftingRecipes.$inferInsert;
export type CraftingRecipeItem = typeof craftingRecipeItems.$inferSelect;
export type Craft = typeof crafts.$inferSelect;
export type CraftMovement = typeof craftMovements.$inferSelect;

// ── map_layers ─────────────────────────────────────────
// A named map of its own: "Robbery routes", "Where friends live", "Turf".
//
// The layer is where permission lives. A faction wanted a map only certain
// ranks can open, and saying that once per layer is both easier to set and
// easier to check than repeating it on every marker inside it — and far
// harder to get wrong by forgetting one.
export const mapLayers = pgTable('map_layers', {
  id:          uuid('id').defaultRandom().primaryKey(),
  factionId:   uuid('faction_id').notNull().references(() => factions.id, { onDelete: 'cascade' }),
  name:        varchar('name', { length: 80 }).notNull(),
  description: text('description'),
  /** Fallback colour for markers inside that have none of their own. */
  color:       varchar('color', { length: 7 }),
  icon:        varchar('icon', { length: 16 }),

  /**
   * The lowest rank level allowed to open this layer, or null for everybody.
   *
   * **Lower level means higher rank** — level 1 is the boss — so a layer with
   * `minRankLevel: 2` is open to levels 1 and 2 and invisible below.
   *
   * It gates editing as well as reading: a marker can only be changed by
   * somebody who holds `manage_map` *and* can see the layer it is in. A
   * permission that let a low rank edit a map they cannot open would be a
   * permission to vandalise what they cannot read.
   */
  minRankLevel: integer('min_rank_level'),

  createdBy:   uuid('created_by').notNull().references(() => users.id),
  createdAt:   timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt:   timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => ({
  factionIndex: index('map_layer_faction').on(table.factionId),
  uniqueName: uniqueIndex('map_layer_unique_name').on(table.factionId, table.name),
}));

export const mapLayersRelations = relations(mapLayers, ({ one, many }) => ({
  faction: one(factions, { fields: [mapLayers.factionId], references: [factions.id] }),
  creator: one(users,    { fields: [mapLayers.createdBy], references: [users.id] }),
  markers: many(mapMarkers),
}));

export type MapLayer = typeof mapLayers.$inferSelect;
export type NewMapLayer = typeof mapLayers.$inferInsert;

// ── map_markers ────────────────────────────────────────
// What a faction knows about the map: stash spots, meets, turf, supply runs.
//
// One table for points, areas and routes rather than three. They differ only
// in how many coordinates they carry and how the client draws them — the name,
// the description, who may see it and who put it there are identical, and
// three tables would mean three of every query, route and permission check.
//
// Coordinates are stored in **game space**, never in map pixels. A player
// reads `-1037.2, -2737.5` off `/coords` in game and that is the number that
// has to survive: the map image, its zoom levels and the transform that puts a
// pixel on screen are all rendering details that can be replaced without
// touching a row here. Storing pixels would tie every marker to one tile set.
export const mapMarkers = pgTable('map_markers', {
  id:          uuid('id').defaultRandom().primaryKey(),
  factionId:   uuid('faction_id').notNull().references(() => factions.id, { onDelete: 'cascade' }),
  /**
   * Which map this belongs to. Exactly one, and it is what decides who may
   * see or change the marker — see `map_layers.minRankLevel`.
   *
   * Cascades: deleting a layer deletes what was drawn on it. A marker outside
   * every layer would be a marker nothing governs the visibility of.
   */
  layerId:     uuid('layer_id').notNull().references(() => mapLayers.id, { onDelete: 'cascade' }),

  kind:        varchar('kind', { length: 8 }).notNull(),
  name:        varchar('name', { length: 120 }).notNull(),
  description: text('description'),

  /**
   * Free-text label the faction chooses — "stash", "meet", "turf". Not an
   * enum: every server has its own vocabulary, and a fixed list would be wrong
   * for most of them within a week.
   */
  category:    varchar('category', { length: 40 }),
  /** Marker colour, `#rrggbb`. Null falls back to the faction's accent. */
  color:       varchar('color', { length: 7 }),
  /** An emoji standing in for the marker, same idea as item types. */
  icon:        varchar('icon', { length: 16 }),

  /**
   * The shape, in game coordinates: `[{x, y, z?}, …]`.
   *
   * One coordinate for a point, two or more for a route, three or more for an
   * area. `z` is only meaningful on a point — a stash is on a specific floor,
   * a turf boundary is not.
   */
  points:      jsonb('points').$type<{ x: number; y: number; z?: number }[]>().notNull(),

  createdBy:   uuid('created_by').notNull().references(() => users.id),
  createdAt:   timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt:   timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => ({
  factionIndex: index('map_marker_faction').on(table.factionId),
  layerIndex: index('map_marker_layer').on(table.layerId),
}));

export const MAP_MARKER_KINDS = ['point', 'area', 'route'] as const;
export type MapMarkerKind = (typeof MAP_MARKER_KINDS)[number];

export const mapMarkersRelations = relations(mapMarkers, ({ one }) => ({
  faction: one(factions, { fields: [mapMarkers.factionId], references: [factions.id] }),
  layer:   one(mapLayers, { fields: [mapMarkers.layerId], references: [mapLayers.id] }),
  creator: one(users,    { fields: [mapMarkers.createdBy], references: [users.id] }),
}));

export type MapMarker = typeof mapMarkers.$inferSelect;
export type NewMapMarker = typeof mapMarkers.$inferInsert;

// ── product_prices ─────────────────────────────────────
// What the faction sells a thing for.
//
// One row per item type, per faction — a price list, not a history. The list
// is small, people read it as a list, and a second price for the same item is
// a question ("which one is current?") nobody at the counter can answer.
//
// A price names the currency it is in, because a faction quotes some things in
// clean money and some in dirty, and "$40,000" is two different offers
// depending on which. The currency is itself an item type: the treasury
// already knows what money the faction holds, and a second list of currencies
// here would let the two drift apart.
export const productPrices = pgTable('product_prices', {
  id:         uuid('id').defaultRandom().primaryKey(),
  factionId:  uuid('faction_id').notNull().references(() => factions.id, { onDelete: 'cascade' }),
  // Cascades: an item type that no longer exists cannot have a price.
  itemTypeId: uuid('item_type_id').notNull().references(() => itemTypes.id, { onDelete: 'cascade' }),
  unitPrice:  decimal('unit_price', { precision: 15, scale: 2 }).notNull(),
  // Restricted rather than cascaded: deleting the currency would silently make
  // every price quoted in it meaningless, so it has to be refused until the
  // prices naming it are dealt with.
  currencyItemTypeId: uuid('currency_item_type_id').notNull().references(() => itemTypes.id, { onDelete: 'restrict' }),

  /**
   * The lowest price this may be sold at, or null for no floor.
   *
   * It warns rather than blocks for anyone holding `manage_prices` — a leader
   * undercutting their own floor is a decision, not a mistake — and blocks for
   * everybody else.
   */
  floorPrice: decimal('floor_price', { precision: 15, scale: 2 }),
  note:       text('note'),
  // Retired rather than deleted, for a thing the faction has stopped selling
  // but does not want to re-enter next month.
  isActive:   boolean('is_active').notNull().default(true),

  updatedBy:  uuid('updated_by').notNull().references(() => users.id),
  createdAt:  timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt:  timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => ({
  factionIndex: index('product_price_faction').on(table.factionId),
  uniqueItem: uniqueIndex('product_price_unique_item').on(table.factionId, table.itemTypeId),
}));

// ── product_addons ─────────────────────────────────────
// The extras a product can be sold with: a suppressor, an extended magazine,
// a scope.
//
// They hang off the price rather than off the item type, so retiring a price
// takes its add-ons with it. Modelling each combination as its own product
// instead would turn one pistol into eight rows — and eight rows to edit the
// day the pistol price changes.
//
// `itemTypeId` is set only when the add-on is a thing the faction actually
// stocks, which is what will let a later phase take it out of the treasury
// when the sale is booked. An add-on that is pure margin — "engraved",
// "delivered" — leaves it null and is only ever a number on the quote.
export const productAddons = pgTable('product_addons', {
  id:             uuid('id').defaultRandom().primaryKey(),
  productPriceId: uuid('product_price_id').notNull().references(() => productPrices.id, { onDelete: 'cascade' }),
  name:           varchar('name', { length: 80 }).notNull(),
  price:          decimal('price', { precision: 15, scale: 2 }).notNull(),
  itemTypeId:     uuid('item_type_id').references(() => itemTypes.id, { onDelete: 'set null' }),
  sortOrder:      integer('sort_order').notNull().default(0),
  isActive:       boolean('is_active').notNull().default(true),
}, (table) => ({
  priceIndex: index('product_addon_price').on(table.productPriceId),
  uniqueName: uniqueIndex('product_addon_unique_name').on(table.productPriceId, table.name),
}));

// ── counterparties ─────────────────────────────────────
// Who the faction sells to, and what deal each one has.
//
// This was asked for as a single "alliance mode" switch. One switch breaks the
// day two allies have different deals, and that day always comes — so it is a
// list with a discount each, and the switch is a dropdown.
//
// Deactivated rather than deleted: a buyer who disappears takes the reason for
// an old price with them.
export const counterparties = pgTable('counterparties', {
  id:        uuid('id').defaultRandom().primaryKey(),
  factionId: uuid('faction_id').notNull().references(() => factions.id, { onDelete: 'cascade' }),
  name:      varchar('name', { length: 80 }).notNull(),
  /** Percent off every line. 0 is a real answer — a walk-in customer. */
  discountPercent: decimal('discount_percent', { precision: 5, scale: 2 }).notNull().default('0'),
  note:      text('note'),
  color:     varchar('color', { length: 7 }),
  icon:      varchar('icon', { length: 16 }),
  isActive:  boolean('is_active').notNull().default(true),

  createdBy: uuid('created_by').notNull().references(() => users.id),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => ({
  factionIndex: index('counterparty_faction').on(table.factionId),
  uniqueName: uniqueIndex('counterparty_unique_name').on(table.factionId, table.name),
}));

// ── quantity_breaks ────────────────────────────────────
// Buy more, pay less: five or more is 10% off.
//
// A null `itemTypeId` is the faction's default ladder, applying to everything
// without one of its own. An item with its own ladder ignores the default
// entirely rather than merging with it — merged ladders cannot be reasoned
// about from the screen that shows them.
export const quantityBreaks = pgTable('quantity_breaks', {
  id:         uuid('id').defaultRandom().primaryKey(),
  factionId:  uuid('faction_id').notNull().references(() => factions.id, { onDelete: 'cascade' }),
  itemTypeId: uuid('item_type_id').references(() => itemTypes.id, { onDelete: 'cascade' }),
  /** The quantity at which this rate starts applying. */
  minQuantity: decimal('min_quantity', { precision: 15, scale: 2 }).notNull(),
  discountPercent: decimal('discount_percent', { precision: 5, scale: 2 }).notNull(),
}, (table) => ({
  factionIndex: index('quantity_break_faction').on(table.factionId),
  // Two indexes rather than one, because Postgres treats NULLs as distinct: a
  // single unique index over the nullable column would happily accept two
  // faction-wide rungs at the same quantity.
  uniqueItemRung: uniqueIndex('quantity_break_unique_item')
    .on(table.factionId, table.itemTypeId, table.minQuantity)
    .where(sql`item_type_id IS NOT NULL`),
  uniqueDefaultRung: uniqueIndex('quantity_break_unique_default')
    .on(table.factionId, table.minQuantity)
    .where(sql`item_type_id IS NULL`),
}));

export const productPricesRelations = relations(productPrices, ({ one, many }) => ({
  faction:  one(factions,  { fields: [productPrices.factionId], references: [factions.id] }),
  itemType: one(itemTypes, { fields: [productPrices.itemTypeId], references: [itemTypes.id] }),
  currency: one(itemTypes, { fields: [productPrices.currencyItemTypeId], references: [itemTypes.id] }),
  addons:   many(productAddons),
}));

export const productAddonsRelations = relations(productAddons, ({ one }) => ({
  price:    one(productPrices, { fields: [productAddons.productPriceId], references: [productPrices.id] }),
  itemType: one(itemTypes,     { fields: [productAddons.itemTypeId], references: [itemTypes.id] }),
}));

export const counterpartiesRelations = relations(counterparties, ({ one }) => ({
  faction: one(factions, { fields: [counterparties.factionId], references: [factions.id] }),
  creator: one(users,    { fields: [counterparties.createdBy], references: [users.id] }),
}));

export const quantityBreaksRelations = relations(quantityBreaks, ({ one }) => ({
  faction:  one(factions,  { fields: [quantityBreaks.factionId], references: [factions.id] }),
  itemType: one(itemTypes, { fields: [quantityBreaks.itemTypeId], references: [itemTypes.id] }),
}));

export type ProductPrice = typeof productPrices.$inferSelect;
export type NewProductPrice = typeof productPrices.$inferInsert;
export type ProductAddon = typeof productAddons.$inferSelect;
export type NewProductAddon = typeof productAddons.$inferInsert;
export type Counterparty = typeof counterparties.$inferSelect;
export type NewCounterparty = typeof counterparties.$inferInsert;
export type QuantityBreak = typeof quantityBreaks.$inferSelect;
export type NewQuantityBreak = typeof quantityBreaks.$inferInsert;

// ── sales ──────────────────────────────────────────────
// One accepted quote, booked.
//
// Everything on it is a snapshot. A sale from six weeks ago has to keep saying
// what was actually charged after the price list has moved, the partner has
// been renamed and the add-on has been deleted — so the figures live here
// rather than being recomputed from the book on every read.
//
// Like a craft, it invents no new kind of money: the payment arrives as an
// ordinary entry and the goods leave as completed payouts, so every balance,
// report and export in the app counts a sale correctly without knowing that
// sales exist. This row is what makes those movements legible as *one act*
// afterwards, and what a revert reverses.
export const sales = pgTable('sales', {
  id:        uuid('id').defaultRandom().primaryKey(),
  factionId: uuid('faction_id').notNull().references(() => factions.id, { onDelete: 'cascade' }),

  // Nullable and set null on delete: losing the link to a deleted partner is
  // acceptable, losing the sale is not. The name and the rate are snapshotted
  // beside it for exactly that case.
  counterpartyId:   uuid('counterparty_id').references(() => counterparties.id, { onDelete: 'set null' }),
  counterpartyName: varchar('counterparty_name', { length: 80 }),
  counterpartyDiscountPercent: decimal('counterparty_discount_percent', { precision: 5, scale: 2 }).notNull().default('0'),

  currencyItemTypeId: uuid('currency_item_type_id').notNull().references(() => itemTypes.id, { onDelete: 'restrict' }),
  subtotal:      decimal('subtotal', { precision: 15, scale: 2 }).notNull(),
  discountTotal: decimal('discount_total', { precision: 15, scale: 2 }).notNull(),
  total:         decimal('total', { precision: 15, scale: 2 }).notNull(),

  /**
   * Whose contribution the payment counts as: `nobody` or `seller`.
   *
   * The same choice crafting makes about its output, and for the same reason.
   * `nobody` books the money against the anonymous placeholder — the treasury
   * moves and no leaderboard does. `seller` credits whoever ran the sale,
   * which is right where selling is the work being measured.
   */
  creditSaleTo: varchar('credit_sale_to', { length: 10 }).notNull().default('nobody'),

  soldBy:   uuid('sold_by').notNull().references(() => users.id),
  saleDate: date('sale_date').notNull(),
  notes:    text('notes'),

  // A sale is reverted once or not at all; the timestamp is the guard.
  revertedAt: timestamp('reverted_at', { withTimezone: true }),
  revertedBy: uuid('reverted_by').references(() => users.id),

  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => ({
  factionIndex: index('sale_faction').on(table.factionId, table.createdAt),
}));

// ── sale_lines ─────────────────────────────────────────
// What was on the receipt, as it read on the day.
//
// `addons` is jsonb rather than a fourth table because these are snapshots,
// never joined to and never queried by: nothing asks "which sales included a
// suppressor" without also wanting the sale. A table would buy referential
// integrity with a row that must not follow the add-on it was copied from.
export const saleLines = pgTable('sale_lines', {
  id:           uuid('id').defaultRandom().primaryKey(),
  saleId:       uuid('sale_id').notNull().references(() => sales.id, { onDelete: 'cascade' }),
  itemTypeId:   uuid('item_type_id').notNull().references(() => itemTypes.id, { onDelete: 'restrict' }),
  itemTypeName: varchar('item_type_name', { length: 100 }).notNull(),
  quantity:     decimal('quantity', { precision: 15, scale: 2 }).notNull(),
  /** The book price of one, before add-ons, as it stood at the sale. */
  unitPrice:    decimal('unit_price', { precision: 15, scale: 2 }).notNull(),
  addons:       jsonb('addons').$type<{ name: string; price: string; itemTypeId: string | null }[]>(),
  discountPercent: decimal('discount_percent', { precision: 5, scale: 2 }).notNull(),
  gross:    decimal('gross', { precision: 15, scale: 2 }).notNull(),
  discount: decimal('discount', { precision: 15, scale: 2 }).notNull(),
  total:    decimal('total', { precision: 15, scale: 2 }).notNull(),
}, (table) => ({
  saleIndex: index('sale_line_sale').on(table.saleId),
}));

// ── sale_movements ─────────────────────────────────────
// The ledger rows a sale created, so a revert can undo exactly those and
// nothing else.
//
// The payment is an entry and each item handed over is a completed payout,
// which is why the two id columns are each nullable — a movement is one or the
// other. The link lives here rather than as a `sale_id` column on entries and
// payouts, keeping the two busiest tables in the app untouched. It is also
// what makes those rows refuse to be edited one at a time: unpicking half a
// sale would leave the books describing a trade that never happened.
export const saleMovements = pgTable('sale_movements', {
  id:         uuid('id').defaultRandom().primaryKey(),
  saleId:     uuid('sale_id').notNull().references(() => sales.id, { onDelete: 'cascade' }),
  role:       varchar('role', { length: 10 }).notNull(),
  itemTypeId: uuid('item_type_id').notNull().references(() => itemTypes.id, { onDelete: 'restrict' }),
  quantity:   decimal('quantity', { precision: 15, scale: 2 }).notNull(),
  entryId:    uuid('entry_id').references(() => entries.id, { onDelete: 'set null' }),
  payoutId:   uuid('payout_id').references(() => payouts.id, { onDelete: 'set null' }),
}, (table) => ({
  saleIndex: index('sale_movement_sale').on(table.saleId),
}));

export const SALE_MOVEMENT_ROLES = ['money_in', 'goods_out'] as const;
export type SaleMovementRole = (typeof SALE_MOVEMENT_ROLES)[number];

export const CREDIT_SALE_TO = ['nobody', 'seller'] as const;
export type CreditSaleTo = (typeof CREDIT_SALE_TO)[number];

export const salesRelations = relations(sales, ({ one, many }) => ({
  faction:      one(factions,       { fields: [sales.factionId], references: [factions.id] }),
  counterparty: one(counterparties, { fields: [sales.counterpartyId], references: [counterparties.id] }),
  currency:     one(itemTypes,      { fields: [sales.currencyItemTypeId], references: [itemTypes.id] }),
  seller:       one(users,          { fields: [sales.soldBy], references: [users.id] }),
  lines:        many(saleLines),
  movements:    many(saleMovements),
}));

export const saleLinesRelations = relations(saleLines, ({ one }) => ({
  sale:     one(sales,     { fields: [saleLines.saleId], references: [sales.id] }),
  itemType: one(itemTypes, { fields: [saleLines.itemTypeId], references: [itemTypes.id] }),
}));

export const saleMovementsRelations = relations(saleMovements, ({ one }) => ({
  sale:     one(sales,     { fields: [saleMovements.saleId], references: [sales.id] }),
  itemType: one(itemTypes, { fields: [saleMovements.itemTypeId], references: [itemTypes.id] }),
  entry:    one(entries,   { fields: [saleMovements.entryId], references: [entries.id] }),
  payout:   one(payouts,   { fields: [saleMovements.payoutId], references: [payouts.id] }),
}));

export type Sale = typeof sales.$inferSelect;
export type NewSale = typeof sales.$inferInsert;
export type SaleLine = typeof saleLines.$inferSelect;
export type SaleMovement = typeof saleMovements.$inferSelect;

// ── currency_rates ─────────────────────────────────────
// What one currency is worth in another, for this faction.
//
// A faction prices some things in clean money and some in dirty, and a buyer
// asks for one basket: "50k dirty, or 35k clean". Without a rate the only
// honest answer is to refuse the mixed quote, which is what the calculator did
// before this table existed.
//
// **Directional, and never inverted automatically.** A row says dirty → clean,
// and quoting the other way needs its own row. Deriving the reverse as 1/rate
// looks helpful and produces a number the faction never agreed to: rates in
// these servers are rarely symmetric — laundering takes a cut — and a derived
// inverse would quietly undercut it.
export const currencyRates = pgTable('currency_rates', {
  id:        uuid('id').defaultRandom().primaryKey(),
  factionId: uuid('faction_id').notNull().references(() => factions.id, { onDelete: 'cascade' }),
  fromItemTypeId: uuid('from_item_type_id').notNull().references(() => itemTypes.id, { onDelete: 'cascade' }),
  toItemTypeId:   uuid('to_item_type_id').notNull().references(() => itemTypes.id, { onDelete: 'cascade' }),
  /**
   * How much of `to` one unit of `from` buys.
   *
   * Six decimals because the interesting rates are fractions — 0.7 clean for
   * a dirty dollar — and two would round a 0.685 agreement into a different
   * deal on every line.
   */
  rate:      decimal('rate', { precision: 18, scale: 6 }).notNull(),
  updatedBy: uuid('updated_by').notNull().references(() => users.id),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => ({
  factionIndex: index('currency_rate_faction').on(table.factionId),
  uniquePair: uniqueIndex('currency_rate_unique_pair')
    .on(table.factionId, table.fromItemTypeId, table.toItemTypeId),
}));

export const currencyRatesRelations = relations(currencyRates, ({ one }) => ({
  faction: one(factions,  { fields: [currencyRates.factionId], references: [factions.id] }),
  from:    one(itemTypes, { fields: [currencyRates.fromItemTypeId], references: [itemTypes.id] }),
  to:      one(itemTypes, { fields: [currencyRates.toItemTypeId], references: [itemTypes.id] }),
}));

export type CurrencyRate = typeof currencyRates.$inferSelect;
export type NewCurrencyRate = typeof currencyRates.$inferInsert;

// ── vehicles ───────────────────────────────────────────
// The faction's own vehicle registry: what it owns, who drives it, where each
// one currently is.
//
// Modelled on the police registries these servers already run, which is what
// was asked for — a plate goes in, everything known about the car comes back.
//
// **The owner is two columns, and that is deliberate.** `ownerUserId` links a
// vehicle to somebody on the roster, which survives a rename and lets a
// member's profile answer "what do they drive". `ownerName` is for everyone
// else: an ally, a front company, a name the faction only half knows. A
// registry that could only name members would be unable to record the car
// parked outside, and one that could only hold text would lose every link the
// day somebody changed their name.
export const vehicles = pgTable('vehicles', {
  id:        uuid('id').defaultRandom().primaryKey(),
  factionId: uuid('faction_id').notNull().references(() => factions.id, { onDelete: 'cascade' }),

  /**
   * Stored exactly as typed, matched case-insensitively.
   *
   * Plates in these servers carry their own spacing and casing conventions and
   * people read them off a screen; normalising on the way in would show them
   * something other than what they entered. The unique index does the
   * normalising instead, so `45ABC123` and `45abc123` cannot both exist.
   */
  plate:     varchar('plate', { length: 16 }).notNull(),
  make:      varchar('make', { length: 60 }),
  model:     varchar('model', { length: 60 }),
  color:     varchar('color', { length: 40 }),
  /** One of VEHICLE_CATEGORIES — car, suv, motorcycle, and so on. */
  category:  varchar('category', { length: 20 }).notNull().default('car'),
  /** Model year. Null where nobody wrote it down, which is most of them. */
  year:      integer('year'),
  /** One of VEHICLE_STATUSES. */
  status:    varchar('status', { length: 20 }).notNull().default('in_service'),
  /** A line beside the status: "impounded at Mission Row, released on the 14th". */
  statusNote: varchar('status_note', { length: 200 }),

  ownerUserId: uuid('owner_user_id').references(() => users.id, { onDelete: 'set null' }),
  ownerName:   varchar('owner_name', { length: 120 }),

  notes:     text('notes'),

  createdBy: uuid('created_by').notNull().references(() => users.id),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedBy: uuid('updated_by').notNull().references(() => users.id),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => ({
  factionIndex: index('vehicle_faction').on(table.factionId, table.plate),
  statusIndex: index('vehicle_status').on(table.factionId, table.status),
  ownerIndex: index('vehicle_owner').on(table.ownerUserId),
  // Case-insensitive, because a plate is one car however it was typed.
  uniquePlate: uniqueIndex('vehicle_unique_plate')
    .on(table.factionId, sql`upper(${table.plate})`),
}));

/**
 * Where a vehicle currently is, as a fixed list rather than free text.
 *
 * Fixed so the same word means the same thing in every faction, so the filter
 * on the table can be a set of chips rather than a search box, and so both
 * languages can name them. The cost is that adding one is a code change —
 * accepted, because a registry whose statuses drift is a registry nobody can
 * filter.
 */
export const VEHICLE_STATUSES = [
  'in_service',
  'in_repair',
  'impounded',
  'stolen',
  'sold',
  'scrapped',
] as const;
export type VehicleStatus = (typeof VEHICLE_STATUSES)[number];

export const VEHICLE_CATEGORIES = [
  'car',
  'suv',
  'motorcycle',
  'van',
  'truck',
  'boat',
  'aircraft',
  'other',
] as const;
export type VehicleCategory = (typeof VEHICLE_CATEGORIES)[number];

export const vehiclesRelations = relations(vehicles, ({ one }) => ({
  faction: one(factions, { fields: [vehicles.factionId], references: [factions.id] }),
  owner:   one(users,    { fields: [vehicles.ownerUserId], references: [users.id] }),
  creator: one(users,    { fields: [vehicles.createdBy], references: [users.id] }),
}));

export type Vehicle = typeof vehicles.$inferSelect;
export type NewVehicle = typeof vehicles.$inferInsert;


// ── operations ─────────────────────────────────────────
// A job the crew ran together, and the split of what they came back with.
//
// The problem this solves is not bookkeeping, it is arithmetic done in a
// Discord voice channel at two in the morning. Four people rob a bank, the
// takings land in one person's pockets, and the faction then wants four
// entries that add up to the haul. Done by hand it is four people typing four
// numbers, and the numbers do not add up: somebody rounds, somebody forgets
// the gold, somebody logs their share twice.
//
// So the haul is recorded once, as one thing that happened, and the app does
// the dividing. The entries it writes are ordinary entries — every balance,
// leaderboard and report in the app already counts them, and none of them
// needed to learn what an operation is.
export const operations = pgTable('operations', {
  id:        uuid('id').defaultRandom().primaryKey(),
  factionId: uuid('faction_id').notNull().references(() => factions.id, { onDelete: 'cascade' }),

  name:     varchar('name', { length: 120 }).notNull(),
  kind:     varchar('kind', { length: 20 }).notNull().default('other'),
  location: varchar('location', { length: 120 }),

  /**
   * When the job happened, not when somebody got round to logging it.
   *
   * A timestamp rather than a date because two jobs in one night is the normal
   * case, and "the second Vangelico run" is how people will look for it. The
   * entries it writes still carry the date, which is what the ledger works in.
   */
  occurredAt: timestamp('occurred_at', { withTimezone: true }).notNull(),

  /**
   * The share taken off the top for the faction itself, before the crew split.
   *
   * Booked against the anonymous placeholder, the same way laundering and an
   * uncredited sale are: the treasury gains it and no leaderboard does. Most
   * factions run a cut like this, and doing it by hand means the crew's shares
   * stop adding up to the haul.
   */
  factionCutPercent: decimal('faction_cut_percent', { precision: 5, scale: 2 }).notNull().default('0'),

  /**
   * Who the haul is credited to: `crew` divides it, `faction` books all of it
   * against the faction itself.
   *
   * The crews that asked for this said the same thing twice: an operation is
   * often just a thing that happened. Nobody is owed a share, the takings go
   * straight into the vault, and what the faction wants recorded is that it
   * was run and who ran it. Splitting by default forced a number onto a night
   * that had no number in it.
   */
  creditTo: varchar('credit_to', { length: 10 }).notNull().default('crew'),

  notes:    text('notes'),
  loggedBy: uuid('logged_by').notNull().references(() => users.id),

  // Reverted once or not at all; the timestamp is the guard, as with sales.
  revertedAt: timestamp('reverted_at', { withTimezone: true }),
  revertedBy: uuid('reverted_by').references(() => users.id),

  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => ({
  factionIndex: index('operation_faction').on(table.factionId, table.occurredAt),
}));

/** What kind of job it was. Labels only — nothing in the split depends on it. */
export const OPERATION_KINDS = [
  'bank',
  'jewelry',
  'store',
  'house',
  'convoy',
  'contract',
  'territory',
  'other',
] as const;
export type OperationKind = (typeof OPERATION_KINDS)[number];

// ── operation_participants ─────────────────────────────
// Who was there, and how big a share they take.
//
// `share` is a weight, not a percentage: three people on 1 each is an even
// three-way split, and giving the driver 2 makes it a quarter/quarter/half
// without anybody working out that 25 and 50 come to 100. Percentages that
// have to sum to a round number are the thing people get wrong.
export const operationParticipants = pgTable('operation_participants', {
  id:          uuid('id').defaultRandom().primaryKey(),
  operationId: uuid('operation_id').notNull().references(() => operations.id, { onDelete: 'cascade' }),
  userId:      uuid('user_id').notNull().references(() => users.id),
  share:       integer('share').notNull().default(1),

  /**
   * How this member did on the job, 1 to 5, or null for not rated.
   *
   * Asked for alongside the split being optional, and for the same reason: an
   * operation with nothing to divide still has something worth recording
   * about the people who ran it. Deliberately part of the operation rather
   * than a score that follows the member around — it says how one night went,
   * not what somebody is worth.
   */
  rating:      integer('rating'),
  ratingNote:  varchar('rating_note', { length: 200 }),

  createdAt:   timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => ({
  uniqueMember: uniqueIndex('operation_participant_unique').on(table.operationId, table.userId),
}));

// ── operation_loot ─────────────────────────────────────
// What came back, as one line per item type, named as it read on the night.
export const operationLoot = pgTable('operation_loot', {
  id:           uuid('id').defaultRandom().primaryKey(),
  operationId:  uuid('operation_id').notNull().references(() => operations.id, { onDelete: 'cascade' }),
  itemTypeId:   uuid('item_type_id').notNull().references(() => itemTypes.id, { onDelete: 'restrict' }),
  itemTypeName: varchar('item_type_name', { length: 100 }).notNull(),
  quantity:     decimal('quantity', { precision: 15, scale: 2 }).notNull(),
}, (table) => ({
  operationIndex: index('operation_loot_operation').on(table.operationId),
}));

// ── operation_movements ────────────────────────────────
// The ledger rows the split created, so a revert can undo exactly those.
//
// Shaped like sale_movements and for the same reason: the link lives here
// rather than as an `operation_id` column on entries, which keeps the busiest
// table in the app untouched, and it is what makes those entries refuse to be
// edited one at a time. Half an unpicked split is a haul that does not add up.
export const operationMovements = pgTable('operation_movements', {
  id:          uuid('id').defaultRandom().primaryKey(),
  operationId: uuid('operation_id').notNull().references(() => operations.id, { onDelete: 'cascade' }),
  /** `share` for a member's cut, `faction_cut` for the part taken off the top. */
  role:        varchar('role', { length: 12 }).notNull(),
  userId:      uuid('user_id').notNull().references(() => users.id),
  itemTypeId:  uuid('item_type_id').notNull().references(() => itemTypes.id, { onDelete: 'restrict' }),
  quantity:    decimal('quantity', { precision: 15, scale: 2 }).notNull(),
  entryId:     uuid('entry_id').references(() => entries.id, { onDelete: 'set null' }),
}, (table) => ({
  operationIndex: index('operation_movement_operation').on(table.operationId),
}));

/** Who a haul is credited to. `crew` divides it; `faction` keeps all of it. */
export const OPERATION_CREDIT = ['crew', 'faction'] as const;
export type OperationCredit = (typeof OPERATION_CREDIT)[number];

export const OPERATION_MOVEMENT_ROLES = ['share', 'faction_cut'] as const;
export type OperationMovementRole = (typeof OPERATION_MOVEMENT_ROLES)[number];

export const operationsRelations = relations(operations, ({ one, many }) => ({
  faction:      one(factions, { fields: [operations.factionId], references: [factions.id] }),
  logger:       one(users,    { fields: [operations.loggedBy],  references: [users.id] }),
  participants: many(operationParticipants),
  loot:         many(operationLoot),
  movements:    many(operationMovements),
}));

export type Operation = typeof operations.$inferSelect;
export type NewOperation = typeof operations.$inferInsert;
export type OperationParticipant = typeof operationParticipants.$inferSelect;
export type OperationLoot = typeof operationLoot.$inferSelect;

// ── shifts ─────────────────────────────────────────────
// Clock in, clock out. A timesheet for the factions that run a business in the
// city rather than a crew: a restaurant with a kitchen rota, a garage with
// mechanics on shift, a taxi firm, a hospital.
//
// Deliberately not connected to the ledger. A shift is time, not value, and
// tying it to money would force every faction using it to have an hourly rate
// and an item type for wages before they could record that somebody worked
// Tuesday evening. What a faction pays for the hours is a decision it can make
// with the hours in front of it.
export const shifts = pgTable('shifts', {
  id:        uuid('id').defaultRandom().primaryKey(),
  factionId: uuid('faction_id').notNull().references(() => factions.id, { onDelete: 'cascade' }),
  userId:    uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),

  /**
   * What they worked as, free text rather than a configured list.
   *
   * Every faction's roles are its own — cook, waiter, mechanic, driver, medic,
   * dispatcher — and asking a faction to define its job titles before anybody
   * can clock in is a setup screen standing in front of a button. The screen
   * suggests whatever this faction has typed before, which converges on a list
   * without anybody having to write one.
   */
  /**
   * Faction work, or something the character did on the side.
   *
   * Asked for as soon as the screen existed: people clock in for the faction,
   * and they also drive a taxi or do a delivery run that has nothing to do
   * with it, and both are hours worth keeping. Splitting them keeps a rota
   * honest — a faction reading its own hours should not be counting somebody's
   * night at a different job.
   */
  kind:      varchar('kind', { length: 10 }).notNull().default('faction'),

  position:  varchar('position', { length: 60 }),
  /** Where the shift was worked: the restaurant, the garage, a district. */
  location:  varchar('location', { length: 120 }),

  startedAt: timestamp('started_at', { withTimezone: true }).notNull(),
  /** Null while somebody is still on shift, which is what "on duty" means. */
  endedAt:   timestamp('ended_at', { withTimezone: true }),
  /** Unpaid time inside the shift, subtracted from the hours it counts for. */
  breakMinutes: integer('break_minutes').notNull().default(0),

  notes:     text('notes'),

  /**
   * Who last changed it, when that was not the person who worked it.
   *
   * A timesheet somebody else corrected is a different thing from one that was
   * clocked, and the person whose hours they are should be able to see which
   * they are looking at.
   */
  editedBy:  uuid('edited_by').references(() => users.id, { onDelete: 'set null' }),

  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => ({
  factionStart: index('shift_faction_started').on(table.factionId, table.startedAt),
  memberStart:  index('shift_member_started').on(table.userId, table.startedAt),
}));

export const shiftsRelations = relations(shifts, ({ one }) => ({
  faction: one(factions, { fields: [shifts.factionId], references: [factions.id] }),
  member:  one(users,    { fields: [shifts.userId],    references: [users.id] }),
}));

/** Whose work it was. Free text says *what*; this says *for whom*. */
export const SHIFT_KINDS = ['faction', 'side'] as const;
export type ShiftKind = (typeof SHIFT_KINDS)[number];

export type Shift = typeof shifts.$inferSelect;
export type NewShift = typeof shifts.$inferInsert;
