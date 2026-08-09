# Infrastructure

Production runs on a single bare-metal server (**coyo**, Debian 12, 31 GB RAM, 911 GB disk).

## Processes (PM2)

All apps run under PM2 as the `bgs` user, managed via `ecosystem.config.cjs` at the repo root.

| PM2 name        | App                | Mode    | Notes                                    |
| --------------- | ------------------ | ------- | ---------------------------------------- |
| `api`           | `apps/api`         | fork    | Koa REST API, `npm start`                |
| `game-server`   | `apps/game-server` | fork    | Game engine runner, `npm start`          |
| `web`           | `apps/web`         | cluster | SvelteKit SSR, 2 instances               |
| `pm2-logrotate` | (module)           | fork    | Rotates PM2 logs at 10 MB, 30-day retain |

PM2 is managed as the `bgs` user (not root). Logs are in `~/.pm2/logs/`.

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
`secure`/`domain` from `X-Forwarded-Host` / `X-Forwarded-Proto`. When the proto is
missing while the host is public, the api now sets the cookie WITHOUT the Secure
attribute instead of throwing "Cannot send secure cookie over unencrypted
connection" (the admin-login prod bug) — the cookie is only Secure when the
connection is actually seen as https. The preview
vhosts (`infra/pr-preview/coyo-pr-preview.nginx.conf`) already do this.

SSL certs managed by Certbot (Let's Encrypt), auto-renewed.

## Loki logging stack (`infra/loki/`)

Podman-based Loki + Promtail + Grafana stack. See [`infra/loki/`](./loki/) for details.

- **Grafana**: `https://grafana.boardgamers.space` (login: `admin`, password in env)
- **Loki**: `127.0.0.1:3100` (internal only)
- **Promtail**: tails `~/.pm2/logs/*.log`, ships to Loki
- **systemd**: `bgs-loki.service` auto-starts the stack on boot

Pre-provisioned dashboard: "Boardgamers — Server Health" (status codes, error rate, latency, slow endpoints).

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
