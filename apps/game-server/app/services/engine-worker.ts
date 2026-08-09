/**
 * Worker-thread entrypoint that hosts one game engine and executes method calls on it.
 *
 * Runs inside a `Worker` spawned by engine-runner.ts (never directly). The engine is
 * dynamically imported from `workerData.path` (the same resolved path engines.ts
 * computes), then each `{ id, method, args }` message on the parent port is dispatched
 * to `engine[method](...args)` and the structured-cloneable result is posted back.
 *
 * All engine inputs/outputs are plain JSON game state (see Engine / GameData), so they
 * cross the thread boundary by structured clone. If an engine method wedges the
 * worker's event loop (an infinite `while` loop), the parent simply never receives the
 * result and terminates the worker on timeout — the main game-server stays responsive.
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
			return { id: msg.id, ok: true, value };
		} catch (err) {
			return { id: msg.id, ok: false, error: err instanceof Error ? err.message : String(err) };
		}
		// oxlint-disable-next-line unicorn/require-post-message-target-origin -- worker_threads port, not a browser window
	})().then((result) => parentPort!.postMessage(result));
});

// Tell the parent the engine finished importing and is ready for calls. Until this
// arrives the parent must not dispatch (a slow import must not eat into call timeouts).
// oxlint-disable-next-line unicorn/require-post-message-target-origin -- worker_threads port, not a browser window
parentPort!.postMessage({ ready: true });
