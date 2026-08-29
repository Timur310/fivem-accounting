# FiveM RP Faction Accountant — Architecture Document & Master Prompt

> **Version:** 2.0 | **Date:** August 2026  
> **Stack:** Node.js 22 LTS (TypeScript) + Express/Fastify + Next.js + PostgreSQL + Docker Compose  
> **Auth:** Discord OAuth 2.0 | **Deployment:** Self-Hosted VPS  
> **Purpose:** AI-readable architecture document and master prompt for autonomous development

---

## Table of Contents

1. [Executive Summary](#1-executive-summary)
2. [System Overview](#2-system-overview)
3. [Technology Stack](#3-technology-stack)
4. [System Architecture](#4-system-architecture)
5. [Data Model](#5-data-model)
6. [API Design](#6-api-design)
7. [Authentication & Authorization](#7-authentication--authorization)
8. [Feature Specifications](#8-feature-specifications)
9. [Frontend Architecture](#9-frontend-architecture)
10. [Deployment](#10-deployment)
11. [Development Roadmap](#11-development-roadmap)
12. [Phase 4-8 Detailed Specifications](#12-phase-4-8-detailed-specifications)
13. [Master Prompt for AI-Assisted Development](#13-master-prompt-for-ai-assisted-development)

---

## 1. Executive Summary

The FiveM RP Faction Accountant is a self-hosted web application for GTA V FiveM roleplay servers that tracks faction members' financial contributions to shared in-game resources. Multiple factions (legal and illegal, 5+ members each) need a centralized system to log daily deposits of dirty money, clean money, and items into shared safes/vaults.

**Core capabilities:**
- Superadmins create factions and appoint faction leaders
- Faction leaders manage their own member rosters via the web dashboard
- Members log daily contributions (configurable item types per faction)
- Quota system (weekly/monthly) with automatic progress tracking
- Only faction admins can edit or delete entries
- Complete audit trail of every action
- Docker Compose single-command deployment
- Discord OAuth 2.0 authentication (no separate login system)

---

## 2. System Overview

### 2.1 Problem Statement

FiveM RP factions pool money and items into communal safes. There is no in-game mechanism to track individual contributions. Faction leaders rely on spreadsheets, Discord messages, or memory — leading to zero accountability, impossible quota enforcement, no leadership handover data, and zero visibility for server admins.

### 2.2 Solution Overview

A web application with three access tiers:

| Role | Scope | Key Abilities |
|------|-------|---------------|
| **Superadmin** | System-wide | Create/delete factions, view all data, manage all members |
| **Faction Admin** | Own faction | Add/remove members, configure item types, set quotas, edit/delete entries |
| **Member** | Own faction (read + own entries) | View dashboard, log own contributions, view history |

Faction admins configure which item types can be logged (dirty money, clean money, lock picks, weapons, etc.). The quota system calculates progress automatically from logged entries.

### 2.3 Key Design Principles

1. **Simplicity over complexity** — convention over configuration, no over-engineering
2. **Docker-first** — deploy with `docker compose up -d`, no manual setup
3. **Discord-native auth** — every FiveM server uses Discord already, zero friction onboarding
4. **Strict access control** — faction data isolation is non-negotiable
5. **Comprehensive audit logging** — every action logged with timestamp, user, and details

---

## 3. Technology Stack

### 3.1 Backend: Node.js 22 LTS + TypeScript 5

- **Node.js 22 LTS + TypeScript 5** — strongly typed backend execution environment
- **Express / Fastify** — high-performance REST API routing with type safety
- **Drizzle ORM** — lightweight, type-safe SQL query builder with zero runtime overhead
- **drizzle-kit** — schema migrations, push, and introspection CLI
- **pg (node-postgres)** — underlying PostgreSQL driver for connection pooling
- **Zod** — strict request/response validation schemas
- **axios** — HTTP client for Discord OAuth token exchange
- **dotenv / envalid** — strict environment variable type checking
- **tsx** — rapid TypeScript execution in development

### 3.2 Frontend: Next.js

- **Next.js 15** — App Router, TypeScript, server-side rendering
- **Tailwind CSS** — utility-first styling
- **shadcn/ui** — accessible component primitives (Radix UI based)
- **TanStack Query (React Query)** — server state, caching, optimistic updates
- **Zustand** — lightweight client-side UI state (sidebar, toasts, selected faction)
- **Axios** — API client with interceptors

### 3.3 Database: PostgreSQL

- **PostgreSQL 16** — ACID compliance, complex aggregations, JSONB support
- **PgBouncer** — connection pooling (separate Docker container)
- **drizzle-kit** — auto-run on backend startup, fully reversible SQL migrations

### 3.4 Infrastructure: Docker Compose

5 services in a single `docker-compose.yml`:

| Service | Image | Ports | Purpose |
|---------|-------|-------|---------|
| `db` | postgres:16-alpine | 5432 (internal) | PostgreSQL database |
| `pgbouncer` | edoburu/pgbouncer | 6432 (internal) | Connection pooler |
| `backend` | Custom (Node.js/TS) | 8000 (internal) | Express/TypeScript API |
| `frontend` | Custom (Node) | 3000 (internal) | Next.js application |
| `caddy` | caddy:2-alpine | 80, 443 (host) | Reverse proxy + auto TLS |

- All services on a shared Docker bridge network
- Only Caddy exposes ports to the host
- Named volumes: `pgdata`, `caddy_data`, `caddy_config`
- Multi-stage Dockerfiles for minimal image sizes
- Health checks on all services, `restart: unless-stopped`
- Target: 2 CPU cores, 2GB RAM VPS

### 3.5 Authentication: Discord OAuth 2.0

- **Flow:** Authorization Code with PKCE
- **Scopes:** `identify`, `email`
- **Session:** Signed JWT in HTTP-only, Secure, SameSite=Strict cookie
- **Expiration:** Configurable (default 7 days)
- **No separate registration** — Discord account is the only identity
- **Discord User ID** as permanent unique identifier

---

## 4. System Architecture

### 4.1 High-Level Architecture

```
Browser (User)
    |
    | HTTPS
    v
Caddy (Reverse Proxy, TLS)
    |
    |-- /           --> Frontend (Next.js, port 3000)
    |-- /api/*      --> Backend (Express/Fastify, port 8000)
    |
Backend
    |-- Drizzle ORM --> pg (node-postgres) --> PgBouncer (port 6432) --> PostgreSQL (port 5432)
    |-- axios --> Discord API (OAuth token exchange)
    |-- jsonwebtoken --> Cookie (session management)
```

- **Stateless application layer** — no in-memory session state
- **JWT** contains user ID and role; Redis optional for rate limiting
- Horizontally scalable (multiple backend replicas behind load balancer)

### 4.2 Data Flow (Entry Logging Example)

1. Member opens faction dashboard → Next.js checks session cookie
2. No cookie → redirect to Discord OAuth → callback → JWT issued
3. Frontend fetches dashboard data via parallel API calls (React Query)
4. Member submits entry form → `POST /api/v1/factions/{id}/entries`
5. Backend validates (user is member, item type active, amount positive)
6. Backend inserts entry + writes audit log
7. Frontend updates cache optimistically → UI reflects new entry

---

## 5. Data Model

### 5.1 Entity Relationships

```
User 1---* FactionMember *---1 Faction
                                   |
                                   |-- 1---* ItemType
                                   |-- 1---* Entry
                                   |-- 1---* Payout
                                   |-- 1---* Quota
                                   |-- 1---* AuditLog
                                   |-- 1---* Announcement
                                   |-- 1---* MemberNote
                                   |-- 1---* Strike

User 1---* Entry (created_by)
User 1---* Payout (created_by / recipient)
User 1---* AuditLog (acted_by)
User 1---* Strike (issued_by / received_by)
ItemType 1---* Entry
ItemType 1---* Quota
FactionMember 1---* Strike
FactionMember 1---* MemberNote
```

### 5.2 Table Schemas

#### users

| Column | Type | Constraints | Description |
|--------|------|-------------|-------------|
| id | UUID | PK, DEFAULT gen_random_uuid() | Unique user identifier |
| discord_id | VARCHAR(20) | UNIQUE, NOT NULL | Discord user ID (permanent) |
| username | VARCHAR(32) | NOT NULL | Discord username |
| avatar_url | TEXT | NULLABLE | Discord avatar URL |
| role | VARCHAR(20) | NOT NULL, DEFAULT 'member' | superadmin / faction_admin / member |
| created_at | TIMESTAMPTZ | NOT NULL, DEFAULT NOW() | Account creation |
| last_login | TIMESTAMPTZ | NULLABLE | Last login timestamp |

#### factions

| Column | Type | Constraints | Description |
|--------|------|-------------|-------------|
| id | UUID | PK, DEFAULT gen_random_uuid() | Unique faction identifier |
| name | VARCHAR(100) | UNIQUE, NOT NULL | Faction display name |
| description | TEXT | NULLABLE | Optional description |
| created_by | UUID | FK -> users.id, NOT NULL | Superadmin who created it |
| created_at | TIMESTAMPTZ | NOT NULL, DEFAULT NOW() | Creation timestamp |
| is_active | BOOLEAN | NOT NULL, DEFAULT TRUE | Soft-delete flag |

#### faction_members

| Column | Type | Constraints | Description |
|--------|------|-------------|-------------|
| id | UUID | PK, DEFAULT gen_random_uuid() | Membership record ID |
| faction_id | UUID | FK -> factions.id, NOT NULL | Reference to faction |
| user_id | UUID | FK -> users.id, NOT NULL | Reference to user |
| role | VARCHAR(20) | NOT NULL, DEFAULT 'member' | admin / member within faction |
| joined_at | TIMESTAMPTZ | NOT NULL, DEFAULT NOW() | Join timestamp |
| | | **UNIQUE(faction_id, user_id)** | One membership per user per faction |

#### item_types

| Column | Type | Constraints | Description |
|--------|------|-------------|-------------|
| id | UUID | PK, DEFAULT gen_random_uuid() | Item type identifier |
| faction_id | UUID | FK -> factions.id, NOT NULL | Owning faction |
| name | VARCHAR(100) | NOT NULL | Display name (Dirty Money, Lock Pick, etc.) |
| unit | VARCHAR(20) | NOT NULL, DEFAULT '$' | Unit: $, kg, pcs, etc. |
| is_active | BOOLEAN | NOT NULL, DEFAULT TRUE | Whether members can log this type |
| created_at | TIMESTAMPTZ | NOT NULL, DEFAULT NOW() | Creation timestamp |

#### entries

| Column | Type | Constraints | Description |
|--------|------|-------------|-------------|
| id | UUID | PK, DEFAULT gen_random_uuid() | Entry identifier |
| faction_id | UUID | FK -> factions.id, NOT NULL | Faction this entry belongs to |
| user_id | UUID | FK -> users.id, NOT NULL | Member who logged this |
| item_type_id | UUID | FK -> item_types.id, NOT NULL | Type of contribution |
| amount | DECIMAL(15,2) | NOT NULL | Amount contributed (never FLOAT) |
| description | TEXT | NULLABLE | Optional note |
| entry_date | DATE | NOT NULL, DEFAULT TODAY | Date of in-game contribution |
| created_at | TIMESTAMPTZ | NOT NULL, DEFAULT NOW() | Record creation time |
| updated_at | TIMESTAMPTZ | NULLABLE | Last edit time (NULL = never edited) |

#### quotas

| Column | Type | Constraints | Description |
|--------|------|-------------|-------------|
| id | UUID | PK, DEFAULT gen_random_uuid() | Quota identifier |
| faction_id | UUID | FK -> factions.id, NOT NULL | Faction this applies to |
| item_type_id | UUID | FK -> item_types.id, NOT NULL | Targeted item type |
| target_amount | DECIMAL(15,2) | NOT NULL | Target total for the period |
| period_type | VARCHAR(10) | NOT NULL | 'weekly' or 'monthly' |
| period_start | DATE | NOT NULL | Start date of quota period |
| is_active | BOOLEAN | NOT NULL, DEFAULT TRUE | Currently active? |
| created_at | TIMESTAMPTZ | NOT NULL, DEFAULT NOW() | Creation timestamp |

#### audit_logs

| Column | Type | Constraints | Description |
|--------|------|-------------|-------------|
| id | BIGSERIAL | PK | Auto-incrementing log ID |
| user_id | UUID | FK -> users.id, NOT NULL | Who performed the action |
| faction_id | UUID | FK -> factions.id, NULLABLE | Affected faction |
| action | VARCHAR(50) | NOT NULL | create, update, delete, login, etc. |
| entity_type | VARCHAR(50) | NOT NULL | faction, member, entry, item_type, quota |
| entity_id | UUID | NULLABLE | ID of affected entity |
| details | JSONB | NULLABLE | Before/after diff or action context |
| ip_address | INET | NULLABLE | Requester IP |
| created_at | TIMESTAMPTZ | NOT NULL, DEFAULT NOW() | When action occurred |

#### payouts

| Column | Type | Constraints | Description |
|--------|------|-------------|-------------|
| id | UUID | PK, DEFAULT gen_random_uuid() | Payout identifier |
| faction_id | UUID | FK -> factions.id, NOT NULL | Faction this payout belongs to |
| recipient_user_id | UUID | FK -> users.id, NOT NULL | Member receiving the payout |
| created_by | UUID | FK -> users.id, NOT NULL | Admin who created the payout |
| item_type_id | UUID | FK -> item_types.id, NOT NULL | Type of resource being distributed |
| amount | DECIMAL(15,2) | NOT NULL | Amount distributed |
| description | TEXT | NULLABLE | Reason or note (e.g. "Weekly cut", "Job bonus") |
| payout_date | DATE | NOT NULL, DEFAULT TODAY | Date the payout was issued |
| status | VARCHAR(20) | NOT NULL, DEFAULT 'pending' | pending / approved / rejected / completed |
| approved_by | UUID | FK -> users.id, NULLABLE | Admin who approved (if multi-admin) |
| approved_at | TIMESTAMPTZ | NULLABLE | When it was approved |
| created_at | TIMESTAMPTZ | NOT NULL, DEFAULT NOW() | Record creation time |
| updated_at | TIMESTAMPTZ | NULLABLE | Last edit time |
| is_deleted | BOOLEAN | NOT NULL, DEFAULT FALSE | Soft-delete flag |

#### announcements

| Column | Type | Constraints | Description |
|--------|------|-------------|-------------|
| id | UUID | PK, DEFAULT gen_random_uuid() | Announcement identifier |
| faction_id | UUID | FK -> factions.id, NOT NULL | Faction this belongs to |
| author_id | UUID | FK -> users.id, NOT NULL | Admin who posted |
| title | VARCHAR(200) | NOT NULL | Announcement headline |
| body | TEXT | NOT NULL | Full announcement content (markdown) |
| priority | VARCHAR(20) | NOT NULL, DEFAULT 'normal' | low / normal / high / urgent |
| is_pinned | BOOLEAN | NOT NULL, DEFAULT FALSE | Show at top of feed |
| expires_at | TIMESTAMPTZ | NULLABLE | Auto-hide after this time |
| created_at | TIMESTAMPTZ | NOT NULL, DEFAULT NOW() | When posted |
| updated_at | TIMESTAMPTZ | NULLABLE | Last edit time |
| is_deleted | BOOLEAN | NOT NULL, DEFAULT FALSE | Soft-delete flag |

#### member_notes

| Column | Type | Constraints | Description |
|--------|------|-------------|-------------|
| id | UUID | PK, DEFAULT gen_random_uuid() | Note identifier |
| faction_id | UUID | FK -> factions.id, NOT NULL | Faction this note belongs to |
| target_user_id | UUID | FK -> users.id, NOT NULL | Member this note is about |
| author_id | UUID | FK -> users.id, NOT NULL | Admin who wrote the note |
| category | VARCHAR(50) | NOT NULL, DEFAULT 'general' | general / performance / discipline / positive / promotion |
| content | TEXT | NOT NULL | Note body |
| is_flagged | BOOLEAN | NOT NULL, DEFAULT FALSE | Flagged for follow-up |
| created_at | TIMESTAMPTZ | NOT NULL, DEFAULT NOW() | When written |

#### strikes

| Column | Type | Constraints | Description |
|--------|------|-------------|-------------|
| id | UUID | PK, DEFAULT gen_random_uuid() | Strike identifier |
| faction_id | UUID | FK -> factions.id, NOT NULL | Faction this strike belongs to |
| target_user_id | UUID | FK -> users.id, NOT NULL | Member receiving the strike |
| issued_by | UUID | FK -> users.id, NOT NULL | Admin who issued |
| reason | TEXT | NOT NULL | Why the strike was given |
| severity | VARCHAR(20) | NOT NULL | warning / minor / major |
| status | VARCHAR(20) | NOT NULL, DEFAULT 'active' | active / appealed / expired / revoked |
| expires_at | TIMESTAMPTZ | NULLABLE | When the strike auto-expires |
| created_at | TIMESTAMPTZ | NOT NULL, DEFAULT NOW() | When issued |

### 5.3 Drizzle Schema (src/db/schema.ts)

```typescript
import {
  pgTable,
  uuid,
  varchar,
  text,
  boolean,
  timestamp,
  bigSerial,
  decimal,
  date,
  jsonb,
  inet,
  uniqueIndex,
  index,
} from 'drizzle-orm/pg-core';
import { relations } from 'drizzle-orm';

// ── users ──────────────────────────────────────────────
export const users = pgTable('users', {
  id:         uuid('id').defaultRandom().primaryKey(),
  discordId:  varchar('discord_id', { length: 20 }).notNull().unique(),
  username:   varchar('username', { length: 32 }).notNull(),
  avatarUrl:  text('avatar_url'),
  role:       varchar('role', { length: 20 }).notNull().default('member'),
  createdAt:  timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  lastLogin:  timestamp('last_login', { withTimezone: true }),
});

export const usersRelations = relations(users, ({ many }) => ({
  factionMembers: many(factionMembers),
  entries:        many(entries),
  auditLogs:      many(auditLogs),
}));

// ── factions ───────────────────────────────────────────
export const factions = pgTable('factions', {
  id:          uuid('id').defaultRandom().primaryKey(),
  name:        varchar('name', { length: 100 }).notNull().unique(),
  description: text('description'),
  createdBy:   uuid('created_by').notNull().references(() => users.id),
  createdAt:   timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  isActive:    boolean('is_active').notNull().default(true),
});

export const factionsRelations = relations(factions, ({ one, many }) => ({
  creator:        one(users, { fields: [factions.createdBy], references: [users.id] }),
  factionMembers: many(factionMembers),
  itemTypes:      many(itemTypes),
  entries:        many(entries),
  quotas:         many(quotas),
  auditLogs:      many(auditLogs),
}));

// ── faction_members ────────────────────────────────────
export const factionMembers = pgTable('faction_members', {
  id:        uuid('id').defaultRandom().primaryKey(),
  factionId: uuid('faction_id').notNull().references(() => factions.id),
  userId:    uuid('user_id').notNull().references(() => users.id),
  role:      varchar('role', { length: 20 }).notNull().default('member'),
  joinedAt:  timestamp('joined_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => ({
  uniqueFactionUser: uniqueIndex('faction_member_unique').on(table.factionId, table.userId),
}));

export const factionMembersRelations = relations(factionMembers, ({ one }) => ({
  faction: one(factions, { fields: [factionMembers.factionId], references: [factions.id] }),
  user:    one(users,    { fields: [factionMembers.userId],    references: [users.id] }),
}));

// ── item_types ─────────────────────────────────────────
export const itemTypes = pgTable('item_types', {
  id:        uuid('id').defaultRandom().primaryKey(),
  factionId: uuid('faction_id').notNull().references(() => factions.id),
  name:      varchar('name', { length: 100 }).notNull(),
  unit:      varchar('unit', { length: 20 }).notNull().default('$'),
  isActive:  boolean('is_active').notNull().default(true),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const itemTypesRelations = relations(itemTypes, ({ one, many }) => ({
  faction: one(factions, { fields: [itemTypes.factionId], references: [factions.id] }),
  entries: many(entries),
  quotas:  many(quotas),
}));

// ── entries ────────────────────────────────────────────
export const entries = pgTable('entries', {
  id:         uuid('id').defaultRandom().primaryKey(),
  factionId:  uuid('faction_id').notNull().references(() => factions.id),
  userId:     uuid('user_id').notNull().references(() => users.id),
  itemTypeId: uuid('item_type_id').notNull().references(() => itemTypes.id),
  amount:     decimal('amount', { precision: 15, scale: 2 }).notNull(),
  description: text('description'),
  entryDate:  date('entry_date').notNull().defaultNow(),
  createdAt:  timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt:  timestamp('updated_at', { withTimezone: true }),
});

export const entriesRelations = relations(entries, ({ one }) => ({
  faction:  one(factions,  { fields: [entries.factionId],  references: [factions.id] }),
  user:     one(users,     { fields: [entries.userId],     references: [users.id] }),
  itemType: one(itemTypes, { fields: [entries.itemTypeId], references: [itemTypes.id] }),
}));

// ── quotas ─────────────────────────────────────────────
export const quotas = pgTable('quotas', {
  id:           uuid('id').defaultRandom().primaryKey(),
  factionId:    uuid('faction_id').notNull().references(() => factions.id),
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

// ── audit_logs ─────────────────────────────────────────
export const auditLogs = pgTable('audit_logs', {
  id:         bigSerial('id').primaryKey(),
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
```

### 5.4 Database Client Setup (src/db/index.ts)

```typescript
import { drizzle } from 'drizzle-orm/node-postgres';
import Pool from 'pg-pool';
import * as schema from './schema';

const pool = new Pool({
  connectionString: process.env.DATABASE_URL!,
  max: 10,
  idleTimeoutMillis: 30_000,
});

export const db = drizzle(pool, { schema });
export type Database = typeof db;
```

### 5.5 Migration Strategy

- **drizzle-kit** manages all migrations (SQL-based, fully reversible)
- Generate migrations from schema changes via `drizzle-kit generate`, then review the SQL
- Migrations run automatically on backend container startup via `drizzle-kit migrate`
- Migration failure = container exit with non-zero code
- Never start the app with an inconsistent schema
- Migration files are plain SQL stored in `backend/drizzle/` — easy to inspect and audit

### 5.6 Example Query Patterns

```typescript
import { db } from '../db';
import { entries, itemTypes, users, factionMembers } from '../db/schema';
import { eq, and, sql, sum, gte, lte, desc } from 'drizzle-orm';

// Get faction dashboard totals by item type
const dashboardTotals = await db
  .select({
    itemTypeId: entries.itemTypeId,
    itemTypeName: itemTypes.name,
    unit: itemTypes.unit,
    total: sum(entries.amount).mapWith(Number),
  })
  .from(entries)
  .innerJoin(itemTypes, eq(entries.itemTypeId, itemTypes.id))
  .where(eq(entries.factionId, factionId))
  .groupBy(entries.itemTypeId, itemTypes.name, itemTypes.unit);

// Get top contributors for a faction in a date range
const topContributors = await db
  .select({
    userId: users.id,
    username: users.username,
    totalContributed: sum(entries.amount).mapWith(Number),
  })
  .from(entries)
  .innerJoin(users, eq(entries.userId, users.id))
  .where(
    and(
      eq(entries.factionId, factionId),
      gte(entries.entryDate, startDate),
      lte(entries.entryDate, endDate),
    ),
  )
  .groupBy(users.id, users.username)
  .orderBy(sql�csum(entries.amount) DESC`)
  .limit(10);

// Insert a new entry with transaction
await db.transaction(async (tx) => {
  const [entry] = await tx
    .insert(entries)
    .values({
      factionId,
      userId,
      itemTypeId,
      amount,
      description,
      entryDate,
    })
    .returning();

  await tx.insert(auditLogs).values({
    userId,
    factionId,
    action: 'create',
    entityType: 'entry',
    entityId: entry.id,
    details: { amount, itemTypeId, entryDate },
    ipAddress: req.ip,
  });
});

// Paginated entry list with filters
const page = Number(req.query.page) || 1;
const pageSize = Number(req.query.page_size) || 50;

const [items, countResult] = await Promise.all([
  db
    .select()
    .from(entries)
    .innerJoin(users, eq(entries.userId, users.id))
    .innerJoin(itemTypes, eq(entries.itemTypeId, itemTypes.id))
    .where(
      and(
        eq(entries.factionId, factionId),
        itemTypeIdFilter ? eq(entries.itemTypeId, itemTypeIdFilter) : undefined,
      ),
    )
    .orderBy(desc(entries.createdAt))
    .limit(pageSize)
    .offset((page - 1) * pageSize),
  db
    .select({ count: sql�ccount(*)::int` })
    .from(entries)
    .where(eq(entries.factionId, factionId)),
]);
```

---

## 6. API Design

All endpoints under `/api/v1`. All require auth except OAuth callback.

### 6.1 Authentication

| Method | Endpoint | Access | Description |
|--------|----------|--------|-------------|
| GET | `/api/v1/auth/discord` | Public | Redirects to Discord OAuth consent screen |
| GET | `/api/v1/auth/callback` | Public | Handles OAuth callback, issues JWT cookie |
| POST | `/api/v1/auth/logout` | Authenticated | Clears JWT cookie |
| GET | `/api/v1/auth/me` | Authenticated | Returns current user profile + role + factions |

### 6.2 Faction Management (Superadmin)

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/api/v1/factions` | Create faction (name, description, initial admin Discord ID) |
| GET | `/api/v1/factions` | List all factions with summary stats (paginated, searchable) |
| GET | `/api/v1/factions/{id}` | Full faction details + members + item types + recent audit logs |
| PATCH | `/api/v1/factions/{id}` | Update name, description, or active status |
| DELETE | `/api/v1/factions/{id}` | Soft-delete (sets is_active=false, data preserved) |

### 6.3 Member Management (Faction Admin)

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/api/v1/factions/{id}/members` | Add member by Discord ID/username, default role=member |
| GET | `/api/v1/factions/{id}/members` | List members with roles, join dates, contribution counts |
| PATCH | `/api/v1/factions/{id}/members/{user_id}` | Update member role (promote/demote) |
| DELETE | `/api/v1/factions/{id}/members/{user_id}` | Remove member (entries preserved) |

### 6.4 Entries (Contributions)

| Method | Endpoint | Access | Description |
|--------|----------|--------|-------------|
| POST | `/api/v1/factions/{id}/entries` | Member | Log new contribution (item_type, amount, date, description) |
| GET | `/api/v1/factions/{id}/entries` | Member | List entries with filters (date range, item type, member, pagination) |
| PATCH | `/api/v1/factions/{id}/entries/{entry_id}` | Admin | Edit entry (amount, description, date). Original values in audit log |
| DELETE | `/api/v1/factions/{id}/entries/{entry_id}` | Admin | Soft-delete entry (is_deleted flag, preserved for history) |

### 6.5 Item Types (Faction Admin)

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/api/v1/factions/{id}/item-types` | Create trackable item type (name, unit) |
| GET | `/api/v1/factions/{id}/item-types` | List item types with active/inactive status |
| PATCH | `/api/v1/factions/{id}/item-types/{type_id}` | Update name, unit, or active status |
| DELETE | `/api/v1/factions/{id}/item-types/{type_id}` | Soft-delete (existing entries preserved) |

### 6.6 Quotas (Faction Admin)

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/api/v1/factions/{id}/quotas` | Create quota (item_type, target, period_type, period_start) |
| GET | `/api/v1/factions/{id}/quotas` | List quotas with current progress (actual vs target) |
| PATCH | `/api/v1/factions/{id}/quotas/{quota_id}` | Update target, period, or active status |
| DELETE | `/api/v1/factions/{id}/quotas/{quota_id}` | Delete quota (history preserved in audit log) |

### 6.7 Dashboard & Reports

| Method | Endpoint | Access | Description |
|--------|----------|--------|-------------|
| GET | `/api/v1/factions/{id}/dashboard` | Member | Aggregated data: totals by type, quota progress, top contributors, activity feed |
| GET | `/api/v1/factions/{id}/reports/summary` | Admin | Summary report for date range: totals, per-member breakdown, quota % |
| GET | `/api/v1/factions/{id}/audit-logs` | Admin | Paginated audit logs with filters (action, user, date) |

### 6.8 Response Format

**Success:**
```json
{
  "data": { ... },
  "meta": { "page": 1, "page_size": 20, "total_count": 150 }
}
```

**Error:**
```json
{
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "Amount must be a positive number"
  }
}
```

HTTP status codes: 400 (validation), 401 (unauthenticated), 403 (unauthorized), 404 (not found), 422 (unprocessable), 500 (server error).

---

## 7. Authentication & Authorization

### 7.1 Discord OAuth 2.0 Flow (with PKCE)

1. Unauthenticated user visits any page → frontend redirects to `GET /api/v1/auth/discord`
2. Backend generates `state` param (stored in short-lived Redis key), builds Discord auth URL
3. User authorizes on Discord → Discord redirects to `GET /api/v1/auth/callback?code=...&state=...`
4. Backend validates state (CSRF protection), exchanges code for access token via server-to-server POST
5. Backend fetches user profile from Discord `/api/users/@me`
6. If no local user exists → create with role=member
7. Backend signs JWT (user_id, role) via `jsonwebtoken` → sets as HTTP-only, Secure, SameSite=Strict cookie
8. Redirect to dashboard. Total flow: <2 seconds.

### 7.2 Role Definitions

**superadmin:**
- Create, edit, soft-delete any faction
- View all factions and all data system-wide
- Manage all faction memberships
- Access system-wide audit log
- **Cannot** log entries (only actual faction members can)
- First superadmin promoted via bootstrap script or direct DB update

**faction_admin:**
- Scoped to specific faction (can be admin in multiple factions)
- Add/remove members, promote/demote within own faction
- Configure item types (create, edit, enable/disable, delete)
- Set and modify quotas
- View, edit, delete any entry within own faction
- View own faction's audit log
- **Cannot** access other factions or system settings

**member:**
- View own faction's dashboard (aggregated data, quota progress, recent entries)
- View member list
- Log own entries (create only)
- View own faction's item types
- **Cannot** edit/delete anything, view other factions, or access admin features

### 7.3 Permission Matrix

| Action | Superadmin | Faction Admin | Member |
|--------|:----------:|:-------------:|:------:|
| Create / delete factions | Yes | No | No |
| View all factions | Yes (all) | Own only | Own only |
| Add / remove faction members | Yes (all) | Own faction | No |
| Configure item types | Yes (all) | Own faction | No |
| Set / modify quotas | Yes (all) | Own faction | No |
| Log new entries | No | Yes (own) | Yes (own) |
| Edit / delete entries | No | Own faction | No |
| View faction dashboard | Yes (all) | Own faction | Own faction |
| View audit logs | Yes (all) | Own faction | No |
| Promote first superadmin | Yes (bootstrap) | No | No |

---

## 8. Feature Specifications

### 8.1 Faction Management

- Only superadmins create factions via `POST /api/v1/factions`
- Input: name (required), description (optional), initial admin Discord ID (required)
- On creation: auto-creates `faction_members` record for the admin, seeds default item types (dirty money, clean money)
- Superadmin faction list: paginated with summary stats (member count, total entries, active quotas)
- Soft-delete: `is_active=false`, data preserved, recoverable
- All actions audit-logged with full context

### 8.2 Member Management

- Faction admins add members by Discord ID or username
- User must have authenticated at least once before being added
- Default role: `member`. Multiple admins per faction allowed.
- Promote/demote between admin and member roles
- Removing a member preserves their contribution entries
- All member management actions audit-logged

### 8.3 Entry (Contribution) Tracking

- Members log via form: item type (from enabled types), amount, optional description, date (default today)
- Backend validates: item type active for faction, amount positive, date not in future
- Only faction admins can edit or delete entries
- Edit: original values saved in audit log `details` JSON (before/after diff), `updated_at` set
- Delete: soft-delete (`is_deleted` flag), excluded from quotas by default, visible in history
- Entry listing: server-side pagination, filter by date range / item type / member
- Default view: most recent 50 entries

### 8.4 Quota System

- Defined by: item type, target amount, period type (weekly/monthly), start date
- Progress = SUM(entries.amount WHERE item_type_id=X AND entry_date WITHIN current period)
- Weekly: finds most recent period start (Monday-based) on or before today, 7-day window
- Monthly: calendar month containing today
- Future start dates: quota inactive until that date
- Inactive quotas: hidden from dashboard but data preserved

### 8.5 Custom Item Types

- Per-faction, fully customizable
- Fields: name (e.g. "Dirty Money", "AK-47"), unit ("$", "pcs", "kg"), is_active flag
- When inactive: hidden from entry form, existing entries preserved, still counts toward quotas
- Examples by faction type:
  - Legal government: salary contributions, uniform costs, vehicle maintenance
  - Illegal syndicate: dirty money, clean money, lock picks, weapons, drugs
  - Medical: medical supplies, patient fees, ambulance fuel

### 8.6 Audit Logging

- **Append-only** — entries never modified or deleted
- Logged actions: auth events, faction CRUD, member management, entry CRUD, item type/quota changes, superadmin actions
- Each entry: acting user_id, affected faction_id (nullable), action type, entity_type, entity_id, JSONB details (before/after), IP address, timestamp
- Purposes: dispute resolution, faction health monitoring, debugging, operational history

---

## 9. Frontend Architecture

### 9.1 Page Structure (Next.js App Router)

| Route | Page | Access |
|-------|------|--------|
| `/` | Login / redirect to dashboard | Public |
| `/auth/callback` | OAuth callback handler | Public |
| `/dashboard` | Default faction dashboard | Authenticated |
| `/factions` | Faction list (all/own) | Authenticated |
| `/factions/[id]` | Faction dashboard (entries, quotas, members) | Faction Member |
| `/factions/[id]/entries` | Full entry list with filters | Faction Member |
| `/factions/[id]/members` | Member management | Faction Admin |
| `/factions/[id]/settings` | Item types, quotas, faction settings | Faction Admin |
| `/factions/[id]/logs` | Audit log viewer | Faction Admin |
| `/admin` | Superadmin panel (all factions, system stats) | Superadmin |

### 9.2 Component Organization

- **Layout:** Sidebar (collapsible on mobile), Header (avatar, username, faction selector dropdown)
- **Data display:** DataTable, StatCard, ProgressBar, ActivityFeed
- **Forms:** EntryForm, ItemTypeForm, QuotaForm, MemberSearchInput
- **Modals:** ConfirmDialog, EntryDetailModal, MemberDetailModal
- **UI primitives:** shadcn/ui (Button, Input, Dialog, DropdownMenu, Table, etc.)
- Components are self-contained with TypeScript types, thin and composable

### 9.3 State Management

- **Server state** → TanStack Query (React Query)
  - Per-endpoint hooks: `useFactions`, `useFactionEntries`, `useFactionDashboard`, `useQuotas`, `useAuditLogs`
  - Cache stale times: 5 min (dashboard), 30 sec (entry lists)
  - Optimistic updates for mutations, auto-rollback on failure
  - Auto background refetch on window focus
- **Client UI state** → Zustand
  - Selected faction ID (persisted to localStorage)
  - Sidebar collapsed/expanded
  - Notification queue
- **API client** → Axios instance
  - Base URL, 401 interceptor (redirect to login), dev-mode logging

---

## 10. Deployment

### 10.1 Docker Compose Structure

```yaml
# docker-compose.yml (simplified)
services:
  db:
    image: postgres:16-alpine
    volumes: [pgdata:/var/lib/postgresql/data]
    environment:
      POSTGRES_DB: faction_accountant
      POSTGRES_PASSWORD: ${POSTGRES_PASSWORD}
    healthcheck: test: ["CMD-SHELL", "pg_isready -U postgres"]

  pgbouncer:
    image: edoburu/pgbouncer
    environment:
      DATABASE_URL: postgres://postgres:${POSTGRES_PASSWORD}@db:5432/faction_accountant
    depends_on: [db]

  backend:
    build: ./backend
    environment:
      DATABASE_URL: postgresql://postgres:${POSTGRES_PASSWORD}@pgbouncer:6432/faction_accountant
      DISCORD_CLIENT_ID: ${DISCORD_CLIENT_ID}
      DISCORD_CLIENT_SECRET: ${DISCORD_CLIENT_SECRET}
      DISCORD_REDIRECT_URI: ${DISCORD_REDIRECT_URI}
      JWT_SECRET: ${JWT_SECRET}
    depends_on: [pgbouncer]
    healthcheck: test: ["CMD", "curl", "-f", "http://localhost:8000/api/v1/health"]

  frontend:
    build: ./frontend
    environment:
      NEXT_PUBLIC_API_URL: http://backend:8000
    depends_on: [backend]

  caddy:
    image: caddy:2-alpine
    ports: ["80:80", "443:443"]
    volumes: [./Caddyfile:/etc/caddy/Caddyfile, caddy_data:/data, caddy_config:/config]
    depends_on: [frontend, backend]

volumes:
  pgdata:
  caddy_data:
  caddy_config:
```

### 10.2 Environment Variables

| Variable | Required | Default | Description |
|----------|:--------:|---------|-------------|
| `DISCORD_CLIENT_ID` | **Yes** | | Discord Application OAuth2 Client ID |
| `DISCORD_CLIENT_SECRET` | **Yes** | | Discord Application OAuth2 Client Secret |
| `DISCORD_REDIRECT_URI` | **Yes** | | OAuth callback URL |
| `JWT_SECRET` | **Yes** | | JWT signing key (`openssl rand -hex 32`) |
| `DATABASE_URL` | No | postgresql://postgres:password@db:5432/faction_accountant | PostgreSQL connection string |
| `POSTGRES_PASSWORD` | No | password | PostgreSQL superuser password |
| `CORS_ORIGINS` | No | http://localhost:3000 | Allowed frontend origins |
| `JWT_EXPIRATION_DAYS` | No | 7 | Session token expiration |
| `LOG_LEVEL` | No | info | Node.js log level (debug/info/warn/error) |
| `DOMAIN` | No | localhost | Domain for Caddy TLS |
| `NODE_ENV` | No | production | Node.js environment (production/development) |

### 10.3 Backend Dockerfile (Multi-stage)

```dockerfile
# backend/Dockerfile
FROM node:22-alpine AS base
RUN corepack enable

FROM base AS deps
WORKDIR /app
COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile

FROM base AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN pnpm build

FROM base AS runner
WORKDIR /app
ENV NODE_ENV=production
RUN addgroup --system --gid 1001 nodejs && adduser --system --uid 1001 nodejs
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/drizzle ./drizzle
COPY --from=builder /app/drizzle.config.ts ./drizzle.config.ts
COPY --from=builder /app/package.json ./package.json
USER nodejs
EXPOSE 8000
CMD ["node", "dist/index.js"]
```

### 10.4 Backend Startup Script

```typescript
// backend/src/index.ts
import 'dotenv/config';
import { db } from './db';
import app from './app';
import { sql } from 'drizzle-orm';
import { execSync } from 'child_process';

const PORT = Number(process.env.PORT) || 8000;

async function bootstrap() {
  // Run pending migrations on startup
  try {
    execSync('npx drizzle-kit migrate', { stdio: 'inherit' });
  } catch (err) {
    console.error('Migration failed:', err);
    process.exit(1);
  }

  // Verify database connection
  await db.execute(sql�cSELECT 1`);

  app.listen(PORT, () => {
    console.log(`Backend running on port ${PORT}`);
  });
}

bootstrap().catch((err) => {
  console.error('Failed to start:', err);
  process.exit(1);
});
```

### 10.5 drizzle.config.ts

```typescript
import { defineConfig } from 'drizzle-kit';

export default defineConfig({
  schema: './src/db/schema.ts',
  out: './drizzle',
  dialect: 'postgresql',
  dbCredentials: {
    url: process.env.DATABASE_URL!,
  },
});
```

### 10.6 VPS Deployment Steps

```bash
# 1. Provision VPS (2 cores, 2GB RAM, 20GB disk, Ubuntu 22.04+)

# 2. Install Docker
curl -fsSL https://get.docker.com | sh
sudo usermod -aG docker $USER

# 3. Clone and configure
git clone <repo-url> && cd faction-accountant
cp .env.example .env
# Edit .env with your Discord credentials, JWT secret, domain

# 4. DNS: point A record to VPS IP

# 5. Deploy
docker compose up -d
# Caddy auto-provisions TLS within minutes

# 6. Backups (cron job)
crontab -e
# Add: 0 3 * * * /path/to/scripts/backup.sh /path/to/backup/dir
```

---

## 11. Development Roadmap

### Phase 1: MVP (Weeks 1-3) — COMPLETE

| # | Feature | Description | Priority |
|---|---------|-------------|----------|
| 1 | Project scaffolding | Docker Compose, Express/Fastify structure, Next.js + Tailwind + shadcn/ui, Drizzle schema + drizzle-kit migrations, .env config | Critical |
| 2 | Discord OAuth auth | Full OAuth2 + PKCE flow, JWT sessions (jsonwebtoken), user creation/lookup, protected routes (backend + frontend) | Critical |
| 3 | Superadmin faction CRUD | Create, list, view, update, soft-delete factions. Bootstrap script for first superadmin | Critical |
| 4 | Member management | Add/remove by Discord ID, role assignment, member list | Critical |
| 5 | Basic item types | Default types (dirty/clean money) per faction. Admin custom types | Critical |
| 6 | Entry logging | Members log contributions. Entry list with pagination | Critical |
| 7 | Faction dashboard | Aggregated totals by type, recent entries, member count | High |
| 8 | Audit logging | Log all CRUD ops with user, timestamp, entity details. Admin view | High |

### Phase 2: Enhanced Features (Weeks 4-6) — COMPLETE

| # | Feature | Description | Priority |
|---|---------|-------------|----------|
| 1 | Quota system | Weekly/monthly quotas per item type. Progress bars. Alerts | Critical |
| 2 | Advanced dashboard | Charts (trends, per-member breakdown, item distribution). Top contributors | High |
| 3 | Entry filtering/search | Filter by date range, item type, member. Full-text search on descriptions | High |
| 4 | Admin entry editing | Edit amount, description, date. Full before/after audit trail | High |
| 5 | CSV export | Export entries and quota reports | Medium |
| 6 | Mobile responsive UI | Collapsible sidebar, touch-friendly forms | Medium |
| 7 | Notifications | Toast notifications. Optional Discord webhook notifications | Medium |

### Phase 3: Advanced Features (Weeks 7-9) — COMPLETE

| # | Feature | Description | Priority |
|---|---------|-------------|----------|
| 1 | Superadmin analytics | System-wide dashboard: total factions, entries, engagement metrics | Medium |
| 2 | Bulk operations | Batch add members, bulk delete entries, CSV import | Medium |
| 3 | Faction customization | Brand color (CSS variable injection), custom entry fields (JSONB per-entry values) | Medium |
| 4 | Advanced reporting | Periodic summaries, comparison reports, performance rankings | Low |
| 5 | Rate limiting | Per-user and per-IP sliding window | Low |

### Phase 4: Treasury & Payouts (Weeks 10-12) — BACKEND COMPLETE, FRONTEND PENDING

| # | Feature | Description | Priority |
|---|---------|-------------|----------|
| 1 | Payout system | Record money/items distributed TO members. Deducts from treasury balance | Critical |
| 2 | Treasury balance tracking | Running balance = total entries IN minus total payouts OUT, per item type | Critical |
| 3 | Payout approval workflow | Multi-admin factions can require approval before payout completes | High |
| 4 | Treasury dashboard | Dedicated view: balance by type, inflow vs outflow charts, net position | High |
| 5 | Payout history & filtering | Full CRUD, filterable list with audit trail | Medium |
| 6 | Quick-payout from dashboard | One-click "distribute even split" to all active members | Medium |

### Phase 5: Member Tools & Discipline (Weeks 13-15)

| # | Feature | Description | Priority |
|---|---------|-------------|----------|
| 1 | Custom faction ranks | Configurable rank hierarchy (Boss, Underboss, Capo, Soldier, Associate, etc.) | High |
| 2 | Member profile pages | Per-member detail view: contribution history, payout history, stats, notes | High |
| 3 | Admin notes on members | Private notes per member (performance, discipline, positive, promotion) | High |
| 4 | Strike/warning system | Issue strikes with severity levels, auto-expiry, appeal tracking | High |
| 5 | Inactivity detection | Flag members who haven't logged entries in X days. Dashboard alert | Medium |
| 6 | Member join/leave history | Track when members joined, left, were kicked, or were reinstated | Medium |

### Phase 6: Faction Communication (Weeks 16-18)

| # | Feature | Description | Priority |
|---|---------|-------------|----------|
| 1 | Announcements system | Admin posts announcements with priority levels (normal, high, urgent) | High |
| 2 | Pinned announcements | Pin important announcements to top of feed, auto-expire after set time | Medium |
| 3 | Announcement read tracking | Track which members have read each announcement | Medium |
| 4 | Markdown rendering | Announcements support full markdown with preview | Low |
| 5 | Activity feed | Combined feed of entries, payouts, announcements, strikes — faction timeline | Medium |

### Phase 7: Advanced Analytics & Gamification (Weeks 19-21)

| # | Feature | Description | Priority |
|---|---------|-------------|----------|
| 1 | Contribution heatmap | GitHub-style activity grid per member (daily contributions over time) | Medium |
| 2 | Member performance score | Composite score based on: quota hit rate, consistency, total contributed, activity streak | Medium |
| 3 | Streak tracking | Track consecutive days/weeks of logging. Display current and best streak | Medium |
| 4 | Leaderboards | Per-faction and cross-faction leaderboards (total, this week, this month) | Low |
| 5 | Growth metrics | Period-over-period comparisons: entries growth rate, new member rate, quota completion trends | Low |
| 6 | Faction comparison | Superadmin view: side-by-side faction comparison on key metrics | Low |

### Phase 8: Automation & Integrations (Weeks 22-24)

| # | Feature | Description | Priority |
|---|---------|-------------|----------|
| 1 | Discord bot integration | Bot commands: /balance, /log <amount> <type>, /top, /quotas, /announce | High |
| 2 | Automated Discord reports | Scheduled messages: daily summary, weekly report, quota deadline warnings | High |
| 3 | Webhook system | Outgoing webhooks on configurable events (entry logged, quota met, strike issued) | Medium |
| 4 | API tokens | Faction-level API tokens for server-side scripts (FiveM in-game resource tracking) | Medium |
| 5 | Data backup/restore | Full faction data export (JSON) and import. Superadmin can backup all data | Medium |
| 6 | Faction templates | Preset configurations for common faction types (cartel, police, EMS, mechanic, etc.) | Low |
| 7 | i18n framework | Translation infrastructure + community translation support | Low |

---

## 12. Phase 4-8 Detailed Specifications

### 12.1 Phase 4: Treasury & Payouts

#### Why This Matters

The current system only tracks money IN (contributions/deposits). In FiveM RP, factions are equally concerned with money OUT — paying members their cut, buying equipment, laundering fees, bribes, and operational costs. Without payout tracking, faction leaders have no idea what their actual treasury balance is. They cannot answer "how much money do we actually have in the stash?" without manually subtracting from a spreadsheet. This phase transforms the app from a "contribution tracker" into a full "treasury management system."

#### 12.1.1 Payout Data Model

```
payouts
  id              UUID PK
  faction_id       FK -> factions
  recipient_user_id FK -> users (who receives)
  created_by       FK -> users (admin who created)
  item_type_id    FK -> item_types (what resource)
  amount          DECIMAL(15,2)
  description     TEXT (reason: "Weekly cut", "Heist bonus", "Equipment restock")
  payout_date     DATE
  status          VARCHAR(20) -- pending / approved / rejected / completed
  approved_by     FK -> users (nullable, for multi-admin approval)
  approved_at     TIMESTAMPTZ
  is_deleted      BOOLEAN
  created_at      TIMESTAMPTZ
  updated_at      TIMESTAMPTZ
```

#### 12.1.2 Treasury Balance Calculation

The treasury balance is a **computed value**, not stored. This avoids drift and ensures accuracy:

```
Balance per item type = SUM(entries.amount WHERE is_deleted=false)
                       - SUM(payouts.amount WHERE is_deleted=false AND status='completed')
```

Dashboard endpoint returns balances alongside existing totals. The treasury card shows:
- Per-item-type balance with +/- indicators (green for positive, red for negative)
- Total net balance across all types
- Recent outflow trend (last 7/30 days of payouts)

#### 12.1.3 Payout API

| Method | Endpoint | Access | Description |
|--------|----------|--------|-------------|
| POST | `/api/v1/factions/{id}/payouts` | Admin | Create payout (recipient, item_type, amount, description, date) |
| GET | `/api/v1/factions/{id}/payouts` | Admin | List payouts with filters (date, recipient, item type, status, pagination) |
| PATCH | `/api/v1/factions/{id}/payouts/{pid}` | Admin | Update status (approve/reject/complete), edit amount/description |
| DELETE | `/api/v1/factions/{id}/payouts/{pid}` | Admin | Soft-delete |
| GET | `/api/v1/factions/{id}/treasury` | Member | Balance per item type, net total, inflow/outflow summary |

#### 12.1.4 Payout Workflow

1. Admin creates payout → status = `pending`
2. If faction has multiple admins AND approval required:
   - Other admins see pending payouts in a dedicated queue
   - Approve → status = `approved`, rejected → status = `rejected`
3. If no approval required (single admin or setting off): auto-complete
4. `completed` payouts are counted against treasury balance
5. `rejected` payouts do NOT affect balance

#### 12.1.5 Quick Payout Feature

"Distribute Even Split" button on treasury dashboard:
- Select an item type and total amount
- System calculates: `per_member = floor(total / active_member_count)`
- Creates individual payout records for each active member
- Single confirmation dialog, one audit log entry for the batch

#### 12.1.6 Frontend Views

- **Treasury tab** on dashboard (members see read-only, admins see full)
- Balance cards per item type with trend sparklines
- Payout management page (admin only, similar layout to entries view)
- Payout create dialog with member selector, item type, amount
- Pending approval queue (if approval workflow enabled)

#### 12.1.7 Settings

New faction setting (in `factions` table or `customFields` JSONB):
- `payoutApprovalRequired` (BOOLEAN, default false)
- When enabled, payouts created by one admin must be approved by another


#### 12.1.8 Backend Implementation Status — DELIVERED

The Phase 4 backend is implemented, type-checked and verified against a live
database. **No frontend exists yet** — everything below is ready for the UI to
be built on top of. This section is the API contract; where it differs from the
specification above, this section is authoritative.

##### What is available

| Method | Endpoint | Access | Purpose |
|--------|----------|--------|---------|
| POST | `/api/v1/factions/{id}/payouts` | Faction admin | Create a payout |
| GET | `/api/v1/factions/{id}/payouts` | Faction admin | List payouts (filtered, paginated) |
| POST | `/api/v1/factions/{id}/payouts/even-split` | Faction admin | Distribute an amount evenly to all members |
| PATCH | `/api/v1/factions/{id}/payouts/{payoutId}` | Faction admin | Edit fields or advance status |
| DELETE | `/api/v1/factions/{id}/payouts/{payoutId}` | Faction admin | Soft-delete |
| GET | `/api/v1/factions/{id}/treasury` | Any faction member | Balances, net position, pending total, outflow trend |

`GET /dashboard` additionally returns `treasuryBalances` and `netBalance`, so a
balance summary can be rendered without a second request.

##### Request bodies

```jsonc
// POST /payouts
{
  "recipientUserId": "uuid",     // must be a member of this faction
  "itemTypeId": "uuid",          // must belong to this faction
  "amount": "2000.00",           // string, positive; decimal(15,2)
  "description": "Weekly cut",   // optional, max 500
  "payoutDate": "2026-08-28"     // optional, defaults to today, cannot be future
}

// POST /payouts/even-split
{
  "itemTypeId": "uuid",
  "totalAmount": "1000.00",
  "description": "Heist bonus", // optional; defaults to "Even split distribution"
  "payoutDate": "2026-08-28"    // optional
}

// PATCH /payouts/{payoutId} — any subset
{
  "amount": "500.00",
  "description": "Corrected note",
  "payoutDate": "2026-08-27",
  "status": "approved"
}
```

`GET /payouts` query parameters: `item_type_id`, `recipient_user_id`, `status`,
`date_from`, `date_to`, `page`, `page_size`. List rows are already joined with
the recipient and item type, so no extra lookups are needed:
`recipientUsername`, `recipientAvatarUrl`, `itemTypeName`, `itemUnit`.

##### Response shapes

```jsonc
// GET /treasury
{
  "balances": [
    { "itemTypeId": "uuid", "itemTypeName": "Dirty Money", "unit": "$",
      "inflow": 10000, "outflow": 4500, "balance": 5500,
      // per-card sparkline data, same window as trendDays
      "outflowTrend": [{ "date": "2026-08-28", "total": 2000 }] }
  ],
  "netBalance": 5500,
  "totalInflow": 10000,
  "totalOutflow": 4500,
  "pending": { "count": 1, "total": 500 },   // awaiting approval, not yet deducted
  "outflowTrend": [{ "date": "2026-08-28", "total": 2000 }],  // all item types combined
  "trendDays": 30,                            // ?trend_days=1..90, default 30
  "recentPayouts": [ /* last 10 completed, with recipient and item type */ ]
}

// POST /payouts/even-split
{
  "created": 2, "perMember": 500, "distributedTotal": 1000,
  "remainder": 0.01, "status": "completed", "payoutIds": ["uuid", "uuid"]
}
```

Every item type of the faction appears in `balances`, including ones with no
activity (zeroes), so the UI can render a stable set of cards.

##### Rules the UI must respect

1. **Status lifecycle.** `pending → approved | rejected | completed`,
   `approved → completed | rejected`. `completed` and `rejected` are terminal —
   the API rejects any transition out of them, so do not offer a "reopen"
   action.
2. **Only `completed` payouts affect the balance.** `pending` and `approved`
   amounts are surfaced separately in `treasury.pending` so they can be shown as
   "committed but not yet paid".
3. **Four-eyes approval.** When `payoutApprovalRequired` is on, the admin who
   created a payout cannot approve it (HTTP 403). Hide or disable the approve
   button on rows where `createdBy` equals the current user.
4. **Locked records.** `amount`, `description` and `payoutDate` cannot be edited
   once a payout is `completed` or `rejected` (HTTP 400).
5. **Creation status depends on the faction setting *and* the admin count.**
   With `payoutApprovalRequired` off, a new payout is created directly as
   `completed`. With it on, it is created as `pending` only when the faction has
   at least two admins; with a single admin there would be nobody allowed to
   approve it (see rule 3), so it auto-completes instead. Always read the
   resulting status from the response — do not assume `pending`.
6. **Even split rounds down to whole cents.** The undistributed `remainder`
   stays in the treasury and is returned in the response; show it so the user
   understands why the numbers do not add up exactly.
7. **Balances may be negative.** Paying out more than was contributed is a valid
   state, not an error. Render negatives rather than clamping at zero.
8. **`amount` is a string** on the wire (`decimal(15,2)`), while computed
   treasury figures are numbers. Do not parse amounts as floats before display.

`payoutApprovalRequired` is a real column on `factions` (not inside
`customFields`) and is settable via `PATCH /api/v1/factions/{id}` alongside
`brandColor` and `customFields`.

##### Related fix outside Phase 4

The faction router applied `requireSuperadmin` at router level while being
mounted at `/api/v1/factions`. Because `app.use` matches by prefix, that guard
also ran for every nested faction-scoped route, so `entries`, `dashboard`,
`item-types`, `quotas`, `charts`, `export`, `reports` and `bulk` returned
`403 FORBIDDEN` for anyone who was not a superadmin. The guard is now applied
per route. Frontend code written around the old behaviour (for example paths
that only ever worked while logged in as superadmin) should be re-tested.

##### Not included

Phase 4 frontend work — treasury tab, balance cards, payout management page,
create dialog and the pending-approval queue — is still open.

---

### 12.2 Phase 5: Member Tools & Discipline

#### Why This Matters

In FiveM RP, faction leaders manage real people with real responsibilities. They need to know who's pulling their weight, who needs help, and who's breaking rules. The current system treats all members identically — just "admin" or "member". Real factions have complex hierarchies (Boss → Underboss → Capo → Soldier → Associate), and leaders need tools to document member performance, issue formal warnings, and track discipline history over time. Without this, leadership handovers lose all institutional knowledge about members.

#### 12.2.1 Custom Faction Ranks

Store a JSONB array on the `factions` table:

```json
[
  { "name": "Boss", "level": 1, "permissions": ["all"] },
  { "name": "Underboss", "level": 2, "permissions": ["entries", "payouts", "members"] },
  { "name": "Capo", "level": 3, "permissions": ["entries"] },
  { "name": "Soldier", "level": 4, "permissions": [] },
  { "name": "Associate", "level": 5, "permissions": [] }
]
```

The `faction_members.role` field remains `admin` or `member` for access control, but gains a `rank` field (VARCHAR, nullable) that stores the custom rank name. This keeps the permission system simple while allowing display-only rank names.

#### 12.2.2 Member Profile Page

New view: `/factions/{id}/members/{userId}`

Displays:
- Avatar, username, Discord ID, rank, join date
- Contribution stats: total contributed, entries count, average per entry, most active item type
- Payout stats: total received, payout count
- Current quota completion (all active quotas)
- Activity heatmap (Phase 7, shows empty state until built)
- Streak info (current streak, best streak)
- Admin notes list (admin-only visibility)
- Strike history (admin-only, member sees own strikes)
- Recent entries (last 20)
- Recent payouts received (last 20)

#### 12.2.3 Admin Notes

```
member_notes
  id              UUID PK
  faction_id       FK -> factions
  target_user_id  FK -> users (member being noted)
  author_id       FK -> users (admin writing)
  category        VARCHAR(50) -- general / performance / discipline / positive / promotion
  content         TEXT
  is_flagged      BOOLEAN (for follow-up)
  created_at      TIMESTAMPTZ
```

Categories help organize notes:
- **general**: General observations
- **performance**: "Consistently hits quota, great team player"
- **discipline": "Late to 3 meetings, warned verbally"
- **positive": "Led a successful heist, good leadership"
- **promotion**: "Ready for Capo promotion, recommended by Underboss"

API:

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/api/v1/factions/{id}/members/{userId}/notes` | Create note |
| GET | `/api/v1/factions/{id}/members/{userId}/notes` | List notes for member |
| PATCH | `/api/v1/factions/{id}/members/{userId}/notes/{noteId}` | Edit content or toggle flag |
| DELETE | `/api/v1/factions/{id}/members/{userId}/notes/{noteId}` | Delete note |

#### 12.2.4 Strike/Warning System

```
strikes
  id              UUID PK
  faction_id       FK -> factions
  target_user_id  FK -> users (member receiving)
  issued_by       FK -> users (admin issuing)
  reason          TEXT
  severity        VARCHAR(20) -- warning / minor / major
  status          VARCHAR(20) -- active / appealed / expired / revoked
  expires_at      TIMESTAMPTZ (nullable, auto-expire)
  created_at      TIMESTAMPTZ
```

Severity levels:
- **warning**: Verbal/formal warning, no consequences, but documented
- **minor**: First formal strike, visible on profile, counts toward discipline threshold
- **major**: Serious infraction, may trigger automatic demotion or kick consideration

Auto-expiry: configurable per faction (default: warnings 30 days, minor 90 days, major never)

API:

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/api/v1/factions/{id}/members/{userId}/strikes` | Issue strike |
| GET | `/api/v1/factions/{id}/members/{userId}/strikes` | List strikes for member |
| PATCH | `/api/v1/factions/{id}/members/{userId}/strikes/{sid}` | Update (revoke, mark appealed) |
| GET | `/api/v1/factions/{id}/strikes` | List all active strikes across members (admin overview) |

#### 12.2.5 Inactivity Detection

Dashboard query enhancement: compute per-member "days since last entry".

```sql
SELECT 
  u.id, u.username,
  MAX(e.entry_date) as last_activity,
  CURRENT_DATE - MAX(e.entry_date) as days_inactive
FROM faction_members fm
JOIN users u ON u.id = fm.user_id
LEFT JOIN entries e ON e.user_id = fm.user_id AND e.is_deleted = false
WHERE fm.faction_id = ?
GROUP BY u.id, u.username
ORDER BY days_inactive DESC NULLS LAST
```

Frontend: show an "Inactive Members" alert card on the admin dashboard when any member hasn't logged in X days (configurable, default 7). Members with strikes or recent joins excluded from inactivity alerts.

#### 12.2.6 Member Join/Leave History

Reuse the existing `audit_logs` table — no new table needed. Member joins, leaves, kicks, role changes, and reinstatements are already logged with `entity_type='faction_member'`. Build a dedicated UI that queries this:

```
GET /api/v1/factions/{id}/members/{userId}/history
→ Returns audit_logs WHERE entity_type='faction_member' AND (details->>'user_id' = userId)
```

---

### 12.3 Phase 6: Faction Communication

#### Why This Matters

Factions need to communicate outside of the in-game chat and Discord. Announcements like "quota deadline is Friday", "new member joining today", "faction meeting Saturday 8pm", or "rules update: all entries must include location" need a persistent, searchable home. Currently this information lives in Discord messages that get buried. A built-in announcement system gives every faction a lightweight bulletin board that's always accessible alongside their financial data.

#### 12.3.1 Announcements

```
announcements
  id              UUID PK
  faction_id       FK -> factions
  author_id       FK -> users
  title           VARCHAR(200)
  body            TEXT (markdown supported)
  priority        VARCHAR(20) -- low / normal / high / urgent
  is_pinned       BOOLEAN
  expires_at      TIMESTAMPTZ (nullable)
  created_at      TIMESTAMPTZ
  updated_at      TIMESTAMPTZ
  is_deleted      BOOLEAN
```

Priority visual treatment:
- **low**: default style, no badge
- **normal**: default style
- **high**: yellow/amber left border or badge
- **urgent**: red left border, pulsing dot, "URGENT" badge

API:

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/api/v1/factions/{id}/announcements` | Create (admin only) |
| GET | `/api/v1/factions/{id}/announcements` | List (all members), ordered by pinned first, then date |
| PATCH | `/api/v1/factions/{id}/announcements/{aid}` | Edit (author only) |
| DELETE | `/api/v1/factions/{id}/announcements/{aid}` | Soft-delete (admin or author) |

#### 12.3.2 Read Tracking

```
announcement_reads
  announcement_id  FK -> announcements
  user_id           FK -> users
  read_at          TIMESTAMPTZ
  PRIMARY KEY (announcement_id, user_id)
```

- `GET /announcements` response includes `read_count` and `is_read_by_me`
- Admins see per-member read status: `GET /announcements/{id}/reads` returns list of who has/hasn't read
- Mark as read: `POST /announcements/{id}/read` (member clicks into announcement)

#### 12.3.3 Activity Feed

A unified timeline view combining all faction events:

```
GET /api/v1/factions/{id}/feed?page=1&page_size=30
```

Returns a chronological mix of:
- Entries ("Username logged $5,000 Dirty Money")
- Payouts ("Admin distributed $2,000 to Username")
- Announcements ("Admin posted: Quota deadline Friday")
- Member joins ("Username joined the faction")
- Strikes ("Username received a minor strike")
- Rank changes ("Username promoted to Capo")

Each feed item has a `type` discriminator and a consistent shape:

```json
{
  "id": "uuid",
  "type": "entry" | "payout" | "announcement" | "member_join" | "strike" | "rank_change",
  "actor_username": "string",
  "actor_avatar_url": "string | null",
  "summary": "Human-readable one-liner",
  "details": { ... },
  "created_at": "ISO timestamp"
}
```

Implementation: `UNION ALL` query across entries, payouts, announcements, and relevant audit_logs, with consistent column aliasing, then `ORDER BY created_at DESC` with pagination.

#### 12.3.4 Frontend

- **Announcements nav item** in sidebar (visible to all members)
- Announcement list with pinned section at top
- Create/edit dialog for admins (title, body with markdown preview, priority, pin, expiry)
- Individual announcement view with full markdown rendering
- Activity feed as an optional dashboard widget or dedicated view

---

### 12.4 Phase 7: Advanced Analytics & Gamification

#### Why This Matters

Factions in FiveM are fundamentally competitive environments. Members want to know where they stand, leaders want to identify top performers and inactive members at a glance, and healthy competition drives engagement. Gamification features (streaks, leaderboards, scores) turn the mundane task of "log your daily contribution" into something members actually engage with. The analytics features give admins the data-driven insights they need to make leadership decisions.

#### 12.4.1 Contribution Heatmap

GitHub-style activity grid rendered on the frontend using recharts or a custom SVG grid.

Backend endpoint:

```
GET /api/v1/factions/{id}/members/{userId}/heatmap?year=2026
```

Returns:

```json
{
  "data": [
    { "date": "2026-01-15", "count": 2, "total": 15000 },
    { "date": "2026-01-16", "count": 1, "total": 5000 },
    ...
  ],
  "max_count": 5
}
```

SQL (gap-filled for all days in the year):

```sql
WITH all_days AS (
  SELECT generate_series(
    (date_trunc('year', CURRENT_DATE) || '-01-01')::date,
    (date_trunc('year', CURRENT_DATE) || '-12-31')::date,
    '1 day'::interval
  )::date AS day
),
daily_counts AS (
  SELECT e.entry_date AS day, COUNT(*) AS count, SUM(e.amount) AS total
  FROM entries e
  WHERE e.user_id = ? AND e.faction_id = ? AND e.is_deleted = false
    AND e.entry_date >= (date_trunc('year', CURRENT_DATE) || '-01-01')::date
  GROUP BY e.entry_date
)
SELECT d.day, COALESCE(dc.count, 0) AS count, COALESCE(dc.total, 0) AS total
FROM all_days d
LEFT JOIN daily_counts dc ON dc.day = d.day
ORDER BY d.day
```

#### 12.4.2 Member Performance Score

Composite score (0-100) calculated on the backend and cached:

```
score = (
  quota_hit_rate   * 30    // % of quota periods where member contributed
  + consistency      * 25    // days with entries / days in period
  + total_volume     * 20    // rank-scaled based on total contribution
  + streak_bonus     * 15    // current streak / best streak
  + seniority_bonus  * 10    // months since joining, capped
)
```

Each sub-score is normalized to 0-1 before weighting. Score is computed on-demand (not stored) and cached with short staleTime (5 min) in TanStack Query.

#### 12.4.3 Streak Tracking

A "streak" is consecutive days (or weeks) where a member logged at least one entry.

Backend logic:

```sql
-- Get all entry dates for a member, ordered
SELECT DISTINCT entry_date FROM entries
WHERE user_id = ? AND faction_id = ? AND is_deleted = false
ORDER BY entry_date DESC

-- Count consecutive days from today backwards
```

Frontend displays:
- Current streak with flame icon
- Best streak (all-time)
- "Keep it going!" encouragement when streak > 3

#### 12.4.4 Leaderboards

New endpoint:

```
GET /api/v1/factions/{id}/leaderboard?period=week|month|all&item_type_id=...
```

Returns ranked members with their totals:

```json
{
  "period": { "from": "2026-01-01", "to": "2026-01-31", "label": "This Month" },
  "rankings": [
    { "rank": 1, "user_id": "...", "username": "...", "avatar_url": "...", "total": 50000, "entry_count": 12, "item_breakdown": { "Dirty Money": 30000, "Clean Money": 20000 } },
    ...
  ]
}
```

Superadmin cross-faction leaderboard:

```
GET /api/v1/leaderboard?period=month&limit=50
→ Top 50 members across ALL factions, with faction name shown
```

#### 12.4.5 Growth Metrics

Enhancement to existing reports endpoint:

```
GET /api/v1/factions/{id}/reports/growth?periods=6
```

Returns period-over-period metrics:

```json
{
  "periods": [
    {
      "label": "Jan 2026",
      "total_entries": 150,
      "total_amount": 500000,
      "active_members": 12,
      "avg_per_member": 41666
    },
    ...
  ],
  "growth": {
    "entries_change_pct": 15.2,
    "amount_change_pct": 8.7,
    "member_change": 2,
    "avg_change_pct": -3.1
  }
}
```

---

### 12.5 Phase 8: Automation & Integrations

#### Why This Matters

The current system requires members to open a web browser, navigate to the site, and fill out a form for every single contribution. In FiveM, this is friction — they're in the middle of roleplay. A Discord bot lets members log contributions with a single slash command without leaving Discord. Server-side integrations (via API tokens) allow FiveM server scripts to automatically log transactions when players deposit money into faction safes in-game. Automated reports keep everyone informed without anyone having to check the dashboard.

#### 12.5.1 Discord Bot Integration

Architecture: a separate Node.js process (or threaded within the backend) that connects to Discord Gateway via discord.js.

Environment variables:

```
DISCORD_BOT_TOKEN=...
DISCORD_BOT_ENABLED=true
```

Bot commands (guild-scoped, only responds in configured channels):

| Command | Access | Description | Example |
|---------|--------|-------------|---------|
| `/log <amount> <item_type> [description]` | Member | Log a contribution | `/log 5000 dirty money Heist from jewelry store` |
| `/balance` | Member | Show faction treasury balances | `/balance` → "Dirty Money: $125,000 | Clean Money: $80,000" |
| `/my` | Member | Show personal stats (total, this week, streak) | `/my` |
| `/top [period]` | Member | Show top contributors | `/top week` |
| `/quotas` | Member | Show quota progress | `/quotas` |
| `/announce <title> | <body>` | Admin | Post announcement | `/announce Meeting Tonight | 8pm at HQ` |
| `/payout <@user> <amount> <type> [reason]` | Admin | Create payout | `/payout @john 5000 dirty money Weekly cut` |
| `/strike <@user> <severity> <reason>` | Admin | Issue strike | `/strike @john minor Missing 3 quota deadlines` |
| `/note <@user> <category> <text>` | Admin | Add member note | `/note @john positive Led the heist flawlessly` |

Bot permissions: reads member roles from the database (not Discord roles) to determine access. Only responds in channels that are configured per-faction in settings.

#### 12.5.2 Automated Discord Reports

Cron-like scheduler (node-cron) in the backend sends periodic embed messages to configured Discord channels:

| Report | Schedule | Content |
|--------|----------|--------|
| Daily Summary | Daily at 11pm server time | Total entries today, top contributor, quota status |
| Weekly Report | Sunday 11pm | Weekly totals, quota completion %, most improved member |
| Quota Warning | Daily at 9am (if quota < 50% and period ends within 2 days) | Urgent: quota X is at Y%, deadline in Z days |
| New Member | Real-time (on member add) | "Welcome @Username to the faction!" |
| Strike Alert | Real-time (on strike issued) | "@Username received a [severity] strike: reason" |

Configuration per faction (stored in `factions` JSONB or dedicated `faction_settings` table):

```json
{
  "discord": {
    "channel_id": "123456789",
    "daily_summary": true,
    "weekly_report": true,
    "quota_warnings": true,
    "member_events": true,
    "strike_alerts": true
  }
}
```

#### 12.5.3 Webhook System

Outgoing webhooks on configurable events:

```json
{
  "url": "https://your-server.com/webhook",
  "events": ["entry.created", "payout.completed", "quota.met", "strike.issued"],
  "secret": "hmac_secret_string"
}
```

Stored in a `webhooks` table:

```
webhooks
  id              UUID PK
  faction_id       FK -> factions
  url             TEXT
  secret          VARCHAR(255)
  events          TEXT[] (array of event type strings)
  is_active       BOOLEAN
  created_at      TIMESTAMPTZ
```

On each event, the backend POSTs a signed payload to matching webhook URLs. Signature: HMAC-SHA256 of the payload body using the webhook's secret, sent as `X-Webhook-Signature` header.

#### 12.5.4 API Tokens

For FiveM server-side scripts to log transactions automatically (e.g., when a player uses an in-game menu to deposit money into the faction safe).

```
api_tokens
  id              UUID PK
  faction_id       FK -> factions
  name             VARCHAR(100) -- e.g. "FiveM Server Script"
  token_hash      VARCHAR(64) -- SHA-256 of the actual token
  permissions      TEXT[] -- ["entries:create", "entries:read"]
  last_used_at    TIMESTAMPTZ
  is_active       BOOLEAN
  created_at      TIMESTAMPTZ
  expires_at      TIMESTAMPTZ (nullable)
```

Usage: `Authorization: Bearer <token>` header. The backend validates the token, resolves the faction, and applies the token's permission scope (which may be narrower than the creating user's role).

#### 12.5.5 Data Backup/Restore

**Export:**

```
GET /api/v1/factions/{id}/export/full (admin)
→ Returns JSON with all faction data: settings, members, item types, entries, payouts,
  quotas, announcements, notes, strikes, audit logs
→ Also available as downloadable JSON file
```

**Import:**

```
POST /api/v1/factions/{id}/import/full (admin)
→ Accepts JSON file, validates structure
→ Upserts entries, payouts, notes, strikes (by original ID if exists, skip if conflict)
→ Requires confirmation for destructive operations
→ Full audit trail of import
```

**Superadmin full backup:**

```
POST /api/v1/admin/backup
→ Dumps all factions, users, and related data as a JSON archive
GET /api/v1/admin/backups
→ Lists available backups (stored in a `backups` table or filesystem)
POST /api/v1/admin/restore/{backup_id}
→ Restores from a backup (with validation and confirmation)
```

#### 12.5.6 Faction Templates

Predefined configuration presets that auto-configure item types, quotas, and ranks when creating a faction:

```json
{
  "cartel": {
    "item_types": [
      { "name": "Dirty Money", "unit": "$" },
      { "name": "Clean Money", "unit": "$" },
      { "name": "Weapons", "unit": "pcs" },
      { "name": "Drugs", "unit": "kg" },
      { "name": "Lock Picks", "unit": "pcs" }
    ],
    "ranks": ["Boss", "Underboss", "Capo", "Soldier", "Associate"]
  },
  "police": {
    "item_types": [
      { "name": "Confiscated Cash", "unit": "$" },
      { "name": "Evidence", "unit": "pcs" },
      { "name": "Tickets Issued", "unit": "$" }
    ],
    "ranks": ["Chief", "Captain", "Lieutenant", "Sergeant", "Officer", "Cadet"]
  },
  "ems": {
    "item_types": [
      { "name": "Medical Supplies", "unit": "$" },
      { "name": "Patient Fees", "unit": "$" },
      { "name": "Revives", "unit": "pcs" }
    ],
    "ranks": ["Director", "Doctor", "Paramedic", "Intern"]
  },
  "mechanic": {
    "item_types": [
      { "name": "Repair Revenue", "unit": "$" },
      { "name": "Parts Used", "unit": "$" },
      { "name": "Scrap Sold", "unit": "$" }
    ],
    "ranks": ["Owner", "Senior Mechanic", "Mechanic", "Apprentice"]
  }
}
```

Template selection is shown during faction creation (superadmin view).

---

## 13. Master Prompt for AI-Assisted Development

> **Copy everything between the `===` markers below and paste it into a new AI chat session to begin development.**

================================================================

You are building a self-hosted web application called "Faction Accountant" for a FiveM GTA V roleplay server. This is an accounting/financial tracking tool where server factions (legal and illegal organizations with 5+ members) log their daily contributions (dirty money, clean money, items like lock picks, weapons, etc.) into shared faction safes or vaults. The system tracks who contributed what, enforces quotas, and maintains complete audit trails.

### TECH STACK (use exactly these)

- **Backend:** Node.js 22 LTS + TypeScript 5 + Express (or Fastify) + Drizzle ORM + pg (node-postgres) + Zod + jsonwebtoken + axios
- **Frontend:** Next.js 15 (App Router) + TypeScript + Tailwind CSS + shadcn/ui + TanStack Query + Zustand
- **Database:** PostgreSQL 16
- **Infrastructure:** Docker Compose with 5 services (db, pgbouncer, backend, frontend, caddy)
- **Auth:** Discord OAuth 2.0 Authorization Code Flow with PKCE
- **Sessions:** JWT in HTTP-only cookies (signed with `jsonwebtoken`)

### ROLES AND ACCESS CONTROL

- **superadmin:** Can create/delete/manage all factions, view all data, promote first superadmin via bootstrap script. Cannot log entries.
- **faction_admin:** Scoped to their faction. Can add/remove members, configure item types, set quotas, edit/delete any entry in their faction.
- **member:** Can view faction dashboard, log own entries, view entry history. Cannot edit/delete anything.

### DATABASE SCHEMA (Drizzle ORM — 7 + 4 new tables)

- **users:** id (UUID PK), discord_id (VARCHAR 20 UNIQUE), username, avatar_url, role (superadmin/faction_admin/member), created_at, last_login
- **factions:** id (UUID PK), name (VARCHAR 100 UNIQUE), description, brand_color (VARCHAR 7), custom_fields (JSONB), created_by (FK users), created_at, is_active
- **faction_members:** id (UUID PK), faction_id (FK factions), user_id (FK users), role (admin/member), rank (VARCHAR, nullable), joined_at. UNIQUE(faction_id, user_id)
- **item_types:** id (UUID PK), faction_id (FK factions), name, unit (default '$'), is_active, created_at
- **entries:** id (UUID PK), faction_id (FK factions), user_id (FK users), item_type_id (FK item_types), amount (Decimal 15,2), description, custom_values (JSONB), entry_date (Date), created_at, updated_at, is_deleted
- **quotas:** id (UUID PK), faction_id (FK factions), item_type_id (FK item_types), target_amount (Decimal 15,2), period_type (weekly/monthly), period_start (Date), is_active, created_at
- **audit_logs:** id (BIGSERIAL PK), user_id (FK users), faction_id (FK nullable), action (VARCHAR 50), entity_type (VARCHAR 50), entity_id (UUID nullable), details (JSONB), ip_address (INET), created_at
- **payouts:** id (UUID PK), faction_id (FK factions), recipient_user_id (FK users), created_by (FK users), item_type_id (FK item_types), amount (Decimal 15,2), description, payout_date, status (pending/approved/rejected/completed), approved_by (FK users nullable), approved_at, is_deleted, created_at, updated_at
- **announcements:** id (UUID PK), faction_id (FK factions), author_id (FK users), title (VARCHAR 200), body (TEXT, markdown), priority (low/normal/high/urgent), is_pinned, expires_at, created_at, updated_at, is_deleted
- **member_notes:** id (UUID PK), faction_id (FK factions), target_user_id (FK users), author_id (FK users), category (general/performance/discipline/positive/promotion), content (TEXT), is_flagged, created_at
- **strikes:** id (UUID PK), faction_id (FK factions), target_user_id (FK users), issued_by (FK users), reason (TEXT), severity (warning/minor/major), status (active/appealed/expired/revoked), expires_at, created_at

### API STRUCTURE

All under `/api/v1`. All require auth except OAuth callback.

- **Auth:** GET /auth/discord (redirect), GET /auth/callback (handle), POST /auth/logout, GET /auth/me
- **Factions (superadmin):** POST/GET /factions, GET/PATCH/DELETE /factions/{id}
- **Members (faction admin):** POST/GET /factions/{id}/members, PATCH/DELETE /factions/{id}/members/{user_id}
- **Entries:** POST/GET /factions/{id}/entries (member: own only for POST, all for GET in own faction), PATCH/DELETE /factions/{id}/entries/{entry_id} (admin only)
- **Item Types (admin):** POST/GET/PATCH/DELETE /factions/{id}/item-types
- **Quotas (admin):** POST/GET/PATCH/DELETE /factions/{id}/quotas
- **Dashboard:** GET /factions/{id}/dashboard, GET /factions/{id}/reports/summary (admin), GET /factions/{id}/audit-logs (admin)

### KEY BUSINESS RULES

1. Faction data is strictly isolated — members of one faction can NEVER see another faction's data
2. Only faction admins can edit/delete entries; members can only create their own
3. Item types are per-faction and fully customizable (name, unit, active/inactive)
4. Quotas are weekly or monthly, calculated by summing entries of the item type within the current period
5. Audit logs are append-only, never modified or deleted
6. All monetary amounts are Decimal(15,2), never floating point
7. Soft-delete for factions (is_active) and entries (is_deleted flag)
8. Superadmins cannot log entries — only actual faction members can

### DEPLOYMENT

- Single `docker-compose.yml` with 5 services: db (postgres:16-alpine), pgbouncer, backend (custom Node.js/TypeScript), frontend (custom Next.js), caddy (reverse proxy + auto TLS)
- `.env` file for all configuration
- Caddy auto-provisions Let's Encrypt certificates
- drizzle-kit runs migrations on backend container startup (`drizzle-kit migrate`)
- Target VPS: 2 cores, 2GB RAM, 20GB disk
- Health checks on all services

### DEVELOPMENT PHASES

**Phase 1 (MVP, 3 weeks):** COMPLETE — Docker Compose scaffolding, Discord OAuth, superadmin faction CRUD, member management, basic item types, entry logging, basic dashboard, audit logging

**Phase 2 (3 weeks):** COMPLETE — Quota system, advanced dashboard with charts, entry filtering/search, admin entry editing, CSV export, mobile responsive UI

**Phase 3 (3 weeks):** COMPLETE — Superadmin analytics, bulk operations, faction customization (brand color + custom fields), advanced reporting, rate limiting

**Phase 4 (3 weeks):** Treasury & Payouts — payout CRUD, treasury balance tracking (computed, not stored), payout approval workflow, treasury dashboard with inflow/outflow charts, quick-payout even split

**Phase 5 (3 weeks):** Member Tools & Discipline — custom faction ranks, member profile pages with full history, admin notes on members (categorized), strike/warning system with severity levels and auto-expiry, inactivity detection alerts, member join/leave history from audit logs

**Phase 6 (3 weeks):** Faction Communication — announcements with priority levels and pinning, announcement read tracking, markdown rendering, unified activity feed (entries + payouts + announcements + strikes + member events)

**Phase 7 (3 weeks):** Advanced Analytics & Gamification — GitHub-style contribution heatmap, composite member performance score (0-100), streak tracking (current + best), per-faction and cross-faction leaderboards, period-over-period growth metrics

**Phase 8 (3 weeks):** Automation & Integrations — Discord bot with slash commands (/log, /balance, /my, /top, /quotas, /announce, /payout, /strike, /note), automated Discord reports (daily/weekly/quota warnings), outgoing webhook system with HMAC signatures, API tokens for FiveM in-game scripts, full data backup/restore, faction templates (cartel, police, EMS, mechanic presets), i18n framework

### START WITH

1. Set up the Docker Compose stack with all 5 services
2. Create the Drizzle schema file (`src/db/schema.ts`) with all 7 tables
3. Implement Discord OAuth on the backend (full PKCE flow with `jsonwebtoken` + `axios`)
4. Build the superadmin faction management API endpoints (Express/Fastify routes)
5. Create the Next.js frontend with authentication flow and faction management pages
6. Implement member management and entry logging
7. Build the faction dashboard with aggregated stats
8. Add comprehensive audit logging

Build clean, well-organized, production-ready TypeScript code. Use Drizzle ORM for all database operations (no raw SQL unless absolutely necessary). Use proper error handling, Zod input validation, and security practices throughout. When in doubt, prefer simplicity.

================================================================

---

*End of Architecture Document*