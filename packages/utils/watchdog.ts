/**
 * In-process event-loop-lag self-check — the complement to the external HTTP watchdog.
 *
 * Why both exist — they catch different hang shapes:
 *  - The external watchdog (apps/game-server/scripts/watchdog.ts) polls GET /health and
 *    restarts an app whose HTTP stops answering. Its timeout fires at the socket level
 *    even for a fully blocked loop, so it catches the hard `while(true)` wedge.
 *  - This in-process guard measures event-loop *scheduling lag* and exits (so PM2
 *    restarts the process) when the loop is severely degraded but still technically
 *    answering — e.g. an engine doing multi-second synchronous bursts that make every
 *    request slow without fully wedging. It runs inside each cluster worker, so it also
 *    covers the case where one worker is degraded while a sibling keeps /health green.
 *
 * Honest limit: a FULLY blocked event loop can't run its own `process.exit()` (the exit
 * is itself scheduled on the loop), so this guard cannot self-terminate a hard wedge —
 * the external watchdog's timeout is the detector for that case. What this guard adds
 * over it is per-worker granularity and detection of severe-but-not-total lag.
 */

import { logEvent } from "./log.ts";

export type EventLoopGuard = { stop: () => void };

export interface EventLoopGuardOptions {
	checkMs?: number;
	maxLagMs?: number;
	threshold?: number;
	/**
	 * Called once when the loop is deemed wedged (lag > maxLagMs for `threshold`
	 * consecutive checks). Default: log + `process.exit(1)` so the supervisor (PM2)
	 * restarts the process. Injectable for tests.
	 */
	onWedged?: (lagMs: number) => void;
}

/**
 * Measure event-loop scheduling lag every `checkMs`; if the lag exceeds `maxLagMs` for
 * `threshold` consecutive checks, the loop is wedged → call `onWedged` (default: exit
 * so PM2 restarts). Returns a handle to stop it (tests / graceful shutdown).
 *
 * Lag is measured as actual minus expected elapsed time between two timer firings.
 * A blocked loop delays the callback, so lag ≈ how long the loop was stuck.
 */
export function startEventLoopGuard(label: string, opts: EventLoopGuardOptions = {}): EventLoopGuard {
	const { checkMs = 5_000, maxLagMs = 15_000, threshold = 2 } = opts;
	// Default action: the process is wedged and must be restarted. Don't run graceful
	// shutdown — a blocked loop can't drain cleanly, and waiting would delay the restart.
	const onWedged =
		opts.onWedged ??
		((lagMs: number) => {
			logEvent("error", "eventLoopWedged", { source: label, lagMs, note: "exiting so the supervisor restarts" });
			process.exit(1);
		});

	let last = Date.now();
	let breaches = 0;
	let stopped = false;

	const timer = setInterval(() => {
		const now = Date.now();
		const lag = now - last - checkMs;
		last = now;

		if (lag > maxLagMs) {
			breaches += 1;
			logEvent("error", "eventLoopLag", { source: label, lagMs: lag, maxLagMs, breaches, threshold });
			if (breaches >= threshold) {
				stop();
				onWedged(lag);
			}
		} else {
			breaches = 0;
		}
	}, checkMs);

	// The guard must not itself keep the process alive (it's a monitor, not main work).
	timer.unref();

	function stop() {
		if (stopped) {
			return;
		}
		stopped = true;
		clearInterval(timer);
	}

	return { stop };
}
