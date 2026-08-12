# Forum integration plan

How to make the NodeBB forum (`forum.boardgamers.space`) the discussion layer of the site,
instead of building/maintaining bespoke chat + feedback features.

Status: proposal. Issues covered: #172, #116, #91, #49, #54, #33 (and a note on #34).

## Current state (researched 2026-08)

**Site side**

- Chat is **per-game only**: `apps/web/src/components/ChatRoom.svelte` on `/game/:id`,
  backed by `POST /api/game/:id/chat` (players only), the capped `chatmessages` collection
  (100 MB cap, `{room, author, data.text, type}`), `roommetadatas` for `lastRead`, and ws push
  (`apps/api/app/ws.ts` polls the collection every 250 ms per subscribed room).
- There is **no feedback widget/table** anywhere. The only forum reference in the UI is a
  footer link (`apps/web/src/components/Layout/Footer.svelte`).
- Out-of-band game notifications = **email only** (Mailgun, "your turn" digest,
  `sendGameNotificationEmail`, cron-driven off the `gamenotifications` collection).
  No Discord integration beyond OAuth login-linking.

**Forum side**

- NodeBB **v4.14**, primary store **MongoDB** (`nodebb` db on the same mongo instance),
  Redis for sessions/cache. Runs on the prod box at `127.0.0.1:4567` behind nginx.
- Login is fully federated: `packages/nodebb-plugin-sso-bgs` (PKCE shim over
  `nodebb-plugin-sso-oauth2-multiple`) against our OIDC provider
  (`apps/api/app/routes/oauth2/index.ts`). Forum is a **trusted first-party client**
  (`oauth2.trustedClients`), silent SSO via `prompt=none` works — a logged-in site user
  landing on the forum is transparently logged in there. Identity mapping:
  `objects {_key: "boardgamersId:uid", "<bgsUserIdHex>": <forumUid>}`.
- `apps/api/app/config/db.ts` has `getNodebbDb()` / `nodebbColls()` — a **read-only**,
  fail-safe (`null` when unreachable) handle on the forum db. Today only the dead-user
  cleanup uses it (#255). **Nothing writes to the forum**: no API tokens, no topic/post
  creation, no webhooks.
- The forum's **read API is open** (`/api/topic/:tid`, `/api/categories`, …) and the **write
  API v3 exists** (currently 403 for unauthenticated writes — i.e. write tokens are not
  provisioned yet). Existing categories already include **Comments & Feedback** (cid 4) with
  per-game subcategories (Gaia Project, Powergrid, Container, 6nimmt) and a **Games**
  category (cid 5) with per-game subs.

## What the existing pieces enable — and what needs more

| Capability                                                          | How                                                                                                                                                                                                                                                                                                              | Needs                                                                                                                                                                                                                                                           |
| ------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Logged-in user clicks any forum link, lands logged in               | silent SSO (`prompt=none`)                                                                                                                                                                                                                                                                                       | nothing — works today                                                                                                                                                                                                                                           |
| Site reads forum content (topic lists, recent posts, counts)        | `getNodebbDb()` (read-only mongo) or the public `/api/*` read endpoints                                                                                                                                                                                                                                          | nothing — works today; prefer the HTTP API for anything rendered to users (cacheable, insulated from NodeBB's internal key schema)                                                                                                                              |
| Site **creates** topics/posts (auto-topic per game, feedback posts) | NodeBB **write API v3** (`POST /api/v3/topics`, `POST /api/v3/topics/:tid`) with a server-side token                                                                                                                                                                                                             | an admin **API token** (ACP → Settings → API Access) + a bot/system uid; keep in `apps/api/.env`. Do **not** write to the forum mongo directly — NodeBB keeps derived sets/sorted-sets (scores, unread, notifications) that raw inserts would silently corrupt. |
| Users post from a site widget under their own name                  | (a) deep-link to forum composer (`/compose?title=…&cid=…`) — zero backend; (b) embed a forum page in an iframe — forum session cookie is SameSite=Lax, so SSO works in iframes on navigation; (c) full in-site posting via per-user write tokens — **don't**: token-per-user plumbing for zero gain over (a)/(b) | (a)/(b) nothing new                                                                                                                                                                                                                                             |
| Forum → site callbacks (e.g. notify on reply)                       | NodeBB **webhooks plugin** (`nodebb-plugin-webhooks`) or a tiny custom plugin                                                                                                                                                                                                                                    | new plugin install on the forum                                                                                                                                                                                                                                 |
| In-page comment widget fully embedded in site pages                 | `psychobunny/nodebb-plugin-blog-comments` (the `nodebb-plugin-comments` model — revived 2025-02 for NodeBB v4, BSD-2)                                                                                                                                                                                            | install + site JS snippet; verify cookie/CORS behavior cross-subdomain; theming work                                                                                                                                                                            |

Hard rule: **the only write path to the forum is its HTTP API** (or NodeBB's own UI).
`getNodebbDb()` stays read-only — extending it to writes is the "corrupt the forum db"
footgun, and it bypasses moderation hooks, notifications, and search indexing.

## Per issue: forum or bespoke?

### #172 — Make forums durable → keep as ops work (prerequisite)

The forum is NodeBB on the prod box, supervised outside PM2 (`web`/`api`/…), and it "often
crashes". **Everything below depends on the forum being up**, so this is the prerequisite:
move NodeBB under PM2 (`ecosystem.config.cjs`) with restart-on-crash, plus a health check in
the existing watchdog, and backup coverage for the `nodebb` mongo db. This plan assumes
it gets done first (it also de-risks itself: more forum traffic ⇒ more crash visibility).

### #116 — General feedback widget → **forum**

Don't build a bespoke feedback table. The forum already has a **Comments & Feedback**
category with tags (`feature request`, `bug`, `solved`, `done`) and gives us threading,
moderation, email digests, and "one place to search" for free. A bespoke table would be a
worse, unmoderated shadow of it and one more schema to maintain.

Recommended build (Phase 2, below): a small site widget ("Feedback") that

- reads the latest feedback topics via the forum read API (cached),
- deep-links "New feedback" to `forum…/compose?cid=4` (silent SSO means no login wall),
- explicitly says urgent support belongs on Discord (per the issue).

Optional later upgrade: auto-post structured feedback (page URL, game id, version) via the
write API under a bot uid that @-mentions the author. Needs the API token.

### #91 — Global/lobby chat → **hybrid: site chat stays, forum handles async**

NodeBB is not a real-time chat system (its chat is a minor DM feature; rooms/unread semantics
don't match a lobby). Our chat stack is already real-time (ws push, capped collection,
per-room `lastRead`) and trivially generalizes: allow non-game room ids (`lobby`,
`help`, …) in the chat routes + ws, add a navbar chat entry with unread badge.

But keep the lobby **small and ephemeral**, and make the forum the place where lobby-born
_discussions_ go to be durable: a "Discuss on the forum" link per room that deep-links to the
relevant category, and surface "hot forum topics" in the lobby page sidebar (read API).

This resolves the issue's moderation concern cheaply too: lobby chat is transient (capped
collection) while anything that matters is a forum thread with real moderation tools.

### #49 — Chat rooms on other pages → **split by intent**

"Chat on any page" conflates two things:

- **Ephemeral page chat** (who's on this page right now) → extend site chat rooms as in #91
  (room id derived from the page). Cheap, real-time, no permissions headache: same rules as
  game chat (logged-in users post).
- **Durable per-page discussion** (feedback on a game _type_, strategy, rules questions) →
  **forum**. Each game-type page (`/game/gaia-project` info/open-games pages) gets a
  "Discussion" section: latest topics from that game's forum category (read API, cached) +
  a "Start a topic" deep-link. The per-game categories already exist on the forum.

This is the answer to the issue's permission worry: forum categories have battle-tested
privileges/moderation; site chat keeps its simple "any logged-in user" rule.

### #54 — Game description + open game page → mostly site, forum for discussion

The game description field and player cards (avatars, karma, links) are core site data —
bespoke. But the "improve open game page" part should include a **forum link/topic per open
game**: e.g. auto-create a forum topic when a game goes public ("Game #123: 4p Gaia Project,
join!") so interested players can ask questions before joining. Needs the write API (bot uid).
Cheap alternative for Phase 2: a plain "Discuss this game" compose deep-link, no auto-topic.

### #33 — Discord game notifications → forum covers part; keep separate

Forum notifications cover **forum events** (reply to your topic, @-mention) and email
digests — they can't replace game-turn notifications, which the site already does by email.
Two non-exclusive options:

- If the community lives on Discord, a Discord webhook/bot for "your turn / game started" is
  still its own feature (out of this plan's scope).
- What the forum _can_ absorb for free: **community announcements** ("new game added:
  Container") via auto-posted Announcement topics, which then reach everyone's forum
  notification prefs (email/push) — needs the write API.

### #34 — Social avatars → orthogonal, small win available

NodeBB already receives `picture` in OIDC claims. When #34 lands and users have avatar URLs,
exposing them in the OIDC `picture` claim makes forum avatars follow automatically.
No forum-specific work.

## Recommended phases

### Phase 1 — Links + durability (no writes, lowest risk)

1. **#172**: NodeBB under PM2 + watchdog health check + mongo backup of the `nodebb` db.
2. Site chrome: "Forum" in the navbar; "Discuss" links on game-type pages pointing at the
   matching forum category; footer link stays.
3. Optionally (zero forum config): read-only "Latest from the forum" panel on the homepage
   via the public read API, cached server-side (fail closed if the forum is down).

### Phase 2 — Feedback widget (#116) + open-game discussion (#54 link part)

1. Feedback widget on the site: recent "Comments & Feedback" topics (read API) + compose
   deep-link; copy that urgent support = Discord.
2. "Discuss this game" deep-link on open-game pages; game-type pages list recent topics from
   their forum category.
3. If we want true embedding later: evaluate `nodebb-plugin-blog-comments` on a staging
   forum (cookie/CORS/theming are the risks).

### Phase 3 — Lobby chat (#91) + page rooms (#49)

1. Generalize chat room ids beyond game ids (`lobby`, `help`); navbar chat entry + unread
   badge; own `lastRead` marker per room.
2. Lobby sidebar: hot forum topics (read API); per-room "take it to the forum" links.

### Phase 4 — Write integration (needs API token + bot uid)

1. Provision a NodeBB write-API token (ACP) for a bot uid; store in `apps/api/.env`.
2. Auto-topics: public game created → topic in the game's "Games" category (linked back from
   the game page); releases/announcements → Announcements category (#33's community part).
3. Structured feedback posts from the widget (bot posts, @-mentions the author).
4. Optional: forum → site webhooks (e.g. show "3 new forum replies" on a game page).

Each phase ships independently; 1–3 need **no forum changes at all** (only #172's ops work),
which is why they come first.

## Open questions

- Do we want per-**game-instance** forum topics at all, or only per-game-type categories +
  open-game topics? (Per-instance topics for _running_ games overlap with in-game chat;
  probably only worth it for open/recruiting games.)
- Forum SEO/visibility: forum topics are public; in-game chat is private to players. Keep
  that boundary obvious in the UI ("this posts publicly on the forum").
- Who moderates the lobby chat? (Forum categories already have moderators; site chat doesn't.)
