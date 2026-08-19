/**
 * Attribution for MAIN-THREAD engine calls — the ones NOT isolated in the worker
 * thread (only `move`/`moveAI` go through engine-runner.ts). If one of these wedges or
 * severely lags the event loop, nothing used to say which game/move/player triggered
 * it: the process just got restarted by the watchdog.
 *
 * `trackedEngine` wraps an engine so every method call records a module-level
 * "current engine call" context (game, method, acting player, move, startedAt):
 *  - the event-loop guard reads it via `currentEngineCall()` when it fires, so a
 *    severe-lag restart is attributed to the in-flight call;
 *  - any call slower than SLOW_ENGINE_CALL_MS logs a `slowEngineCall` warning at
 *    completion — the early-warning trail before an actual freeze.
 *
 * Deliberately cheap: one plain context object per call, no timers (duration is
 * computed at completion; the guard reads the context when *it* fires). Honest limit:
 * a FULLY blocked loop can't run its own logging — the external watchdog restarts the
 * process in that case (see @bgs/utils/watchdog) — but the context still names the
 * culprit whenever the loop recovers enough to log.
 */
import { logEvent } from "@bgs/utils/log";
import type { Engine } from "../types/engine.ts";

export type EngineCallAttribution = {
	gameId: string;
	game: string;
	version: number;
	playerIndex?: number;
	playerName?: string;
	move?: unknown;
};

type EngineCallContext = EngineCallAttribution & { method: string; startedAt: number };

const DEFAULT_SLOW_MS = Number(process.env.SLOW_ENGINE_CALL_MS) || 2_000;

const MOVE_MAX_LEN = 200;

let current: EngineCallContext | null = null;

/** Move → bounded string for logs (raw notation or compact JSON). */
export function moveString(move: unknown): string | undefined {
	if (move === undefined || move === null) {
		return undefined;
	}
	const raw = typeof move === "string" ? move : JSON.stringify(move);
	return raw.length > MOVE_MAX_LEN ? raw.slice(0, MOVE_MAX_LEN - 1) + "…" : raw;
}

function loggable(ctx: EngineCallContext): Record<string, unknown> {
	return {
		gameId: ctx.gameId,
		game: ctx.game,
		version: ctx.version,
		method: ctx.method,
		playerIndex: ctx.playerIndex,
		playerName: ctx.playerName,
		move: moveString(ctx.move),
	};
}

/**
 * Snapshot of the in-flight main-thread engine call, shaped for logging. Read by the
 * event-loop guard when it fires (see server.ts) so a hang is attributed to a
 * game/method/player instead of just "loop wedged".
 */
export function currentEngineCall(): Record<string, unknown> | undefined {
	if (!current) {
		return undefined;
	}
	return { ...loggable(current), engineCallMs: Date.now() - current.startedAt };
}

const tracked = new WeakSet<object>();

/**
 * Wrap an engine so each method call sets/clears the module-level context and logs a
 * `slowEngineCall` warning when it overruns `slowMs`. Idempotent: an already-tracked
 * engine is returned as-is (the outermost attribution wins — callers wrap with the
 * most specific one they have, e.g. acting player + move on the move route).
 */
export function trackedEngine(engine: Engine, attribution: EngineCallAttribution, slowMs = DEFAULT_SLOW_MS): Engine {
	if (tracked.has(engine)) {
		return engine;
	}
	const proxy = new Proxy(engine, {
		get(target, prop, receiver) {
			const value: unknown = Reflect.get(target, prop, receiver);
			if (typeof value !== "function") {
				return value;
			}
			return (...args: unknown[]) => {
				const ctx: EngineCallContext = { ...attribution, method: String(prop), startedAt: Date.now() };
				current = ctx;
				const finish = () => {
					if (current === ctx) {
						current = null;
					}
					const elapsedMs = Date.now() - ctx.startedAt;
					if (elapsedMs >= slowMs) {
						logEvent("warn", "slowEngineCall", { source: "game-server", ...loggable(ctx), elapsedMs });
					}
				};
				try {
					const result: unknown = value.apply(target, args);
					if (result instanceof Promise) {
						return result.then(
							(v: unknown) => {
								finish();
								return v;
							},
							(err: unknown) => {
								finish();
								throw err;
							},
						);
					}
					finish();
					return result;
				} catch (err) {
					finish();
					throw err;
				}
			};
		},
	});
	tracked.add(proxy);
	return proxy;
}
