// Run via `pnpm test` (needs a Mongo db, see AGENTS.md). Covers the move-route
// EngineTimeoutError attribution: the apiErrors entry (and Loki log) must name the
// acting player and the move, not just the game — a stuck engine has to be traceable
// without cross-referencing user ObjectIds.
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, before, describe, it } from "node:test";
import jwt from "jsonwebtoken";
import { ObjectId } from "mongodb";

// Env overrides must land before the app (and the shared engineRunner) load:
// a short engine timeout keeps the suite fast, and each spec file runs in its own
// process so this can't leak into other suites.
process.env.ENGINE_CALL_TIMEOUT_MS = "300";
process.env.port = String(52000 + Math.floor(Math.random() * 1000));

const { colls, closeDb } = await import("../config/db.ts");
const env = (await import("../config/env.ts")).default;
const { engineKey } = await import("../services/engines.ts");
const { engineRunner } = await import("../services/engine-runner.ts");
const { listen } = await import("../app.ts");

const ENGINE_NAME = "timeout-test";
const ENGINE_VERSION = 1;
const GAME_ID = "timeout-game-1";

function makeEngine(dir: string) {
	fs.writeFileSync(
		path.join(dir, "engine.mjs"),
		`export async function move() { for (;;) {} }
		export function ended() { return false; }
		export function scores() { return [0]; }
		export function currentPlayer() { return 0; }
		export function logLength() { return 0; }
		export function logSlice() { return { log: [] }; }
		export async function dropPlayer(data) { return data; }`,
	);
	return path.join(dir, "engine.mjs");
}

function installEngine(sourceFile: string) {
	const key = engineKey(ENGINE_NAME, ENGINE_VERSION, { name: "@test/timeout", version: "1.0.0" });
	const dir = new URL(`../../games/node_modules/${key}/`, import.meta.url);
	fs.mkdirSync(dir, { recursive: true });
	fs.copyFileSync(sourceFile, new URL(path.basename(sourceFile), dir));
}

async function waitFor<T>(cond: () => Promise<T | null | undefined>, timeoutMs = 5_000): Promise<T> {
	const start = Date.now();
	for (;;) {
		const value = await cond();
		if (value) {
			return value;
		}
		if (Date.now() - start > timeoutMs) {
			throw new Error("Timed out waiting for condition");
		}
		await new Promise((r) => setTimeout(r, 25));
	}
}

describe("POST /:gameId/move — engine timeout attribution", () => {
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), "bgs-timeout-engine-"));
	const playerId = new ObjectId();
	let server: Awaited<ReturnType<typeof listen>>;

	before(async () => {
		await colls.games.deleteMany({ _id: GAME_ID });
		await colls.gameInfos.deleteMany({ "_id.game": ENGINE_NAME });
		await colls.apiErrors.deleteMany({ "meta.gameId": GAME_ID });
		await colls.gameInfos.insertOne({
			_id: { game: ENGINE_NAME, version: ENGINE_VERSION },
			viewer: { url: "//test/timeout" },
			public: true,
			meta: { bots: false },
			engine: { package: { name: "@test/timeout", version: "1.0.0" }, entryPoint: "engine.mjs" },
		});
		installEngine(makeEngine(dir));
		await colls.games.insertOne({
			_id: GAME_ID,
			players: [{ _id: playerId, remainingTime: 5000, score: 0, dropped: false, quit: false, name: "alice" }],
			creator: playerId,
			currentPlayers: [{ _id: playerId, timerStart: new Date(), deadline: new Date(Date.now() + 3600_000) }],
			data: {},
			context: { round: 0 },
			options: {
				setup: { seed: GAME_ID, nbPlayers: 1, playerOrder: "join" },
				timing: { timePerGame: 5000, timePerMove: 5000, timer: { start: 0, end: 86400 } },
			},
			game: { name: ENGINE_NAME, version: ENGINE_VERSION, expansions: [] },
			status: "active",
			ready: true,
			cancelled: false,
			createdAt: new Date(),
			updatedAt: new Date(),
			lastMove: new Date(),
		});
		server = await listen();
	});

	after(async () => {
		server?.close();
		await engineRunner.close();
		await closeDb();
		fs.rmSync(dir, { recursive: true, force: true });
	});

	it("responds 422 and records an apiErrors entry naming the player and move", async () => {
		const token = jwt.sign(
			{ userId: playerId.toHexString(), isAdmin: false, scopes: ["gameplay"] },
			env.jwt.keys.public,
		);
		const res = await fetch(`http://127.0.0.1:${env.listen.port}/api/gameplay/${GAME_ID}/move`, {
			method: "POST",
			headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
			body: JSON.stringify({ move: "loop forever" }),
		});
		assert.equal(res.status, 422);

		// The apiErrors insert is fire-and-forget in the route — poll for it.
		const doc = await waitFor(() => colls.apiErrors.findOne({ "meta.gameId": GAME_ID }));
		assert.equal(doc.error.name, "EngineTimeoutError");
		assert.equal(doc.meta.source, "game-server");
		assert.equal(doc.meta.game, ENGINE_NAME);
		assert.equal(doc.meta.version, ENGINE_VERSION);
		assert.equal(doc.meta.action, "move");
		assert.equal(doc.meta.playerIndex, 0);
		assert.equal(doc.meta.playerName, "alice");
		assert.equal(doc.meta.move, "loop forever");
		assert.ok(doc.user?.equals(playerId));
	});
});
