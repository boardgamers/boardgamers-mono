// Run via `pnpm test` (the package.json script), NOT bare `node --test`. The script
// imports app/config/test-hooks.ts, which connects to the *-test database and starts
// the API server. Running this file directly leaves `colls` uninitialized.
import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { ObjectId } from "mongodb";
import { CHAT_REACTION_EMOJI, MAX_CHAT_REACTIONS_PER_MESSAGE, type ChatReactionAggregate } from "@bgs/models";
import { colls, db } from "../../config/db.ts";
import env from "../../config/env.ts";
import { testGame, testUser } from "../../config/test-helpers.ts";
import { ACTION_RATE_LIMITS } from "../../services/actionratelimit.ts";
import { createAccessToken, generateRefreshCode, hashRefreshCode } from "../../models/jwtrefreshtokens.ts";

const baseURL = () => `http://${env.listen.host}:${env.listen.port.api}`;

async function api(method: string, path: string, headers?: Record<string, string>) {
	const res = await fetch(`${baseURL()}${path}`, {
		method,
		headers: { "Content-Type": "application/json", ...headers },
	});
	const data: unknown = res.headers.get("content-type")?.includes("application/json")
		? await res.json()
		: await res.text();
	return { status: res.status, data, ok: res.ok };
}

async function makeAuthHeaders(userId: ObjectId) {
	const code = generateRefreshCode();
	const tokenDoc = { user: userId, codeHash: hashRefreshCode(code), createdAt: new Date() };
	await colls.jwtRefreshTokens.insertOne(tokenDoc);
	const token = await createAccessToken(tokenDoc, ["all"], false);
	return { Authorization: `Bearer ${token}` };
}

function reactionUrl(gameId: string, messageId: ObjectId, emoji: string) {
	return `/api/game/${gameId}/chat/${messageId.toHexString()}/reaction/${encodeURIComponent(emoji)}`;
}

// oxlint-disable-next-line typescript/no-unsafe-type-assertion -- test responses are unvalidated JSON
const asAggregate = (data: unknown) => data as ChatReactionAggregate;

describe("Chat reactions API", () => {
	const gameId = "reaction-game";
	const playerId = new ObjectId();
	const otherPlayerId = new ObjectId();
	const outsiderId = new ObjectId();
	const messageId = new ObjectId();
	let playerHeaders: Record<string, string> = {};
	let otherPlayerHeaders: Record<string, string> = {};
	let outsiderHeaders: Record<string, string> = {};

	before(async () => {
		await colls.users.insertOne(testUser({ _id: playerId, account: { username: "player", email: "player@test.com" } }));
		await colls.users.insertOne(
			testUser({ _id: otherPlayerId, account: { username: "other", email: "other@test.com" } }),
		);
		await colls.users.insertOne(
			testUser({ _id: outsiderId, account: { username: "outsider", email: "outsider@test.com" } }),
		);
		await colls.games.insertOne(
			testGame({
				_id: gameId,
				game: { name: "test", version: 1 },
				status: "active",
				players: [
					{ _id: playerId, name: "player" },
					{ _id: otherPlayerId, name: "other" },
				],
			}),
		);
		await colls.chatMessages.insertOne({
			_id: messageId,
			room: gameId,
			author: { _id: playerId, name: "player" },
			data: { text: "gg" },
			type: "text",
		});
		playerHeaders = await makeAuthHeaders(playerId);
		otherPlayerHeaders = await makeAuthHeaders(otherPlayerId);
		outsiderHeaders = await makeAuthHeaders(outsiderId);
	});

	it("sets a reaction idempotently and aggregates per emoji", async () => {
		const first = await api("PUT", reactionUrl(gameId, messageId, "👍"), playerHeaders);
		assert.strictEqual(first.status, 200);
		assert.deepStrictEqual(asAggregate(first.data), {
			message: messageId.toHexString(),
			reactions: [{ emoji: "👍", users: [{ _id: playerId.toHexString(), name: "player" }] }],
		});

		const doc = await colls.chatReactions.findOne({ message: messageId, user: playerId, emoji: "👍" });
		assert.ok(doc);
		assert.strictEqual(doc.active, true);
		const updatedAt = doc.updatedAt;

		// Repeated set: no duplicate user, and no updatedAt bump (the websocket
		// watermark poll must not re-push an unchanged reaction).
		const second = await api("PUT", reactionUrl(gameId, messageId, "👍"), playerHeaders);
		assert.strictEqual(second.status, 200);
		assert.strictEqual(asAggregate(second.data).reactions[0].users.length, 1);
		const unchanged = await colls.chatReactions.findOne({ message: messageId, user: playerId, emoji: "👍" });
		assert.deepStrictEqual(unchanged?.updatedAt, updatedAt);

		// A second player on the same emoji joins the same group, in reaction order.
		const third = await api("PUT", reactionUrl(gameId, messageId, "👍"), otherPlayerHeaders);
		assert.strictEqual(third.status, 200);
		assert.deepStrictEqual(
			asAggregate(third.data).reactions[0].users.map((u) => u.name),
			["player", "other"],
		);
	});

	it("unsets a reaction idempotently and reports an empty aggregate when the last one goes", async () => {
		const del = await api("DELETE", reactionUrl(gameId, messageId, "👍"), otherPlayerHeaders);
		assert.strictEqual(del.status, 200);
		assert.deepStrictEqual(
			asAggregate(del.data).reactions[0].users.map((u) => u.name),
			["player"],
		);

		// Unset keeps the doc (flipped inactive) so the ws watermark sees the change.
		const doc = await colls.chatReactions.findOne({ message: messageId, user: otherPlayerId, emoji: "👍" });
		assert.strictEqual(doc?.active, false);
		const updatedAt = doc.updatedAt;

		// Repeated unset: still 200, and no updatedAt bump.
		const again = await api("DELETE", reactionUrl(gameId, messageId, "👍"), otherPlayerHeaders);
		assert.strictEqual(again.status, 200);
		const unchanged = await colls.chatReactions.findOne({ message: messageId, user: otherPlayerId, emoji: "👍" });
		assert.deepStrictEqual(unchanged?.updatedAt, updatedAt);

		const last = await api("DELETE", reactionUrl(gameId, messageId, "👍"), playerHeaders);
		assert.strictEqual(last.status, 200);
		assert.deepStrictEqual(asAggregate(last.data), { message: messageId.toHexString(), reactions: [] });
	});

	it("requires login", async () => {
		const res = await api("PUT", reactionUrl(gameId, messageId, "👍"));
		assert.strictEqual(res.status, 401);
	});

	it("rejects non-players", async () => {
		const res = await api("PUT", reactionUrl(gameId, messageId, "👍"), outsiderHeaders);
		assert.strictEqual(res.status, 422);
	});

	it("rejects emoji outside the whitelist", async () => {
		for (const emoji of ["x", "not-an-emoji", "💊💊"]) {
			const res = await api("PUT", reactionUrl(gameId, messageId, emoji), playerHeaders);
			assert.strictEqual(res.status, 400, emoji);
		}
	});

	it("404s on a message outside the game's room", async () => {
		const foreignMessage = new ObjectId();
		await colls.chatMessages.insertOne({
			_id: foreignMessage,
			room: "some-other-room",
			data: { text: "hi" },
			type: "text",
		});
		const res = await api("PUT", reactionUrl(gameId, foreignMessage, "👍"), playerHeaders);
		assert.strictEqual(res.status, 404);

		const missing = await api("PUT", reactionUrl(gameId, new ObjectId(), "👍"), playerHeaders);
		assert.strictEqual(missing.status, 404);
	});

	it("caps distinct active emoji per message per user", async () => {
		const target = new ObjectId();
		await colls.chatMessages.insertOne({ _id: target, room: gameId, data: { text: "cap me" }, type: "text" });

		const emoji = CHAT_REACTION_EMOJI.slice(0, MAX_CHAT_REACTIONS_PER_MESSAGE + 1);
		for (const e of emoji.slice(0, MAX_CHAT_REACTIONS_PER_MESSAGE)) {
			const res = await api("PUT", reactionUrl(gameId, target, e), playerHeaders);
			assert.strictEqual(res.status, 200, e);
		}
		const over = await api("PUT", reactionUrl(gameId, target, emoji[MAX_CHAT_REACTIONS_PER_MESSAGE]), playerHeaders);
		assert.strictEqual(over.status, 400);

		// Re-setting an emoji already in the set is NOT blocked by the cap…
		const reset = await api("PUT", reactionUrl(gameId, target, emoji[0]), playerHeaders);
		assert.strictEqual(reset.status, 200);

		// …and unsetting one frees a slot.
		await api("DELETE", reactionUrl(gameId, target, emoji[0]), playerHeaders);
		const freed = await api("PUT", reactionUrl(gameId, target, emoji[MAX_CHAT_REACTIONS_PER_MESSAGE]), playerHeaders);
		assert.strictEqual(freed.status, 200);
	});

	it("rate limits reaction toggles", async () => {
		// A fresh user so hits from the other tests don't count into the window.
		const limitedId = new ObjectId();
		await colls.users.insertOne(
			testUser({ _id: limitedId, account: { username: "limited", email: "limited@test.com" } }),
		);
		const limitedHeaders = await makeAuthHeaders(limitedId);
		const limitedGame = "reaction-rate-limit-game";
		await colls.games.insertOne(
			testGame({
				_id: limitedGame,
				game: { name: "test", version: 1 },
				status: "active",
				players: [{ _id: limitedId, name: "limited" }],
			}),
		);
		const target = new ObjectId();
		await colls.chatMessages.insertOne({ _id: target, room: limitedGame, data: { text: "spam me" }, type: "text" });

		// Tighten the registered limit (a registry entry beats the suite-wide test
		// relaxation), restore it afterwards.
		const saved = ACTION_RATE_LIMITS["game/chat-reaction"];
		ACTION_RATE_LIMITS["game/chat-reaction"] = { max: 2, windowMs: 60 * 1000 };
		try {
			assert.strictEqual((await api("PUT", reactionUrl(limitedGame, target, "👍"), limitedHeaders)).status, 200);
			assert.strictEqual((await api("DELETE", reactionUrl(limitedGame, target, "👍"), limitedHeaders)).status, 200);
			const limited = await api("PUT", reactionUrl(limitedGame, target, "👍"), limitedHeaders);
			assert.strictEqual(limited.status, 429);
		} finally {
			ACTION_RATE_LIMITS["game/chat-reaction"] = saved;
		}
	});

	after(() => db().dropDatabase());
});
