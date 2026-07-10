# Workarounds & future cleanups — `apps/game-server`

Things that are intentional for now but should be revisited / removed later. Add an entry when you leave a temporary shim, a deferred migration, or anything a future reader might mistake for a permanent decision. Keep entries short and link the code.

## Dev/prod listen host defaults to `127.0.0.1` (`app/config/env.ts`)

`env.listen.host` defaults to `127.0.0.1` (was `localhost`). Same rationale as `apps/api/app/config/env.ts` — on hosts whose `/etc/hosts` maps `localhost` to **both** `127.0.0.1` and `::1`, Node's `http.listen("localhost")` binds **only `::1`**, while nginx (prod) dials `127.0.0.1` → `ECONNREFUSED`.

**Prod note (2026-07-10):** prod nginx upstream (`/etc/nginx/sites-enabled/gaia-project`, `gaia_game_server`) now dials `127.0.0.1:50803` — matching this default. Both sides are aligned; no `listenHost` env override is needed in prod. Operators can still force `::1` / `0.0.0.0` via `listenHost`. See `apps/api/WORKAROUNDS.md` for the full history. Revisit if we ever move to dual-stack listen or a hostname-based upstream.
