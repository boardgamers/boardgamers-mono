# AGENTS.md

Guidance for AI agents (and humans) working in this monorepo.

## What this is

Boardgamers — an online board game platform. pnpm workspace, Node ≥ 24, ESM (`"type": "module"`).

| Path               | What                                                              |
| ------------------ | ----------------------------------------------------------------- |
| `apps/web`         | Player frontend (SvelteKit, Svelte 5)                             |
| `apps/admin`       | Admin panel (SvelteKit, modern)                                   |
| `apps/api`         | REST API (Koa + MongoDB)                                          |
| `apps/game-server` | Game engine runner / gameplay API                                 |
| `apps/docs`        | Docs site                                                         |
| `packages/models`  | Shared Zod schemas + Mongo collection definitions (`@bgs/models`) |
| `packages/utils`   | Shared helpers (`@bgs/utils`)                                     |

## Comments

Default to no comment — write self-explanatory code. Only comment the non-obvious: a _why_ (decision, constraint, gotcha), or a workaround for an external bug (link the issue/PR).

## Secrets

Avoid reading env vars & secrets directly, you can store them in files or env and load them, but avoid reading them directly

## Running instances (agent swarms)

Multiple copies of the stack can run side-by-side on one machine — this is how a
coordinator agent gives each of its sub-agents an isolated environment.
**Never run two agents against the default ports/db at once** (they collide and
share `bgs-dev`).

Division of labor:

- **Coordinator**: spawns one sub-agent per worktree. Before spawning, pick a
  unique `<name>`, allocate its IP, and **copy the local env files into the
  worktree** — `.env` is gitignored so the worktree has none:

  ```bash
  IP=$(scripts/instance-ip.sh alloc <name>)       # unique 127.1.X.Y, idempotent
    [spawn subagent with IP, tell it its name]
  for app in api game-server; do
    [ -f apps/$app/.env ] && cp apps/$app/.env .worktrees/<name>/apps/$app/.env
  done
  # (no .env on this machine? give the sub-agent a dbUrl in its task instead)
  ```

- **Sub-agent**: runs the stack from inside its worktree, on the IP it was given:

  ```bash
  pnpm install
  listenHost=$IP dbName=bgs-<name> \
    VITE_backend=$IP WEB_HOST=$IP \
    pnpm dev                                        # web+api+game-server, default ports
  # → http://<IP>:8612   (api 50801, ws 50802, game-server 50803, all on the IP)
  # when done: coordinator runs scripts/instance-ip.sh free <name>
  ```

Rules for the agent:

- Always set `dbName` (e.g. `bgs-<name>`) — otherwise the instance shares the
  default `bgs-dev` db. `NODE_ENV` stays unset (development), so the db is
  actually `bgs-<name>-dev`. Process forking is owned by PM2 (see
  `ecosystem.config.cjs`), not the app, so a direct `pnpm dev` run is always a
  single process that also runs cron (which defaults on in dev).
- **Don't set `dbUrl` if the coordinator gave you an `.env`** — it already
  points at the right Mongo for this host, and `dbUrl` overrides it. If there
  is **no** `apps/api/.env` in your worktree, set `dbUrl` explicitly if the default
  one doesnt work (ask the
  coordinator for the Mongo URL if you don't have one).
- **Mongo**: check `dbUrl` in `apps/api/.env` first — that's the source of truth. In
  the devcontainer it's the compose service (`mongodb://mongo:27017/admin`), reachable
  via the docker network, already running, with `mongosh` on PATH. Only when running
  outside the devcontainer (plain host) do you `docker compose up -d mongo` and hit the
  published port (`127.0.0.1:27517`). Note `docker` is **not** on PATH inside the
  devcontainer, so don't try to start Mongo from here — use the `mongo` hostname.

## Preview environments & test credentials

- Each open PR can get an ephemeral preview at `https://pr-<N>.boardgamers.space`,
  deployed by `.github/workflows/pr-preview.yml` when a MEMBER/OWNER/COLLABORATOR
  pushes (or the PR has the `preview` label). The preview db is a **sanitized prod
  dump** — full architecture in `infra/pr-preview/README.md`.
- **Every preview user's password is `password`**
  (`infra/pr-preview/seed/scrub-users.mjs` rewrites every password hash and sets
  emails to `<username>@preview.invalid`), so you can log in as anyone on a preview —
  e.g. admin user `coyotte508` / `password`.
- Script against a preview API:

  ```bash
  curl -X POST https://pr-<N>.boardgamers.space/api/account/login \
    -H 'content-type: application/json' \
    -d '{"email":"coyotte508","password":"password"}'
  # → { accessToken: {code, expiresAt}, refreshToken: {code, expiresAt}, user }
  # (the "email" field also accepts a username); then:
  curl https://pr-<N>.boardgamers.space/api/... -H "Authorization: Bearer <accessToken.code>"
  ```

  Admin routes check `authority === "admin"` on the user reloaded from the db per
  request. If a preview's API container is stale, the db still has the data — reach
  the preview mongo from the prod box: `ssh bgs` → `mongosh "mongodb://10.90.0.2:27017/bgs-pr-<N>"`.

- Local seeded db (`apps/api/scripts/seed.ts`): every fixture user's password is
  also `password` (e.g. `admin@test.com` / `password`).

### Admin tokens (agent-facing)

To let an agent script `/api/admin/*` (prod or preview) without a password, **a
human admin creates a token and hands you the raw value** — via the admin
panel's Admin Tokens page or one `POST /api/admin/tokens` (`{ name, ttlDays? }`)
from their authenticated admin session; the raw token is shown exactly once at
creation. You then simply:

```bash
curl https://<host>/api/admin/<endpoint> -H "Authorization: Bearer <token>"
```

Raw tokens carry a `bgs_admin_` prefix so the token type is identifiable (and
flaggable by secret scanners) in logs and code. Tokens are scoped to
`/api/admin/*` by construction (elsewhere the credential just doesn't
authenticate), temporary (default 30d, max 90d) and revocable, and only work
while their owner is still an admin — treat one as a credential, and ask the
admin for a new one if it stops working. (Admins: list/revoke your own tokens on
the Admin Tokens page or via `GET`/`DELETE /api/admin/tokens`.)

## Workarounds

Each project keeps a `WORKAROUNDS.md` (e.g. `apps/web/WORKAROUNDS.md`, `apps/api/WORKAROUNDS.md`) listing temporary shims and deferred cleanups — things intentional for now but to revisit later. When you add such a thing, log a short entry there; when you touch related code, check whether an entry can be removed.

## Personal data & the preview sanitize script

PR preview envs (`infra/pr-preview/`) restore their db from a **sanitized** dump of
prod. The sanitization lives in `infra/pr-preview/seed/`:

- `dump-and-ship.sh` **excludes whole collections** (`EXCLUDED=(...)`) — sessions,
  tokens, private comms, cron state, debug/transient bulk.
- `scrub-users.mjs` rebuilds `users` from a **whitelist** of safe fields and sets
  every password to the hash of `password` (so you can log in as anyone on a
  preview), with emails rewritten to `<username>@preview.invalid`.

**When you add a collection or a user field that holds personal data** (emails,
passwords, OAuth ids, IPs, tokens, private messages, anything identifying), update
these two files in the same change: add the collection to `EXCLUDED`, or make sure
the new user field is _not_ in the `KEEP_*` sets (the whitelist drops unknown
fields by default — you only need to act if you _want_ the field kept, or if it's
a new collection that isn't covered). The whitelist is the safety net: a field you
don't mention never reaches a preview.

## Screenshots on PRs/issues

To attach a screenshot to a PR or issue:

- **Do NOT use** GitHub's asset upload (drag-drop / `/assets/` URLs) from an agent token — it fails with "Asset upload is not working with this token type".
- **Do NOT** commit screenshots to the PR's own branch (they'd get merged into main and bloat the repo), and do NOT create throwaway draft releases to host them (deleting the release breaks the images).
- **The convention**: push the file to the dedicated long-lived **`pr-assets`** branch (an orphan-ish branch we never delete, so the raw URLs stay valid), under a per-PR folder `pr-<N>/`:

```bash
# from a clone of the repo, on the pr-assets branch (fetch it first if you don't have it):
git fetch origin pr-assets && git checkout pr-assets
mkdir -p pr-<N>
cp /path/to/screenshot.png pr-<N>/
git add pr-<N> && git commit -m "PR <N>: <what>" && git push origin pr-assets
```

Then embed it in the PR body or a comment:

```
![alt](https://raw.githubusercontent.com/boardgamers/boardgamers-mono/pr-assets/pr-<N>/<name>.png)
```

Switch **back** to your working branch/worktree afterward — or do this in a separate throwaway clone — so the assets commit never lands on your working branch.

## PR review (Copilot)

- **Open one PR per worker** (each worker opens its own). Copilot auto-review is enabled — it reviews on PR open and on every new push.
- After pushing, wait for the in-flight review and list its new inline comments:

  ```bash
  git push; bash scripts/wait-copilot-review.sh <PR> "$(date -u +%Y-%m-%dT%H:%M:%SZ)"
  ```

  It exits when the review is done and prints new inline comments plus the latest review's **suppressed comments** — real suggestions Copilot collapsed in its review body, which can persist on unchanged lines; check them too. Iterate (fix → push → re-run) until both are clean.
- **Fix the valid comments (inline and suppressed alike).** For false positives, reply on the PR thread explaining why, rather than changing the code.

## Conventions

- **Formatting** is enforced (see `.prettierrc`: 120 cols, 2-space, `trailingComma: es5`). Don't hand-format; let the formatter run.
- **Document shapes live in `@bgs/models`** as Zod schemas. They define the types with `z.infer` and are also inserted in DB as validation schemas (`"warn"`).
- **Tests** are colocated `*.spec.ts` using `node:test` (api/game-server). API tests run with `NODE_ENV=test` against a `…-test` database. Build fixtures inline via `app/config/test-helpers.ts` rather than relying on shared seed data.
