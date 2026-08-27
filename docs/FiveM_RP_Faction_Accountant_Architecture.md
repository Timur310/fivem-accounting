# FiveM RP Faction Accountant — Architecture Document & Master Prompt

> **Version:** 1.0 | **Date:** August 2026  
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
12. [Master Prompt for AI-Assisted Development](#12-master-prompt-for-ai-assisted-development)

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
                                   |-- 1---* Quota
                                   |-- 1---* AuditLog

User 1---* Entry (created_by)
User 1---* AuditLog (acted_by)
ItemType 1---* Entry
ItemType 1---* Quota
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

### Phase 1: MVP (Weeks 1-3)

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

### Phase 2: Enhanced Features (Weeks 4-6)

| # | Feature | Description | Priority |
|---|---------|-------------|----------|
| 1 | Quota system | Weekly/monthly quotas per item type. Progress bars. Alerts | Critical |
| 2 | Advanced dashboard | Charts (trends, per-member breakdown, item distribution). Top contributors | High |
| 3 | Entry filtering/search | Filter by date range, item type, member. Full-text search on descriptions | High |
| 4 | Admin entry editing | Edit amount, description, date. Full before/after audit trail | High |
| 5 | CSV export | Export entries and quota reports | Medium |
| 6 | Mobile responsive UI | Collapsible sidebar, touch-friendly forms | Medium |
| 7 | Notifications | Toast notifications. Optional Discord webhook notifications | Medium |

### Phase 3: Advanced Features (Weeks 7-9)

| # | Feature | Description | Priority |
|---|---------|-------------|----------|
| 1 | Superadmin analytics | System-wide dashboard: total factions, entries, engagement metrics | Medium |
| 2 | Bulk operations | Batch add members, bulk delete entries, CSV import | Medium |
| 3 | Faction customization | Branding, custom entry fields, notification preferences | Low |
| 4 | Advanced reporting | Periodic summaries, comparison reports, performance rankings | Low |
| 5 | Discord bot integration | Optional bot for member management and dashboard summaries from Discord | Low |
| 6 | Rate limiting | Per-user and per-IP via Redis sliding window | Low |
| 7 | i18n | Framework + English pack. Structure for community translations | Low |

---

## 12. Master Prompt for AI-Assisted Development

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

### DATABASE SCHEMA (Drizzle ORM — 7 tables)

- **users:** id (UUID PK), discord_id (VARCHAR 20 UNIQUE), username, avatar_url, role (superadmin/faction_admin/member), created_at, last_login
- **factions:** id (UUID PK), name (VARCHAR 100 UNIQUE), description, created_by (FK users), created_at, is_active
- **faction_members:** id (UUID PK), faction_id (FK factions), user_id (FK users), role (admin/member), joined_at. UNIQUE(faction_id, user_id)
- **item_types:** id (UUID PK), faction_id (FK factions), name, unit (default '$'), is_active, created_at
- **entries:** id (UUID PK), faction_id (FK factions), user_id (FK users), item_type_id (FK item_types), amount (Decimal 15,2), description, entry_date (Date), created_at, updated_at
- **quotas:** id (UUID PK), faction_id (FK factions), item_type_id (FK item_types), target_amount (Decimal 15,2), period_type (weekly/monthly), period_start (Date), is_active, created_at
- **audit_logs:** id (BIGSERIAL PK), user_id (FK users), faction_id (FK nullable), action (VARCHAR 50), entity_type (VARCHAR 50), entity_id (UUID nullable), details (JSONB), ip_address (INET), created_at

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

**Phase 1 (MVP, 3 weeks):** Docker Compose scaffolding, Discord OAuth, superadmin faction CRUD, member management, basic item types, entry logging, basic dashboard, audit logging

**Phase 2 (3 weeks):** Quota system, advanced dashboard with charts, entry filtering/search, admin entry editing, CSV export, mobile responsive UI, notifications

**Phase 3 (3 weeks):** Superadmin analytics, bulk operations, faction customization, advanced reporting, optional Discord bot integration, rate limiting, i18n

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