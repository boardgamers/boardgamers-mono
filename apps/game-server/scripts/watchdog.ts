/**
 * HTTP liveness watchdog for the game-server and api PM2 processes.
 *
 * Why this exists: on 2026-08-09 the prod game-server wedged (event loop blocked by
 * an engine stuck in an infinite loop) — the process stayed alive but stopped serving
 * HTTP, so PM2 (which only restarts on process exit) never restarted it. Result: a
 * ~25 min outage until a coincidental deploy's `pm2 reload` un-wedged it.
 *
 * This watchdog polls each serving app's GET /health endpoint. An app that fails
 * `FAIL_THRESHOLD` consecutive checks (connection refused, timeout, or non-200) is
 * restarted with `pm2 restart <name>`, bounding any hang to roughly
 * FAIL_THRESHOLD * INTERVAL_MS (~60s with the defaults).
 *
 * /health only proves "the event loop accepts and answers HTTP requests" — it does
 * NOT touch the DB, so a slow database never reads as a hang. A blocked event loop
 * (the failure mode above) fails the check because the request is never answered.
 *
 * Runs as the `watchdog` PM2 app (see ecosystem.config.cjs) so PM2 keeps the watchdog
 * itself alive. It only ever *restarts* apps; PM2 remains the supervisor that brings
 * them back. See infra/README.md#watchdog.
 *
 * Config (env): WATCHDOG_HOST (default 127.0.0.1 — prod binds ::1, set it there),
 * WATCHDOG_INTERVAL_MS, WATCHDOG_TIMEOUT_MS, WATCHDOG_FAIL_THRESHOLD,
 * WATCHDOG_RESTART_COOLDOWN_MS, WATCHDOG_PM2_BIN.
 */
import { execFile } from "node:child_process";

const HOST = process.env.WATCHDOG_HOST ?? "127.0.0.1";
const INTERVAL_MS = Number(process.env.WATCHDOG_INTERVAL_MS) || 15_000;
const TIMEOUT_MS = Number(process.env.WATCHDOG_TIMEOUT_MS) || 5_000;
const FAIL_THRESHOLD = Number(process.env.WATCHDOG_FAIL_THRESHOLD) || 4;
const RESTART_COOLDOWN_MS = Number(process.env.WATCHDOG_RESTART_COOLDOWN_MS) || 60_000;
const PM2_BIN = process.env.WATCHDOG_PM2_BIN ?? "pm2";

export type WatchdogTarget = { name: string; port: number };

// The serving processes (PM2 cluster workers). The *-cron fork processes don't bind
// a port (see server.ts), so they have no /health to poll — a hung cron process is
// out of scope here (its work is retried via the DB locks on the next tick).
export const DEFAULT_TARGETS: WatchdogTarget[] = [
	{ name: "game-server", port: 50803 },
	{ name: "api", port: 50801 },
];

function log(level: "info" | "warn" | "error", msg: string, fields: Record<string, unknown> = {}) {
	const line = JSON.stringify({ level, msg, source: "watchdog", ...fields, time: new Date().toISOString() });
	(level === "error" ? process.stderr : process.stdout).write(line + "\n");
}

/** Outcome of one liveness probe. */
export type HealthStatus =
	| { ok: true }
	// No HTTP response in time / non-200 — the signature of a wedged event loop (the
	// process is up, the socket accepts, but the request is never answered).
	| { ok: false; kind: "unresponsive" }
	// Connection refused — process down or still booting (port not bound yet).
	| { ok: false; kind: "down" };

/** One liveness probe. Never throws. Distinguishes a wedge (unresponsive) from a down/booting process. */
export async function checkHealth(target: WatchdogTarget, timeoutMs = TIMEOUT_MS): Promise<HealthStatus> {
	const url = `http://${HOST}:${target.port}/health`;
	try {
		const res = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) });
		// Drain so the socket is released; we only care about the status.
		await res.text().catch(() => {});
		return res.status === 200 ? { ok: true } : { ok: false, kind: "unresponsive" };
	} catch (err) {
		// AbortSignal.timeout → TimeoutError (loop too busy to answer). A refused
		// connection surfaces as a TypeError whose cause carries code ECONNREFUSED.
		const code =
			err instanceof Error && err.cause && typeof err.cause === "object" && "code" in err.cause
				? (err.cause as { code?: unknown }).code
				: undefined;
		const kind =
			err instanceof Error && err.name === "TimeoutError"
				? "unresponsive"
				: code === "ECONNREFUSED"
					? "down"
					: "unresponsive";
		return { ok: false, kind };
	}
}

function pm2Restart(name: string): Promise<void> {
	return new Promise((resolve) => {
		execFile(PM2_BIN, ["restart", name], { timeout: 30_000 }, (err, stdout, stderr) => {
			if (err) {
				log("error", "restartFailed", { name, error: err.message, stderr: stderr.trim() });
			} else {
				log("info", "restarted", { name, output: stdout.trim() });
			}
			// Resolve either way — a failed restart must not crash the watchdog loop.
			resolve();
		});
	});
}

type TargetState = { failures: number; lastRestart: number };

/**
 * Run one watchdog cycle against `targets`. Returns when every failing target has
 * been handled. Exported (with injectable state) for tests.
 */
export async function tick(
	targets: WatchdogTarget[],
	state: Map<string, TargetState>,
	{ failThreshold = FAIL_THRESHOLD, restartCooldownMs = RESTART_COOLDOWN_MS, now = Date.now() } = {},
): Promise<void> {
	await Promise.all(
		targets.map(async (target) => {
			const result = await checkHealth(target);
			const s = state.get(target.name) ?? { failures: 0, lastRestart: 0 };

			if (result.ok) {
				if (s.failures > 0) {
					log("info", "recovered", { name: target.name, afterFailures: s.failures });
				}
				s.failures = 0;
				state.set(target.name, s);
				return;
			}

			s.failures += 1;
			state.set(target.name, s);
			// kind=unresponsive (timeout/non-200) points at a wedged loop; kind=down
			// (refused) at a crashed/booting process. Both warrant a restart once they
			// persist past the threshold — a "down" that lasts ~60s isn't coming back on
			// its own (PM2 already restarts crashes instantly, so persistent down means
			// crash-looping or a boot hang, both of which a restart can clear).
			log("warn", "healthCheckFailed", {
				name: target.name,
				port: target.port,
				kind: result.kind,
				failures: s.failures,
				failThreshold,
			});

			if (s.failures < failThreshold) {
				return;
			}
			if (now - s.lastRestart < restartCooldownMs) {
				log("warn", "restartCoolingDown", { name: target.name, cooldownMs: restartCooldownMs });
				return;
			}

			log("error", "restartingUnresponsive", { name: target.name, failures: s.failures });
			s.lastRestart = now;
			s.failures = 0;
			await pm2Restart(target.name);
		}),
	);
}

const isMain = process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href;

if (isMain) {
	const state = new Map<string, TargetState>();
	log("info", "started", {
		targets: DEFAULT_TARGETS.map((t) => `${t.name}@:${t.port}`),
		intervalMs: INTERVAL_MS,
		timeoutMs: TIMEOUT_MS,
		failThreshold: FAIL_THRESHOLD,
		restartCooldownMs: RESTART_COOLDOWN_MS,
	});

	// Self-correcting cadence: re-arm after each tick completes so a slow check can't
	// pile up overlapping ticks. NOT unref'd — the re-armed timer is the only thing
	// keeping the process alive between ticks; unref would let the event loop drain and
	// the watchdog would exit after the first tick. The watchdog's own liveness is PM2's job.
	const loop = async () => {
		try {
			await tick(DEFAULT_TARGETS, state);
		} catch (err) {
			log("error", "tickError", { error: err instanceof Error ? err.message : String(err) });
		} finally {
			setTimeout(loop, INTERVAL_MS);
		}
	};
	void loop();
}
