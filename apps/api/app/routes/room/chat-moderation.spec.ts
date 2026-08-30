// Run via `pnpm test` (the package.json script), NOT bare `node --test`. The script
// imports app/config/test-hooks.ts, which connects to the *-test database and starts
// the API server. Running this file directly leaves `colls` uninitialized.
import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { ObjectId } from "mongodb";
import { boardgameRoomId, LOBBY_ROOM, SettingsKey, type ChatMessageDoc } from "@bgs/models";
import env from "../../config/env.ts";
import { colls, db } from "../../config/db.ts";
import { testUser, testGame } from "../../config/test-helpers.ts";
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

describe("Chat moderation", () => {
	const gameId = "moderation-game";
	const boardgame = "modtestgame";
	const boardgameRoom = boardgameRoomId(boardgame);

	const adminId = new ObjectId();
	const aliceId = new ObjectId();
	const bobId = new ObjectId();
	// Scoped admin holding a gameinfo grant but NOT full admin — must not reach
	// the moderation toggles.
	const scopedId = new ObjectId();
	let adminHeaders: Record<string, string> = {};
	let aliceHeaders: Record<string, string> = {};
	let bobHeaders: Record<string, string> = {};
	let scopedHeaders: Record<string, string> = {};

	function lobbyMessage(overrides: Partial<ChatMessageDoc> = {}): ChatMessageDoc & { _id: ObjectId } {
		return {
			_id: new ObjectId(),
			room: LOBBY_ROOM,
			author: { _id: aliceId, name: "modalice" },
			data: { text: "original" },
			type: "text",
			...overrides,
		};
	}

	before(async () => {
		await colls.users.insertOne(
			testUser({ _id: adminId, account: { username: "modadmin", email: "modadmin@test.com" }, authority: "admin" }),
		);
		await colls.users.insertOne(
			testUser({ _id: aliceId, account: { username: "modalice", email: "modalice@test.com" } }),
		);
		await colls.users.insertOne(testUser({ _id: bobId, account: { username: "modbob", email: "modbob@test.com" } }));
		await colls.users.insertOne(
			testUser({
				_id: scopedId,
				account: { username: "modscoped", email: "modscoped@test.com" },
				adminGrants: ["gameinfo", "users"],
			}),
		);
		adminHeaders = await makeAuthHeaders(adminId);
		aliceHeaders = await makeAuthHeaders(aliceId);
		bobHeaders = await makeAuthHeaders(bobId);
		scopedHeaders = await makeAuthHeaders(scopedId);

		// A game with alice + bob (admin NOT a participant — moderation must not
		// require game membership).
		await colls.games.insertOne(
			testGame({ _id: gameId, game: { name: "test", version: 1 }, players: [{ _id: aliceId }, { _id: bobId }] }),
		);

		// A boardgame with a public version: its metadata doc hosts the chatDisabled
		// flag and its public room ("boardgame:<slug>") is open per the room
		// validator (isOpenPublicChatRoom). The meta PUT also requires the version.
		await colls.gameInfos.insertOne({
			_id: { game: boardgame, version: 1 },
			viewer: { url: "//test.com/mod", topLevelVariable: "mod" },
			public: true,
			meta: {},
		});
		await colls.gameMetadatas.insertOne({ _id: boardgame, label: "Mod Test Game", players: [2] });
	});

	after(async () => {
		await db().dropDatabase();
	});

	describe("admin message deletion", () => {
		it("403s a non-admin delete (author or not) and keeps the message", async () => {
			const message = lobbyMessage();
			await colls.chatMessages.insertOne(message);

			for (const headers of [aliceHeaders, bobHeaders]) {
				const res = await api("DELETE", `/api/room/${LOBBY_ROOM}/chat/${message._id.toString()}`, undefined, headers);
				assert.strictEqual(res.status, 403);
			}
			assert.ok(await colls.chatMessages.findOne({ _id: message._id }));
		});

		it("lets an admin hard-delete a public-room message: doc + reactions gone, tombstone + audit written", async () => {
			// Guard against the vacuous-pass trap: test-setup must have recreated
			// chatmessages CAPPED (ensureCollections), or this spec would "verify"
			// a delete against a regular collection.
			const [collInfo] = await db().listCollections({ name: "chatmessages" }, { nameOnly: false }).toArray();
			assert.strictEqual(collInfo?.options?.capped, true, "chatmessages must be a capped collection");

			const message = lobbyMessage();
			await colls.chatMessages.insertOne(message);
			const reaction = await api(
				"PUT",
				`/api/room/${LOBBY_ROOM}/chat/${message._id.toString()}/reaction/${encodeURIComponent("👍")}`,
				undefined,
				bobHeaders,
			);
			assert.strictEqual(reaction.status, 200, errorMessage(reaction.data));
			assert.ok(await colls.chatReactions.findOne({ message: message._id }));

			const res = await api(
				"DELETE",
				`/api/room/${LOBBY_ROOM}/chat/${message._id.toString()}`,
				undefined,
				adminHeaders,
			);
			assert.strictEqual(res.status, 200, errorMessage(res.data));

			// Empirical check that Mongo really deleted from the capped collection
			// (allowed since 5.0 — same verification approach as #433's edits).
			assert.strictEqual(await colls.chatMessages.findOne({ _id: message._id }), null);
			assert.strictEqual(await colls.chatReactions.findOne({ message: message._id }), null);

			const tombstone = await colls.chatDeletions.findOne({ message: message._id });
			assert.ok(tombstone, "deletion tombstone for the ws broadcast");
			assert.strictEqual(tombstone.room, LOBBY_ROOM);

			const audit = await colls.adminLogs.findOne({
				action: "chat.deleteMessage",
				"target.id": message._id.toString(),
			});
			assert.ok(audit, "audit trail entry");
			assert.strictEqual(audit.admin.name, "modadmin");
			assert.strictEqual(audit.meta?.text, "original");
		});

		it("lets an admin delete a game-room message without being a participant — participants can't", async () => {
			const message = lobbyMessage({ room: gameId });
			await colls.chatMessages.insertOne(message);

			const participant = await api(
				"DELETE",
				`/api/game/${gameId}/chat/${message._id.toString()}`,
				undefined,
				aliceHeaders,
			);
			assert.strictEqual(participant.status, 403);

			const res = await api("DELETE", `/api/game/${gameId}/chat/${message._id.toString()}`, undefined, adminHeaders);
			assert.strictEqual(res.status, 200, errorMessage(res.data));
			assert.strictEqual(await colls.chatMessages.findOne({ _id: message._id }), null);
		});

		it("404s an unknown message and a message from another room", async () => {
			const elsewhere = lobbyMessage({ room: "some-other-room" });
			await colls.chatMessages.insertOne(elsewhere);

			for (const id of [new ObjectId().toString(), elsewhere._id.toString()]) {
				const res = await api("DELETE", `/api/room/${LOBBY_ROOM}/chat/${id}`, undefined, adminHeaders);
				assert.strictEqual(res.status, 404, id);
			}
		});
	});

	describe("per-user chat mute", () => {
		it("gates the mute routes on the users permission", async () => {
			const res = await api("POST", `/api/admin/users/${bobId.toString()}/chat-mute`, { duration: "1h" }, aliceHeaders);
			assert.strictEqual(res.status, 403);
			const unmute = await api("DELETE", `/api/admin/users/${bobId.toString()}/chat-mute`, undefined, aliceHeaders);
			assert.strictEqual(unmute.status, 403);
		});

		it("404s muting an unknown user", async () => {
			const res = await api(
				"POST",
				`/api/admin/users/${new ObjectId().toString()}/chat-mute`,
				{ duration: "1h" },
				adminHeaders,
			);
			assert.strictEqual(res.status, 404);
		});

		it("blocks a muted user's posts, edits and reactions in BOTH room kinds, and audits mute/unmute", async () => {
			const own = lobbyMessage({ author: { _id: bobId, name: "modbob" }, data: { text: "bob's" } });
			await colls.chatMessages.insertOne(own);

			const mute = await api(
				"POST",
				`/api/admin/users/${bobId.toString()}/chat-mute`,
				{ duration: "1d" },
				adminHeaders,
			);
			assert.strictEqual(mute.status, 200, errorMessage(mute.data));
			assert.ok(await colls.adminLogs.findOne({ action: "user.chatMute", "target.id": bobId.toString() }));

			const post = await api(
				"POST",
				`/api/room/${LOBBY_ROOM}/chat`,
				{ type: "text", data: { text: "hi" } },
				bobHeaders,
			);
			assert.strictEqual(post.status, 403);
			assert.match(errorMessage(post.data) ?? "", /muted/);

			const gamePost = await api(
				"POST",
				`/api/game/${gameId}/chat`,
				{ type: "text", data: { text: "hi" } },
				bobHeaders,
			);
			assert.strictEqual(gamePost.status, 403);

			const edit = await api(
				"PATCH",
				`/api/room/${LOBBY_ROOM}/chat/${own._id.toString()}`,
				{ data: { text: "edited" } },
				bobHeaders,
			);
			assert.strictEqual(edit.status, 403);

			const react = await api(
				"PUT",
				`/api/room/${LOBBY_ROOM}/chat/${own._id.toString()}/reaction/${encodeURIComponent("👍")}`,
				undefined,
				bobHeaders,
			);
			assert.strictEqual(react.status, 403);

			// Others are unaffected.
			const alice = await api(
				"POST",
				`/api/room/${LOBBY_ROOM}/chat`,
				{ type: "text", data: { text: "hi" } },
				aliceHeaders,
			);
			assert.strictEqual(alice.status, 200, errorMessage(alice.data));

			const unmute = await api("DELETE", `/api/admin/users/${bobId.toString()}/chat-mute`, undefined, adminHeaders);
			assert.strictEqual(unmute.status, 200, errorMessage(unmute.data));
			assert.ok(await colls.adminLogs.findOne({ action: "user.chatUnmute", "target.id": bobId.toString() }));

			const unmuted = await api(
				"POST",
				`/api/room/${LOBBY_ROOM}/chat`,
				{ type: "text", data: { text: "back" } },
				bobHeaders,
			);
			assert.strictEqual(unmuted.status, 200, errorMessage(unmuted.data));
		});

		it("honors mute expiry — a past chatMutedUntil doesn't block", async () => {
			await colls.users.updateOne({ _id: bobId }, { $set: { chatMutedUntil: new Date(Date.now() - 1000) } });
			try {
				const res = await api(
					"POST",
					`/api/room/${LOBBY_ROOM}/chat`,
					{ type: "text", data: { text: "expired" } },
					bobHeaders,
				);
				assert.strictEqual(res.status, 200, errorMessage(res.data));
			} finally {
				await colls.users.updateOne({ _id: bobId }, { $unset: { chatMutedUntil: true } });
			}
		});

		it("rejects an unknown duration", async () => {
			const res = await api("POST", `/api/admin/users/${bobId.toString()}/chat-mute`, { duration: "5y" }, adminHeaders);
			assert.ok(res.status >= 400 && res.status < 500, String(res.status));
			assert.strictEqual((await colls.users.findOne({ _id: bobId }))?.chatMutedUntil, undefined);
		});
	});

	describe("chat kill switch (site-wide)", () => {
		after(async () => {
			await colls.settings.deleteOne({ _id: SettingsKey.ChatKillSwitch });
		});

		it("gates the toggle on full admin", async () => {
			for (const headers of [aliceHeaders, scopedHeaders]) {
				const res = await api("PUT", "/api/admin/chat-kill-switch", { mode: "all" }, headers);
				assert.strictEqual(res.status, 403);
				const get = await api("GET", "/api/admin/chat-kill-switch", undefined, headers);
				assert.strictEqual(get.status, 403);
			}
		});

		it("defaults to off", async () => {
			const res = await api("GET", "/api/admin/chat-kill-switch", undefined, adminHeaders);
			assert.deepStrictEqual(res.data, { mode: "off" });
		});

		it("mode=public blocks public rooms but not game chat; mode=all blocks everything; audited", async () => {
			const set = await api("PUT", "/api/admin/chat-kill-switch", { mode: "public" }, adminHeaders);
			assert.strictEqual(set.status, 200, errorMessage(set.data));
			assert.ok(await colls.adminLogs.findOne({ action: "site.chatKillSwitch", "meta.mode": "public" }));

			const lobby = await api(
				"POST",
				`/api/room/${LOBBY_ROOM}/chat`,
				{ type: "text", data: { text: "x" } },
				aliceHeaders,
			);
			assert.strictEqual(lobby.status, 403);
			assert.match(errorMessage(lobby.data) ?? "", /disabled/);

			const game = await api("POST", `/api/game/${gameId}/chat`, { type: "text", data: { text: "x" } }, aliceHeaders);
			assert.strictEqual(game.status, 200, errorMessage(game.data));

			await api("PUT", "/api/admin/chat-kill-switch", { mode: "all" }, adminHeaders);
			const gameBlocked = await api(
				"POST",
				`/api/game/${gameId}/chat`,
				{ type: "text", data: { text: "x" } },
				aliceHeaders,
			);
			assert.strictEqual(gameBlocked.status, 403);
			const lobbyBlocked = await api(
				"POST",
				`/api/room/${LOBBY_ROOM}/chat`,
				{ type: "text", data: { text: "x" } },
				aliceHeaders,
			);
			assert.strictEqual(lobbyBlocked.status, 403);
			// Edits and reactions are blocked too (all writes funnel through the same check).
			const message = lobbyMessage();
			await colls.chatMessages.insertOne(message);
			const edit = await api(
				"PATCH",
				`/api/room/${LOBBY_ROOM}/chat/${message._id.toString()}`,
				{ data: { text: "x" } },
				aliceHeaders,
			);
			assert.strictEqual(edit.status, 403);
			const react = await api(
				"PUT",
				`/api/room/${LOBBY_ROOM}/chat/${message._id.toString()}/reaction/${encodeURIComponent("👍")}`,
				undefined,
				aliceHeaders,
			);
			assert.strictEqual(react.status, 403);

			const off = await api("PUT", "/api/admin/chat-kill-switch", { mode: "off" }, adminHeaders);
			assert.strictEqual(off.status, 200);
			const back = await api(
				"POST",
				`/api/room/${LOBBY_ROOM}/chat`,
				{ type: "text", data: { text: "x" } },
				aliceHeaders,
			);
			assert.strictEqual(back.status, 200, errorMessage(back.data));
		});

		it("rejects an unknown mode", async () => {
			const res = await api("PUT", "/api/admin/chat-kill-switch", { mode: "maybe" }, adminHeaders);
			assert.ok(res.status >= 400 && res.status < 500, String(res.status));
		});
	});

	describe("per-boardgame chatDisabled flag", () => {
		it("gates the toggle on full admin (scoped gameinfo admins can't)", async () => {
			const res = await api("PUT", `/api/admin/gameinfo/${boardgame}/chat-disabled`, { disabled: true }, scopedHeaders);
			assert.strictEqual(res.status, 403);
		});

		it("404s an unknown boardgame", async () => {
			const res = await api("PUT", "/api/admin/gameinfo/no-such-game/chat-disabled", { disabled: true }, adminHeaders);
			assert.strictEqual(res.status, 404);
		});

		it("blocks posting in the boardgame's public room while set — lobby and game chat unaffected; audited", async () => {
			const set = await api("PUT", `/api/admin/gameinfo/${boardgame}/chat-disabled`, { disabled: true }, adminHeaders);
			assert.strictEqual(set.status, 200, errorMessage(set.data));
			assert.strictEqual((await colls.gameMetadatas.findOne({ _id: boardgame }))?.chatDisabled, true);
			assert.ok(await colls.adminLogs.findOne({ action: "gameinfo.setChatDisabled", "target.id": boardgame }));

			const blocked = await api(
				"POST",
				`/api/room/${boardgameRoom}/chat`,
				{ type: "text", data: { text: "x" } },
				aliceHeaders,
			);
			assert.strictEqual(blocked.status, 403);
			assert.match(errorMessage(blocked.data) ?? "", /disabled for this boardgame/);

			const lobby = await api(
				"POST",
				`/api/room/${LOBBY_ROOM}/chat`,
				{ type: "text", data: { text: "x" } },
				aliceHeaders,
			);
			assert.strictEqual(lobby.status, 200, errorMessage(lobby.data));
			const game = await api("POST", `/api/game/${gameId}/chat`, { type: "text", data: { text: "x" } }, aliceHeaders);
			assert.strictEqual(game.status, 200, errorMessage(game.data));

			const unset = await api(
				"PUT",
				`/api/admin/gameinfo/${boardgame}/chat-disabled`,
				{ disabled: false },
				adminHeaders,
			);
			assert.strictEqual(unset.status, 200);
			const back = await api(
				"POST",
				`/api/room/${boardgameRoom}/chat`,
				{ type: "text", data: { text: "x" } },
				aliceHeaders,
			);
			assert.strictEqual(back.status, 200, errorMessage(back.data));
		});

		it("is not clobbered by the regular metadata form PUT", async () => {
			await api("PUT", `/api/admin/gameinfo/${boardgame}/chat-disabled`, { disabled: true }, adminHeaders);

			// The admin metadata editor round-trips the GET /meta response — a stale
			// form must not flip the moderation flag (the route strips it).
			const meta = await api(
				"PUT",
				`/api/admin/gameinfo/${boardgame}/meta`,
				{ label: "Mod Test Game", players: [2], chatDisabled: false },
				adminHeaders,
			);
			assert.strictEqual(meta.status, 200, errorMessage(meta.data));
			assert.strictEqual((await colls.gameMetadatas.findOne({ _id: boardgame }))?.chatDisabled, true);

			await api("PUT", `/api/admin/gameinfo/${boardgame}/chat-disabled`, { disabled: false }, adminHeaders);
		});
	});
});
