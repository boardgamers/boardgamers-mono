# Workarounds & future cleanups — `apps/game-server`

Things that are intentional for now but should be revisited / removed later. Add an entry when you leave a temporary shim, a deferred migration, or anything a future reader might mistake for a permanent decision. Keep entries short and link the code.

## Engine isolation covers only the `move` path (`app/services/engine-runner.ts`, `app/routes/gameplay.ts`)

Engines run in-process via dynamic `import()`; a synchronous infinite loop in any engine method wedges the whole game-server event loop (the 2026-08-09 outage). As a first step, only the player-facing **`move`** call runs inside a `worker_thread` with a hard timeout (`engineRunner.call`, default 10s via `ENGINE_CALL_TIMEOUT_MS`) — a runaway `move` is terminated and fails that one request instead of hanging the server. The other engine entry points (`init`, `dropPlayer`, `replay`, `logSlice`, `afterMove`'s `scores`/`currentPlayer`/etc.) still run on the main thread and can still wedge it; the **watchdog** (`scripts/watchdog.ts`) is the safety net that restarts the process in that case. Full isolation = route every engine call through the runner (or a worker pool / separate engine pod). Revisit when extending coverage.

## Listen host: default `127.0.0.1`, prod binds `::1` (`app/config/env.ts`)

Same as `apps/api` (`apps/api/WORKAROUNDS.md`): `env.listen.host` defaults to `127.0.0.1` for local dev / multi-instance (`scripts/instance-ip.sh`); prod sets `listenHost=::1` and the nginx upstream (`gaia_game_server`) dials `::1:50803`. Override via the `listenHost` env var; keep server bind and the nginx upstream on the same address family.
