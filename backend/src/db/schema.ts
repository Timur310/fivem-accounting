import {
  pgTable,
  uuid,
  varchar,
  text,
  boolean,
  timestamp,
  bigserial,
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
  avatarUrl: text('avatar_url'),
  role:      varchar('role', { length: 20 }).notNull().default('member'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  lastLogin: timestamp('last_login', { withTimezone: true }),
});

export const usersRelations = relations(users, ({ many }) => ({
  factionMembers: many(factionMembers),
  entries:        many(entries),
  payouts:        many(payouts),
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
  // When true, a payout created by one admin must be approved by a different
  // admin before it can be completed.
  payoutApprovalRequired: boolean('payout_approval_required').notNull().default(false),
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
  auditLogs:      many(auditLogs),
}));

export type Faction = typeof factions.$inferSelect;
export type NewFaction = typeof factions.$inferInsert;

// ── faction_members ────────────────────────────────────
export const factionMembers = pgTable('faction_members', {
  id:        uuid('id').defaultRandom().primaryKey(),
  factionId: uuid('faction_id').notNull().references(() => factions.id, { onDelete: 'cascade' }),
  userId:    uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  role:      varchar('role', { length: 20 }).notNull().default('member'),
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

// ── quotas ─────────────────────────────────────────────
export const quotas = pgTable('quotas', {
  id:           uuid('id').defaultRandom().primaryKey(),
  factionId:    uuid('faction_id').notNull().references(() => factions.id, { onDelete: 'cascade' }),
  itemTypeId:   uuid('item_type_id').notNull().references(() => itemTypes.id),
  targetAmount: decimal('target_amount', { precision: 15, scale: 2 }).notNull(),
  periodType:   varchar('period_type', { length: 10 }).notNull(),
  periodStart:  date('period_start').notNull(),
  isActive:     boolean('is_active').notNull().default(true),
  createdAt:    timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const quotasRelations = relations(quotas, ({ one }) => ({
  faction:  one(factions,  { fields: [quotas.factionId],  references: [factions.id] }),
  itemType: one(itemTypes, { fields: [quotas.itemTypeId], references: [itemTypes.id] }),
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
