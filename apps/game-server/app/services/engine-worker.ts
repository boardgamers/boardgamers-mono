/**
 * Worker-thread entrypoint that hosts one game engine and executes method calls on it.
 *
 * Runs inside a `Worker` spawned by engine-runner.ts (never directly). The engine is
 * dynamically imported from `workerData.path` (the same resolved path engines.ts
 * computes), then each `{ id, method, args }` message on the parent port is dispatched
 * to `engine[method](...args)` and the result is posted back.
 *
 * Only PLAIN JSON crosses the thread boundary — structured clone rejects anything
 * else with DataCloneError. This bites on BOTH directions for engines that keep live
 * class instances / closures / EventEmitters in their state (e.g. gaia-project):
 *  - input: the game state passed in is already plain (Mongo's BSON can't hold class
 *    instances/functions, and engine.ts persists via JSON.parse(JSON.stringify(...))).
 *  - OUTPUT: the engine method's return value is NOT — gaia's move returns a live
 *    `Engine` instance whose players are EventEmitters with listener closures, so we
 *    MUST serialize it before posting (see below) or postMessage throws DataCloneError.
 *
 * If an engine method wedges the worker's event loop (an infinite `while` loop), the
 * parent simply never receives the result and terminates the worker on timeout — the
 * main game-server stays responsive.
 */
import { parentPort, workerData } from "node:worker_threads";
import type { Engine } from "../types/engine.ts";

type CallMessage = { id: number; method: keyof Engine; args: unknown[] };
type CallResult = { id: number; ok: true; value: unknown } | { id: number; ok: false; error: string };

// oxlint-disable-next-line typescript/no-unsafe-type-assertion -- workerData shape is fixed by the parent (engine-runner.ts)
const { path } = workerData as { path: string };

// oxlint-disable-next-line typescript/no-unsafe-type-assertion -- engines conform to the Engine contract by convention
const engine = (await import(path)) as Engine;

parentPort!.on("message", (msg: CallMessage) => {
	void (async (): Promise<CallResult> => {
		try {
			const fn = engine[msg.method];
			if (typeof fn !== "function") {
				throw new Error(`Engine has no method ${String(msg.method)}`);
			}
			// oxlint-disable-next-line typescript/no-unsafe-type-assertion -- engine methods are called dynamically by name
			const value = await (fn as (...a: unknown[]) => unknown)(...msg.args);
			// Engine results must be plain JSON to cross the thread boundary — some
			// engines (gaia-project) return live class instances / EventEmitters that
			// structured clone would reject with DataCloneError. A JSON round-trip
			// strips those; this matches how engine.ts persists results anyway
			// (JSON.parse(JSON.stringify(...))), so nothing the route needs is lost.
			// Doing it here (not via postMessage) also keeps a serialization failure a
			// clean per-call rejection instead of a fatal postMessage throw.
			return { id: msg.id, ok: true, value: value === undefined ? undefined : JSON.parse(JSON.stringify(value)) };
		} catch (err) {
			return { id: msg.id, ok: false, error: err instanceof Error ? err.message : String(err) };
		}
		// oxlint-disable unicorn/require-post-message-target-origin -- worker_threads port, not a browser window
	})().then((result) => {
		try {
			parentPort!.postMessage(result);
		} catch (err) {
			// Last-resort: the serialized result still can't be cloned (e.g. contains a
			// BigInt). Post a per-call error so the promise rejects cleanly instead of
			// this throw crashing the worker (it would surface as a generic crash/500).
			parentPort!.postMessage({
				id: msg.id,
				ok: false,
				error: `engine result is not serializable: ${err instanceof Error ? err.message : String(err)}`,
			});
		}
	});
	// oxlint-enable unicorn/require-post-message-target-origin
});

// Tell the parent the engine finished importing and is ready for calls. Until this
// arrives the parent must not dispatch (a slow import must not eat into call timeouts).
// oxlint-disable-next-line unicorn/require-post-message-target-origin -- worker_threads port, not a browser window
parentPort!.postMessage({ ready: true });
