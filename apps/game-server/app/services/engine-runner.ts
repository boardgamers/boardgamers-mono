/**
 * Runs game-engine methods inside a `worker_thread` with a hard per-call timeout.
 *
 * Why: engines are third-party code loaded by dynamic `import()` (see engines.ts) and
 * run on the game-server's event loop. A `while (true)` in any engine method wedges
 * the whole process — the 2026-08-09 outage. A `Promise.race` timeout CANNOT help
 * there: JS can't preempt a synchronous busy loop on the same thread. A worker thread
 * can, because `worker.terminate()` kills the thread from outside.
 *
 * Model: one worker per engine (keyed by game+version), lazily spawned and reused
 * across calls (engines are stateless — all state is the GameData passed in/out).
 * A call that exceeds `timeoutMs` terminates the worker (so a wedged loop actually
 * dies), rejects with an EngineTimeoutError, and discards the worker so the next call
 * gets a fresh thread. The main process stays responsive throughout.
 */
import { Worker } from "node:worker_threads";
import type { Engine, GameData } from "../types/engine.ts";

export class EngineTimeoutError extends Error {
	readonly engineName: string;
	readonly method: string;
	readonly timeoutMs: number;

	constructor(engineName: string, method: string, timeoutMs: number) {
		super(`Engine ${engineName}.${method} did not finish within ${timeoutMs}ms (terminated)`);
		this.name = "EngineTimeoutError";
		this.engineName = engineName;
		this.method = method;
		this.timeoutMs = timeoutMs;
	}
}

type Pending = { resolve: (v: unknown) => void; reject: (e: Error) => void; timer: NodeJS.Timeout };

type WorkerEntry = {
	worker: Worker;
	ready: Promise<void>;
	pending: Map<number, Pending>;
	nextId: number;
	/** True once the worker has been terminated/errored — never reuse it. */
	dead: boolean;
};

const WORKER_URL = new URL("./engine-worker.ts", import.meta.url);

// Default per-call budget. Engine moves are normally milliseconds; 10s is generous
// headroom for the heaviest available-moves computation while still bounding a hang.
const DEFAULT_TIMEOUT_MS = Number(process.env.ENGINE_CALL_TIMEOUT_MS) || 10_000;

export class EngineRunner {
	private workers = new Map<string, WorkerEntry>();
	private readonly timeoutMs: number;

	constructor(timeoutMs = DEFAULT_TIMEOUT_MS) {
		this.timeoutMs = timeoutMs;
	}

	private spawn(key: string, path: string): WorkerEntry {
		const worker = new Worker(WORKER_URL, { workerData: { path } });
		const entry: WorkerEntry = { worker, ready: Promise.resolve(), pending: new Map(), nextId: 0, dead: false };

		entry.ready = new Promise<void>((resolve, reject) => {
			const onMessage = (msg: { ready?: boolean }) => {
				if (msg?.ready) {
					worker.off("message", onMessage);
					resolve();
				}
			};
			worker.on("message", onMessage);
			worker.once("error", reject);
		});

		worker.on("message", (msg: { id: number; ok: boolean; value?: unknown; error?: string }) => {
			const p = entry.pending.get(msg.id);
			if (!p) {
				return;
			}
			entry.pending.delete(msg.id);
			clearTimeout(p.timer);
			if (msg.ok) {
				p.resolve(msg.value);
			} else {
				p.reject(new Error(msg.error ?? "engine error"));
			}
		});

		const kill = (err: Error) => {
			entry.dead = true;
			for (const p of entry.pending.values()) {
				clearTimeout(p.timer);
				p.reject(err);
			}
			entry.pending.clear();
		};
		worker.once("error", (err) => kill(err));
		worker.once("exit", (code) => {
			if (code !== 0 && !entry.dead) {
				kill(new Error(`engine worker exited with code ${code}`));
			}
		});

		this.workers.set(key, entry);
		return entry;
	}

	/** Run one engine method in the worker, with a hard timeout. */
	async call(name: string, version: number, path: string, method: keyof Engine, args: unknown[]): Promise<unknown> {
		const key = `${name}_${version}`;
		let entry = this.workers.get(key);
		if (!entry || entry.dead) {
			entry = this.spawn(key, path);
		}

		await entry.ready;

		const id = entry.nextId++;
		return new Promise<unknown>((resolve, reject) => {
			const timer = setTimeout(() => {
				// The call overran: the worker may be wedged in a sync loop. Terminate the
				// thread (the only way to stop it) and drop it so the next call respawns.
				entry.dead = true;
				entry.pending.delete(id);
				void entry.worker.terminate();
				this.workers.delete(key);
				reject(new EngineTimeoutError(name, String(method), this.timeoutMs));
			}, this.timeoutMs);

			entry.pending.set(id, { resolve, reject, timer });
			// oxlint-disable-next-line unicorn/require-post-message-target-origin -- worker_threads port, not a browser window
			entry.worker.postMessage({ id, method, args });
		});
	}

	/** Terminate all workers (graceful shutdown / tests). */
	async close(): Promise<void> {
		const entries = [...this.workers.values()];
		this.workers.clear();
		await Promise.all(entries.map((e) => e.worker.terminate()));
	}
}

/** Convenience wrapper presenting an Engine-like surface backed by the runner. */
export function runEngineMethod(
	runner: EngineRunner,
	name: string,
	version: number,
	path: string,
	method: keyof Engine,
	...args: unknown[]
): Promise<GameData> {
	// GameData is `unknown`, and runner.call resolves unknown — no assertion needed.
	return runner.call(name, version, path, method, args);
}

/**
 * Shared runner for the serving process. One instance so workers are reused across
 * requests; closed on graceful shutdown (see server.ts).
 */
export const engineRunner = new EngineRunner();
