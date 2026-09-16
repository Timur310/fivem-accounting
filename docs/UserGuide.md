# Faction Accountant — User Guide

> A complete, plain-language guide to everything the app does, where to find
> it, and why it's there. If you just want to log your haul and get back to
> the streets, read sections **1–5**. Faction leaders should read the rest;
> superadmins get section **9**.

---

## Table of contents

1. [What this app is](#1-what-this-app-is)
2. [Signing in](#2-signing-in)
3. [The layout](#3-the-layout)
4. [Roles and permissions](#4-roles-and-permissions)
5. [For members — the daily stuff](#5-for-members--the-daily-stuff)
6. [For leaders — running the faction](#6-for-leaders--running-the-faction)
7. [Reports, exports and printing](#7-reports-exports-and-printing)
8. [Settings — configuring the faction](#8-settings--configuring-the-faction)
9. [For superadmins](#9-for-superadmins)
10. [The audit log — who did what](#10-the-audit-log--who-did-what)
11. [Good to know — rules the app never breaks](#11-good-to-know--rules-the-app-never-breaks)
12. [Quick answers](#12-quick-answers)

---

## 1. What this app is

Your faction pools money, goods and dirt in a shared vault. This app is the
ledger for that vault:

- **who put what in** — every entry, tied to a person (or anonymous),
- **what got paid out** — every withdrawal, with its state,
- **what the faction spent** — rent, utilities, supplies,
- **what's expected** — weekly and monthly quotas,
- **who stepped up and who didn't** — leaderboards, streaks, inactivity,
- **what the faction needs to know** — announcements, a shared activity feed,
- **and who touched what** — a complete, uneditable audit trail.

It replaces spreadsheets and memory. It does not replace your Discord — it
feeds it: connect a server and the ledger posts there by itself (§8.6).

Everything here is permanent on purpose: log honestly, because leaders can see
the history of all of it — including the numbers you'd rather they didn't.

---

## 2. Signing in

### 2.1 Discord only

There is no username or password. Click **Sign in with Discord** and approve
the app. The session lasts 7 days, then you sign in again — nothing you did
is ever lost, only your login.

### 2.2 First sign-in: your in-game name

You'll be asked for your **in-game name** — your character's name. This is
how you appear *everywhere* in the app: dashboard, leaderboards, payout rows.
You can change it later from the top-right menu, and your admins can correct
it too (§6.1). If you skip the prompt you can set it from the menu any time.

### 2.3 "Waiting for approval"

You're signed in, but not yet in a faction. The screen shows:

- **which Discord account** you're waiting as,
- your **Discord ID with a copy button** — this ID is exactly what your
  admin needs to add you,
- and it re-checks every few seconds, so the app **opens by itself** the
  moment you're added. No refreshing.

### 2.4 Language

The interface speaks **English and Hungarian**. Switch with the globe in the
header (it's also on the sign-in screen). Your choice is remembered per
browser; a first-time visitor gets the browser's language. Numbers are
formatted the same way in both languages — see §11.

---

## 3. The layout

One sidebar on the left, content on the right. On phones the sidebar becomes
a slide-in drawer (hamburger button in the top bar).

**Top bar:** the **bell** (below) · language switcher · your name (click it to
change your in-game name) · your role badge. If you belong to more than one
faction — or a superadmin gave you browse rights — a **faction selector**
appears; everything below it shows the selected faction.

The sidebar has two states: full labels, or a slim icon rail. The bottom-most
button collapses it.

**Play, Manage and Server.** Inside the sidebar, screens split into groups:

- **Play** — Dashboard, Entries, Withdrawals, Announcements, Activity,
  Leaderboard, Support and the User Guide. The ones you open daily, and all
  open to every member whatever their rank.
- **Manage** — Members, Strikes, Treasury, Laundering, Crafting, Map,
  Reports, Audit logs, Settings. Visible only if your rank grants them
  (§4) — except the Map, which every member can open; what they find on it
  depends on their rank (§6.8).
- **Server** — superadmin only: faction administration and the Support Inbox.

Each group collapses on its own, so a plain member's sidebar stays short even
before permissions enter the picture. At the very bottom sit the app's version
and copyright line, above the collapse button.

**Small things worth knowing.**

- **Press Enter to save.** Every form in the app submits on Enter — logging an
  entry, requesting a withdrawal, recording an expense. Enter inside a longer
  *message* box still starts a new line, as you would expect.
- **Amounts echo back formatted.** Type `1500000` and **$1,500,000** appears
  under the field. FiveM money is long, and `1500000` and `150000` look almost
  identical while you are typing.
- **Column headers sort.** On Entries, Withdrawals and Strikes, click a header
  to sort by it; click again to flip direction. It sorts the *whole* list, not
  just the page you are looking at.
- **Filters and sorting stay put.** Narrow a list, click into a member, come
  back — it is how you left it. Remembered per faction.
- **Quick ranges.** Today / This week / This month fill both date boxes for
  you, on Entries, Withdrawals and the audit log.

**Command palette.** Press **Ctrl+K** (⌘K on a Mac) from anywhere in the app
to open a search box that jumps straight to a member, a screen, or an action
like "log entry" — faster than clicking through the sidebar, and handy on a
desktop mid-session.

**Install it like an app.** On a phone, or a desktop browser that supports
it, your browser's menu offers *Add to Home Screen* / *Install App*.
Installed, it opens full-screen with no address bar and sits on your home
screen next to your other apps — the fastest way in mid-heist.

---

### The bell — what the app tells you

The **bell** in the top bar is how the app reaches you instead of waiting to be
found. A number on it means unread.

You get one when:

- a withdrawal of yours is **approved**, **rejected** or **paid out**
- you are given a **strike**
- a bug report or idea you sent is **resolved** or **declined**

Clicking one takes you to where it happened — and switches you into the right
faction first, if you were looking at a different one. **Mark all read** clears
the number; **Clear** empties the list.

You are never notified about something you did yourself, and nobody else can
see your bell — not other members, not your faction admin, not the developer.

---

## 4. Roles and permissions

There are two layers: your **global role**, and your **rank inside the
faction**.

| Role | Where it comes from | What it means |
|---|---|---|
| **Member** | default | Dashboard, entries, own withdrawals, treasury, leaderboard, announcements, activity, support |
| **Faction admin** | appointed by a superadmin | Everything in *their* faction, including all rank permissions |
| **Superadmin** | server owner / bootstrap | Everything, everywhere, plus creating and deleting factions |

Between plain member and admin sit **ranks** (Boss, Underboss, Capo, … — your
faction defines its own). Each rank grants specific permissions, and the
sidebar shows exactly what your rank gives you:

| Permission | What it opens |
|---|---|
| `manage_members` | Roster: add/remove, ranks, in-game names, kick-suggestion flags, member notes |
| `manage_entries` | Log entries for others or the faction, edit/delete any entry |
| `manage_payouts` | Withdrawals for others, even split, settling requests, vault verification |
| `manage_expenses` | Recording the faction's running costs |
| `manage_discord` | Connecting a Discord server and choosing what gets posted there (§8.6) |
| `manage_laundering` | The laundering desk |
| `manage_crafting` | Writing and retiring recipes, and reverting a craft (§6.7) |
| `craft` | Running a saved recipe (§6.7). Safe to hand out widely — it spends materials, it does not define what they cost |
| `manage_map` | Creating maps and drawing on them (§6.8). Only on maps the holder can already open |
| `manage_prices` | Setting prices, add-ons, partners and bulk discounts (§6.11), and reverting a booked sale |
| `manage_vehicles` | Adding, editing and deleting vehicles in the registry (§6.12). Reading it needs nothing |
| `sell` | Booking a sale into the treasury (§6.11). Safe to hand out widely — it records what was sold, it does not decide what things cost |
| *(rank, not a permission)* | Seeing cost and margin (§6.11). Set in the price list, and it works like a map's rank: at or above the level you pick |
| `manage_strikes` | Issuing and settling strikes, the faction strike list |
| `manage_quotas` | Creating and editing quotas |
| `manage_item_types` | The faction's item types |
| `manage_settings` | Ranks, thresholds, expiry, escalation, budgets — and **posting announcements** (§5.9) |
| `manage_customization` | Accent color and custom entry fields |
| `view_audit_logs` | The audit trail |
| `view_reports` | Period summaries and comparisons |

**Some screens have no permission at all.** Announcements, Activity, Support
and the User Guide are open to every member. That is deliberate: a notice
nobody can read is not a notice, and the people most likely to hit a bug are
the ones holding the fewest rights. The Activity feed narrows itself instead of
being gated — it shows you only what you could already see elsewhere (§5.10).

The **admin seat itself is not delegable**: a rank can run the roster, but
promoting someone to admin stays with faction admins and superadmins.

---

## 5. For members — the daily stuff

### 5.1 Dashboard — your first glance

The dashboard is one page, top to bottom — ordered around *you first, then
the faction*:

1. **Faction header** — name, description, and, if a superadmin set one
   (§9.1), a small logo with the faction's accent color glowing behind it.
2. **Quick log** (§5.2) — pre-filled, one-click logging.
3. **My stats strip** — *your* week at a glance, ahead of the faction's own
   totals:
   - **Your week** — total contributed this week and entry count,
   - **Leaderboard** — your rank this week,
   - **Streak** — consecutive days with at least one entry (🔥 amber when
     you've logged today),
   - **Your quota** — your progress on a per-person quota, if the faction
     runs one.
4. **Net treasury balance & stats cards** — what the vault holds, counting
   up on load. Money-only, because dollars and kilograms don't add up; goods
   are listed per type further down. Sits alongside total entries, member
   count and item type count.
5. **Quota progress** — faction targets as energy bars. Unmet bars read
   *"Még $2,400"* — the amount still missing, not a percentage.
6. **Quotas missed last period** — only appears when a just-ended period was
   missed. It stays visible until the next period ends, so a silent failure
   can't hide.
7. **Top contributors / Recent activity** — who's carrying this period, and
   the latest ledger movement.
8. **Balances by item type** — the per-item view of the vault.
9. **Inactive members** (admins only) — members who haven't logged anything
   within the faction's inactivity threshold. Newcomers and already-struck
   members are excluded automatically.
10. **Charts & export** — folded away at the bottom; open when you want the
    graphs or a CSV.

### 5.2 Logging an entry

*Entries → Log entry* — or the **Quick log** card on the dashboard, which is
the same thing pre-filled.

1. **Item type** — pick what you contributed. Your three most recent types
   appear as **one-tap chips** above the list.
2. **Amount** — type it, or use the **+ / −** buttons: they step by 1,000 for
   money and 1 for countable goods.
3. **Date** — today by default. You can backdate (you logged yesterday's take
   today). **Future dates are refused** — the ledger doesn't record the
   future.
4. **Description** (optional) — "jewelry store", "pharmacy run". This is
   searchable later.
5. **Custom fields** — if your faction configured extra fields (e.g.
   "location"), they appear here.

**Who gets credit:** your own name, always. Logging for someone else or for
the faction anonymously requires `manage_entries` (§6.2). Anonymous entries
belong to the faction itself — they count toward the vault but never appear
on any person's score.

**Made a typo? — the 5-minute undo.** Your own row shows a trash button for
**five minutes** after you log it. Click it and the entry is removed, no
admin needed. After five minutes it's permanent unless a leader removes it,
so double-check the big numbers while the countdown is yours.

### 5.3 The entries list

The full ledger, newest first, searchable.

- **Filters:** item type, from/to dates, free-text search on descriptions.
  The **Quick range** buttons (Today / This week / This month) fill the dates
  for you — "did I log yesterday?" is two taps.
- **The filter bar stays put.** Scroll a long list and the filters ride along
  at the top instead of scrolling out of view, so you can change one without
  scrolling back up.
- **CSV exports** (top right):
  - **Entries CSV** — everything matching the current filters,
  - **My entries CSV** — only your rows, for your own bookkeeping.

**Leaders:** anyone holding `manage_entries` can hover a row to reveal inline
edit and delete controls — not limited to your own entry within the first
five minutes (§5.2).

### 5.4 Withdrawals (getting something out of the vault)

*Withdrawals*. The name is generic on purpose: what leaves the vault is as
often ammunition or drugs as it is money.

**Anyone can request one for themselves.** It starts **pending** and waits
for a leader to settle it. The status shows as a visual pipeline on the
withdrawal itself, not just a badge, so you can see at a glance where a
request sits:

```
pending → approved → completed
   └──────→ rejected
```

- **pending** — requested, nothing has moved. While it sits here it is still
  yours: a **Withdraw request** button on your own row takes it back. Nothing
  has been paid out, so nothing changes in the treasury, and you can ask again
  whenever you like. Once a leader approves, rejects or pays it, that button
  goes away — from then on it is their decision and part of the ledger.
- **approved** — a leader committed to it; it still hasn't left the vault.
- **completed** — paid out. **Only completed withdrawals reduce the
  treasury.**
- **rejected** — refused. It stays visible in the history but never affects
  any balance.

Completed and rejected withdrawals are final — they can't be reopened. They
*can* be deleted by a leader (§6.5), which removes them from the ledger.

### 5.5 Quotas — what's expected of you

A quota targets an **item type** over a **week** (resets Monday) or a
**month** (resets on the 1st), in local server time. Three scopes exist
(§6.3); as a member you mostly care about the second:

- **Everyone individually** — the same target measured on *you personally*.
  Your dashboard bar and the "My stats" strip show your own progress, and the
  bar reads how much is still missing.
- **Faction-wide** — everyone's contributions sum into one shared target.
  Your contribution is part of it; the bar is the faction's, not yours.
- **Per member** — a target pinned to one specific person.

A missed period doesn't vanish: when a period ends, its outcome stays visible
on the dashboard until the next one ends too (§6.3).

### 5.6 Leaderboard

*Leaderboard* — ranked members for **this week**, **this month** or **all
time**, switched with a segmented control at the top instead of a dropdown.

The **top three sit on a podium** — #1 raised and centered — before the
ranked list continues underneath.

- ▲2 / ▼1 next to a rank = places gained or lost versus the previous period.
  No arrow = unchanged; a newcomer has no arrow either.
- 🔥 marks a **logging streak of 3+ days** (consecutive days with at least
  one entry) — amber when the person has logged today, grey when the streak
  is still alive from yesterday.
- Equal totals share a rank — two people on the same amount are both #2, and
  the next is #4.
- Your own row is highlighted, even if you have to scroll for it.
- Tap any member to open their **profile** (§6.2).

### 5.7 Treasury — reading the vault

*Treasury* — what the vault has done, and why.

- **Net balance / Total in / Total out** — the headline numbers. Money only;
  the note under them tells you how many goods types are tracked separately.
  If the faction has paid out more than it took in, an **IN THE RED** stamp
  sits beside the figure — the same fact the red number and the line beneath
  it already tell you, hard to miss.
- **Running expenses** — the faction's costs, with budget bars showing the
  month against the caps (§6.4). If you want to know why the vault shrank,
  start here.
- **Balances by item type** (collapsed by default, "Show balances") — every
  type the vault has ever moved: inflow, outflow, current balance, and a mini
  outflow sparkline. Negative balances are possible and shown in red — the
  faction paid out more than it took in.
- **Outflow trend** — everything that left the vault per day (completed
  withdrawals *and* expenses) over the last 30 days.
- **Recent withdrawals** (admins) — the last completed payouts.

The treasury is read-only for members: transparency, not control.

---

### 5.8 Support — reporting a bug or asking for a feature

*Support* is in the sidebar for **everyone**, whatever your rank. You do not
need a permission to tell the developer something is broken — the people who
hit the most bugs usually hold the fewest rights.

Pick one of two:

- **Report a bug** — something is broken or behaves wrongly.
- **Request a feature** — something is missing that would help.

Then a short subject and the details. For a bug, the single most useful thing
you can write is **the steps that led to it**: what you did, what you expected,
and what happened instead. For a feature, say what problem it would solve, not
just what it should look like.

**You can follow what happens to it.** Everything you have sent is listed under
the form with its status:

| Status | Means |
|---|---|
| **Open** | Sent, not answered yet. |
| **Resolved** | The developer dealt with it. |
| **Declined** | The developer is not going to do it — usually with a reason. |
| **Withdrawn** | You took it back. |

If the developer writes a reply when closing your ticket, it appears on the
ticket itself.

**Withdraw** takes back a ticket you have not had an answer to yet — a typo, or
you worked out it was not a bug after all. Once it has been answered the button
is gone, because withdrawing it then would erase the answer. You can always send
a new one.

The faction you were looking at when you sent it is attached automatically, so
you do not have to explain where you were.

---

### 5.9 Announcements — what the faction needs you to know

**Announcements** is in the sidebar for everyone. It is the faction's notice
board: quota changes, meeting times, rule updates — the things that used to get
buried in Discord.

- **Pinned** notices stay at the top however old they get.
- **High** and **Urgent** ones carry a coloured badge and a coloured edge.
  Normal and low ones do not, on purpose — if everything is urgent, nothing is.
- **Expired** notices drop off the list automatically. They are never deleted;
  tick **Show expired** to read them again.

Opening the page marks everything on it as read. You do not have to click each
one.

If you can post (that is `manage_settings`, the same permission as faction
settings), **New announcement** takes a title, a message in markdown, a
priority, an optional pin, and an optional hide-after time. Everyone on the
roster gets a notification except you. You can also see **who has read it** —
the list shows the whole roster, so the useful part is who has not.

You can edit only your own announcements. You can remove your own, and with
`manage_settings` you can remove anybody's.

If your faction has connected a Discord server and routed **Announcement
posted** to a channel (§8.6), posting one also drops it into that channel —
title and author, not the whole message. Editing it afterwards does not update
what Discord already received.

---

### 5.10 Activity — what the faction has been doing

**Activity** is the faction's timeline: entries, withdrawals, announcements,
strikes and roster changes, newest first. Filter it to one kind with the
buttons across the top.

**You only ever see what you could already see.** Withdrawals and strikes that
are not yours are hidden unless you hold the permission for them, and roster
history needs `view_audit_logs`. The feed does not show you anything a normal
screen would not.

Anonymous entries appear as **The faction** rather than a name, because that is
who they belong to.

This is the in-app timeline, and it is separate from Discord posting (§8.6).
The feed narrows itself to what you are allowed to see; a Discord channel shows
the same message to everyone in it. Choose which channels get what accordingly.

---

### 5.11 Operations — logging a job you did together

You and three others hit the bank. The cash and the gold are in one person's
pockets, and now four people have to log four numbers that add up. **Don't.**
Open **Operations** and log it once.

Fill in what it was (*Pacific Standard*), the kind, roughly where and when, add
everybody who was on it, and list what came back — one line per item.

**Shares.** Everybody starts on 1, which splits it evenly. Give somebody 2 and
they take twice as much as somebody on 1. You don't have to make anything add
up to 100.

**Faction cut.** If your faction keeps a percentage, type it in. It comes off
the top before the crew split, and it counts for nobody — it does not put the
person filling in the form at the top of the leaderboard.

**Check the split before you log it.** The bottom of the form shows exactly
what each person will be credited with, worked out by the server. Every
hundredth is handed out, so the shares always add back up to the haul.

Press **Log it** and everybody's share is written into the books as a normal
entry — it counts for quotas, the leaderboard and the treasury like anything
else you log.

**Got it wrong?** Somebody with *Revert Operations* can take the whole thing
back out in one go from the card, and then you log it again with the right
numbers. You cannot edit one person's share on its own — that is how a split
stops adding up.

## 6. For leaders — running the faction

These sections appear only if your role or rank grants them. The permission
names match what admins see in the rank editor (§8.4).

### 6.1 Members (`manage_members`)

The roster — who's in, sorted by rank with admins always on top.

**Columns:** name (in-game, falling back to Discord name), rank, entries,
last activity ("never" is the loudest number on the page), joined date,
active strikes.

- **Add member** — by Discord ID, or by searching a name. Someone registered
  by Discord ID who hasn't signed in yet shows as **provisional**: their row
  is a full member row (holds entries, payouts, strikes), it just has nobody
  behind it yet. Their inactivity clock doesn't run, and their names can be
  renamed. The moment they first log in, everything lands on their account.
- **Remove member** — takes them off the roster. Their entries stay in the
  history.
- **Set rank** — pick from the faction's defined ranks (§8.4). An unknown
  rank can't be set.
- **Promote/demote admin** — admins and superadmins only; the admin seat is
  never a rank permission.
- **Edit in-game name** — the name lives on the *person*, not the
  membership, so fixing it here fixes it in every faction they're in. The
  dialog says so, and the audit log records the old and new names.
- **Kick suggestion** — a red badge on members whose **active strikes**
  reached a threshold the faction configured (§8.4). Nothing automatic
  happens — the flag is the reminder, the decision is yours.
- **Member notes** — on each member's profile, admins can write private
  notes categorized as general / performance / discipline / positive /
  promotion, and flag notes for follow-up. **The member can never see these
  notes — not even their existence.** Note *contents* are also kept out of
  the audit log, which admins share; only the category is logged.

### 6.2 The member profile

Tap any member's name (from the roster, leaderboard, or an entry row). One
page with everything the faction knows about them:

- **Identity card** — avatar, in-game and Discord names, rank, join date,
  admins also see active strikes.
- **Contribution stats** — total contributed, entry count, average per entry,
  most-used item type.
- **Payout stats** — total received, count.
- **Streak** — current and best, plus whether they've logged today.
- **Performance score** (0–100) — a blend of quota hit rate, consistency,
  volume relative to the faction's top contributor, streak, and time in the
  faction. It's computed on the spot and *relative to this faction* — 100
  means "leads this faction", not "contributed a lot in absolute terms".
- **Quota progress** — every active quota that involves this member, and
  their contribution this period.
- **Activity heatmap** — the largest element on the page: an enlarged,
  accent-tinted, GitHub-style grid of the calendar year. Darker days mean
  more logged; hover or tap a day for the exact count, and a "best day"
  callout marks the single biggest day of the year. Pick the year at the
  top.
- **Recent entries / payouts received** — the last 20 of each.
- **Strike history** — every strike ever, including revoked and expired ones
  (leaders' view; the faction-wide list hides those by default).
- **Notes** — the private admin notes (§6.1), if you hold `manage_members`.
- **History** — join/leave/rank changes pulled from the audit log
  (`manage_members`, or your own history).

### 6.3 Quotas (`manage_quotas`)

Settings → Quotas — create, edit, deactivate and delete targets.

**Creating one:** item type · target amount · period (weekly / monthly) ·
start date (the quota does nothing until it starts) · **scope**:

- **Faction-wide** — all contributions sum into one target.
- **Everyone individually** — the same target measured on each member
  separately. Every member sees their own bar; nobody's progress depends on
  anybody else.
- **Per member** — a target pinned to one member. Only that member's entries
  count, and only their name is on it.

Only one *active* quota can exist per (item type + period + scope) —
deactivate the old one first. Editing works per field; deactivating freezes a
quota without deleting it.

**History:** the history button on each quota shows **every completed period
since it began** — dates, amounts, met or not — plus a summary line ("9 of 12
periods met"). No more one-week memory.

**Missed periods stay visible:** when a period ends short of its target, the
dashboard keeps a card listing it (item, period dates, achieved vs. target)
until the *next* period also ends. A quiet failure can't quietly disappear.

### 6.4 Expenses (`manage_expenses`)

Treasury → *Running Expenses*: warehouse rent, utilities, supplies — costs
that leave the vault but belong to **no member**.

- **Record an expense:** item (what was spent), amount, category, date, and
  an optional note ("August warehouse rent"). The date can't be in the
  future — a cost was paid when it was paid.
- **Categories:** warehouse / utilities / supplies / other — they exist so
  the budget bars and category totals mean something. Use *other* rather than
  shoehorning.
- **Effect:** immediate. There's no approval step for expenses — money spent
  is spent. If something must be approved first, do the approving in Discord
  and record the expense after.
- **Budget bars:** the faction can set a monthly cap per category (§8.4). The
  bars show this month's spending against the cap — green below 80%, amber
  approaching, red over.
- **Editing/deleting** is possible for `manage_expenses` holders; deletes are
  soft (§11) and audited.

**Expenses are not payouts.** If a member receives it, it's a withdrawal. If
the landlord receives it, it's an expense.

### 6.5 Withdrawals (`manage_payouts`)

Everything from §5.4, plus:

- **Create a withdrawal for another member** — the recipient picker is the
  roster.
- **Settle requests** — approve, complete, or reject anything pending. You
  may settle a request you raised yourself; that's by design, not an
  oversight.
- **Even split** — pick an item type and a total; the app distributes it
  evenly, rounded down to the cent, with the remainder staying in the vault
  (the result tells you the per-member share, the total distributed, and the
  remainder). Default is the whole roster; tick **Selected members** to split
  across a picked crew — provisional registrations are unchecked to start.
- **Edit** — amount, description, date — but **not** once a withdrawal is
  completed or rejected: those are part of the ledger.
- **Delete** — possible at any status, soft-deleted and audited.
- **Vault verification** ("Kassza-ellenőrzés") — the dispute killer:
  1. Count the real stash.
  2. Record it: item type, counted amount, date, optional note.
  3. The app derives what the ledger says the vault **should** have held on
     that day (entries − completed withdrawals − expenses, up to that date)
     and shows the **variance**: green *matches*, or red *off by X*.

  Nothing is adjusted automatically — a variance is information, and if it's
  real, you investigate and then correct the ledger with the appropriate
  entry, expense or withdrawal. Every count is audited.

### 6.6 Laundering (`manage_laundering`)

Treasury flows through the laundering desk for one job: **convert one
currency into another** — dirty in, clean back.

- You type **both amounts**: what went in and what came back. There is no
  configured rate, because the cut depends on who did the wash and what they
  agreed. The screen shows the resulting percentage so you can sanity-check
  before submitting.
- Both sides book against **the faction itself** — no member is charged or
  credited, no score moves, and the vault ends up correct.
- The source balance is checked: you can't launder money the vault doesn't
  hold.
- Currencies only — converting counted goods would be inventory correction
  wearing a laundering costume.

### 6.7 Crafting (`manage_crafting`, `craft`)

Factions make things. Before this screen existed, recording that meant a
withdrawal for every component and an entry for the result — by hand, every
time, and one of them eventually wrong.

A **recipe** says it once. Running it writes every movement in a single go, or
none of them.

**Two permissions, on purpose.** `manage_crafting` writes the recipes;
`craft` runs them. What a craft costs the faction is a leadership decision;
pressing the button is the shop floor. Give `craft` out widely — somebody who
holds it can spend materials, but cannot change what they are worth.

**Writing a recipe.** Name it, then list what goes in and what comes out.
Several of each is fine: a recipe can take three materials and produce a
product plus scrap. An item type may appear on both sides — burning 10 crates
to make 6 better ones is a real thing and the app does not forbid it.

**Who the output counts for** is the one choice worth thinking about:

- **Nobody** (the default) — the vault moves and no leaderboard does. Right
  for anything the faction already owned, and the same treatment laundering
  gets.
- **The crafter** — counts toward their quota and their leaderboard position.
  Only for recipes whose materials are genuinely hard to come by. A recipe
  that credits the crafter and takes cheap inputs can be run in a loop to farm
  a quota, and the app will not stop somebody doing that.

**Running one.** The bench shows each recipe as a card: every material as
*needed / held*, the short ones in red, and how many the vault can currently
make. Ask for more than one and every number on the card scales with it. If
the materials are not there the button is simply off — the screen refuses
before you fill anything in, which is the whole point of it.

**What actually happens.** Each material leaves the vault as a completed
withdrawal booked against the faction, and each product arrives as an entry.
Nothing is a special kind of record, so every balance, report and export
counts a craft correctly. Two people crafting from the same materials at the
same moment queue up rather than both spending the same stock.

**Reverting.** History lists every craft, with what it consumed and what it
produced. `manage_crafting` can revert one: the materials go back, the product
comes out, both together. The craft stays in history marked reverted, and it
can only be done once.

A revert is refused if the product has already been spent — putting it back
would drive that balance below zero, and a correction should not be the thing
that does that.

**A craft cannot be taken apart by hand.** Its entries and withdrawals refuse
to be edited or deleted individually, and point you at Revert instead. Undoing
one half and not the other would either hand the faction free materials or
destroy the product it paid for.

### 6.8 The map (`manage_map`)

An interactive map of the city with the faction's own marks on it: stash
spots, meeting points, turf, supply runs. Every member can open the screen —
what they find on it is the question, and the answer is *maps*.

**A map is a named set of marks.** "Robbery routes". "Where friends live".
"Turf". A faction keeps as many as it wants, and each one decides who may open
it. That is the whole permission model: **you can see, and change, exactly the
marks on maps you can open.**

The panel on the right lists them. The eye beside each one shows or hides it
without changing anything — that is your own view, not a setting. The number
is how many marks it holds. A padlock means the map is restricted.

**Who can open a map** is a rank, set when the map is made:

- *Everyone in the faction* — the default.
- *Underboss and above* — visible to the Underboss, the Boss, and faction
  admins. Invisible below, and that means genuinely absent: a mark you may not
  see is never sent to your browser at all, not merely hidden on screen.

Visibility runs upward only. There is no way to hide a map from your
superiors; faction admins and superadmins see every map.

You cannot restrict a map to a rank above your own — you would not be able to
open it afterwards, and there would be no way back through the app.

**Drawing.** With `manage_map`, click a map's name in the panel to aim at it,
then pick Point, Route or Area:

- **Point** — one click. A stash, a meet, a door.
- **Route** — click each turn. Two or more.
- **Area** — click each corner. Three or more.

Press **Done** and name it. Each mark can take its own colour and an emoji;
leave the colour alone and it takes the map's, so a whole map recolours in one
place.

**Paste coordinates instead.** This is the part that beats a screenshot in a
Discord channel. Run `/coords` in game, copy the line, paste it into the box
in the side panel, press Place. The mark lands exactly where you stood —
including which floor, which a click on a flat map can never say. It reads
`-1037.2, -2737.5, 20.1` and `vector3(...)` and most of what other scripts
print.

**Deleting a map deletes everything drawn on it.** The confirmation says how
many.

**If marks land in the wrong place**, the map image and the game's coordinates
are out of step — that is one setting on the server, not something you did.
Hover anywhere and the coordinate under the cursor is shown in the bottom-left
corner; send a screenshot of that over somewhere you know the real coordinates
of, and whoever runs the instance can correct it.

### 6.9 Strikes (`manage_strikes`)

Formal warnings. Issue from a member's profile or the Strikes view.

- **Severity:** warning / minor / major — each with its own expiry length set
  in Faction Settings (majors are typically configured to never expire).
- **The member always sees their own strikes.** Issue nothing you wouldn't
  say to their face.
- **Lifecycle:** `active → appealed → back to active or revoked`. *Revoked*
  and *expired* are final — no reinstatement, so the record can't be quietly
  rewritten. Reason and severity also can't be edited after issuing; only the
  outcome can.
- **Expiry is evaluated at read time** — a strike past its expiry shows as
  expired even though nothing wrote to it. Use *effective status* on screen.
- **The faction list defaults to what still counts** against members; the
  status filter (All statuses / revoked / expired / …) shows the full
  history. A member's own profile always shows their complete history.
- Nobody can issue a strike on themselves.
- **Escalation:** when a member's active strikes of a severity reach the
  faction's configured threshold, the roster shows a **Kick suggestion**
  badge (§6.1).

**If strikes are routed to Discord** (§8.6), issuing one posts the member's
name, the severity and the reason into that channel. Everyone who can read the
channel reads it. Pick a leadership-only channel, or leave strikes unrouted.

### 6.10 Audit logs (`view_audit_logs`)

The app's memory of who did what: actor, action, entity, timestamp, and
before/after values for changes. Filterable and paginated. It is
append-only — no editing, no deleting, for anyone. See §10.

### 6.12 The vehicle registry (`manage_vehicles`)

Every vehicle the faction keeps track of, in one searchable list. Anyone in the
faction can open it and look a plate up; changing what is in it needs
`manage_vehicles`.

**The table** shows plate, make and model, colour, owner, year and status.
Click any row for the full card, with the notes and the history.

**Search is one box** over the four things you actually have in front of you:
plate, owner, make, model. It matches part of a word, so `45AB` finds
`45ABC123` and `vega` finds anything owned by Marco Vega — including vehicles
whose owner is a member of the faction rather than a typed name.

**Filters** sit beside it: status and category, with the number of vehicles in
each status counted over the whole registry rather than the page you are
looking at.

**Status** is a fixed list, so that it means the same thing to everyone: in
service, in repair, impounded, stolen, sold, scrapped. Beside it you can write
a line of detail — "impounded at Mission Row, out on the 14th". The status is
what colours the row, so a registry can be read down its right-hand edge.

**The owner is either a member or a name.** Pick somebody from the roster and
the link survives them changing their name; type a name for anyone who is not
on it — an ally, a business, somebody you only half know.

**Plates are unique.** The app refuses a second record for a plate it already
holds, whatever the casing, and points you at the record that exists. Two cards
for one car is the thing a registry is for preventing.

**History** on each card says who added the vehicle, who changed it, when, and
exactly what changed — "colour: Black → Red". Only the fields that actually
moved are recorded, so the one change you are looking for is not buried. You
need `manage_vehicles` or `view_audit_logs` to see it: whoever may change a
record may see who changed it before them.

**Deleting is permanent.** If the car is simply gone, set it to sold or
scrapped instead — that keeps the record and its history.

**Discord.** Adding and deleting a vehicle can both be announced in a channel,
like the rest of the activity — switch them on under Settings → Discord. The
message leads with the plate.

---

### 6.11 The price calculator (`manage_prices`)

Somewhere to look up what something costs, so nobody has to do the maths in
the middle of a deal. Every member can open it and build a quote; changing
what things cost needs `manage_prices`.

**Calculator.** Pick the buyer, add the items, read the total. If a product has
extras — a suppressor, an extended magazine — they appear as buttons under the
line; tick the ones being sold and the price follows. **Copy for Discord** puts
the whole quote on your clipboard, itemised, ready to paste to the person
you are talking to.

**Price list.** One price per item, and the currency it is quoted in, so
"$40,000 clean" and "$40,000 dirty" cannot be confused for each other. A price
can carry a **floor** — the lowest it should ever go for. Discounts that fall
under it are flagged in red, not blocked: the app tells you, and you decide.

Retiring a price keeps it and hides it from the calculator. Deleting it takes
its add-ons with it.

**Bulk discounts** are rungs: "5 or more, 10% off". Set them for everything, or
for one item. An item with its own rungs ignores the faction-wide ones
completely — so a ladder on pistols replaces the general one rather than
stacking with it.

**Partners** are the crews you sell to on standing terms, each with their own
discount. Pick one on the calculator and the discount applies to every line.
Everyone else is a walk-in at full price.

Two things worth knowing about the numbers:

- **Discounts add up, they do not compound.** An ally at 15% buying in bulk at
  10% off pays 25% less. Not 23.5% — you have to be able to say the number out
  loud and have the buyer's own arithmetic agree with it.
- **Everything in one quote has to be in the same currency.** Mixing them would
  need an exchange rate, and the app will not invent one. Quote them
  separately.

Deactivating a partner is better than deleting them where the deal is only
paused.

### Booking a sale (`sell`)

When the deal is done, press **Sold**. The payment goes into the treasury and
the goods come out of it, in one act — no separate entry, no withdrawal per
item. This is the part that removes the double bookkeeping.

It asks two things first:

- **Whose contribution it counts as.** *Nobody* moves the treasury and leaves
  every leaderboard alone, the way laundering does. *The seller* credits you,
  as a logged entry would. Pick whichever matches how your faction measures
  work.
- **A note**, if the sale needs one.

**Selling more than the vault holds is allowed.** The app books it and tells
you what is short, rather than refusing in front of the buyer — usually it
means the stock is real and the books are behind.

**Sales** lists what has been booked, newest first. **Revert** on any of them
takes the payment back out and puts the goods back, together. Reverting needs
`manage_prices`, not `sell`: the till takes money in, and moving it back out is
a different decision. It is refused if the money has already been spent — the
vault cannot give back what it no longer has.

While a sale stands, the rows it wrote cannot be edited or deleted one at a
time on the entries or withdrawals screens. Half an unpicked sale is money
received for goods that never moved, and the app will not let the books say
that. Revert the sale instead.

### What the deal is worth

If you have written crafting recipes and priced their materials, the
calculator also shows **cost** and **margin** — what the goods cost the
faction to make, and what is left after the discount. Nothing extra to enter:
the recipe already says ten steel makes a pistol, and the price list already
says what steel costs.

Three things it will not do:

- If any material in a recipe has no price, it shows **no cost for that item
  at all** rather than a number that looks like a margin and is not one. It
  says so under the total.
- If two of your recipes make the same thing, it uses the **cheaper** one.
- The margin is a percentage of the price, not of the cost — "we keep 40% of
  what they pay".

**Who sees it is up to you.** In the price list, *Who sees cost and margin*
sets a rank: everyone, or only that rank and above. A soldier at the counter
does not need to know the markup, and a screenshot from them should not reveal
it. Below the line, the figures are not hidden on screen — they are never sent
to that browser at all.

### Selling in two kinds of money

If your faction quotes some things in clean money and some in dirty, set the
**exchange rates** in the price list. Then the calculator gets a *Quote in*
picker: one basket, priced in whichever money the buyer is paying with, with
each converted line marked.

Each direction is its own rate. Dirty → clean does not give the app clean →
dirty, on purpose: washing money takes a cut, so the reverse is a different
deal and you should be the one to say what it is.

Without a rate the app refuses rather than inventing one, and the message names
the two currencies so you know which rate is missing.

---

## 7. Reports, exports and printing

*Reports* (`view_reports`).

- **Period summary** — totals, entry counts, active members and per-item
  breakdowns for a chosen period (this/last week, this/last month, last 30/90
  days, all).
- **Period comparison** — two periods side by side with the deltas.
- **Growth** — period-over-period: entries, amounts, active members, averages
  (admin).
- **Print** — the print button strips the sidebar, header and buttons and
  produces a clean sheet. Leaders print the monthly summary for RP meetings.

**CSV exports elsewhere:** entries (filtered or personal, §5.3) and the quota
report (dashboard) cover the data side.

---

## 8. Settings — configuring the faction

*Settings* is tabbed. Which tabs you see depends on your permissions. faction
admins reach everything; some tabs also open for specific rank permissions.

### 8.1 Item types (`manage_item_types`)

The faction's vocabulary: Dirty Money, Clean Money, Lock Picks, …

- Each has a **name**, a **unit** ($ for currencies, pcs for goods), an
  optional **image URL** (an icon shown everywhere the item appears), and an
  **active** switch.
- Deactivate instead of delete — old entries keep their type readable.
- **Export/Import CSV** (§8.5).

**Icons and categories.** Each item type can carry an **emoji** and a
**category** (cash, goods, contraband, other). The emoji shows wherever the
item appears; the category tints the tile behind it, so a mixed table can be
read by kind at a glance. A pasted image URL still wins over the emoji if you
have artwork. Neither changes any number — only `isCurrency` does that.

### 8.2 Quotas (`manage_quotas`)

See §6.3.

### 8.3 Customization (`manage_customization`)

- **Accent color** — the faction's brand color, used for navigation, primary
  buttons, glows and charts. It never colors a number: red means negative,
  amber means warning, green means met — no matter what the accent is.
- **Custom entry fields** — extra fields on the entry form (name + required
  flag), stored with every entry.

### 8.4 Faction settings (`manage_settings`)

- **Item icons and categories** — give each item type an emoji and a
  category (cash, goods, contraband, other). The emoji shows wherever the
  item is listed, and the category tints the tile behind it so a mixed
  table can be read by kind at a glance. A pasted image URL still wins over
  the emoji if you have one. Neither changes any number.
- **Ranks** — the hierarchy, each with a level (lower = higher) and the
  permissions it grants. The rank editor shows every permission in the system
  (§4). Deleting a rank clears it off members automatically. *Granting
  permissions is admin-only, even for members who can otherwise edit ranks.*
- **Inactivity threshold** — days without an entry before the dashboard flags
  a member. Recent joins and already-struck members are excluded.
- **Strike expiry** — days per severity; empty means never expires.
- **Strike escalation** — the active-strike count per severity that flags a
  member for kick consideration on the roster. Empty disables that severity.
- **Expense budgets** — monthly caps per expense category; the treasury bars
  read these. Empty = no cap.

### 8.5 CSV import/export (per tab)

The item types, quotas and ranks tabs each have **Export CSV / Import CSV**.

- **Export** — a spreadsheet-friendly file of the current configuration.
- **Import** — applies a file back:
  - *Item types* upsert by name: existing names update unit/currency/active,
    new names are created.
  - *Quotas* validate every row exactly like the create form — item type must
    exist, target member must be in the faction, duplicates are refused, and
    the scope column is honored.
  - *Ranks* **replace the whole hierarchy** — with the same rails as manual
    editing (max 20 ranks, unique names/levels, known permissions only,
    removed ranks cleared off members). An import with no valid rows is
    refused rather than allowed to wipe the ranks.
- Row-level problems don't abort the import: skipped rows are reported with
  their line numbers and reasons.

Practical use: **clone one faction's setup into another** — export, tweak
names, import.

### 8.6 Discord (`manage_discord`)

Post what happens in the faction straight into your own Discord server.

**Connecting.** Press **Connect a Discord server**. Discord asks which server
and shows what the bot is asking for — seeing channels, sending messages, and
showing embedded boxes. Nothing else: it cannot read your conversations, and
it has no access to anything outside the channels you point it at. You need
**Manage Server** on the Discord side to add a bot; if the button does not
appear there, ask whoever runs your Discord.

You come back to this screen and it says which server you are connected to.

**Choosing channels.** Each kind of activity — an entry logged, a withdrawal
approved, a strike issued — gets its own dropdown. Pick a channel and it saves
straight away. Anything left on **Off** is not sent, and everything starts on
Off: nothing is posted until you decide it should be.

You can route them all to one channel, or split them up — the ledger to a
quiet log channel, strikes somewhere only leadership reads.

**Activity:**

| | |
|---|---|
| Entry logged | somebody added to the vault |
| Withdrawal requested / approved / rejected / paid out | each state, separately |
| Expense recorded | money that left the vault with no member receiving it |
| Strike issued | discipline |
| Announcement posted | title and author |
| Member joined / left | roster changes |
| Laundering completed | one currency converted into another |
| Something was crafted | the recipe, what it used and what it made |

**Corrections and removals**, listed separately underneath:

| | |
|---|---|
| Entry removed | including a member undoing their own within 5 minutes |
| Withdrawal removed or cancelled | a leader removing one, or the requester taking their own back |
| Expense removed | |
| Strike revoked | it no longer counts against the member |
| Announcement removed | |
| A craft was reverted | the materials went back and the product came out |

These have their own channels for a reason. A log that only shows things going
*in* can be worked: log it, take the credit, quietly remove it later. Routing
the removals — even to a channel only leadership reads — closes that. The
message says whose row it was, not just who removed it.

The **send icon** beside each row posts a test message to that channel, so you
can confirm it arrives before waiting for something real to happen.

Once a channel is set, the real thing posts by itself: somebody logs an entry,
the message appears. Nothing is ever sent for an event you left on Off.

**Message language** is English, and the picker is switched off for now. Unlike
the app, a Discord message has no single reader — everyone in the channel sees
the same text — so it cannot follow each member's own language. The faction
will choose one once there is a second language to choose.

**Reminders.** Underneath the channel list, **Reminders** are messages the bot
posts on a schedule — quota deadlines, rent night, meeting times. Up to 50 per
faction, shared by everyone who can manage Discord rather than 50 each.

Each one takes a channel, a label for this list, the message itself, and when:

- **Once** — a date and time.
- **Every day** — a time.
- **Every week** — a time and the days.
- **Every month** — a time and the day. Pick 31 for the last day; short months
  are clamped to their last day, never skipped.

Times are **server time**, the same clock quotas reset on. A reminder set for
20:00 arrives within a minute of it — the app checks once a minute rather than
watching the clock continuously. The list shows when each one next goes out, and the **send icon** posts it right now without
disturbing that schedule — useful for the one that should have gone out an
hour ago, and the only way to see what it looks like without waiting for
Friday.

Switch a reminder **off** to pause it; its schedule is kept. Delete it to be
rid of it. A one-off switches itself off after it goes, so you can see it went
and reuse it later. If a send fails, the reason appears on the reminder in red.

**Tagging.** Each reminder can ping **roles** from your Discord server and
**members** from your roster, picked from a list — no typing ids. Leave
everything unpicked and the reminder posts quietly.

- If some roles are greyed out with a warning about reconnecting, your server
  was connected before the bot asked for permission to ping roles. Press
  **Connect a different server** and pick the same one again — Discord does not
  widen an existing bot's permissions on its own. (Switching the role's own
  *"allow anyone to @mention this role"* on in Discord also works.)
- Members are tagged from your faction roster, so you pick by in-game name. If
  someone leaves, the reminder keeps working and simply stops tagging them.
  Somebody who was added by Discord ID and has never signed in is tagged like
  anyone else — most of a faction never opens the app, and the ping is for them
  more than for anybody.
- **A tag only reaches somebody who is in your Discord server.** A mention of
  someone who is not a member of it renders perfectly in the channel and
  notifies nobody, which is impossible to spot by looking. Saving a reminder
  checks this and names anybody it applies to.
- **@everyone cannot be pinged**, even if you type it into the message. The bot
  was never given that permission, and the message is sent pinning only the
  roles and people you picked.

**What arrives** is a titled box with your message, and the date written so
that everyone reading sees it in their own timezone — useful when somebody is
playing from another country.

**Think about who reads the channel.** Inside the app, a withdrawal or a
strike is only visible to the people whose permission covers it. A Discord
channel has no such thing: everybody who can read the channel reads the
message. Strikes and withdrawals are the two to place carefully — a channel
your whole faction sees will show your whole faction who got disciplined.

**If it stops working.** A red bar appears here with the last failure. Almost
always it means the bot was removed from the server, or lost access to a
channel it used to be able to post in. Reconnecting fixes the first; fixing the
channel's permissions in Discord fixes the second.

**Disconnecting** stops the posting and forgets your channel choices. The
dialog offers one extra, switched off: **also remove the bot from the server**.

Leave it off if that same bot does anything else in your Discord — a
whitelist, roles, anything at all — because removing it stops that too. Off
means the bot simply stays where it is, silent and harmless, and any Discord
admin can kick it by hand later (Server Settings → Integrations, or right-click
→ Kick). Turn it on and the bot removes itself as it disconnects. If Discord
refuses, you are told so rather than left assuming it is gone.

**If the whole section says there is no bot set up**, that is the app, not your
faction: Discord delivery is switched off for this installation. Send a feature
request through Support (§5.8) if you would like it turned on.

---

### 8.7 Features this faction uses

Not every faction wants every part of this app. A faction that only wants plates
and a map should not be reading a menu of twenty-three screens.

In **Settings → Features this faction uses**, tick what you need. Whatever you
untick disappears from the menu for everybody, and its permissions disappear
from the rank editor above — which is what makes setting up ranks short.

**Nothing is deleted.** A switched-off feature stops accepting new records and
keeps showing the old ones to anything that asks, and ticking it again finds
everything exactly where you left it. Turn something off for a month and back
on, and your ledger is untouched.

Only a faction admin can change this.

## 9. For superadmins

### 9.1 Factions

Create, edit and **deactivate** factions (deactivation hides all data but
keeps it for history), and appoint the first admin. A deactivated faction's
roster and ledger are invisible to everyone except superadmins.

When creating or editing a faction you can also set a **logo image URL** — it
appears in that faction's dashboard masthead alongside its accent color, so
each faction's app feels like its own rather than a shared shell.

### 9.2 Users panel

Everyone the system knows: signed-in users, plus **provisional registrations**
pinned to the top and labelled. For provisional rows you can rename and
remove — they're placeholders waiting for their first sign-in. Everything
else about a person is faction business, not server business.

### 9.3 Global leaderboard

The whole server's top contributors across factions, one row per
faction-membership. This deliberately crosses the isolation boundary every
other page enforces — it's superadmin-only for that reason.

### 9.4 Being a superadmin inside a faction

You can enter any faction and act there, and you hold every permission. Two
rules keep the ledger honest:

- **You can't log an entry on yourself** in a faction you're not a member of —
  a contributor must have a roster row, or the leaderboard has no row for
  them. Log it for a member or anonymously instead.
- Superadmin with no factions? You're exactly the person who creates the
  first one — the app gives you the management screens instead of an empty
  dashboard.

### 9.5 Support inbox

Every ticket from every faction lands in **Support Inbox**, and the sidebar item
carries a badge with the number still open. The list opens on the open ones
regardless of date — it is a work queue, not an archive. Filter by status and by
type across the top.

Each ticket shows who sent it, which faction they were in, and the full message
— no clicking through to read it.

- **Resolve** — you dealt with it.
- **Decline** — you are not going to do it. Both open a box for an optional
  reply, which the reporter sees on their own ticket. A decline with no reason
  is the one worth writing a line for.
- **Delete** — removes the ticket permanently, for you *and* for the person who
  sent it. Unlike the rest of the app this is a real delete, not a soft one: a
  ticket is correspondence, not ledger history. It cannot be undone.

A ticket the reporter withdrew shows as **Withdrawn** and needs nothing from
you.

### 9.6 Backup

**Download** gives you one file holding the entire database: every faction,
every entry, every withdrawal, every member, every strike. **Restore** takes
such a file and puts it back.

Nothing is kept on the server. That is on purpose — a copy that lives on the
machine it is protecting is not a backup, and a folder of database dumps
sitting beside the database is the thing an intruder would want most. It has a
cost, and it is yours to carry: **the backup is exactly as fresh as the last
time you clicked Download.** Somebody has to do it, and nobody will be
reminded.

So: download regularly, and put the file somewhere else. Another machine,
another drive, a cloud folder — anywhere the server cannot reach.

The panel at the top says whether backups can run at all. If it reports that
the tools are missing, or that it is pointed at the connection pooler, the
buttons will not work until whoever deploys the app fixes it — the message
names what to change.

**Restoring replaces everything.** Anything entered between the moment that
file was made and now is gone, with no way back. Because of that:

- You have to type `RESTORE` before the button will do anything.
- The file is checked before a single row is touched. Anything that is not a
  backup this page produced is refused outright.
- The server takes a copy of the current database first, automatically, and
  refuses to restore at all if that copy fails. Where it put it is in the
  message you get at the end — write it down if the restore turns out to be
  the wrong file.
- Either the whole file goes in or none of it does. A restore that fails
  halfway leaves the database exactly as it was.

One thing to expect: after a restore, the accounts that exist are the accounts
in the file. If yours is not one of them, you will be signed out.

---

## 10. The audit log — who did what

*Audit logs* (`view_audit_logs`).

Every meaningful write lands here: entries created/edited/removed,
withdrawals and their status changes, expenses, quota changes, rank and
permission edits, strikes issued and settled, member additions and removals,
settings changes, vault counts, CSV imports. Each row carries the actor, the
action, the entity, when it happened, and before/after values for changes.

- **Append-only.** Nobody — not even a superadmin — can edit or delete a row.
- Note contents (§6.1) are deliberately *absent*; the log is readable by
  every admin, so private notes only log their category.
- This is the page that ends "that's not what happened" arguments. Check it
  before arguing.

---

## 11. Good to know — rules the app never breaks

- **Amounts are game amounts.** Money and quantities are formatted the same
  way everywhere, in every language — a thousands separator never turns into
  a decimal sign. A comma that means different things in two languages is a
  real way to mis-pay someone.
- **Balances are always derived, never stored.** Vault = entries in −
  *completed* withdrawals − expenses. There is no stored balance that can
  drift, and pending/approved withdrawals haven't left the vault yet.
- **Nothing is truly deleted.** Removed entries, withdrawals and expenses are
  marked deleted — they vanish from the numbers but stay in the audit trail.
- **A craft is all of its parts or none of them.** The rows a craft wrote
  cannot be edited or removed one at a time; reverting the craft undoes both
  sides together, or nothing happens.
- **The ledger doesn't record the future.** Entry, payout, expense and check
  dates can't be ahead of today.
- **Anonymous entries belong to the faction.** They count toward the vault
  and faction-wide quotas but never toward any person's score or ranking.
- **Dates are your local days.** Quota weeks reset Monday, months on the 1st,
  in the server's local time — not UTC.
- **Data isolation is absolute.** Members of one faction can never see
  another faction's data. The only cross-faction page is the superadmin
  global leaderboard.
- **Colour means one thing or nothing.** Red = negative/variance, amber =
  warnings, green = met/positive. The faction's accent color is decoration —
  it never colors a number.
- **Private notes stay private.** A member can see their own strikes; they
  can never see the notes written about them.
- **Only a superadmin can copy the database.** The backup page is the one
  place the whole server leaves in one piece, so it is the one page no faction
  admin can reach, in their own faction or anywhere else.
- **A hidden map mark is absent, not hidden.** Marks on a map your rank
  cannot open are never sent to your browser, so there is nothing to find
  by looking harder. The same rule blocks editing one: you can only change
  what you could already see.
- **Discord is told, never asked.** The bot only posts. It reads no messages,
  takes no commands, and nothing in Discord can change a number here.
- **A Discord problem is never your problem.** If the bot cannot post, the
  entry, withdrawal or strike still happened and still saved. The message is
  the only thing lost, and the failure is shown in Settings → Discord.

---

## 12. Quick answers

**I logged an entry with the wrong amount.**
Undo it yourself within 5 minutes — the trash button on your row in Entries.
After that, ask a leader to remove it.

**The undo button isn't on my entry.**
Five minutes have passed, or it isn't yours. Only `manage_entries` holders
can remove it now — hovering the row shows them the controls.

**My dashboard says "waiting for approval".**
You're not in a faction yet. Copy the Discord ID shown on that screen and
send it to your faction admin.

**I changed my character's name.**
Top-right menu → change your in-game name. Your admin can also fix it for
you, and the fix reaches every faction you're in.

**I crafted the wrong thing.**
Crafting → History → Revert. Materials back, product out, in one move.
Anyone with `manage_crafting` can do it. Deleting the rows by hand is
refused on purpose — it would undo one half and not the other.

**The draw buttons on the map are greyed out.**
There is no map to draw on yet. Make one in the panel on the right — the
plus button — then click its name to aim at it.

**Somebody says there is a mark on the map and I cannot see it.**
It is on a map your rank cannot open. Ask whoever drew it; they can move it
to one you can, or widen who may open that map.

**The craft button is greyed out.**
The vault is short of a material. The card shows each one as needed / held
with the missing ones in red. Lower the count, or log what is missing.

**Why can't I see Members / Strikes / Laundering / Crafting?**
Your rank doesn't grant it. Ask your leadership, or have them check the
rank's permissions in Settings → Faction settings.

**Why did my withdrawal not change the treasury?**
Only *completed* withdrawals leave the vault. Pending and approved are
commitments, not payments.

**How do I see last week's quota result?**
Dashboard → "Quotas missed last period", or Settings → Quotas → the history
button on the quota.

**Who spent money from the vault?**
Treasury → Running Expenses: every expense with its category, amount, date
and who recorded it. Budget bars show the month against the caps.

**The vault has less than the ledger says.**
Record a vault count (Treasury → Vault verification). The variance is the
starting point of the investigation, and the count is audited.

**Where do announcements go?**
The **Announcements** screen (§5.9) — pinned, prioritised, with read tracking,
so "quota deadline is Friday" stops getting buried. If your faction has
connected a Discord server (§8.6), new announcements are posted there too.

**Can the app post to our Discord?**
Yes. A leader with `manage_discord` connects your server in Settings → Discord
and picks which channel each kind of activity goes to (§8.6). Nothing is sent
until somebody chooses a channel for it.

**Our Discord channel stopped getting messages.**
Settings → Discord shows the last failure in a red bar. Usually the bot was
removed from the server, or lost access to that channel.

**Can I use the app in Hungarian?**
Yes — globe icon in the header. Everything is translated, and your choice is
remembered.

**Is there a faster way to get around than clicking the sidebar?**
Press Ctrl+K (⌘K on a Mac) anywhere to search for a member, a screen, or an
action.

**Can I put this on my home screen like a real app?**
Yes — your browser's menu has *Add to Home Screen* or *Install App*. It then
opens full-screen, no address bar.

---

*Faction Accountant — self-hosted ledger for FiveM RP factions. Interface in
English and Hungarian.*