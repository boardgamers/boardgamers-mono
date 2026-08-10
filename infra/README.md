# Infrastructure

Production runs on a single bare-metal server (**coyo**, Debian 12, 31 GB RAM, 911 GB disk).

## Processes (PM2)

All apps run under PM2 as the `bgs` user, managed via `ecosystem.config.cjs` at the repo root.

| PM2 name        | App                | Mode    | Notes                                                  |
| --------------- | ------------------ | ------- | ------------------------------------------------------ |
| `api`           | `apps/api`         | cluster | Koa REST API, 2 workers (+ `api-cron`)                 |
| `game-server`   | `apps/game-server` | cluster | Gameplay API, 2 workers (+ `game-server-cron`)         |
| `web`           | `apps/web`         | cluster | SvelteKit SSR, 2 instances                             |
| `watchdog`      | `apps/game-server` | fork    | Hang detector — restarts unresponsive apps (see below) |
| `pm2-logrotate` | (module)           | fork    | Rotates PM2 logs at 10 MB, 30-day retain               |

PM2 is managed as the `bgs` user (not root). Logs are in `~/.pm2/logs/`.

## Watchdog (hang detection + auto-restart)

PM2 only restarts a process when it **exits**. A process whose event loop is **wedged**
(a synchronous infinite loop — e.g. a runaway game engine) stays alive but stops
answering HTTP, so PM2 never restarts it. This caused a ~25 min production outage on
2026-08-09 (game-server hung, nginx 502'd `/api/gameplay/*`, nothing restarted it until
a coincidental deploy).

The **`watchdog`** PM2 app (`apps/game-server/scripts/watchdog.ts`) closes that gap:

- Every `WATCHDOG_INTERVAL_MS` (default 15s) it GETs `/health` on `game-server`
  (`:50803`) and `api` (`:50801`).
- `/health` is a cheap liveness probe that returns 200 as long as the event loop serves
  HTTP. It deliberately does **not** touch the DB — a slow database must not read as a
  hang and cause a restart loop. A wedged event loop fails the check because the request
  is never answered (`WATCHDOG_TIMEOUT_MS`, default 5s).
- After `WATCHDOG_FAIL_THRESHOLD` (default 4) consecutive failures it runs
  `pm2 restart <name>`, bounding any hang to roughly `interval × threshold` (~60s with
  defaults). A `WATCHDOG_RESTART_COOLDOWN_MS` (default 60s) prevents restart loops.
- Each failure is classified `unresponsive` (timeout / non-200 — the wedged-loop
  signature; the timeout fires at the socket level even for a fully blocked loop) vs
  `down` (connection refused — crashed or still booting) for triage; both restart once
  they persist past the threshold.
- The watchdog runs **under PM2 itself**, so PM2 keeps the watchdog alive; the watchdog
  only ever _restarts_ the other apps (PM2 remains the supervisor that brings them back).

Prod binds apps to `::1` (full IPv6), so set `WATCHDOG_HOST=::1` in the watchdog's
environment there (default is `127.0.0.1`). It is part of `ecosystem.config.cjs`, so a
normal `pm2 reload ecosystem.config.cjs` deploy starts it.

**Complementary in-process guard** (`packages/utils/watchdog.ts`, started in each serving
worker): measures event-loop _scheduling lag_ and exits (so PM2 restarts the process)
when the loop is severely degraded but still technically answering — e.g. an engine doing
multi-second synchronous bursts. It runs per cluster worker, so it also catches one
degraded worker while a sibling keeps `/health` green. A **fully** blocked loop can't run
its own `process.exit()`, so the hard `while(true)` wedge is the external watchdog's job
(its timeout doesn't depend on the target's loop); the guard covers the laggy-but-alive
case.

**Prevention (the root cause):** the game-server runs engine `move` calls inside a
`worker_thread` with a hard timeout (`apps/game-server/app/services/engine-runner.ts`,
default 10s via `ENGINE_CALL_TIMEOUT_MS`). A `Promise.race` can't preempt a synchronous
infinite loop on the same thread, so the worker is `terminate()`d on timeout — the move
fails with 422 and the server stays responsive. A timeout also writes an `apiErrors`
record (`meta.gameId` + game/version/action) so the culprit game/engine is findable on
the admin errors page. Other engine entry points (`init`/`dropPlayer`/`replay`/
`logSlice`) still run in-process — see `apps/game-server/WORKAROUNDS.md`; the watchdog +
guard are the net for those.

## Nginx

Nginx (root) fronts all public traffic. Prod is **full IPv6**: app processes bind
`::1` (`listenHost=::1` in the prod env) and nginx upstreams dial `::1`:

- `boardgamers.space` / `www.boardgamers.space` → SvelteKit SSR (`[::1]:8612`)
- `admin.boardgamers.space` → admin SPA (static files + `/api` proxy to `[::1]:50801`)
- `resources.boardgamers.space` → resources API (`[::1]:50804`)
- `forum.boardgamers.space` → NodeBB
- `grafana.boardgamers.space` → Grafana (`127.0.0.1:3030`)

Every vhost that proxies `/api` (web, admin, resources, previews) must set
`proxy_set_header Host $host; proxy_set_header X-Forwarded-Proto $scheme;` (and
`X-Forwarded-For`). The api (`app.proxy = true`) decides the session cookie's
`secure`/`domain` from `X-Forwarded-Host` / `X-Forwarded-Proto`, and Koa throws
"Cannot send secure cookie over unencrypted connection" on login when the proto is
missing while the host is public — this was the admin-login prod bug. The preview
vhosts (`infra/pr-preview/coyo-pr-preview.nginx.conf`) already do this.

SSL certs managed by Certbot (Let's Encrypt), auto-renewed.

## Loki logging stack (`infra/loki/`)

Podman-based Loki + Promtail + Grafana stack. See [`infra/loki/`](./loki/) for details.

- **Grafana**: `https://grafana.boardgamers.space` (login: OAuth via boardgamers.space, admins only — see "Grafana OAuth" below; `admin`/password env kept as backdoor)
- **Loki**: `127.0.0.1:3100` (internal only)
- **Promtail**: tails `~/.pm2/logs/*.log`, ships to Loki
- **systemd**: `bgs-loki.service` auto-starts the stack on boot

Pre-provisioned dashboard: "Boardgamers — Server Health" (status codes, error rate, latency, slow endpoints).

### Grafana OAuth (OIDC login)

Login goes through the boardgamers.space OAuth2/OIDC provider (CIMD, PKCE — no client secret). Role comes from the user's `authority` claim: `admin` → GrafanaAdmin, anything else → denied (`role_attribute_strict=true`). The `admin`/password envs remain as an emergency backdoor.

**Prerequisite:** the API PR exposing the `authority` claim under the `role` scope must be deployed on www.boardgamers.space first.

**Deploy** (on coyo):

1. Sync the nginx vhost `infra/loki/grafana.boardgamers.space` to `/etc/nginx/sites-enabled/` (adds the `location = /client-metadata.json` CIMD block), then `sudo nginx -t && sudo systemctl reload nginx`.
2. `docker compose -f infra/loki/docker-compose.yml up -d grafana` to pick up the `GF_AUTH_GENERIC_OAUTH_*` envs.
3. Verify: log in via the "Boardgamers" button on https://grafana.boardgamers.space with an admin account (gets GrafanaAdmin); a non-admin account must be denied.

**Follow-up:** once OAuth is confirmed working, uncomment `GF_AUTH_DISABLE_LOGIN_FORM=true` in `infra/loki/docker-compose.yml` (and redeploy) to remove the password form.

Admin panel health widgets: `admin.boardgamers.space/health` (queries Loki via `/api/admin/loki/*` proxy).

## Deploy

Automated via GitHub Actions (`.github/workflows/deploy.yml`). On push to `master`:

1. CI passes (lint, tsc, tests, prettier)
2. Action SSHes into coyo as `bgs`
3. `git pull origin master`
4. `pnpm install` (workspace root)
5. `pnpm --filter @bgs/web build` (rebuild SvelteKit SSR)
6. `pm2 reload ecosystem.config.cjs` (zero-downtime reload of all apps)

### Required GitHub secrets

| Secret             | Purpose                                                         |
| ------------------ | --------------------------------------------------------------- |
| `COYO_SSH_KEY`     | Private SSH key for the `bgs` user on coyo                      |
| `COYO_SSH_HOST`    | Hostname/IP of coyo (e.g. `62.210.93.85`)                       |
| `COYO_SSH_PORT`    | SSH port (default `22`)                                         |
| `COYO_KNOWN_HOSTS` | Output of `ssh-keyscan` for coyo (pins host key, prevents MITM) |

To set up: generate an SSH keypair, add the public key to `~bgs/.ssh/authorized_keys` on coyo, and add the private key as a GitHub secret. For `COYO_KNOWN_HOSTS`, run `ssh-keyscan -p 22 62.210.93.85` and paste the output as the secret value.

### Manual deploy (fallback)

```bash
ssh coyo
sudo su - bgs
cd ~/boardgamers-mono
git pull origin master
pnpm install
pnpm --filter @bgs/web build
pm2 reload ecosystem.config.cjs
```

## Database

MongoDB 8.0 running on coyo (`127.0.0.1:27017`). Database name: `bgs` (or `bgs-test` / `bgs-dev` based on `NODE_ENV`).

Redis (`127.0.0.1:6379`) is used by NodeBB.

## Other services on coyo

| Service | Port   | Purpose                      |
| ------- | ------ | ---------------------------- |
| MongoDB | 27017  | Primary database             |
| Redis   | 6379   | NodeBB sessions/cache        |
| Nginx   | 80/443 | Reverse proxy + SSL          |
| NodeBB  | 4567   | Forums                       |
| PM2 God | -      | Process supervisor for `bgs` |

## SSH access

```bash
ssh coyo              # as your user (debian)
sudo su - bgs          # switch to bgs for app management
```

The `bgs` user has no password — use `sudo su -` to switch.
