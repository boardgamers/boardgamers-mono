// Run via `pnpm test` (the package.json script), NOT bare `node --test`. The script
// imports app/config/test-hooks.ts, which connects to the *-test database and starts
// the API server. Running this file directly leaves `colls` uninitialized.
import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { ObjectId } from "mongodb";
import { LOBBY_ROOM, type ChatMessageDoc } from "@bgs/models";
import env from "../../config/env.ts";
import { colls, db } from "../../config/db.ts";
import { testUser } from "../../config/test-helpers.ts";
import { ACTION_RATE_LIMITS } from "../../services/actionratelimit.ts";
import { createAccessToken, generateRefreshCode, hashRefreshCode } from "../../models/jwtrefreshtokens.ts";

const baseURL = () => `http://${env.listen.host}:${env.listen.port.api}`;

async function api(method: string, path: string, body?: unknown, headers?: Record<string, string>) {
	const res = await fetch(`${baseURL()}${path}`, {
		method,
		headers: { "Content-Type": "application/json", ...headers },
		body: body ? JSON.stringify(body) : undefined,
	});
	const data: unknown = res.headers.get("content-type")?.includes("application/json")
		? await res.json()
		: await res.text();
	return { status: res.status, data, ok: res.ok };
}

function errorMessage(data: unknown): string | undefined {
	if (data && typeof data === "object" && "message" in data && typeof data.message === "string") {
		return data.message;
	}
	return undefined;
}

async function makeAuthHeaders(userId: ObjectId) {
	const code = generateRefreshCode();
	const tokenDoc = { user: userId, codeHash: hashRefreshCode(code), createdAt: new Date() };
	await colls.jwtRefreshTokens.insertOne(tokenDoc);
	const token = await createAccessToken(tokenDoc, ["all"], false);
	return { Authorization: `Bearer ${token}` };
}

describe("Lobby (public room) chat API", () => {
	// Two users NOT sharing any game — the lobby must not require game participation.
	const aliceId = new ObjectId();
	const bobId = new ObjectId();
	let aliceHeaders: Record<string, string> = {};
	let bobHeaders: Record<string, string> = {};

	function lobbyMessage(overrides: Partial<ChatMessageDoc> = {}): ChatMessageDoc & { _id: ObjectId } {
		return {
			_id: new ObjectId(),
			room: LOBBY_ROOM,
			author: { _id: aliceId, name: "lobbyalice" },
			data: { text: "original" },
			type: "text",
			...overrides,
		};
	}

	before(async () => {
		await colls.users.insertOne(
			testUser({ _id: aliceId, account: { username: "lobbyalice", email: "lobbyalice@test.com" } }),
		);
		await colls.users.insertOne(
			testUser({ _id: bobId, account: { username: "lobbybob", email: "lobbybob@test.com" } }),
		);
		aliceHeaders = await makeAuthHeaders(aliceId);
		bobHeaders = await makeAuthHeaders(bobId);
	});

	it("rejects a logged-out post", async () => {
		const res = await api("POST", `/api/room/${LOBBY_ROOM}/chat`, { type: "text", data: { text: "hi" } });
		assert.strictEqual(res.status, 401);
	});

	it("lets any logged-in user post — no game-participant check", async () => {
		const res = await api(
			"POST",
			`/api/room/${LOBBY_ROOM}/chat`,
			{ type: "text", data: { text: "hello lobby" } },
			aliceHeaders,
		);
		assert.strictEqual(res.status, 200, errorMessage(res.data));

		const message = await colls.chatMessages.findOne({ room: LOBBY_ROOM, "data.text": "hello lobby" });
		assert.ok(message);
		assert.strictEqual(message.author?.name, "lobbyalice");
		assert.strictEqual(message.type, "text");
	});

	it("404s on a room outside the public allow-list", async () => {
		for (const path of [
			"/api/room/not-a-room/chat",
			"/api/room/not-a-room/chat/lastRead",
			`/api/room/${new ObjectId().toString()}/chat`,
		]) {
			const res = await api("POST", path, { type: "text", data: { text: "hi" } }, aliceHeaders);
			assert.strictEqual(res.status, 404, path);
		}
	});

	it("rejects an unconfirmed user's post", async () => {
		const unconfirmedId = new ObjectId();
		await colls.users.insertOne(
			testUser({
				_id: unconfirmedId,
				account: { username: "lobbyunconfirmed", email: "lobbyunconfirmed@test.com" },
				security: { confirmed: false },
			}),
		);
		const headers = await makeAuthHeaders(unconfirmedId);
		const res = await api("POST", `/api/room/${LOBBY_ROOM}/chat`, { type: "text", data: { text: "hi" } }, headers);
		assert.strictEqual(res.status, 403);
	});

	it("rate limits lobby posts per user (game chat stays unlimited)", async () => {
		const limitedId = new ObjectId();
		await colls.users.insertOne(
			testUser({ _id: limitedId, account: { username: "lobbylimited", email: "lobbylimited@test.com" } }),
		);
		const limitedHeaders = await makeAuthHeaders(limitedId);

		// Tighten the registered limit (a registry entry beats the suite-wide test
		// relaxation), restore it afterwards.
		const saved = ACTION_RATE_LIMITS["room/chat-message"];
		ACTION_RATE_LIMITS["room/chat-message"] = { max: 2, windowMs: 60 * 1000 };
		try {
			for (const text of ["one", "two"]) {
				const res = await api("POST", `/api/room/${LOBBY_ROOM}/chat`, { type: "text", data: { text } }, limitedHeaders);
				assert.strictEqual(res.status, 200, errorMessage(res.data));
			}
			const limited = await api(
				"POST",
				`/api/room/${LOBBY_ROOM}/chat`,
				{ type: "text", data: { text: "three" } },
				limitedHeaders,
			);
			assert.strictEqual(limited.status, 429);
		} finally {
			ACTION_RATE_LIMITS["room/chat-message"] = saved;
		}
	});

	it("lets the author edit their lobby message, and nobody else", async () => {
		const message = lobbyMessage();
		await colls.chatMessages.insertOne(message);

		const hijack = await api(
			"PATCH",
			`/api/room/${LOBBY_ROOM}/chat/${message._id.toString()}`,
			{ data: { text: "hijack" } },
			bobHeaders,
		);
		assert.strictEqual(hijack.status, 422);
		assert.match(errorMessage(hijack.data) ?? "", /your own messages/);

		const res = await api(
			"PATCH",
			`/api/room/${LOBBY_ROOM}/chat/${message._id.toString()}`,
			{ data: { text: "fixed" } },
			aliceHeaders,
		);
		assert.strictEqual(res.status, 200, errorMessage(res.data));
		const updated = await colls.chatMessages.findOne({ _id: message._id });
		assert.strictEqual(updated?.data.text, "fixed");
		assert.ok(updated.editedAt instanceof Date);
	});

	it("404s an edit of a message from another room, even with a matching id", async () => {
		const elsewhere = lobbyMessage({ room: "some-game" });
		await colls.chatMessages.insertOne(elsewhere);
		const res = await api(
			"PATCH",
			`/api/room/${LOBBY_ROOM}/chat/${elsewhere._id.toString()}`,
			{ data: { text: "x" } },
			aliceHeaders,
		);
		assert.strictEqual(res.status, 404);
	});

	it("lets any logged-in user react to a lobby message", async () => {
		const message = lobbyMessage();
		await colls.chatMessages.insertOne(message);

		const url = `/api/room/${LOBBY_ROOM}/chat/${message._id.toString()}/reaction/${encodeURIComponent("👍")}`;
		const res = await api("PUT", url, undefined, bobHeaders);
		assert.strictEqual(res.status, 200, errorMessage(res.data));
		// oxlint-disable-next-line typescript/no-unsafe-type-assertion -- test responses are unvalidated JSON
		const aggregate = res.data as { message: string; reactions: { emoji: string; users: { name: string }[] }[] };
		assert.deepStrictEqual(
			aggregate.reactions.map((group) => group.emoji),
			["👍"],
		);
		assert.deepStrictEqual(
			aggregate.reactions[0].users.map((u) => u.name),
			["lobbybob"],
		);

		const cleared = await api("DELETE", url, undefined, bobHeaders);
		assert.strictEqual(cleared.status, 200);

		const anon = await api("PUT", url);
		assert.strictEqual(anon.status, 401);
	});

	it("tracks lastRead per room — the lobby marker doesn't leak into game rooms", async () => {
		const lastRead = Date.now();
		const set = await api("POST", `/api/room/${LOBBY_ROOM}/chat/lastRead`, { lastRead }, aliceHeaders);
		assert.strictEqual(set.status, 200, errorMessage(set.data));

		const lobby = await api("GET", `/api/room/${LOBBY_ROOM}/chat/lastRead`, undefined, aliceHeaders);
		assert.strictEqual(lobby.data, lastRead);

		// Same user, different room: unaffected.
		const gameRoom = await api("GET", "/api/game/lobby-isolation-game/chat/lastRead", undefined, aliceHeaders);
		assert.strictEqual(gameRoom.data, 0);

		// Same room, different user: unaffected.
		const bob = await api("GET", `/api/room/${LOBBY_ROOM}/chat/lastRead`, undefined, bobHeaders);
		assert.strictEqual(bob.data, 0);

		const anon = await api("GET", `/api/room/${LOBBY_ROOM}/chat/lastRead`);
		assert.strictEqual(anon.status, 401);
	});

	it("reserves public room ids: new-game rejects them", async () => {
		const res = await api(
			"POST",
			"/api/game/new-game",
			{
				game: { game: "test", version: 1 },
				gameId: LOBBY_ROOM,
				players: 2,
				timePerGame: 3600,
				timePerMove: 600,
			},
			aliceHeaders,
		);
		// The reserved-id assert (422) fires before the game-info lookup could 404.
		assert.strictEqual(res.status, 422);
		assert.match(errorMessage(res.data) ?? "", /reserved/);
	});

	after(() => db().dropDatabase());
});
