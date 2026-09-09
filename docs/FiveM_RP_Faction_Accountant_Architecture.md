# FiveM RP Faction Accountant — Architecture Document & Master Prompt

> **Version:** 2.1 | **Date:** September 2026  
> **Stack:** Node.js 22 LTS (TypeScript) + Express/Fastify + Next.js + PostgreSQL + Docker Compose  
> **Auth:** Discord OAuth 2.0 | **Deployment:** Self-Hosted VPS  
> **Purpose:** AI-readable architecture document and master prompt for autonomous development

> **Status:** Sections 5 to 10 describe the system as built, and are kept in step
> with the code. Sections 11 to 13 are the original plan and master prompt, left
> as written — they record what was intended, not what exists. Where the two
> disagree, the code and sections 5 to 10 are correct.

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
- Only the reverse proxy (nginx) exposes ports to the host
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
nginx (Reverse Proxy, TLS)
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
                                   |-- 1---* Expense
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

### 5.2 Tables As Built

Twelve tables. Every id is a `uuid` with `defaultRandom()` unless noted.

**`users`** — one row per Discord account, and per person registered before they
ever signed in.

| Column | Notes |
|---|---|
| `discord_id` | unique; the key the OAuth callback lands on |
| `username` | Discord's name, refreshed on each login |
| `in_game_name` | character name; null until set. Editable by the player, and by `manage_members` inside a faction |
| `avatar_url`, `role`, `created_at`, `last_login` | `role` is `superadmin` / `faction_admin` / `member` |
| `is_system` | the anonymous placeholder that owns anonymous entries. Not a person; excluded from rosters and rankings |
| `is_provisional` | registered by Discord ID, never signed in. Cleared by the first login, so their history carries over |

**`factions`** — `name` (unique), `description`, `brand_color`, `custom_fields`
(jsonb), `ranks` (jsonb), `inactivity_threshold_days`, `strike_expiry_days`
(jsonb, per severity), `strike_escalation` (jsonb, per severity),
`expense_budgets` (jsonb, per expense category — a monthly spending cap, null
disables the category's budget), `created_by`, `created_at`, `is_active`.

`ranks` is where faction-level authorisation lives: each entry is
`{ name, level, permissions[] }`, and `permissions` holds names from
`FACTION_PERMISSIONS` (§7.2).

**`faction_members`** — `faction_id`, `user_id` (unique together), `role`
(`admin` / `member`), `rank` (matches a name in the faction's `ranks`),
`joined_at`.

**`item_types`** — `faction_id`, `name`, `unit`, `is_currency`, `image_url`,
`is_active`. `unit` is derived from `is_currency` rather than typed: `$` for
money, `pcs` for goods.

**`entries`** — contributions in. `faction_id`, `user_id`, `item_type_id`,
`amount` (decimal, kept as a string end to end), `description`, `entry_date`,
`custom_values` (jsonb), `is_deleted`.

**`payouts`** — value out. `faction_id`, `recipient_user_id`, `created_by`,
`item_type_id`, `amount`, `description`, `payout_date`, `status`
(`pending` / `approved` / `rejected` / `completed`), `approved_by`,
`approved_at`, `is_deleted`.

**`expenses`** — faction running costs (warehouse rent, utilities, supplies):
value that left the vault without any member receiving it. `faction_id`,
`created_by`, `item_type_id`, `category` (`warehouse` / `utilities` /
`supplies` / `other`), `amount`, `description`, `expense_date`, `is_deleted`.
No lifecycle — the cost is gone the moment the row exists. Governed by
`manage_expenses` (migration `0008`).

**`treasury_checks`** — a vault count: an admin counted the real stash and
recorded what they found (`item_type_id`, `counted_amount`, `check_date`,
`note`). The recorded balance for that day is derived on read, so the check
carries a `variance` instead of a stored verdict (migration `0010`).

**`strikes`** — `faction_id`, `target_user_id`, `issued_by`, `reason`,
`severity` (`warning` / `minor` / `major`), `status`
(`active` / `appealed` / `revoked` / `expired`), `expires_at`. The status on the
row and the *effective* status differ: an `active` strike past `expires_at`
reads as expired without anything having written to it.

**`member_notes`** — admin-only notes on a member. Never shown to their subject.

**`quotas`** — `faction_id`, `item_type_id`, `target_amount`, `period_type`
(`weekly` / `monthly`), `period_start`, `scope` (`faction` / `everyone` /
`member`), `target_user_id` (set only for `member`; null means the quota is
not pinned to one person), `is_active`.

**`audit_logs`** — `user_id`, `faction_id`, `action`, `entity_type`,
`entity_id`, `details` (jsonb, before/after), `ip_address`, `created_at`.

**Removed:** `factions.payout_approval_required` (migration `0007`). It decided
where a payout started rather than who could settle it, and once the four-eyes
rule went it no longer bought a second pair of eyes. `manage_payouts` decides
now — see §8.3.

### 5.3 Balances Are Derived, Never Stored

There is no balance column anywhere. `computeTreasuryBalances()` derives it:

```
balance = SUM(entries WHERE NOT deleted)
        - SUM(payouts WHERE NOT deleted AND status = 'completed')
        - SUM(expenses WHERE NOT deleted)
```

Only completed payouts count: pending and approved ones have not left the vault,
and rejected ones never will. Expenses have no lifecycle — rent is gone the
moment the row exists. The helper takes `onlyWithActivity`, which drops
item types nothing has ever passed through — the treasury and dashboard pass it
so they do not show rows of zeroes; laundering does not, because you wash *into*
a currency the vault has never held. An expense alone counts as activity.

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

All routes are under `/api/v1`. Faction-scoped routes sit behind
`requireFactionMember`, which resolves the caller's `factionRole` and the
permission set their rank grants (§7.2); individual routes then add
`requirePermission(...)`.

### 6.1 Authentication

| Method | Path | Who |
|---|---|---|
| GET | `/auth/discord` | anyone — starts OAuth |
| GET | `/auth/callback` | Discord |
| GET | `/auth/me` | signed in |
| PATCH | `/auth/me` | signed in — sets own `inGameName` (2–50 chars) |
| POST | `/auth/logout` | signed in |

### 6.2 Superadmin

| Method | Path | Notes |
|---|---|---|
| GET/POST/PATCH/DELETE | `/factions` | create, list, edit, deactivate |
| GET | `/admin/analytics` | cross-faction totals |
| GET | `/admin/users` | every real user; provisional first, then by last login. Excludes the system placeholder |
| GET/POST/PATCH/DELETE | `/admin/provisional-users` | register someone by Discord ID; rename and remove while nobody has signed into the row |
| GET | `/leaderboard` | cross-faction ranking |

### 6.3 Faction-Scoped

Prefix: `/factions/:id`.

| Path | Notes |
|---|---|
| `/members` | roster. PATCH sets `role`, `rank` and `inGameName` — see §8.5 |
| `/members/search` | find a user to add; returns `inGameName` too |
| `/members/:userId/notes` | admin-only notes |
| `/members/:userId/strikes` | issue and settle a member's strikes; reading your own record returns its full history |
| `/strikes` | faction-wide. No `status` means "still counts against the member"; `status=all` is the whole history |
| `/entries` | contributions. POST accepts `userId` (credit another member) and `anonymous` |
| `/payouts` | see §8.3 |
| `/treasury` | derived balances, pending totals, outflow trend |
| `/expenses` | faction running costs. Read for any member, `manage_expenses` writes |
| `/laundering` | convert one currency into another |
| `/item-types`, `/quotas`, `/settings` | faction configuration |
| `/config` | CSV export/import of item types, quotas and ranks — see §8.8 |
| `/dashboard`, `/charts`, `/reports`, `/leaderboard`, `/audit-logs`, `/export`, `/bulk` | reading and reporting |

### 6.4 Response Format

Unchanged from the original design: `{ data, meta? }` on success,
`{ error: { code, message } }` on failure, with `meta` carrying
`page` / `page_size` / `total_count` on paginated lists.

---

## 7. Authentication & Authorization

### 7.1 Discord OAuth 2.0

Unchanged: Discord is the only identity provider, the callback issues a JWT in
an httpOnly cookie, and the first account to sign in is promoted to superadmin.
A login whose Discord ID matches a provisional row lands on that row and clears
the flag, so anything already booked against it carries over.

### 7.2 Two Layers of Authority

**Global role** (`users.role`): `superadmin`, `faction_admin`, `member`.

A superadmin holds every faction permission in every faction, membership or
not — `requireFactionMember` grants the full set on the global role alone. This
is deliberate and is what the interface reflects: a superadmin sees every menu
and every action, including in a faction they joined as a plain member on a rank
that grants nothing.

**Faction permissions** (`factions.ranks[].permissions`): what a rank lets an
ordinary member do. A faction admin holds all of them implicitly.

```
manage_members       manage_payouts      manage_entries
manage_strikes       manage_quotas       manage_item_types
manage_settings      manage_customization
view_audit_logs      view_reports        manage_laundering
manage_expenses
```

The admin seat itself is not delegable: `manage_members` runs the roster, but
changing someone's `role` stays with the faction admin and the superadmin.

### 7.3 Permission Matrix

"Rank" means a member whose rank grants the named permission.

| Action | Superadmin | Faction Admin | Rank | Member |
|---|:--:|:--:|:--:|:--:|
| Create / delete factions | Yes | No | — | No |
| Add / remove members, set ranks | Yes | Yes | `manage_members` | No |
| Change a member's `role` | Yes | Yes | No | No |
| Edit a member's in-game name | Yes | Yes | `manage_members` | own only |
| Log an entry for yourself | Yes¹ | Yes | Yes | Yes |
| Log for another member, or anonymously | Yes | Yes | `manage_entries` | No |
| Edit / delete entries | Yes | Yes | `manage_entries` | No |
| Request a withdrawal for yourself | Yes | Yes | Yes | Yes |
| Create one for someone else | Yes | Yes | `manage_payouts` | No |
| Approve / complete / reject / edit / delete a withdrawal | Yes | Yes | `manage_payouts` | No |
| See the faction's whole withdrawal list | Yes | Yes | `manage_payouts` | own only |
| Issue and settle strikes | Yes | Yes | `manage_strikes` | No |
| Launder currency | Yes | Yes | `manage_laundering` | No |
| Record / edit / delete running expenses | Yes | Yes | `manage_expenses` | No |
| Item types / quotas / settings | Yes | Yes | matching permission | No |
| View audit logs | Yes | Yes | `view_audit_logs` | No |
| View reports | Yes | Yes | `view_reports` | No |
| Read the treasury and dashboard | Yes | Yes | Yes | Yes |

¹ A superadmin who is not on the roster cannot credit an entry to themselves —
there is nobody for it to belong to. They name a member or mark it anonymous.

---

## 8. Feature Specifications

### 8.1 Factions, Members and Ranks

A superadmin creates a faction and appoints its first admin. Ranks are defined
per faction as `{ name, level, permissions[] }`; the level orders the roster and
the permissions decide what the rank may do (§7.2).

People can be registered by Discord ID before they ever sign in. Such a row is a
full user from the start — it joins factions, holds entries, payouts and
strikes — and the first login lands on it, so nothing has to be migrated. Until
then nobody is behind it: it carries no inactivity, and its names stay editable
from the superadmin roster.

### 8.2 Entries

A member logs their own contributions. `manage_entries` additionally allows
crediting another member, or the faction itself via `anonymous`, which books the
value to a system placeholder so the treasury counts it while every ranking
leaves it out.

A superadmin may book an entry into any faction, but never onto themselves when
they are not on that roster — a self-credited entry would put a contributor in
the ledger that the leaderboard and member totals have no row for. They name a
member, or mark it anonymous.

Entries are soft-deleted. Amounts are decimals carried as strings end to end.

**Five-minute undo:** a member may delete their **own** entry for five minutes
after logging it (`created_at` decides — no scheduler), which keeps a typo'd
amount from waiting on an admin. Past the window, or on someone else's row,
`manage_entries` is the only key. The delete is still soft, still audited, and
the audit row notes when it was a self-undo.

### 8.3 Withdrawals

`manage_payouts` governs reach, not access:

- **Anyone** may request a withdrawal with their own name on it, and read the
  requests they made.
- **`manage_payouts`** may name someone else, see the faction's whole queue, and
  approve, complete, reject, edit or delete anything in it.

Where a withdrawal starts is decided by the same permission, and nothing else: a
holder's withdrawal is settled on creation; a request from anyone else starts
`pending` and waits for someone who can grant it. Auto-completing a member's own
request would let anyone pay themselves out of the treasury and call it done.

There is no second-person requirement. Whoever holds the permission may settle a
withdrawal they raised themselves — including a member who asked for one and was
given the permission afterwards. Deleting works at any status; editing does not,
because a completed or rejected withdrawal is part of the ledger.

**Even split** distributes an amount across the roster, rounding down per member
and leaving the remainder in the vault. An optional `memberUserIds` list (every
id must be a faction member) narrows the split to a picked crew instead —
the per-member share and the remainder are computed over that subset.

### 8.4 Treasury and Laundering

The treasury reports what the vault has done: derived balances per item type,
completed outflow trend, and pending withdrawals counted separately. Running
expenses — warehouse rent, utilities — deduct from the
balances and ride the same outflow trend as completed payouts, so a balance
that dropped because of rent does not read as an unexplained gap. The treasury
view lists recent expenses with per-category totals; writing them needs
`manage_expenses`, reading them is open to every member.

Per-category monthly budgets (`expense_budgets`, settable in faction settings)
turn the totals into budget bars: amber from 80% of the cap, red at 100%.

**Vault verification.** Disputes about the vault are the argument this app
exists to settle, so an admin can record a physical count
(`POST /treasury/checks`, `manage_payouts`): item type, counted amount, date,
note. The recorded balance for that day is derived from the same source as the
live balance, and each check answers with a `variance` — counted minus
recorded. Counts are admin-readable (`GET /treasury/checks`); nothing is
reconciled automatically, the number is the point. Only item
types with at least one live entry or completed payout are listed — on both the
treasury page and the dashboard card. The list can be filtered by name and
ordered by name or current amount, in either direction; name ordering collates
in the reading language.

Cross-type totals cover currency only. Money, kilograms and piece counts do not
add up to a number with a unit, so goods are reported per type.

Laundering converts one faction currency into another. The rate is not
configured: whoever runs the wash enters what went in and what came back,
because the cut depends on who did it. Both sides book against the anonymous
placeholder, so no member is charged or credited.

### 8.5 Discipline and Member Files

Strikes carry a severity and an expiry per severity, set per faction. The stored
status and the *effective* status differ: an active strike past its expiry reads
as expired without a write. The faction-wide list defaults to what still counts
against a member; `status=all` returns the history. A member's own record always
returns in full, which is why their profile shows revoked and expired strikes
that the faction list hides by default.

Member notes are admin-only and never shown to their subject.

In-game names: a player sets their own, and `manage_members` may correct anyone
on the roster. The name lives on the user, not the membership, so an edit reaches
every faction that player belongs to — the dialog says so, and the audit log
records before and after.

Escalation is a per-faction setting alongside strike expiry:
`strike_escalation` holds, per severity, an active-strike count at which the
roster flags a member for kick consideration (`null` disables a severity). The
roster carries per-severity active counts for admins (`activeStrikesBySeverity`)
alongside the total, and renders the flag from those two — nothing is written
and nobody is kicked automatically; the decision stays with the leadership.

### 8.6 Quotas, Reports and Audit

Quotas target an item type over a weekly or monthly period. The `scope` decides
what the target measures:

- **`faction`** — everyone's contributions sum into one shared target.
- **`everyone`** — the same target applies to each member individually:
  progress is read from the viewer's own ledger, so every member sees their
  personal bar against the shared number.
- **`member`** — one named member's personal target (`target_user_id`).

Every quota response also carries `previousPeriod` — the outcome of the period
before the current one, with its dates, amounts and a `met` flag — because
progress resets when a period rolls over and this is the only trace a
just-ended period leaves. It is reported only when the quota already existed
back then. The dashboard shows unmet previous periods on an alert card, and the
quota list in Settings shows the same per row.

`GET /quotas/{id}/history` returns every completed period since the quota began
(dates, amounts, `met`) plus a `{ met, total }` summary — "9 of 12 weeks met".
It is computed on read from a single grouped query, so there is no rollover
scheduler and no second source of truth. For `everyone` quotas it answers for
the caller unless `?user_id=` names a member.

Reports summarise a period or compare two. Every write that matters lands in
the audit log with a before/after payload.

### 8.7 Interface Language

The interface ships in English and Hungarian. English is the source of truth:
`TranslationKey` and `Translations` are derived from the English dictionary, so a
dictionary missing a key, carrying a stray one, or using a plain string where a
plural belongs fails the build.

The reader chooses. A switcher sits in the app header and on the sign-in screen,
and the choice is remembered per browser; a first-time visitor gets their
browser's language if the app speaks it. `NEXT_PUBLIC_DEFAULT_LOCALE` and
`NEXT_PUBLIC_LOCALES` set where that starts and narrow what is offered, but they
are the fallback rather than the authority.

Dates follow the interface language. **Amounts do not** — money and quantities
are formatted the American way in every locale, behind a `NUMBER_LOCALE`
constant. The figures mirror what the game shows and players repeat them to each
other as they appear there; a comma that separates thousands in one language and
decimals in another is a real way to mis-pay someone.

### 8.8 Faction Configuration Import/Export

Faction configuration — item types, quotas and ranks — can be exported to and
imported from CSV, mounted under `/factions/{id}/config`:

| Method | Path | Who | Notes |
|---|---|---|---|
| GET | `/config/item-types` | any member | `Name,Unit,Is Currency,Active` |
| GET | `/config/quotas` | any member | `Item Type,Target Amount,Period Type,Period Start,Target Member,Active` |
| GET | `/config/ranks` | any member | `Name,Level,Permissions` — pipe-separated permission list |
| POST | `/config/item-types` | `manage_item_types` | Upsert by name (case-insensitive); unit derived when left out |
| POST | `/config/quotas` | `manage_quotas` | Same validation as the create endpoint |
| POST | `/config/ranks` | `manage_settings` | Full replace of the rank list |

Imports POST `{ csv: string }` (the client reads the picked file as text) and
answer with `{ imported, updated?, skipped, errors[] }`. The same caps as entry
import apply: 500 KB and 1000 data rows.

Rules the importers share:

- **Skipped, never half-valid.** A row that fails any check is skipped and named
  in `errors`; nothing about it is written. Item types are the exception that
  upserts per row — an existing name updates unit, currency flag and active
  state, a new one is created.
- **Quota rows resolve names against the faction.** The item type must exist;
  a `Target Member` (blank = faction-wide) must match a current member by
  Discord name or in-game name. The one-active-quota-per-(type + period + scope)
  rule holds, counting both stored rows and what the same file inserted earlier.
- **A ranks import replaces the whole list** and carries the settings
  endpoint's rails: at most 20 ranks, unique names and levels, unknown
  permissions rejected, and removed ranks cleared off members in the same
  transaction. An import with no valid rows is refused rather than allowed to
  wipe the ranks.
- **Every import writes one audit log row** carrying the outcome counts — and
  for ranks, before/after rank lists and the removed names.

---

## 9. Frontend Architecture

### 9.1 Shape

Next.js App Router, but a single client-rendered screen: `app/page.tsx` resolves
the session and renders one of three things — the sign-in page, a waiting screen,
or the app shell. Navigation is a zustand view switch inside the shell, not
routing. This is why the i18n layer is hand-rolled rather than `next-intl`: the
routing and server-component machinery a full package brings would sit unused.

**Before the shell:** an account that belongs to no active faction gets a waiting
screen rather than a sidebar of screens that all refuse to load. It shows which
Discord it is waiting as, puts the Discord ID on screen with a copy button —
that ID is what an admin needs to fix it — and re-reads the session every 15
seconds and on tab focus, so it leaves by itself once a membership appears. The
in-game name prompt renders over it, so a first-time player sets their character
name and then waits. A superadmin is exempt: with no memberships they are exactly
the person who has to create the faction.

**Quick log:** logging happens mid-roleplay on phones, so the dashboard opens
with a pre-filled card — the member's own last entry supplies the item type and
amount, and ± steppers adjust by 1000 for currency and 1 for goods. The entries
dialog pre-fills the same way, offers the last three item types as one-tap
chips, and the entries filter has Today / This week / This month presets plus a
"My entries" CSV export (the export endpoint takes `user_id`).

**My stats strip:** the dashboard assembles, from endpoints that already
existed, the member's own week: total and entry count (week leaderboard),
leaderboard rank (`myRank`), logging streak (profile), and progress on the
first active `everyone` quota. Quota bars read "Még $2,400" — amount to go —
instead of a bare percentage, and the leaderboard shows ▲/▼ movement against
the previous period (competition-ranked, so a real rank change) and a flame on
streaks of three days or more.

**Print:** the reports view carries a print button; a `@media print` block
strips the sidebar, header and controls so a leader can print a clean monthly
sheet for RP meetings.

**User guide:** `docs/UserGuide.md` is the complete, plain-language manual —
also rendered in-app as a "User Guide" sidebar item (the markdown is copied to
`public/` at build time and fetched by the guide view, so the repo file and
the page never diverge).

### 9.2 Views

`views/` holds one component per screen: dashboard, entries, payouts, treasury,
laundering, members, member-profile, strikes, leaderboard, reports, settings,
audit-logs, admin-factions, admin-faction-detail, users-panel.

`users-panel` is the superadmin roster: everyone who has signed in plus the
registrations still waiting, in one list with the registrations pinned to the top
and labelled. Rename and remove appear only on those, because that is all the API
allows.

Expenses are not a view of their own: they render as a section inside the
treasury view, because the balance cards above them already carry their effect.
The Settings tabs for item types, quotas and ranks each carry CSV export/import
buttons (§8.8).

### 9.3 Shared Rules

- **Names** go through `displayName()` — character name when there is one, Discord
  name when there is not — everywhere a person is labelled. `fullDisplayName()`
  renders both where a row has to be traced to an account.
- **Permissions** are read from the membership the API returned, never inferred.
  `hasPermission()` returns true for a superadmin unconditionally, matching the
  server; a screen stricter than the API silently removes rights.
- **Colour on a figure means one thing or nothing.** A faction picks its own
  accent and nothing stops it picking green or red, so balances, scores, ranks and
  quota bars are neutral unless the value is actually negative (red) or a quota is
  actually met (green). The accent is for chrome: navigation, buttons, badges,
  card glows and charts.
- **State**: zustand for session, selected faction and view; TanStack Query for
  everything fetched.

### 9.4 Redesign — "Serious Ledger, Game Soul" (Phase 9)

A frontend redesign pass reworked the player-facing surfaces around a single
identity: the faction's own terminal, not a SaaS dashboard. Numbers stay
tabular and condensed, hairline rules and a dot-grid texture carry the
"ledger paper" language already established in §9.1, and every playful
element stays chrome-only — flavor lives in navigation, badges and card
glows, never in the ledger rows themselves.

**Player surfaces.** The dashboard reorders identity-first: the member's own
stats strip and quota sit above faction totals, with the hero balance's
count-up animation (§9.1) carried over. Quick log is now the star of the
card — last-three-item chips, larger tap targets, a one-thumb three-tap
flow. The entries list gained a filter bar that sticks on scroll and
per-row hover actions. The leaderboard gained a podium treatment for the
top three, animated movement arrows, and a segmented control in place of
the period dropdown. Withdrawals render their pending → approved →
completed lifecycle as a status pipeline instead of a text badge, so a
member sees at a glance where their request sits.

**Structure and navigation.** The sidebar now splits into a collapsible
"Play" group (Dashboard, Entries, Withdrawals, Leaderboard) and a "Manage"
group (Members, Strikes, Treasury, Settings) inside the icon rail, so
leaders get density without surfacing admin screens to players. A Ctrl+K
command palette jumps to any member, view, or action (e.g. "log entry").

**Identity and delight.** The faction landing area got a masthead
treatment: display-type name, accent glow, and an optional logo image URL
a superadmin can set. The contribution heatmap became the hero of the
member profile — enlarged, accent-tinted, with a "best day" tooltip. The
app also ships as a PWA: manifest, home-screen icon, and fullscreen
standalone mode.

**Guardrails**, carried over from the design brief and enforced per
component: animations stay under ~300ms and respect
`prefers-reduced-motion`; figures never wear the faction accent — §9.3
already established this for balances, scores, ranks and quota bars, and
the redesign extends the same rule to every new surface; no sound,
confetti, or emoji in ledger rows; every playful element is removable by
config for a faction that wants it austere.

**Not yet implemented from the plan:**

- A shared shimmer skeleton and a single line-art empty-state component —
  each view still hand-rolls its own, visually close but not unified.
- Item types as full visual citizens: a built-in icon/emoji picker per item
  type and cash/goods/contraband category color-coding. Only the existing
  admin-pasted image URL is in place.
- Row-level micro-feedback: a green/red pulse on a freshly logged entry and
  an eased quota-bar fill on update — the hero count-up is done; this is
  the rest of the "everything should move" principle.
- Stats-strip fact-chips — "Best week so far", "12-week quota streak."
- Roster rank sigils (Boss/Underboss emblem) and the stamped "IN THE RED"
  mark on a negative balance.

None of the above blocks testing or launch — it's polish. Of the remainder,
the row-pulse micro-feedback and the shared empty-state component are the
best value for the effort; the item-type icon picker is the largest, since
it needs both a picker UI and a schema field.

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
| `COOKIE_SECURE` | No | false | Set the `Secure` flag on the session cookie — enable on every HTTPS deployment |
| `LOG_LEVEL` | No | info | Node.js log level (debug/info/warn/error) |
| `DOMAIN` | No | localhost | Domain for the reverse proxy's TLS |
| `NEXT_PUBLIC_API_URL` | No | *(empty)* | Cross-origin API base. Empty means same-origin, proxied |
| `NEXT_PUBLIC_DEFAULT_LOCALE` | No | en | Interface language for a visitor with no saved choice (`en`, `hu`) |
| `NEXT_PUBLIC_LOCALES` | No | *(all)* | Comma-separated list of languages the switcher offers |
| `NODE_ENV` | No | production | Node.js environment (production/development) |

### 10.2.1 Content-Security-Policy

Set by `frontend/next.config.ts`, not by the reverse proxy — it is the only place
it lives. `img-src` allows `http:` and `https:` from any host, because an item's
image is a link an admin pastes and there is no set of hosts to enumerate up
front. `http:` buys less than it looks like: on an HTTPS deployment the browser
blocks a plain-http image as mixed content whatever this header permits, so it is
there for deployments still served over http, and should be dropped once every
deployment is on TLS.

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
# nginx serves TLS from the configured certificate

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

### Phase 4: Treasury & Payouts (Weeks 10-12) — COMPLETE

| # | Feature | Description | Priority |
|---|---------|-------------|----------|
| 1 | Payout system | Record money/items distributed TO members. Deducts from treasury balance | Critical |
| 2 | Treasury balance tracking | Running balance = total entries IN minus total payouts OUT, per item type | Critical |
| 3 | Payout approval workflow | Multi-admin factions can require approval before payout completes | High |
| 4 | Treasury dashboard | Dedicated view: balance by type, inflow vs outflow charts, net position | High |
| 5 | Payout history & filtering | Full CRUD, filterable list with audit trail | Medium |
| 6 | Quick-payout from dashboard | One-click "distribute even split" to all active members | Medium |

### Phase 5: Member Tools & Discipline (Weeks 13-15) — COMPLETE

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

### Phase 7: Advanced Analytics & Gamification (Weeks 19-21) — COMPLETE

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

### Phase 9: Frontend Redesign — "Serious Ledger, Game Soul" (Weeks 25-26) — MOSTLY COMPLETE

| # | Feature | Description | Priority |
|---|---------|-------------|----------|
| 1 | Dashboard reorder + count-up | Identity-first layout: stats strip and quota above faction totals; hero balance count-up animation — **DONE** | High |
| 2 | Quick-log redesign | Last-3 chips, larger tap targets, one-thumb three-tap flow — **DONE** | High |
| 3 | Entries polish | Sticky filter bar on scroll, per-row hover edit/undo — **DONE** | Medium |
| 4 | Leaderboard podium | Top-3 podium treatment, animated movement arrows, segmented period control — **DONE** | Medium |
| 5 | Withdrawal status pipeline | Visual pending → approved → completed pipeline replacing text badges — **DONE** | Medium |
| 6 | Sidebar Play/Manage grouping | Two-level collapsible sidebar split by role density — **DONE** | Medium |
| 7 | Command palette (Ctrl+K) | Jump to any member, view, or action — **DONE** | Medium |
| 8 | Faction masthead | Display-type name, accent glow, optional logo image URL — **DONE** | Medium |
| 9 | Heatmap-as-hero | Enlarged, accent-tinted heatmap with "best day" tooltip on the member profile — **DONE** | Low |
| 10 | PWA / mobile app feel | Manifest, home-screen icon, fullscreen standalone mode — **DONE** | Medium |
| 11 | Skeleton/empty-state unification | One shared shimmer skeleton + one line-art empty-state component | Low — not started |
| 12 | Item type icon/category system | Built-in icon/emoji picker per item type, cash/goods/contraband color coding | Low — not started (image URL only) |
| 13 | Row/quota micro-feedback | Green/red pulse on a freshly logged row, eased quota-bar fill | Low — not started |
| 14 | Stats-strip fact-chips | "Best week so far", "12-week quota streak" | Low — not started |
| 15 | Rank sigils + "IN THE RED" stamp | Boss/Underboss roster emblem; stamped mark on a negative balance | Low — not started |

See §9.4 for the narrative writeup, guardrails, and what's left.

---

## 12. Phase 4-8 Detailed Specifications

### 12.1 Phase 4: Treasury & Payouts

> **Wording.** The UI calls these **withdrawals**, not payouts: what leaves the
> vault is as often ammunition or drugs as it is money. The API, the database
> and the `manage_payouts` permission still say *payout* — the rename was
> deliberately kept to the screens.

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

> **Superseded.** The rest of §12.1 describes a `payoutApprovalRequired` setting
> and a four-eyes approval rule. Both are gone: the column was dropped in
> migration `0007`, and `manage_payouts` alone now decides where a withdrawal
> starts and who may settle it — including a withdrawal the settler raised. Read
> §8.3 for what the system does; what follows records what was planned.

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
`recipientUsername`, `recipientInGameName`, `recipientAvatarUrl`, `itemTypeName`,
`itemUnit`. A payout is owed to a character but tied to a Discord account, so
the UI shows both names: the in-game one, with the Discord one in parentheses.

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

#### 12.1.9 Laundering Desk

Converts one of the faction's currencies into another: dirty money in, clean
money back, minus whatever the washer kept.

| Method | Endpoint | Who | Notes |
|---|---|---|---|
| GET | `/api/v1/factions/{id}/laundering` | `manage_laundering` | The faction's active currencies with the treasury balance of each |
| POST | `/api/v1/factions/{id}/laundering` | `manage_laundering` | Performs one conversion |

```jsonc
// POST body
{
  "fromItemTypeId": "uuid",   // currency leaving the vault
  "amountIn":       "10000",
  "toItemTypeId":   "uuid",   // currency coming back
  "amountOut":      "7500",
  "description":    "optional note",
  "date":           "2026-08-31"   // optional, defaults to today
}
```

Design notes, in the order they usually get asked about:

- **No new kind of record.** A conversion is written as the two movements the
  treasury already derives its balances from: a **completed payout** of the
  source currency and an **entry** of the target one, both against the
  anonymous placeholder (`system:anonymous`, `is_system = true`). Nobody's
  contribution score or payout history moves, and the vault ends up correct
  without a second source of truth.
- **The rate is not configured.** Whoever runs the wash types both amounts;
  the cut depends on who did it. The UI shows the resulting percentage so the
  numbers can be sanity-checked before submitting.
- **Its own permission.** `manage_laundering` is separate from
  `manage_payouts` and `manage_entries` — holding either of those does not
  open the desk, and the menu is hidden without it.
- **Currencies only.** Both sides must be active item types with
  `isCurrency = true`; converting counted goods would be an inventory
  correction wearing a laundering costume.
- **The vault has to hold it.** The source balance is checked inside the
  transaction, so two conversions cannot spend the same money; a short vault
  answers `400` and writes nothing.
- The payout is created `completed` and skips `payoutApprovalRequired`: there
  is no member on the receiving end to four-eyes, and the balance has to move
  at once for the entry beside it to make sense.
- Each conversion writes one audit log row with `entity_type = 'laundering'`,
  carrying both amounts, both item types, and the ids of the payout and entry
  it produced.

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
- Strike history (`manage_strikes` sees the faction, a member sees their own)
- Notes (`manage_members` only, hidden from the member they are about) and
  join/rank history (`manage_members` reads anyone's, a member reads their own)
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


#### 12.2.7 Backend Implementation Status — DELIVERED

The Phase 5 backend is implemented, type-checked and verified against a live
database. **No frontend exists yet.** This section is the API contract; where it
differs from the specification above, this section is authoritative.

##### What is available

| Method | Endpoint | Access | Purpose |
|--------|----------|--------|---------|
| GET | `/factions/{id}/members/{userId}` | Any faction member | Member profile aggregate |
| GET | `/factions/{id}/members/{userId}/history` | `manage_members`, or the member themselves | Join / role / rank changes from the audit log |
| PATCH | `/factions/{id}/members/{userId}` | Faction admin | Now also accepts `rank` |
| POST/GET | `/factions/{id}/members/{userId}/notes` | `manage_members` | Private management notes; never shown to their subject |
| PATCH/DELETE | `/factions/{id}/members/{userId}/notes/{noteId}` | `manage_members` | Edit / remove a note |
| POST/GET | `/factions/{id}/members/{userId}/strikes` | `manage_strikes` issues and reads anyone; a member reads their own | Strikes for one member |
| PATCH | `/factions/{id}/members/{userId}/strikes/{strikeId}` | `manage_strikes` | Appeal, revoke, reinstate |
| GET | `/factions/{id}/strikes` | Any faction member | Faction-wide with `manage_strikes`, own record without it |
| GET | `/factions/{id}/settings` | Any faction member | Ranks, inactivity threshold, strike expiry |
| PATCH | `/factions/{id}/settings` | Faction admin | Update those settings |

`GET /members` (roster) gained `rank`, `lastEntryDate`, `daysInactive`, and —
for admins only — `activeStrikeCount`.
`GET /dashboard` gained `inactiveMembers` and `inactivityThresholdDays`, both
admin-only.

##### New faction settings

All three live on **`PATCH /api/v1/factions/{id}/settings`**, which **faction
admins can reach** for their own faction. They are deliberately not on
`PATCH /factions/{id}` (superadmin-only): that endpoint governs whether a
faction exists — name, active flag — while these govern how a faction runs
itself. `GET /factions/{id}/settings` is readable by any member, since ranks
appear on the roster and the threshold explains why someone is flagged.

```jsonc
{
  "ranks": [                                   // max 20, names and levels unique
    { "name": "Boss", "level": 1, "permissions": ["all"] },
    { "name": "Capo", "level": 3, "permissions": [] }
  ],
  "inactivityThresholdDays": 7,                // 1..365
  "strikeExpiryDays": { "warning": 30, "minor": 90, "major": null }  // null = never
}
```

Removing a rank from the list clears it from every member holding it, in the
same transaction — a roster can never display a rank the faction no longer
defines.

##### Request bodies

```jsonc
// PATCH /members/{userId} — at least one field required
{ "role": "admin", "rank": "Capo" }   // rank: null clears it

// POST /members/{userId}/notes
{ "category": "performance",          // general|performance|discipline|positive|promotion
  "content": "Consistently hits quota",
  "isFlagged": true }

// POST /members/{userId}/strikes
{ "severity": "minor",                // warning|minor|major
  "reason": "Missed 3 quota deadlines" }

// PATCH /members/{userId}/strikes/{strikeId}
{ "status": "appealed" }              // appealed|revoked|active only
```

##### Rules the UI must respect

1. **Notes are invisible to their subject.** Every note endpoint needs
   `manage_members` — read included — so a member never sees what was written
   about them. Member history is the opposite case: a member may read their
   own, and `manage_members` reads anyone's. The profile response carries
   `canViewNotes` and `canViewHistory` so the UI can hide each tab on its
   own.
2. **Note bodies are deliberately kept out of the audit log** — audit logs are
   readable by every faction admin, so only the category and flag are recorded.
3. **Strikes are visible to their subject.** A member may read their own
   strikes; reading anyone else's returns 403 unless their rank grants
   `manage_strikes`, which reads the whole faction. `GET /factions/{id}/strikes`
   answers accordingly: the faction-wide overview for a holder of that
   permission, the caller's own record for everyone else. The two differ in
   their default filter as well — the overview defaults to the strikes that
   still count, while a member reading their own history gets every status,
   revoked and expired included.
4. **Expiry is evaluated at read time.** There is no scheduler, so a strike past
   `expiresAt` still has `status: "active"` stored. Use **`effectiveStatus`**,
   which every strike response includes, and ignore the raw `status` for
   display.
5. **`revoked` and `expired` are terminal.** Allowed transitions are
   `active → appealed|revoked` and `appealed → active|revoked`. Do not offer
   reinstatement for a revoked or expired strike.
6. **Reason and severity cannot be edited after issuing** — only the outcome
   changes, so the record cannot be quietly rewritten.
7. **Nobody can strike themselves** (HTTP 400).
8. **Ranks are display-only.** Access control still runs entirely off `role`
   (`admin`/`member`). `permissions` inside a rank is stored but not enforced
   anywhere — do not build UI that implies it grants anything.
9. **An unknown rank is rejected** with the list of valid names in the message.
10. **Inactivity excludes two groups**: members who joined more recently than
    the threshold, and members with an active strike (already handled through
    discipline). `daysInactive: null` means the member has never logged an
    entry — that is *more* severe than a large number, and the list is sorted
    with those first.

##### Not included

Phase 5 frontend work — member profile page, notes tab, strike management,
rank editor and the inactivity alert card — is still open. `heatmap` and
`streak` are returned as `null` in the profile response: they are Phase 7
features, declared now so the UI can render an empty state without guessing at
the eventual shape.

##### Note on `brandColor` and `customFields`

Those two Phase 3 settings still sit on the superadmin-only
`PATCH /factions/{id}`, so a faction admin cannot change their own faction's
brand colour or custom entry fields. That predates Phase 5 and was left as is;
if the same reasoning should apply to them, they belong on this settings
endpoint too.

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


#### 12.4.6 Backend Implementation Status — DELIVERED

The Phase 7 backend is implemented, type-checked and verified against a live
database. **No frontend exists yet.** This section is the API contract; where it
differs from the specification above, this section is authoritative.

Note that **Phase 6 was skipped** — the announcement and activity-feed work in
12.3 has not been built.

##### What is available

| Method | Endpoint | Access | Purpose |
|--------|----------|--------|---------|
| GET | `/factions/{id}/members/{userId}/heatmap?year=` | Any faction member | Gap-filled daily activity for one calendar year |
| GET | `/factions/{id}/leaderboard` | Any faction member | Ranked members for a period |
| GET | `/leaderboard` | **Superadmin** | Top contributors across all factions |
| GET | `/factions/{id}/reports/growth` | Faction admin | Period-over-period metrics |

The member profile (`GET /factions/{id}/members/{userId}`) no longer returns
`heatmap: null` and `streak: null`. It now carries a populated `streak` object
and a `performance` score. The heatmap stays on its own endpoint because a full
year of days dwarfs the rest of that response.

##### Response shapes

```jsonc
// GET /members/{userId}/heatmap?year=2026
{
  "year": 2026,
  "data": [ { "date": "2026-01-01", "count": 0, "total": 0 }, ... ],  // every day
  "maxCount": 3, "maxTotal": 15000    // for scaling the colour ramp
}

// inside GET /members/{userId}
"streak": { "current": 5, "best": 12, "lastEntryDate": "2026-08-29", "activeToday": true },
"performance": {
  "score": 77.22,
  "breakdown": { "quotaHitRate": 1, "consistency": 0.27,
                 "totalVolume": 1, "streakBonus": 1, "seniorityBonus": 0.56 }
}

// GET /factions/{id}/leaderboard?period=week|month|all&item_type_id=&limit=
{
  "period": { "from": "2026-08-01", "to": "2026-08-29", "label": "This Month" },
  "rankings": [ { "rank": 1, "userId": "...", "username": "...", "avatarUrl": null,
                  "total": 5502, "entryCount": 8,
                  "itemBreakdown": { "Cash": 5500, "Drugs": 2 }, "isMe": true } ],
  "myRank": 1
}

// GET /factions/{id}/reports/growth?periods=6&granularity=month|week
{
  "granularity": "month",
  "periods": [ { "label": "Aug 2026", "from": "2026-08-01", "to": "2026-08-31",
                 "totalEntries": 10, "totalAmount": 6102,
                 "activeMembers": 2, "avgPerMember": 3051 } ],
  "growth": { "entriesChangePct": 15.2, "amountChangePct": null,
              "memberChange": 2, "avgChangePct": -3.1 },
  "partial": true
}
```

##### Rules the UI must respect

1. **A streak survives until a day is missed.** Logging yesterday but not yet
   today keeps `current` alive; `activeToday` distinguishes the two. Do not
   render a streak as broken just because the member has not logged today.
2. **`performance.score` is computed on demand and never stored.** Cache it
   client-side with a short stale time; do not treat it as a stable value.
3. **The score is relative to the faction.** `totalVolume` is rank-scaled
   against the faction's top contributor, so 100 does not mean "contributed a
   lot" in absolute terms — it means "leads this faction".
4. **`quotaHitRate` is neutral (1), not zero, when the faction has no active
   quotas.** A faction that does not use quotas should not have every member
   scored down for it.
5. **Growth percentages can be `null`.** That means the previous period was
   zero, so there is no baseline to compare against — render it as "n/a", not
   as 0% or ∞.
6. **`partial: true` means the last period is still running.** Label it as
   in-progress; otherwise a mid-month reading looks like a collapse.
7. **Equal totals share a rank.** Two members on the same amount both get e.g.
   rank 2, and the next is rank 4. Do not renumber sequentially.
8. **The leaderboard returns `isMe` and `myRank`** so the caller's own row can
   be highlighted without a second lookup. `myRank` is null when the caller
   falls outside the returned slice.
9. **`GET /leaderboard` (no faction) is superadmin-only.** It deliberately
   crosses the faction isolation boundary every other endpoint enforces, and
   lists each member once per faction they are active in.
10. **The heatmap always returns every day of the year**, including zeroes, so
    the grid can be rendered without filling gaps client-side.

##### Related fix outside Phase 7

`toDateString` formatted dates by converting to UTC first, so at UTC+2 a local
midnight landed on the previous day: `new Date(2026, 7, 1)` came back as
`2026-07-31`. That shifted every month and week boundary by a day — quota
periods, reports, charts, exports and the new leaderboards all read from it. It
now formats from the local calendar date, which is the correct reading given
`entry_date` and `payout_date` are plain dates with no timezone.

##### Not included

Phase 7 frontend work — the heatmap grid, score display, streak indicator,
leaderboard views and growth charts — is still open. Phase 6 (announcements,
read tracking, activity feed) was skipped entirely and remains unbuilt on both
sides.

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