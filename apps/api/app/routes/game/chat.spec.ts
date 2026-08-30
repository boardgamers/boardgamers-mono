// Run via `pnpm test` (the package.json script), NOT bare `node --test`. The script
// imports app/config/test-hooks.ts, which connects to the *-test database and starts
// the API server. Running this file directly leaves `colls` uninitialized.
import assert from "node:assert/strict";
import { before, describe, it } from "node:test";
import { ObjectId } from "mongodb";
import type { ChatMessageDoc } from "@bgs/models";
import env from "../../config/env.ts";
import { colls } from "../../config/db.ts";
import { testUser, testGame } from "../../config/test-helpers.ts";
import { createAccessToken, generateRefreshCode, hashRefreshCode } from "../../models/jwtrefreshtokens.ts";
import { CHAT_EDIT_WINDOW_MS } from "./index.ts";

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

describe("Chat message editing", () => {
	const gameId = "chat-edit-game";
	const authorId = new ObjectId();
	const otherId = new ObjectId();
	let authorHeaders: Record<string, string> = {};
	let otherHeaders: Record<string, string> = {};

	function textMessage(overrides: Partial<ChatMessageDoc> = {}): ChatMessageDoc & { _id: ObjectId } {
		return {
			_id: new ObjectId(),
			room: gameId,
			author: { _id: authorId, name: "chatauthor" },
			data: { text: "original" },
			type: "text",
			...overrides,
		};
	}

	before(async () => {
		await colls.users.insertOne(
			testUser({
				_id: authorId,
				account: { username: "chatauthor", email: "chatauthor@test.com" },
				security: { confirmed: true },
			}),
		);
		await colls.users.insertOne(
			testUser({
				_id: otherId,
				account: { username: "chatother", email: "chatother@test.com" },
				security: { confirmed: true },
			}),
		);
		await colls.games.insertOne(
			testGame({
				_id: gameId,
				game: { name: "test", version: 1 },
				players: [{ _id: authorId }, { _id: otherId }],
				status: "active",
			}),
		);
		authorHeaders = await makeAuthHeaders(authorId);
		otherHeaders = await makeAuthHeaders(otherId);
	});

	it("lets the author edit their own recent text message and stamps editedAt", async () => {
		const message = textMessage();
		await colls.chatMessages.insertOne(message);

		const res = await api(
			"PATCH",
			`/api/game/${gameId}/chat/${message._id.toString()}`,
			{ data: { text: "fixed" } },
			authorHeaders,
		);
		assert.strictEqual(res.status, 200, errorMessage(res.data));

		const updated = await colls.chatMessages.findOne({ _id: message._id });
		assert.strictEqual(updated?.data.text, "fixed");
		assert.ok(updated.editedAt instanceof Date);
	});

	it("rejects an edit by someone other than the author", async () => {
		const message = textMessage();
		await colls.chatMessages.insertOne(message);

		const res = await api(
			"PATCH",
			`/api/game/${gameId}/chat/${message._id.toString()}`,
			{ data: { text: "hijack" } },
			otherHeaders,
		);
		assert.strictEqual(res.status, 422);
		assert.match(errorMessage(res.data) ?? "", /your own messages/);

		const unchanged = await colls.chatMessages.findOne({ _id: message._id });
		assert.strictEqual(unchanged?.data.text, "original");
		assert.strictEqual(unchanged.editedAt, undefined);
	});

	it("rejects an unauthenticated edit", async () => {
		const message = textMessage();
		await colls.chatMessages.insertOne(message);

		const res = await api("PATCH", `/api/game/${gameId}/chat/${message._id.toString()}`, { data: { text: "anon" } });
		assert.strictEqual(res.status, 401);
	});

	it("rejects editing system and emoji messages", async () => {
		const system = textMessage({ type: "system", author: undefined });
		const emoji = textMessage({ type: "emoji", data: { text: "🎉" } });
		await colls.chatMessages.insertOne(system);
		await colls.chatMessages.insertOne(emoji);

		for (const message of [system, emoji]) {
			const res = await api(
				"PATCH",
				`/api/game/${gameId}/chat/${message._id.toString()}`,
				{ data: { text: "x" } },
				authorHeaders,
			);
			assert.strictEqual(res.status, 422);
			assert.match(errorMessage(res.data) ?? "", /Only text messages/);
		}
	});

	it("rejects an edit after the edit window", async () => {
		const staleId = ObjectId.createFromTime(Math.floor((Date.now() - CHAT_EDIT_WINDOW_MS - 60_000) / 1000));
		const message = textMessage({ _id: staleId });
		await colls.chatMessages.insertOne(message);

		const res = await api(
			"PATCH",
			`/api/game/${gameId}/chat/${staleId.toString()}`,
			{ data: { text: "late" } },
			authorHeaders,
		);
		assert.strictEqual(res.status, 422);
		assert.match(errorMessage(res.data) ?? "", /edit window/);

		const unchanged = await colls.chatMessages.findOne({ _id: staleId });
		assert.strictEqual(unchanged?.data.text, "original");
	});

	it("rejects an empty replacement text", async () => {
		const message = textMessage();
		await colls.chatMessages.insertOne(message);

		const res = await api(
			"PATCH",
			`/api/game/${gameId}/chat/${message._id.toString()}`,
			{ data: { text: "" } },
			authorHeaders,
		);
		assert.strictEqual(res.status, 400);
	});

	it("404s on a message that doesn't exist or belongs to another room", async () => {
		const missing = await api(
			"PATCH",
			`/api/game/${gameId}/chat/${new ObjectId().toString()}`,
			{ data: { text: "x" } },
			authorHeaders,
		);
		assert.strictEqual(missing.status, 404);

		const elsewhere = textMessage({ room: "some-other-room" });
		await colls.chatMessages.insertOne(elsewhere);
		const res = await api(
			"PATCH",
			`/api/game/${gameId}/chat/${elsewhere._id.toString()}`,
			{ data: { text: "x" } },
			authorHeaders,
		);
		assert.strictEqual(res.status, 404);
	});

	it("422s on a malformed message id", async () => {
		const res = await api("PATCH", `/api/game/${gameId}/chat/not-an-id`, { data: { text: "x" } }, authorHeaders);
		assert.strictEqual(res.status, 422);
		assert.match(errorMessage(res.data) ?? "", /Invalid message id/);
	});
});
