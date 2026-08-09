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
	return {
		dir,
		ok: path.join(dir, "ok.mjs"),
		loop: path.join(dir, "loop.mjs"),
		throw: path.join(dir, "throw.mjs"),
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
		// The looping worker was terminated above; a new call on the same key respawns.
		// (Use the healthy engine under the looping key's name to prove respawn works.)
		const out = await runner.call("loop", 1, engines.ok, "move", [{ n: 5 }, "d4", 1]);
		assert.deepEqual(out, { n: 6, last: "d4" });
	});

	it("propagates engine-thrown errors (not timeouts)", async () => {
		await assert.rejects(runner.call("throw", 1, engines.throw, "move", [{}, "x", 0]), /bad move/);
	});
});
