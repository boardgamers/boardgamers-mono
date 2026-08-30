// Run via `pnpm test` (the package.json script), NOT bare `node --test`. The script
// imports app/config/test-hooks.ts, which connects to the *-test database and starts
// the API server. Running this file directly leaves `colls` uninitialized.
import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { ObjectId } from "mongodb";
import { LOBBY_ROOM, boardgameRoomId, type ChatMessageDoc } from "@bgs/models";
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

// The room id carries a ":" — always URL-encoded in paths, like the web client.
const roomPath = (room: string, rest = "") => `/api/room/${encodeURIComponent(room)}/chat${rest}`;

describe("Public (per-boardgame) room chat API", () => {
	const publicRoom = boardgameRoomId("chat-public-game");
	const mixedRoom = boardgameRoomId("chat-mixed-game");
	const betaRoom = boardgameRoomId("chat-beta-game");
	// Two users NOT sharing any game — public rooms must not require game participation.
	const aliceId = new ObjectId();
	const bobId = new ObjectId();
	// A beta grantee (access.maxVersion on chat-beta-game) and an admin — beta rooms
	// are only accessible to users who can access the boardgame itself.
	const granteeId = new ObjectId();
	const adminId = new ObjectId();
	let aliceHeaders: Record<string, string> = {};
	let bobHeaders: Record<string, string> = {};
	let granteeHeaders: Record<string, string> = {};
	let adminHeaders: Record<string, string> = {};

	function roomMessage(overrides: Partial<ChatMessageDoc> = {}): ChatMessageDoc & { _id: ObjectId } {
		return {
			_id: new ObjectId(),
			room: publicRoom,
			author: { _id: aliceId, name: "lobbyalice" },
			data: { text: "original" },
			type: "text",
			...overrides,
		};
	}

	before(async () => {
		// A public boardgame (open room), a beta one (no public version → no room),
		// and one whose only public version is archived (excluded like the listing).
		await colls.gameInfos.insertOne({
			_id: { game: "chat-public-game", version: 1 },
			viewer: { url: "//test.com/chat-public-game" },
			public: true,
		});
		await colls.gameInfos.insertOne({
			_id: { game: "chat-beta-game", version: 1 },
			viewer: { url: "//test.com/chat-beta-game" },
			public: false,
		});
		await colls.gameInfos.insertOne({
			_id: { game: "chat-archived-game", version: 1 },
			viewer: { url: "//test.com/chat-archived-game" },
			public: true,
			meta: { archived: true },
		});
		// A game with a public version AND a newer private one: the room is open to
		// everyone — "public" means ANY version public, not the picked-latest (#427).
		await colls.gameInfos.insertOne({
			_id: { game: "chat-mixed-game", version: 1 },
			viewer: { url: "//test.com/chat-mixed-game" },
			public: true,
		});
		await colls.gameInfos.insertOne({
			_id: { game: "chat-mixed-game", version: 2 },
			viewer: { url: "//test.com/chat-mixed-game" },
			public: false,
		});
		await colls.users.insertOne(
			testUser({ _id: aliceId, account: { username: "lobbyalice", email: "lobbyalice@test.com" } }),
		);
		await colls.users.insertOne(
			testUser({ _id: bobId, account: { username: "lobbybob", email: "lobbybob@test.com" } }),
		);
		await colls.users.insertOne(
			testUser({ _id: granteeId, account: { username: "lobbygrantee", email: "lobbygrantee@test.com" } }),
		);
		await colls.users.insertOne(
			testUser({ _id: adminId, account: { username: "lobbyadmin", email: "lobbyadmin@test.com" }, authority: "admin" }),
		);
		await colls.gamePreferences.insertOne({
			user: granteeId,
			game: "chat-beta-game",
			access: { maxVersion: 1 },
		});
		aliceHeaders = await makeAuthHeaders(aliceId);
		bobHeaders = await makeAuthHeaders(bobId);
		granteeHeaders = await makeAuthHeaders(granteeId);
		adminHeaders = await makeAuthHeaders(adminId);
	});

	it("rejects a logged-out post", async () => {
		const res = await api("POST", roomPath(publicRoom), { type: "text", data: { text: "hi" } });
		assert.strictEqual(res.status, 401);
	});

	it("lets any logged-in user post to a public boardgame's room — no game-participant check", async () => {
		const res = await api("POST", roomPath(publicRoom), { type: "text", data: { text: "hello room" } }, aliceHeaders);
		assert.strictEqual(res.status, 200, errorMessage(res.data));

		const message = await colls.chatMessages.findOne({ room: publicRoom, "data.text": "hello room" });
		assert.ok(message);
		assert.strictEqual(message.author?.name, "lobbyalice");
		assert.strictEqual(message.type, "text");
	});

	it("keeps the dormant lobby room valid (no UI mounts it)", async () => {
		const res = await api("POST", roomPath(LOBBY_ROOM), { type: "text", data: { text: "hi lobby" } }, aliceHeaders);
		assert.strictEqual(res.status, 200, errorMessage(res.data));
	});

	it("404s rooms outside the public namespace or the requester can't access", async () => {
		for (const room of [
			boardgameRoomId("chat-beta-game"), // no public version, requester has no grant
			boardgameRoomId("chat-archived-game"), // only public version is archived
			boardgameRoomId("no-such-game"), // unknown boardgame
			"some-game-id", // game-id-shaped: game rooms live under /game, not /room
			"boardgame:", // empty slug
		]) {
			const res = await api("POST", roomPath(room), { type: "text", data: { text: "hi" } }, aliceHeaders);
			assert.strictEqual(res.status, 404, room);
			const lastRead = await api("GET", roomPath(room, "/lastRead"), undefined, aliceHeaders);
			assert.strictEqual(lastRead.status, 404, room);
		}
	});

	it("opens the room when ANY version is public, not just the picked-latest (#427 bug class)", async () => {
		// chat-mixed-game's latest version (2) is private — the room must still be
		// open to everyone, mirroring the web's FAB-visibility check.
		const res = await api("POST", roomPath(mixedRoom), { type: "text", data: { text: "mixed hello" } }, bobHeaders);
		assert.strictEqual(res.status, 200, errorMessage(res.data));
	});

	it("opens a fully-private boardgame's room to its beta grantees", async () => {
		const res = await api("POST", roomPath(betaRoom), { type: "text", data: { text: "beta hello" } }, granteeHeaders);
		assert.strictEqual(res.status, 200, errorMessage(res.data));

		const message = await colls.chatMessages.findOne({ room: betaRoom, "data.text": "beta hello" });
		assert.ok(message);
		assert.strictEqual(message.author?.name, "lobbygrantee");

		// The grantee can use the whole room API — edit their message, react, lastRead.
		const edit = await api(
			"PATCH",
			roomPath(betaRoom, `/${message._id.toString()}`),
			{ data: { text: "beta hello (fixed)" } },
			granteeHeaders,
		);
		assert.strictEqual(edit.status, 200, errorMessage(edit.data));

		const reaction = await api(
			"PUT",
			roomPath(betaRoom, `/${message._id.toString()}/reaction/${encodeURIComponent("👍")}`),
			undefined,
			granteeHeaders,
		);
		assert.strictEqual(reaction.status, 200, errorMessage(reaction.data));

		const lastRead = Date.now();
		const set = await api("POST", roomPath(betaRoom, "/lastRead"), { lastRead }, granteeHeaders);
		assert.strictEqual(set.status, 200, errorMessage(set.data));
		const read = await api("GET", roomPath(betaRoom, "/lastRead"), undefined, granteeHeaders);
		assert.strictEqual(read.data, lastRead);
	});

	it("opens a fully-private boardgame's room to admins", async () => {
		const res = await api("POST", roomPath(betaRoom), { type: "text", data: { text: "admin here" } }, adminHeaders);
		assert.strictEqual(res.status, 200, errorMessage(res.data));
	});

	it("keeps a fully-private boardgame's room hidden from everyone else", async () => {
		// Logged-in without a grant: the room doesn't exist for them.
		const bob = await api("POST", roomPath(betaRoom), { type: "text", data: { text: "hi" } }, bobHeaders);
		assert.strictEqual(bob.status, 404);
		// Logged out: same 404 (the room validator runs before the login check).
		const anon = await api("POST", roomPath(betaRoom), { type: "text", data: { text: "hi" } });
		assert.strictEqual(anon.status, 404);
		const anonRead = await api("GET", roomPath(betaRoom, "/lastRead"));
		assert.strictEqual(anonRead.status, 404);
		// A grant on some OTHER game doesn't help — access is per boardgame.
		const otherGrantId = new ObjectId();
		await colls.users.insertOne(
			testUser({ _id: otherGrantId, account: { username: "lobbyother", email: "lobbyother@test.com" } }),
		);
		await colls.gamePreferences.insertOne({ user: otherGrantId, game: "chat-mixed-game", access: { maxVersion: 2 } });
		const other = await api(
			"POST",
			roomPath(betaRoom),
			{ type: "text", data: { text: "hi" } },
			await makeAuthHeaders(otherGrantId),
		);
		assert.strictEqual(other.status, 404);
	});

	it("doesn't open a room on an unknown boardgame, even for admins", async () => {
		const res = await api(
			"POST",
			roomPath(boardgameRoomId("no-such-game")),
			{ type: "text", data: { text: "hi" } },
			adminHeaders,
		);
		assert.strictEqual(res.status, 404);
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
		const res = await api("POST", roomPath(publicRoom), { type: "text", data: { text: "hi" } }, headers);
		assert.strictEqual(res.status, 403);
	});

	it("rate limits public-room posts per user (game chat stays unlimited)", async () => {
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
				const res = await api("POST", roomPath(publicRoom), { type: "text", data: { text } }, limitedHeaders);
				assert.strictEqual(res.status, 200, errorMessage(res.data));
			}
			const limited = await api(
				"POST",
				roomPath(publicRoom),
				{ type: "text", data: { text: "three" } },
				limitedHeaders,
			);
			assert.strictEqual(limited.status, 429);
		} finally {
			ACTION_RATE_LIMITS["room/chat-message"] = saved;
		}
	});

	it("lets the author edit their room message, and nobody else", async () => {
		const message = roomMessage();
		await colls.chatMessages.insertOne(message);

		const hijack = await api(
			"PATCH",
			roomPath(publicRoom, `/${message._id.toString()}`),
			{
				data: { text: "hijack" },
			},
			bobHeaders,
		);
		assert.strictEqual(hijack.status, 422);
		assert.match(errorMessage(hijack.data) ?? "", /your own messages/);

		const res = await api(
			"PATCH",
			roomPath(publicRoom, `/${message._id.toString()}`),
			{
				data: { text: "fixed" },
			},
			aliceHeaders,
		);
		assert.strictEqual(res.status, 200, errorMessage(res.data));
		const updated = await colls.chatMessages.findOne({ _id: message._id });
		assert.strictEqual(updated?.data.text, "fixed");
		assert.ok(updated.editedAt instanceof Date);
	});

	it("404s an edit of a message from another room, even with a matching id", async () => {
		const elsewhere = roomMessage({ room: "some-game" });
		await colls.chatMessages.insertOne(elsewhere);
		const res = await api(
			"PATCH",
			roomPath(publicRoom, `/${elsewhere._id.toString()}`),
			{
				data: { text: "x" },
			},
			aliceHeaders,
		);
		assert.strictEqual(res.status, 404);
	});

	it("lets any logged-in user react to a room message", async () => {
		const message = roomMessage();
		await colls.chatMessages.insertOne(message);

		const url = roomPath(publicRoom, `/${message._id.toString()}/reaction/${encodeURIComponent("👍")}`);
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

	it("tracks lastRead per room — one boardgame's marker doesn't leak elsewhere", async () => {
		const lastRead = Date.now();
		const set = await api("POST", roomPath(publicRoom, "/lastRead"), { lastRead }, aliceHeaders);
		assert.strictEqual(set.status, 200, errorMessage(set.data));

		const room = await api("GET", roomPath(publicRoom, "/lastRead"), undefined, aliceHeaders);
		assert.strictEqual(room.data, lastRead);

		// Same user, other rooms (a game room, the lobby): unaffected.
		const gameRoom = await api("GET", "/api/game/room-isolation-game/chat/lastRead", undefined, aliceHeaders);
		assert.strictEqual(gameRoom.data, 0);
		const lobby = await api("GET", roomPath(LOBBY_ROOM, "/lastRead"), undefined, aliceHeaders);
		assert.strictEqual(lobby.data, 0);

		// Same room, different user: unaffected.
		const bob = await api("GET", roomPath(publicRoom, "/lastRead"), undefined, bobHeaders);
		assert.strictEqual(bob.data, 0);

		const anon = await api("GET", roomPath(publicRoom, "/lastRead"));
		assert.strictEqual(anon.status, 401);
	});

	it("reserves public room ids: new-game rejects them", async () => {
		// "boardgame:<slug>" ids can't even pass the gameId regex (no ":"), so the
		// only reservable plain id is the dormant lobby's.
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
