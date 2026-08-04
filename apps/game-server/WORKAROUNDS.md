# Workarounds & future cleanups — `apps/game-server`

Things that are intentional for now but should be revisited / removed later. Add an entry when you leave a temporary shim, a deferred migration, or anything a future reader might mistake for a permanent decision. Keep entries short and link the code.

## Listen host: default `127.0.0.1`, prod binds `::1` (`app/config/env.ts`)

Same as `apps/api` (`apps/api/WORKAROUNDS.md`): `env.listen.host` defaults to `127.0.0.1` for local dev / multi-instance (`scripts/instance-ip.sh`); prod sets `listenHost=::1` and the nginx upstream (`gaia_game_server`) dials `::1:50803`. Override via the `listenHost` env var; keep server bind and the nginx upstream on the same address family.
