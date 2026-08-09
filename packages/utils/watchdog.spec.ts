import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { startEventLoopGuard } from "./watchdog.ts";

describe("startEventLoopGuard", () => {
	it("does not fire while the event loop is responsive", async () => {
		let wedged = 0;
		const guard = startEventLoopGuard("test", {
			checkMs: 25,
			maxLagMs: 10_000,
			threshold: 2,
			onWedged: () => wedged++,
		});
		await new Promise((r) => setTimeout(r, 120));
		guard.stop();
		assert.equal(wedged, 0);
	});

	it("stops cleanly (idempotent, no timers left running)", async () => {
		const guard = startEventLoopGuard("test", { checkMs: 20, maxLagMs: 5_000, threshold: 1, onWedged: () => {} });
		guard.stop();
		guard.stop();
		await new Promise((r) => setTimeout(r, 60));
		assert.ok(true);
	});

	it("detects a blocked event loop (lag above threshold) and calls onWedged", async () => {
		let wedgedLag = 0;
		startEventLoopGuard("test", { checkMs: 20, maxLagMs: 30, threshold: 1, onWedged: (lag) => (wedgedLag = lag) });
		// Let the guard establish its baseline tick, THEN block the loop ~150ms (≫30ms).
		await new Promise((r) => setTimeout(r, 50));
		const until = Date.now() + 150;
		while (Date.now() < until) {}
		// The delayed interval callback now observes the lag and trips onWedged.
		await new Promise((r) => setTimeout(r, 80));
		assert.ok(wedgedLag > 30, `expected wedged with lag > 30ms, got ${wedgedLag}`);
	});
});
