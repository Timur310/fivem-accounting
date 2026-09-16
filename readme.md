# Faction Accountant

**A self-hosted toolkit for FiveM roleplay factions.** Track who put what in
the vault, split what the crew took on a job, keep a registry of plates and
turf, and settle any argument by pointing at an audit trail nobody can
rewrite.

Cartels, PDs, EMS, mechanic shops, biker clubs — any faction that pools
money, goods or contraband and needs an honest record of it.

**Take the parts you want.** It started as a ledger and grew into a set of
tools, so every faction picks which ones it runs. A crew that only wants a
vehicle registry and a map switches the rest off and gets a five-item menu.
Nothing is deleted by switching a feature off, and switching it back on finds
everything where it was left.

<!-- 
  Swap in real badges once the repo is live, e.g.:
  ![License](https://img.shields.io/github/license/Timur310/fivem-accounting)
  ![Docker](https://img.shields.io/badge/deploy-docker--compose-2496ED?logo=docker)
  ![Next.js](https://img.shields.io/badge/frontend-Next.js-black?logo=nextdotjs)
-->

---

## Why

Discord threads and spreadsheets lose the thread the moment a faction gets
past a dozen members. Four people come back from a bank and spend ten minutes
working out who logs what — and get it wrong, because four people rounding by
hand never add up to what was actually taken.

Faction Accountant replaces both with one page: log an entry in three taps,
record a whole crew's haul once and let the app do the dividing, see the vault
balance in real time, and settle a dispute by pointing at an append-only audit
log instead of scrolling Discord history.

## Features

Grouped the way the app's own sidebar groups them.

### Ledger

- 💰 **Entries & treasury** — every contribution logged per member, per item
  type; the vault balance is always derived, never stored, so it can't drift
- 🏦 **Withdrawals** — request → approve → complete pipeline, plus even-split
  payouts and vault-count reconciliation
- 🔨 **Crafting** — write a recipe once (10 steel + 2 powder → 1 pistol) and
  run it in one click; the materials leave the vault and the product arrives,
  in batches, with a one-click revert if it was a mistake
- 🧮 **Price calculator** — a price list with add-ons, per-partner discounts
  and bulk rungs; pick the buyer, read the total, paste it into Discord, and
  book the sale into the treasury in one click — with margins read straight
  out of your crafting recipes, and either currency at your own rate
- 🧼 **Laundering** — convert one of the faction's currencies into another,
  booked against the faction so nobody's score moves

### Field

- 🎯 **Operations** — a job the crew ran together, logged once. Say who was
  there and what came back, and the app writes every share into the books for
  you. Shares are weights rather than percentages, every last hundredth is
  handed out so the split always equals the haul, and the faction's cut comes
  off the top credited to nobody. Got it wrong? Revert the whole split in one
  go and log it again
- 🚗 **Vehicle registry** — plate, make, colour, owner and status for every
  car the faction tracks, searchable by plate or owner, with a per-vehicle
  history of who changed what
- 🗺️ **Map** — an interactive Los Santos map with the faction's own marks on
  it; points, routes and turf grouped into named maps, each of which decides
  which ranks may open it. Paste coordinates straight from `/coords` and the
  pin lands where the player stood

### People

- 🎯 **Quotas** — weekly/monthly targets, per-member or faction-wide, with a
  full history of every period, met or missed
- 🏆 **Leaderboards & streaks** — ranked contributors, logging streaks, a
  GitHub-style contribution heatmap per member
- ⚖️ **Discipline** — strikes with severity, expiry and appeal tracking;
  private admin notes members never see

### Running the faction

- 🧩 **Features you use** — switch whole parts of the app off per faction.
  What you untick leaves the menu, leaves the rank editor's permission list,
  and leaves the Discord routing list. The data stays exactly where it is
- 🛡️ **Rank templates** — start from Crew, Organisation or Business instead of
  a blank list and twenty-one checkboxes. The suggested permissions follow the
  features your faction actually runs, and you edit everything before saving
- 💬 **Discord** — connect your faction's own Discord server and choose which
  channel each kind of activity is posted to, plus scheduled reminders for
  quota deadlines and rent night
- 📣 **Announcements** — a faction bulletin board with priorities, pinning,
  expiry and read tracking, so "quota deadline is Friday" stops getting buried
- 🕑 **Activity feed** — one timeline over the whole faction, narrowed to what
  each member is allowed to see
- 🔔 **Notifications** — an in-app bell: your withdrawal was approved, you were
  given a strike, your bug report was answered
- 🧾 **Audit log** — append-only record of every write in the system, actor
  and timestamp included

### Server

- 💾 **Database backup** — a superadmin downloads the whole database as one
  file, or restores one; nothing is kept on the server, so the copy lives
  wherever they put it
- ✅ **Backup verification** — `npm run backup:verify -- ./latest.dump` (from
  `backend/`) restores a backup into a scratch database beside the live one,
  counts every table and throws the scratch away. It cannot touch the live
  database. A backup nobody has restored is a file, not a backup
- 🛟 **Support** — anyone can send a bug report or feature request straight to
  whoever maintains the instance

### Everywhere

- 🌐 **English & Hungarian** out of the box, with amounts formatted
  consistently in both
- ⚡ **Command palette (Ctrl+K)**, installable as a PWA, mobile-first UI
- 🔐 **Discord OAuth** login — no separate accounts, ranks map to your
  faction's own hierarchy

## Tech stack

| Layer | Choice |
|---|---|
| Frontend | Next.js (App Router), TypeScript, Tailwind, TanStack Query, zustand |
| Backend | Node.js 22 LTS, TypeScript, Express |
| Database | PostgreSQL, Drizzle ORM |
| Auth | Discord OAuth 2.0 + JWT sessions |
| Tests | Vitest — the backend suite runs against a real Postgres built from the committed migrations |
| Deploy | Docker Compose, self-hosted on your own VPS |

## Quick start

```bash
git clone https://github.com/Timur310/fivem-accounting.git
cd fivem-accounting

cp backend/.env.example backend/.env    # Discord OAuth, JWT secret, DB
cp frontend/.env.example frontend/.env  # where the browser finds the API

docker compose up -d
```

One thing to change before the first build: `docker-compose.yml` passes the
frontend its API URL as a build argument, and it is pinned to the author's
host. Point `NEXT_PUBLIC_API_URL` at your own.

Then open the app, sign in with Discord, and promote yourself:

```bash
docker compose exec backend node dist/bootstrap.js <your-discord-id>
```

(The `npm run bootstrap` script runs the TypeScript source and is for local
development; the container image ships compiled JavaScript without the dev
dependencies.)

Full deployment steps (VPS sizing, TLS, backups) live in
[`docs/FiveM_RP_Faction_Accountant_Architecture.md`](docs/FiveM_RP_Faction_Accountant_Architecture.md).

## Documentation

- 📘 [`docs/UserGuide.md`](docs/UserGuide.md) — the complete player/leader/
  superadmin manual (also served in-app)
- 🏗️ [`docs/FiveM_RP_Faction_Accountant_Architecture.md`](docs/FiveM_RP_Faction_Accountant_Architecture.md) — system design, data
  model, API, and the full development roadmap

## Roadmap

Actively developed and running in production for real factions. Operations,
per-faction modules and rank templates shipped most recently; Discord bot
commands, automated reports, webhooks and per-feature onboarding are next up —
see the roadmap in the architecture doc for the full phase-by-phase plan and
what's already shipped.

## Contributing

Issues and PRs welcome. If you're adding a feature, check the roadmap first
so it lines up with where the project's headed.

## Version and attribution

The app shows its version and copyright line in the sidebar footer and on the
sign-in screen. The version has one source — `version` in
`frontend/package.json` — which `next.config.ts` injects as
`NEXT_PUBLIC_APP_VERSION`. Bump it there to cut a release; nothing else needs
editing, and the footer cannot drift from the package.

Owner and copyright holder: **Mustafa Yildiz**. The name and year live in
`frontend/src/lib/app-meta.ts`.

---

*Built for FiveM roleplay servers. Self-hosted, your data, your rules.*
