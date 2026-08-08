# PR preview environments (issue #120)

Ephemeral per-PR instances of the whole stack, running on the home minipc and
served at `https://pr-<n>.boardgamers.space`. Follows the issue: replicate,
don't share — every env restores its own `bgs-pr-<n>` db from a nightly
sanitized dump of prod and never touches the live `bgs`.

## Access & credentials

- **Every preview user's password is `password`** (`seed/scrub-users.mjs` rewrites
  all password hashes to the bcrypt of `password`, emails to `<username>@preview.invalid`).
  You can log in as anyone — e.g. admin user `coyotte508` / `password`.
- Via the API: `POST https://pr-<n>.boardgamers.space/api/account/login` with
  `{"email": "<username-or-email>", "password": "password"}` →
  `{ accessToken: {code, ...}, refreshToken, user }`; then
  `Authorization: Bearer <accessToken.code>` on API calls.
- Direct db access from the prod box: `ssh bgs` →
  `mongosh "mongodb://10.90.0.2:27017/bgs-pr-<n>"` (minipc mongo over WireGuard).
- Admin routes check `authority === "admin"` on the user loaded fresh from the db,
  so a stale API container still admin-auths correctly as long as the db is intact.
- Env dbs (`bgs-pr-<n>`) persist across code updates and container restarts — the
  entrypoint seeds from the template only on first boot (db empty), and `PUT` on an
  existing PR swaps the container without touching the db. The db is dropped only on
  env delete (`DELETE`, PR close) or janitor reap.

## Layout

```
Internet ── coyo (62.210.93.85, the one public entry point)
              nginx:
                pr-<n>.boardgamers.space  → minipc env ports (12/13/14/15/16000+n)
                pr-preview-api...         → minipc preview-api (control plane)
              certbot: wildcard *.boardgamers.space (dns-namecheap, auto-renew)
              cron 03:17: dump-and-ship.sh  (sanitized prod dump → minipc)
                    │ WireGuard 10.90.0.1 ↔ 10.90.0.2 (no inbound ports at home)
minipc ── preview-api :9900 (control plane, WireGuard IP only)
          bgs-preview-mongo :27017 (holds all preview dbs; on the bgs-preview bridge)
          bgs-pr-<n> containers (rootless Podman): web+api+game-server
```

## Network isolation

Envs and mongo share a rootless Podman bridge network (`bgs-preview`); envs reach
mongo **by container name** (`mongodb://bgs-preview-mongo:27017`). There is **no
`allow_host_loopback`** — a compromised env cannot reach the minipc's host loopback
(`127.0.0.1`) services. Outbound internet still works (bridge NAT) so the game-server
can `npm install` engines. Caveat: services bound to the WireGuard IP `10.90.0.2`
(preview-api :9900, other envs' ports) remain reachable from envs since that IP is
routable from the bridge — preview-api is bearer-token authed, so this is acceptable;
only host _loopback_ is firewalled off.

## Files here

- `containerfile/` — the env image + entrypoint (checkout PR sha, seed db on first
  boot, run web/api/game-server). One container per env = the sandbox boundary:
  rootless, no-new-privileges, cap-drop ALL, mem/cpu/pids caps. The game-server
  `npm install`s third-party engines at runtime (`apps/game-server/app/services/installer.ts`),
  which is exactly why envs are containers with no published ports except via nginx.
- `manager/preview-api.mjs` — tiny Node control plane on minipc (10.90.0.2:9900).
  Bearer-authed. `PUT /envs/:n {sha}` creates (cap 5) or updates to a new sha,
  `DELETE /envs/:n` tears down, `GET /envs` lists, `POST /seed` imports the newest
  dump. Runs under `systemd --user` (`preview-api.service`).
- `seed/dump-and-ship.sh` + `seed/scrub-users.mjs` — nightly on coyo: mongodump
  of `bgs` minus private collections, users rebuilt from a **whitelist** of safe
  fields (emails → `@preview.invalid`, passwords/social/IPs dropped), shipped to
  minipc and imported as `bgs-preview-template`.

## One-time setup (already done on coyo/minipc)

- WireGuard mesh coyo↔minipc: `/etc/wireguard/wg0.conf`, 10.90.0.1 / 10.90.0.2.
- minipc: rootless podman, `bgs-preview-mongo` container, `preview-api` user
  service, image built from `containerfile/`, secret at `~/.config/bgs-preview/secret`.
- coyo: nginx vhosts `sites-available/{pr-preview,pr-preview-api}`, wildcard cert
  lineage `wildcard.boardgamers.space` (venv at `/opt/certbot-dns` for the
  dns-namecheap plugin; renewals go through `/usr/local/bin/certbot-renew`),
  bgs cron for the seed.

## GitHub side

`.github/workflows/pr-preview.yml` (`pull_request_target`): gated on
MEMBER/OWNER/COLLABORATOR or a `preview` label, calls
`https://pr-preview-api.boardgamers.space` with the shared secret, surfaces the URL as a
GitHub Deployment per push, comments the player + admin URLs on the PR the first time a
preview goes live (sentinel `<!-- pr-preview-deployed -->`, so later pushes don't spam),
and tears down on close/unlabel. Needs repo secret `PREVIEW_SECRET` = the minipc
`~/.config/bgs-preview/secret`.

The session cookie is scoped host-only per preview host. The api stamps
`Domain=domain` (`pr-<n>.boardgamers.space`), which the browser accepts on the player host
(host == Domain) but rejects on the admin host — `admin-pr-<n>.boardgamers.space` is a
sibling of `pr-<n>`, not a subdomain. The coyo vhost rewrites it with
`proxy_cookie_domain pr-<n>.boardgamers.space $host;` in BOTH server blocks, so each host
stores a host-only cookie (`pr-<n>` on the player, `admin-pr-<n>` on the admin) and no
cookie ever carries the shared `boardgamers.space` ancestor (which would leak into prod).

## Ports (minipc, WireGuard IP only)

| port    | what                                  |
| ------- | ------------------------------------- |
| 9900    | preview-api control plane             |
| 27017   | bgs-preview-mongo                     |
| 12000+n | env n web                             |
| 13000+n | env n api                             |
| 14000+n | env n game-server (gameplay)          |
| 15000+n | env n websocket                       |
| 16000+n | env n resources (game-viewer iframes) |

nginx builds the upstream port by zero-padding the PR number to 3 digits
(`12` + `099` for PR 99), so PRs must stay < 1000.
