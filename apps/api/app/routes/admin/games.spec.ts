// Run via `pnpm test` (the package.json script), NOT bare `node --test` — see
// routes/game/index.spec.ts.
import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { ObjectId } from "mongodb";
import { colls, db } from "../../config/db.ts";
import env from "../../config/env.ts";
import { testGame, testUser } from "../../config/test-helpers.ts";
import { createAccessToken, generateRefreshCode, hashRefreshCode } from "../../models/jwtrefreshtokens.ts";

const baseURL = () => `http://${env.listen.host}:${env.listen.port.api}`;

async function api(method: string, path: string, headers?: Record<string, string>, body?: unknown) {
	const res = await fetch(`${baseURL()}${path}`, {
		method,
		headers: { ...(body !== undefined ? { "content-type": "application/json" } : {}), ...headers },
		body: body !== undefined ? JSON.stringify(body) : undefined,
	});
	const data: unknown = res.headers.get("content-type")?.includes("application/json")
		? await res.json()
		: await res.text();
	return { status: res.status, data };
}

async function makeAuthHeaders(userId: ObjectId) {
	const code = generateRefreshCode();
	const tokenDoc = { user: userId, codeHash: hashRefreshCode(code), createdAt: new Date() };
	await colls.jwtRefreshTokens.insertOne(tokenDoc);
	const token = await createAccessToken(tokenDoc, ["all"], true);
	return { Authorization: `Bearer ${token}` };
}

describe("Admin game cancel API", () => {
	const adminId = new ObjectId();
	const userId = new ObjectId();
	let adminHeaders: Record<string, string>;
	let userHeaders: Record<string, string>;

	before(async () => {
		await colls.users.insertOne(testUser({ _id: adminId, authority: "admin" }));
		await colls.users.insertOne(testUser({ _id: userId }));
		adminHeaders = await makeAuthHeaders(adminId);
		userHeaders = await makeAuthHeaders(userId);
	});

	after(() => db().dropDatabase());

	function insertActiveGame(overrides: Partial<Parameters<typeof testGame>[0]> = {}) {
		return colls.games.insertOne(
			testGame({
				_id: new ObjectId().toHexString(),
				game: { name: "test", version: 1 },
				status: "active",
				creator: new ObjectId(),
				players: [{ _id: new ObjectId(), name: "alice" }],
				currentPlayers: [{ _id: new ObjectId(), timerStart: new Date() }],
				...overrides,
			}),
		);
	}

	it("cancels an active game and creates a gameEnded notification", async () => {
		const { insertedId } = await insertActiveGame();
		const gameId = insertedId.toString();

		const res = await api("POST", `/api/admin/games/${gameId}/cancel`, adminHeaders);
		assert.strictEqual(res.status, 200, JSON.stringify(res.data));

		const game = await colls.games.findOne({ _id: gameId });
		assert.strictEqual(game?.status, "ended");
		assert.strictEqual(game?.cancelled, true);
		assert.deepEqual(game?.currentPlayers, []);

		const notification = await colls.gameNotifications.findOne({ game: gameId, kind: "gameEnded" });
		assert.ok(notification, "expected a gameEnded notification");
		assert.strictEqual(notification.processed, false);

		const chat = await colls.chatMessages.findOne({ room: gameId, type: "system" });
		assert.strictEqual(chat?.data.text, "Game cancelled by an admin");
	});

	it("rejects non-admin callers", async () => {
		const { insertedId } = await insertActiveGame();
		const gameId = insertedId.toString();

		for (const headers of [undefined, userHeaders]) {
			const res = await api("POST", `/api/admin/games/${gameId}/cancel`, headers);
			assert.strictEqual(res.status, 403, JSON.stringify(res.data));
		}
	});

	it("rejects cancelling a non-active game", async () => {
		const { insertedId } = await insertActiveGame({ status: "ended", cancelled: true, currentPlayers: [] });
		const gameId = insertedId.toString();

		const res = await api("POST", `/api/admin/games/${gameId}/cancel`, adminHeaders);
		assert.strictEqual(res.status, 409, JSON.stringify(res.data));
	});

	it("404s when the game is missing", async () => {
		const res = await api("POST", `/api/admin/games/${new ObjectId().toHexString()}/cancel`, adminHeaders);
		assert.strictEqual(res.status, 404);
	});
});
