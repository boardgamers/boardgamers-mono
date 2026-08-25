import type { ApiErrorDoc } from "@bgs/models";
import assert from "node:assert/strict";
import { describe, it, mock } from "node:test";
import type { Engine } from "../types/engine.ts";

// This spec asserts on the structured log lines themselves — opt back into
// stdout logging (they're suppressed under NODE_ENV=test, see @bgs/utils/log).
// Set before importing the module under test: the flag is read at module load.
process.env.logToStdout = "true";
const { currentEngineCall, moveString, setSlowCallRecorder, trackedEngine } = await import("./engine-call-context.ts");

// Capture persisted slow-call docs instead of hitting Mongo — this spec must run
// without a db connection (the default recorder lazily imports config/db.ts).
const recordedSlowCalls: ApiErrorDoc[] = [];
setSlowCallRecorder((doc) => recordedSlowCalls.push(doc));

const ATTRIBUTION = { gameId: "game-1", game: "gaia-project", version: 4 };

// Fake engines only implement what each test calls — the proxy probes methods lazily.
// oxlint-disable-next-line typescript/no-unsafe-type-assertion -- test double
const asEngine = (obj: object) => obj as Engine;

describe("trackedEngine / currentEngineCall", () => {
	it("exposes the in-flight call (game, method, player, move) and clears it after", () => {
		let seen: Record<string, unknown> | undefined;
		const engine = trackedEngine(
			asEngine({
				scores() {
					seen = currentEngineCall();
					return [1, 2];
				},
			}),
			{ ...ATTRIBUTION, playerIndex: 1, playerName: "alice", move: "up 3." },
		);

		assert.deepEqual(engine.scores({}), [1, 2]);
		assert.ok(seen, "context must be set during the call");
		assert.equal(seen.gameId, "game-1");
		assert.equal(seen.game, "gaia-project");
		assert.equal(seen.version, 4);
		assert.equal(seen.method, "scores");
		assert.equal(seen.playerIndex, 1);
		assert.equal(seen.playerName, "alice");
		assert.equal(seen.move, "up 3.");
		assert.equal(typeof seen.engineCallMs, "number");
		assert.equal(currentEngineCall(), undefined, "context must be cleared after the call");
	});

	it("keeps the context set while an async engine call is pending, clears at settle", async () => {
		const engine = trackedEngine(
			asEngine({
				async dropPlayer(data: unknown) {
					await new Promise((r) => setTimeout(r, 20));
					return data;
				},
			}),
			ATTRIBUTION,
		);

		const pending = engine.dropPlayer({ ok: true }, 0);
		const during = currentEngineCall();
		assert.equal(during?.method, "dropPlayer");
		assert.deepEqual(await pending, { ok: true });
		assert.equal(currentEngineCall(), undefined);
	});

	it("clears the context and propagates the error when the engine throws", async () => {
		const engine = trackedEngine(
			asEngine({
				ended() {
					throw new Error("sync boom");
				},
				async replay() {
					throw new Error("async boom");
				},
			}),
			ATTRIBUTION,
		);

		assert.throws(() => engine.ended({}), /sync boom/);
		assert.equal(currentEngineCall(), undefined);
		await assert.rejects(async () => engine.replay({}), /async boom/);
		assert.equal(currentEngineCall(), undefined);
	});

	it("logs a slowEngineCall warning and persists an apiErrors doc when a call overruns the threshold", () => {
		recordedSlowCalls.length = 0;
		const write = mock.method(process.stdout, "write");
		try {
			const engine = trackedEngine(
				asEngine({
					logLength() {
						const until = Date.now() + 30;
						while (Date.now() < until) {}
						return 7;
					},
				}),
				{ ...ATTRIBUTION, playerIndex: 0, playerName: "bob", move: { pass: true } },
				10,
			);
			assert.equal(engine.logLength({}), 7);
		} finally {
			write.mock.restore();
		}

		const lines = write.mock.calls.map((c) => String(c.arguments[0]));
		const slow = lines.find((l) => l.includes('"slowEngineCall"'));
		assert.ok(slow, "expected a slowEngineCall log line");
		// oxlint-disable-next-line typescript/no-unsafe-type-assertion -- shape asserted below
		const parsed = JSON.parse(slow) as Record<string, unknown>;
		assert.equal(parsed.level, "warn");
		assert.equal(parsed.gameId, "game-1");
		assert.equal(parsed.method, "logLength");
		assert.equal(parsed.playerName, "bob");
		assert.equal(parsed.move, '{"pass":true}');
		assert.ok(typeof parsed.elapsedMs === "number" && parsed.elapsedMs >= 30);

		// The same slow call is persisted for the admin hangs page.
		assert.equal(recordedSlowCalls.length, 1);
		const doc = recordedSlowCalls[0];
		assert.equal(doc.error.name, "SlowEngineCall");
		assert.match(doc.error.message, /^Engine gaia-project\.logLength took \d+ms$/);
		assert.equal(doc.request.url, "engine://game-1/logLength");
		assert.equal(doc.meta.source, "game-server");
		assert.equal(doc.meta.gameId, "game-1");
		assert.equal(doc.meta.game, "gaia-project");
		assert.equal(doc.meta.version, 4);
		assert.equal(doc.meta.method, "logLength");
		assert.equal(doc.meta.playerIndex, 0);
		assert.equal(doc.meta.playerName, "bob");
		assert.equal(doc.meta.move, '{"pass":true}');
		assert.ok(typeof doc.meta.elapsedMs === "number" && doc.meta.elapsedMs >= 30);
	});

	it("does not log fast calls and passes non-function properties through", () => {
		const write = mock.method(process.stdout, "write");
		try {
			const engine = trackedEngine(asEngine({ ended: () => false }), ATTRIBUTION);
			assert.equal(engine.ended({}), false);
			// oxlint-disable-next-line typescript/unbound-method -- existence check, not a call
			assert.equal(engine.stripSecret, undefined);
		} finally {
			write.mock.restore();
		}
		assert.ok(!write.mock.calls.some((c) => String(c.arguments[0]).includes('"slowEngineCall"')));
	});

	it("is idempotent: re-wrapping a tracked engine keeps the original (most specific) attribution", () => {
		let seen: Record<string, unknown> | undefined;
		const inner = trackedEngine(
			asEngine({
				currentPlayer() {
					seen = currentEngineCall();
					return 0;
				},
			}),
			{ ...ATTRIBUTION, playerIndex: 2, playerName: "carol", move: "spend 4pw" },
		);
		const outer = trackedEngine(inner, ATTRIBUTION);
		assert.equal(outer, inner);
		outer.currentPlayer({});
		assert.equal(seen?.playerName, "carol");
		assert.equal(seen?.move, "spend 4pw");
	});
});

describe("moveString", () => {
	it("keeps strings, stringifies objects, drops null/undefined", () => {
		assert.equal(moveString("booster5"), "booster5");
		assert.equal(moveString({ a: 1 }), '{"a":1}');
		assert.equal(moveString(null), undefined);
		assert.equal(moveString(undefined), undefined);
	});

	it("bounds very long moves", () => {
		const long = "x".repeat(500);
		const out = moveString(long);
		assert.ok(out && out.length <= 200 && out.endsWith("…"));
	});

	it("never throws on a non-serializable move", () => {
		const circular: Record<string, unknown> = {};
		circular.self = circular;
		assert.equal(moveString(circular), "[unserializable move]");
		assert.equal(
			moveString(() => {}),
			"[unserializable move]",
		);
	});
});
