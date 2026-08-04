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

## Workarounds

Each project keeps a `WORKAROUNDS.md` (e.g. `apps/web/WORKAROUNDS.md`, `apps/api/WORKAROUNDS.md`) listing temporary shims and deferred cleanups — things intentional for now but to revisit later. When you add such a thing, log a short entry there; when you touch related code, check whether an entry can be removed.

## Conventions

- **Formatting** is enforced (see `.prettierrc`: 120 cols, 2-space, `trailingComma: es5`). Don't hand-format; let the formatter run.
- **Document shapes live in `@bgs/models`** as Zod schemas. They define the types with `z.infer` and are also inserted in DB as validation schemas (`"warn"`).
- **Tests** are colocated `*.spec.ts` using `node:test` (api/game-server). API tests run with `NODE_ENV=test` against a `…-test` database. Build fixtures inline via `app/config/test-helpers.ts` rather than relying on shared seed data.
