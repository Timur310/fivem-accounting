# Faction Accountant

**A self-hosted ledger for FiveM roleplay factions.** Track who put what in
the vault, what got paid out, what's expected this week, and who's carrying
the crew — with an audit trail nobody can rewrite.

Cartels, PDs, EMS, mechanic shops, biker clubs — any faction that pools
money, goods or contraband and needs an honest record of it.

<!-- 
  Swap in real badges once the repo is live, e.g.:
  ![License](https://img.shields.io/github/license/your-org/faction-accountant)
  ![Docker](https://img.shields.io/badge/deploy-docker--compose-2496ED?logo=docker)
  ![Next.js](https://img.shields.io/badge/frontend-Next.js-black?logo=nextdotjs)
-->

---

## Why

Discord threads and spreadsheets lose the thread the moment a faction gets
past a dozen members. Faction Accountant replaces both with one page: log an
entry in three taps, see the vault balance in real time, and settle a
dispute by pointing at an append-only audit log instead of scrolling
Discord history.

## Features

- 💰 **Entries & treasury** — every contribution logged per member, per item
  type; the vault balance is always derived, never stored, so it can't drift
- 🏦 **Withdrawals** — request → approve → complete pipeline, plus even-split
  payouts and vault-count reconciliation
- 🎯 **Quotas** — weekly/monthly targets, per-member or faction-wide, with a
  full history of every period, met or missed
- 🏆 **Leaderboards & streaks** — ranked contributors, logging streaks, a
  GitHub-style contribution heatmap per member
- ⚖️ **Discipline** — strikes with severity, expiry and appeal tracking;
  private admin notes members never see
- 🔨 **Crafting** — write a recipe once (10 steel + 2 powder → 1 pistol) and
  run it in one click; the materials leave the vault and the product arrives,
  in batches, with a one-click revert if it was a mistake
- 🗺️ **Map** — an interactive Los Santos map with the faction's own marks on
  it; points, routes and turf grouped into named maps, each of which decides
  which ranks may open it. Paste coordinates straight from `/coords` and the
  pin lands where the player stood
- 🧼 **Laundering** — convert one of the faction's currencies into another,
  booked against the faction so nobody's score moves
- 📣 **Announcements** — a faction bulletin board with priorities, pinning,
  expiry and read tracking, so "quota deadline is Friday" stops getting buried
- 💬 **Discord** — connect your faction's own Discord server and choose which
  channel each kind of activity is posted to, plus scheduled reminders for
  quota deadlines and rent night
- 🔔 **Notifications** — an in-app bell: your withdrawal was approved, you were
  given a strike, your bug report was answered
- 🕑 **Activity feed** — one timeline over the whole faction, narrowed to what
  each member is allowed to see
- 🛟 **Support** — anyone can send a bug report or feature request straight to
  whoever maintains the instance
- 🧮 **Price calculator** — a price list with add-ons, per-partner discounts
  and bulk rungs; pick the buyer, read the total, paste it into Discord, and
  book the sale into the treasury in one click — with margins read straight
  out of your crafting recipes, and either currency at your own rate
- 🧾 **Audit log** — append-only record of every write in the system, actor
  and timestamp included
- 💾 **Database backup** — a superadmin downloads the whole database as one
  file, or restores one; nothing is kept on the server, so the copy lives
  wherever they put it
- 🌐 **English & Hungarian** out of the box, with amounts formatted
  consistently in both
- ⚡ **Command palette (Ctrl+K)**, installable as a PWA, mobile-first UI
- 🔐 **Discord OAuth** login — no separate accounts, ranks map to your
  faction's own hierarchy

## Tech stack

| Layer | Choice |
|---|---|
| Frontend | Next.js (App Router), TypeScript, Tailwind, TanStack Query, zustand |
| Backend | Node.js 22 LTS, TypeScript |
| Database | PostgreSQL, Drizzle ORM |
| Auth | Discord OAuth 2.0 + JWT sessions |
| Deploy | Docker Compose, self-hosted on your own VPS |

## Quick start

```bash
git clone https://github.com/<your-org>/faction-accountant.git
cd faction-accountant

cp .env.example .env
# fill in Discord OAuth credentials, JWT secret, DB config

docker compose up -d
```

Then open the app, sign in with Discord, and the first superadmin bootstrap
script creates the initial faction. Full deployment steps (VPS sizing, TLS,
backups) live in [`docs/FiveM_RP_Faction_Accountant_Architecture.md`](docs/FiveM_RP_Faction_Accountant_Architecture.md).

## Documentation

- 📘 [`docs/UserGuide.md`](docs/UserGuide.md) — the complete player/leader/
  superadmin manual (also served in-app)
- 🏗️ [`docs/FiveM_RP_Faction_Accountant_Architecture.md`](docs/FiveM_RP_Faction_Accountant_Architecture.md) — system design, data
  model, API, and the full development roadmap

## Roadmap

Actively developed. The price calculator shipped most recently; Discord bot commands,
automated reports, webhooks and faction templates are next up — see the roadmap in the architecture doc for
the full phase-by-phase plan and what's already shipped.

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
