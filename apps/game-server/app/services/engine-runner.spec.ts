import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, describe, it } from "node:test";
import { EngineRunner, EngineTimeoutError } from "./engine-runner.ts";

// Write throwaway engines to a temp dir. `loop` is the runaway: a synchronous
// infinite loop that would wedge the main event loop if run in-process.
function makeEngines() {
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), "bgs-engine-"));
	fs.writeFileSync(
		path.join(dir, "ok.mjs"),
		`export async function move(data, move) { return { ...data, last: move, n: (data.n ?? 0) + 1 }; }
		 export function ended(data) { return false; }
		 export function logLength(data) { return data.n ?? 0; }`,
	);
	fs.writeFileSync(path.join(dir, "loop.mjs"), `export async function move() { for (;;) {} }`);
	fs.writeFileSync(path.join(dir, "throw.mjs"), `export async function move() { throw new Error("bad move"); }`);
	// Mimics engines like gaia-project whose move() returns a LIVE class instance with
	// closures / EventEmitters in it — not structured-cloneable as-is. The worker must
	// serialize the result to plain JSON before posting (else postMessage throws
	// DataCloneError), so the caller receives clean JSON, not the class.
	fs.writeFileSync(
		path.join(dir, "classy.mjs"),
		`class State {
		   constructor(prev) {
		     this.n = (prev?.n ?? 0) + 1;
		     this.board = {};
		     // A closure capturing \`this\` — the exact shape that made gaia-project's
		     // move() result fail to structured-clone (DataCloneError).
		     this.handler = (...args) => this.board.handlers?.(...args);
		   }
		 }
		 export async function move(data) { return new State(data); }`,
	);
	return {
		dir,
		ok: path.join(dir, "ok.mjs"),
		loop: path.join(dir, "loop.mjs"),
		throw: path.join(dir, "throw.mjs"),
		classy: path.join(dir, "classy.mjs"),
	};
}

describe("EngineRunner (worker_thread isolation)", () => {
	const engines = makeEngines();
	const runner = new EngineRunner(500); // 500ms budget so the test is fast

	after(async () => {
		await runner.close();
		fs.rmSync(engines.dir, { recursive: true, force: true });
	});

	it("runs a healthy engine method and returns its result", async () => {
		const out = await runner.call("ok", 1, engines.ok, "move", [{ n: 1 }, "e2e4", 0]);
		assert.deepEqual(out, { n: 2, last: "e2e4" });
	});

	it("a runaway engine (infinite loop) times out and is terminated — main thread stays responsive", async () => {
		// Prove the main event loop keeps ticking while the engine is wedged.
		let mainTicked = false;
		const tick = setTimeout(() => {
			mainTicked = true;
		}, 100);

		await assert.rejects(runner.call("loop", 1, engines.loop, "move", [{}, "x", 0]), EngineTimeoutError);
		clearTimeout(tick);

		// The main loop scheduled and ran a timer during the wedged call → not blocked.
		assert.equal(mainTicked, true);
	});

	it("recovers: a fresh worker serves the next call after its worker was terminated", async () => {
		// The looping worker (keyed by the engines.loop path) was terminated above. The
		// healthy engine keeps working on its own worker, unaffected by the kill.
		const out = await runner.call("ok", 1, engines.ok, "move", [{ n: 5 }, "d4", 1]);
		assert.deepEqual(out, { n: 6, last: "d4" });
	});

	it("an engine bump (new path, same game+version) spawns a fresh worker, not the stale one", async () => {
		// Workers are keyed by resolved path, which embeds the engine package version.
		// Two paths for the "same" game+version must not share a worker.
		fs.writeFileSync(path.join(engines.dir, "v2.mjs"), `export async function move() { return { v: 2 }; }`);
		const out = await runner.call("ok", 1, path.join(engines.dir, "v2.mjs"), "move", [{}, "x", 0]);
		assert.deepEqual(out, { v: 2 }); // served by the v2 module, not the cached ok.mjs worker
	});

	it("propagates engine-thrown errors (not timeouts)", async () => {
		await assert.rejects(runner.call("throw", 1, engines.throw, "move", [{}, "x", 0]), /bad move/);
	});

	it("serializes an engine result holding closures / an EventEmitter (gaia-style) instead of throwing DataCloneError", async () => {
		// Regression test for the gaia-project DataCloneError: move() returns a live
		// class instance with listener closures; the worker must strip it to plain JSON
		// before posting, so the caller gets JSON — not a structured-clone failure.
		const out = await runner.call("classy", 1, engines.classy, "move", [{ n: 3 }, "x", 0]);
		assert.deepEqual(out, { n: 4, board: {} });
		// The returned value must be a plain object (no prototype / class), ready for
		// Mongo persistence and re-clone.
		assert.equal(Object.getPrototypeOf(out), Object.prototype);
	});

	it("a worker survives a call whose result needed serialization and still serves the next call", async () => {
		// The serialization happens inside the worker, so a result that can't be
		// structured-cloned must not kill the worker — the same worker stays usable.
		await runner.call("classy", 1, engines.classy, "move", [{ n: 0 }, "x", 0]);
		const out = await runner.call("classy", 1, engines.classy, "move", [{ n: 10 }, "x", 0]);
		assert.deepEqual(out, { n: 11, board: {} });
	});
});
