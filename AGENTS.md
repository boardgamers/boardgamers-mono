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
| `apps/docs`        | Self-hosted docs (Node server, markdown + HTML, agent-friendly)   |
| `packages/models`  | Shared Zod schemas + Mongo collection definitions (`@bgs/models`) |
| `packages/utils`   | Shared helpers (`@bgs/utils`)                                     |

## Working in this repo

Work directly in your checkout on a branch. Worktrees/parallel instances are only for the coordinator-orchestrated swarm setup (below) — solo agents can skip that section.

## Comments

Default to no comments. Comment only the non-obvious: a _why_ (decision, constraint, gotcha), or a workaround for an external bug (link the issue/PR).

## Secrets

Don't read env vars/secrets directly — load them from files or env without printing them.

## Conventions

- **Formatting** is enforced (`.prettierrc`: 120 cols, 2-space, `trailingComma: es5`). Don't hand-format.
- **Document shapes live in `@bgs/models`** as Zod schemas: they define the types (`z.infer`) and are inserted in DB as validation schemas (`"warn"`).
- **Tests**: colocated `*.spec.ts` with `node:test` (api/game-server); API tests run with `NODE_ENV=test` against a `…-test` db. Build fixtures inline via `app/config/test-helpers.ts`, no shared seed data.
- **Workarounds**: log temporary shims in the project's `WORKAROUNDS.md`; check for removable entries when touching related code. Any deploy-window / backward-compat shim (code tolerating a stale client, a pre-migration data shape, or an in-flight deploy) MUST get a `WORKAROUNDS.md` entry marked "removable once \<condition\>" when added, so it can be found and cleaned up after the window closes.
- **Plans live in GitHub issues, not `docs/`**: open/update an issue with the plan; don't commit plan markdown files.

## Local dev services

- **Running the stack**: `pnpm dev` runs web+api+game-server+docs (web 8612, api 50801, ws 50802, game-server 50803, docs 8620). It's a single process that also runs cron (on by default in dev) — process forking is owned by PM2 (`ecosystem.config.cjs`), not the app. Docs alone: `pnpm --filter @bgs/docs dev`.
- **Don't collide with the shared `bgs-dev` db**: if another instance may be up, set a unique `dbName` (`dbName=bgs-<name> pnpm dev` → db `bgs-<name>-dev`). If `apps/api/.env` exists, don't also set `dbUrl` (it overrides the `.env`); without an `.env`, set `dbUrl` explicitly.
- **Mongo**: source of truth is `dbUrl` in `apps/api/.env`. Devcontainer: the compose service `mongodb://mongo:27017/admin` is already running, `mongosh` on PATH. Plain host: no devcontainer mongo — use the root `docker-compose.yml` `mongo` service, started with `podman compose up -d` (rootless podman; `pipx install podman-compose` makes `podman compose` shell out to it). It publishes `127.0.0.1:27517` and self-initiates replica set `rs0`, so connect with `dbUrl=mongodb://127.0.0.1:27517/admin?replicaSet=rs0&directConnection=true` (`directConnection` required — the RS member is named `localhost`). No `mongosh` on host PATH: `podman exec <project>_mongo_1 mongosh`. The **preview mongo** (`10.90.0.2:27017`, dbs `bgs-pr-*`) is **off-limits** — it serves PR preview envs.
- **S3 (local)**: same compose file runs MinIO (`127.0.0.1:9000` API, `:9001` console, `minio`/`minio123`) with a pre-created anonymous-download `bgs-assets` bucket. Uncomment the `S3_*` block from `apps/web/.env.example` into `apps/web/.env` to enable the share-thumbnail cache; unset = no-op.

## Pull requests

- **Merging to `main` auto-deploys to production** (git pull + build + pm2 restart). Merging = shipping.
- **UI PRs must include screenshots** (see below).

## Screenshots on PRs/issues

- GitHub's asset upload fails from agent tokens; don't commit screenshots to the PR branch or use throwaway releases.
- **The convention**: push to the long-lived **`pr-assets`** branch under `pr-<N>/`, then embed the raw URL:

```bash
git fetch origin pr-assets && git checkout pr-assets
mkdir -p pr-<N> && cp /path/to/screenshot.png pr-<N>/
git add pr-<N> && git commit -m "PR <N>: <what>" && git push origin pr-assets
# switch back to your working branch afterwards
```

```
![alt](https://raw.githubusercontent.com/boardgamers/boardgamers-mono/pr-assets/pr-<N>/<name>.png)
```

## Multi-agent swarms (coordinator)

Only relevant when a coordinator runs several workers on one machine. **Never run two agents against the default ports/db at once** — each sub-agent gets an isolated worktree, IP, and db.

- **Coordinator**: one sub-agent per worktree. Before spawning, pick a unique `<name>`, allocate its IP, and copy the (gitignored) env files into the worktree:

  ```bash
  IP=$(scripts/instance-ip.sh alloc <name>)       # unique 127.1.X.Y, idempotent
  [spawn subagent with IP, tell it its name]
  for app in api game-server; do
    [ -f apps/$app/.env ] && cp apps/$app/.env .worktrees/<name>/apps/$app/.env
  done
  # no .env on this machine? give the sub-agent a dbUrl in its task instead
  ```

- **Sub-agent**:

  ```bash
  pnpm install
  listenHost=$IP dbName=bgs-<name> VITE_backend=$IP WEB_HOST=$IP pnpm dev
  # → http://<IP>:8612   (api 50801, ws 50802, game-server 50803, all on the IP)
  # when done: coordinator runs scripts/instance-ip.sh free <name>
  ```

  Always set `dbName`. Don't set `dbUrl` if the coordinator gave you an `.env` — it already points at the right Mongo; if there is no `apps/api/.env`, ask the coordinator for the Mongo URL.

### PR review process (swarm)

- One PR per worker; worker branches are `moon/<name>`.
- **The coordinator never merges** — only the user merges. The coordinator prepares PRs and reports readiness.
- **Keep a worker's worktree (and reviewer workers) alive until its PR is merged** — don't discard on "approved"/"ready"; follow-up edits and rebases reuse the checked-out worktree. Discard only after merge.
- **Every PR gets an independent review by a fresh reviewer agent** (especially auth/security/proxy/data/public-facing changes): read-only review of the PR head reporting blockers/nits and a verdict (APPROVE / REQUEST-CHANGES). Author's own tests passing is not sufficient. The reviewer also verifies UI-PR screenshots match the claimed change.
- **Keep the coordinator's local `main` fresh**: after each merge, `git fetch origin && git reset --hard origin/main` on the main checkout — workers branch off `origin/main` at spawn time, so a stale main risks reverting merged work. Re-check in-flight workers' bases after a merge and rebase if they overlap.

## Preview environments & test credentials

- Each open PR can get an ephemeral preview at `https://pr-<N>.boardgamers.space`, deployed by `.github/workflows/pr-preview.yml` when a MEMBER/OWNER/COLLABORATOR pushes (or the PR has the `preview` label). The preview db is a **sanitized prod dump** — architecture in `infra/pr-preview/README.md`.
- **Every preview user's password is `password`**, so you can log in as anyone (e.g. admin `coyotte508`):

  ```bash
  curl -X POST https://pr-<N>.boardgamers.space/api/account/login \
    -H 'content-type: application/json' \
    -d '{"email":"coyotte508","password":"password"}'
  # → { accessToken: {code, ...}, ... } — "email" also accepts a username
  curl https://pr-<N>.boardgamers.space/api/... -H "Authorization: Bearer <accessToken.code>"
  ```

  Admin routes check `authority === "admin"` on the user reloaded from the db per request. If a preview's API container is stale, the db still has the data — from the prod box: `mongosh "mongodb://10.90.0.2:27017/bgs-pr-<N>"`.

- Local seeded db (`apps/api/scripts/seed.ts`): fixture passwords are also `password` (e.g. `admin@test.com`).

### Preview sanitization

Lives in `infra/pr-preview/seed/`: `dump-and-ship.sh` **excludes whole collections** (`EXCLUDED=(...)` — sessions, tokens, private comms, cron state, debug bulk); `scrub-users.mjs` rebuilds `users` from a **whitelist** of safe fields, rewrites emails to `<username>@preview.invalid`, and sets every password to the hash of `password`.

**When you add a collection or user field holding personal data** (emails, passwords, OAuth ids, IPs, tokens, private messages, …), update these two files in the same change: add the collection to `EXCLUDED`, or keep the field out of the `KEEP_*` sets. The whitelist drops unknown fields by default — act only if you _want_ a field kept or a new collection covered.

### Admin tokens (agent-facing)

To script `/api/admin/*` (prod or preview) without a password: **a human admin creates a token and hands you the raw value** (admin panel's Admin Tokens page, or `POST /api/admin/tokens` `{ name, ttlDays? }` from their session; shown once). Then:

```bash
curl https://<host>/api/admin/<endpoint> -H "Authorization: Bearer <token>"
```

Raw tokens carry a `bgs_admin_` prefix (identifiable to secret scanners), are scoped to `/api/admin/*`, temporary (default 30d, max 90d), revocable, and die when the owner stops being admin. Ask the admin for a new one if it stops working.

## Production operations

Prod runs under PM2 (`ecosystem.config.cjs`); reach the box with `ssh bgs`. Containers (Loki/Grafana, `infra/loki/`) are rootless **podman under the `bgs` user** — no docker; details in `infra/README.md`.

- **Reload, don't restart**: `pm2 reload <proc> --update-env` (graceful) rather than `pm2 restart`. Processes: `web`, `api`, `api-cron`, `game-server` (plus `game-server-cron`, `watchdog`). `api-cron` is the singleton that runs DB migrations + cron — reloading it re-runs pending migrations.
- **Fresh logs**: `pm2 logs` starts from a buffered tail — `pm2 flush <proc>` first to tell new output apart.
- **Re-running a DB migration**: migrations (`apps/api/app/models/migrations/`) run at `api-cron` boot for versions greater than `settings.{_id:"dbVersion"}.value`. To re-run `X`, set `value` just below `X` and reload:

  ```bash
  mongosh <db> --eval 'db.settings.updateOne({_id:"dbVersion"},{$set:{value:"1.4.2"}})'
  pm2 reload api-cron --update-env
  ```

  Write migrations to be **idempotent**.

- **Scaleway Object Storage bucket policies are ALLOW-ONLY** (version `2023-04-17`): a policy with only public-read `s3:GetObject` silently denies the owning key's own `PutObject`/`ListObjects`. Always pair public-read with full access for the owner:

  ```json
  {
  	"Principal": { "SCW": "user_id:<id>" },
  	"Action": ["s3:*"],
  	"Resource": ["<bucket>", "<bucket>/*"]
  }
  ```

  Resources are plain `bucket/prefix/*` strings, not ARNs.

### Removing an index

Indexes are reconciled at boot against the declared set (`ensureIndexes` in `packages/models/setup.ts`). Never drop an index in the same PR that stops using it — deploys ship code before migrations run, and a same-PR drop can race the new index build. Two PRs:

1. **PR A**: remove the code/usage and the index from the declared `*Indexes` list, keep the index itself. Merge + deploy.
2. **PR B**: add the index name to `droppedIndexes` in `packages/models/setup.ts`. Merge + deploy — boot reconcile drops it.

The index-drift CI guard (`scripts/apply-indexes.mjs`) fails if a PR both declares and drops the same name. Example: `jwtrefreshtokens.code_1` — usage removed by #191/#193, dropped later in `droppedIndexes`.
