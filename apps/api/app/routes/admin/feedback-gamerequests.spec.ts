// Run via `pnpm test` (the package.json script), NOT bare `node --test`. The script
// imports app/config/test-hooks.ts, which connects to the *-test database and starts
// the API server.
import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { ObjectId } from "mongodb";
import { z } from "zod";
import { colls, db } from "../../config/db.ts";
import env from "../../config/env.ts";
import { testUser } from "../../config/test-helpers.ts";
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

async function insertUserWithAuth(
	suffix: string,
	extra: { authority?: string; adminGrants?: string[] } = {},
): Promise<{ userId: ObjectId; authHeaders: Record<string, string> }> {
	const userId = new ObjectId();
	await colls.users.insertOne(
		testUser({
			_id: userId,
			account: { username: `gradmin${suffix}`, email: `gradmin${suffix}@test.com` },
			security: { confirmed: true, slug: `gradmin${suffix}` },
			...extra,
		}),
	);
	const code = generateRefreshCode();
	const tokenDoc = { user: userId, codeHash: hashRefreshCode(code), createdAt: new Date() };
	await colls.jwtRefreshTokens.insertOne(tokenDoc);
	const token = await createAccessToken(tokenDoc, ["all"], false);
	return { userId, authHeaders: { Authorization: `Bearer ${token}` } };
}

const gameRequestItem = z.object({
	_id: z.string(),
	label: z.string(),
	description: z.string().optional(),
	likeCount: z.number(),
	requestedBy: z.string().optional(),
	forumTid: z.number().optional(),
	createdAt: z.string().optional(),
});

describe("Admin game-request management API", () => {
	let fullAdmin: Awaited<ReturnType<typeof insertUserWithAuth>>;
	let feedbackAdmin: Awaited<ReturnType<typeof insertUserWithAuth>>;
	let usersAdmin: Awaited<ReturnType<typeof insertUserWithAuth>>;
	let gameAdmin: Awaited<ReturnType<typeof insertUserWithAuth>>;
	let otherGameAdmin: Awaited<ReturnType<typeof insertUserWithAuth>>;
	let requester: Awaited<ReturnType<typeof insertUserWithAuth>>;
	let likerA: Awaited<ReturnType<typeof insertUserWithAuth>>;
	let likerB: Awaited<ReturnType<typeof insertUserWithAuth>>;

	const insertRequest = (
		game: string,
		over: { label?: string; description?: string; likeCount?: number; forumTid?: number; createdAt?: Date } = {},
	) =>
		colls.gameMetadatas.insertOne({
			_id: game,
			label: over.label ?? game,
			...(over.description ? { description: over.description } : {}),
			players: [],
			status: "requested",
			requestedBy: requester.userId,
			...(over.likeCount !== undefined ? { likeCount: over.likeCount } : {}),
			...(over.forumTid !== undefined ? { forumTid: over.forumTid } : {}),
			createdAt: over.createdAt ?? new Date(),
		});

	const like = (game: string, userId: ObjectId) =>
		colls.gameLikes.insertOne({ game, user: userId, createdAt: new Date() });

	before(async () => {
		fullAdmin = await insertUserWithAuth("full", { authority: "admin" });
		feedbackAdmin = await insertUserWithAuth("scoped", { adminGrants: ["feedback"] });
		usersAdmin = await insertUserWithAuth("users", { adminGrants: ["users"] });
		gameAdmin = await insertUserWithAuth("game", { adminGrants: ["gameinfo:gr-own"] });
		otherGameAdmin = await insertUserWithAuth("other", { adminGrants: ["gameinfo:gr-other"] });
		requester = await insertUserWithAuth("requester");
		likerA = await insertUserWithAuth("likera");
		likerB = await insertUserWithAuth("likerb");

		// Sorting fixtures: same likeCount (3), newest first on ties.
		await insertRequest("gr-tie-newest", { likeCount: 3, createdAt: new Date("2024-06-01T00:00:00Z") });
		await insertRequest("gr-tie-oldest", { likeCount: 3, createdAt: new Date("2024-01-01T00:00:00Z") });
		await insertRequest("gr-own", {
			label: "GR Own Game",
			description: "A request the per-game admin may manage",
			likeCount: 5,
			forumTid: 4242,
		});
		await insertRequest("gr-other", { label: "GR Other Game", likeCount: 1 });
		// A beta game and an implemented game: never listed, never actionable.
		await colls.gameMetadatas.insertOne({
			_id: "gr-beta",
			label: "GR Beta",
			players: [2],
			status: "beta",
			requestedBy: requester.userId,
			likeCount: 7,
		});
		await colls.gameMetadatas.insertOne({ _id: "gr-implemented", label: "GR Implemented", players: [2] });
		await colls.gameInfos.insertOne({ _id: { game: "gr-beta", version: 1 }, viewer: { url: "//test.com/gr-beta" } });
		await colls.gameInfos.insertOne({
			_id: { game: "gr-implemented", version: 1 },
			viewer: { url: "//test.com/gr-implemented" },
			public: true,
		});
	});

	after(() => db().dropDatabase());

	it("requires the feedback permission or a per-game grant", async () => {
		assert.strictEqual((await api("GET", "/api/admin/feedback/game-requests")).status, 403);
		assert.strictEqual((await api("GET", "/api/admin/feedback/game-requests", requester.authHeaders)).status, 403);
		assert.strictEqual((await api("GET", "/api/admin/feedback/game-requests", usersAdmin.authHeaders)).status, 403);
		assert.strictEqual((await api("GET", "/api/admin/feedback/game-requests", gameAdmin.authHeaders)).status, 200);
	});

	it("lists only status-requested games, most voted then newest first", async () => {
		for (const headers of [feedbackAdmin.authHeaders, fullAdmin.authHeaders]) {
			const res = await api("GET", "/api/admin/feedback/game-requests", headers);
			assert.strictEqual(res.status, 200);
			const items = z.array(gameRequestItem).parse(res.data);
			assert.deepStrictEqual(
				items.map((r) => [r._id, r.likeCount] as const),
				[
					["gr-own", 5],
					["gr-tie-newest", 3],
					["gr-tie-oldest", 3],
					["gr-other", 1],
				],
			);
			const own = items[0];
			assert.strictEqual(own.label, "GR Own Game");
			assert.strictEqual(own.description, "A request the per-game admin may manage");
			assert.strictEqual(own.requestedBy, "gradminrequester");
			assert.strictEqual(own.forumTid, 4242);
			assert.ok(own.createdAt);
		}
	});

	it("scopes a per-game admin's listing to their granted games", async () => {
		const res = await api("GET", "/api/admin/feedback/game-requests", gameAdmin.authHeaders);
		assert.strictEqual(res.status, 200);
		assert.deepStrictEqual(
			z
				.array(gameRequestItem)
				.parse(res.data)
				.map((r) => r._id),
			["gr-own"],
		);
	});

	it("deletes a request with its likes, then 404s", async () => {
		await insertRequest("gr-delete", { likeCount: 2 });
		await like("gr-delete", likerA.userId);
		await like("gr-delete", likerB.userId);

		const res = await api("DELETE", "/api/admin/feedback/game-requests/gr-delete", feedbackAdmin.authHeaders);
		assert.strictEqual(res.status, 204);
		assert.strictEqual(await colls.gameMetadatas.findOne({ _id: "gr-delete" }), null);
		assert.strictEqual(await colls.gameLikes.countDocuments({ game: "gr-delete" }), 0);

		assert.strictEqual(
			(await api("DELETE", "/api/admin/feedback/game-requests/gr-delete", feedbackAdmin.authHeaders)).status,
			404,
		);
		assert.strictEqual(
			(await api("DELETE", "/api/admin/feedback/game-requests/gr-unknown", feedbackAdmin.authHeaders)).status,
			404,
		);
	});

	it("refuses to delete a request that has version docs", async () => {
		// Defence-in-depth: a version upload raced the request (status not yet beta).
		await insertRequest("gr-race");
		await colls.gameInfos.insertOne({ _id: { game: "gr-race", version: 1 }, viewer: { url: "//test.com/gr-race" } });

		assert.strictEqual(
			(await api("DELETE", "/api/admin/feedback/game-requests/gr-race", feedbackAdmin.authHeaders)).status,
			409,
		);
		assert.ok(await colls.gameMetadatas.findOne({ _id: "gr-race" }));
		// Beta games are out of scope altogether.
		assert.strictEqual(
			(await api("DELETE", "/api/admin/feedback/game-requests/gr-beta", feedbackAdmin.authHeaders)).status,
			404,
		);
	});

	it("merges a request into another, moving votes without duplicates", async () => {
		await insertRequest("gr-merge-src", { likeCount: 3 });
		await insertRequest("gr-merge-dst", { likeCount: 2 });
		// likerA voted for both — the merge must not duplicate their vote.
		await like("gr-merge-src", likerA.userId);
		await like("gr-merge-src", likerB.userId);
		await like("gr-merge-src", requester.userId);
		await like("gr-merge-dst", likerA.userId);

		const res = await api("POST", "/api/admin/feedback/game-requests/gr-merge-src/merge", feedbackAdmin.authHeaders, {
			into: "gr-merge-dst",
		});
		assert.strictEqual(res.status, 200);
		assert.deepStrictEqual(res.data, { into: "gr-merge-dst", likeCount: 3 });

		// The source request is gone; the target holds exactly the deduplicated votes.
		assert.strictEqual(await colls.gameMetadatas.findOne({ _id: "gr-merge-src" }), null);
		assert.strictEqual(await colls.gameLikes.countDocuments({ game: "gr-merge-src" }), 0);
		const dstLikes = await colls.gameLikes.find({ game: "gr-merge-dst" }).toArray();
		assert.deepStrictEqual(
			dstLikes.map((l) => l.user.toHexString()).sort(),
			[likerA.userId.toHexString(), likerB.userId.toHexString(), requester.userId.toHexString()].sort(),
		);
		// Exact recount, not 2 + 3.
		assert.strictEqual((await colls.gameMetadatas.findOne({ _id: "gr-merge-dst" }))?.likeCount, 3);
	});

	it("validates merge targets", async () => {
		const headers = feedbackAdmin.authHeaders;
		// Source === target.
		assert.strictEqual(
			(await api("POST", "/api/admin/feedback/game-requests/gr-own/merge", headers, { into: "gr-own" })).status,
			400,
		);
		// Missing/empty body.
		assert.strictEqual((await api("POST", "/api/admin/feedback/game-requests/gr-own/merge", headers, {})).status, 400);
		// Unknown source or target.
		assert.strictEqual(
			(await api("POST", "/api/admin/feedback/game-requests/gr-unknown/merge", headers, { into: "gr-own" })).status,
			404,
		);
		assert.strictEqual(
			(await api("POST", "/api/admin/feedback/game-requests/gr-own/merge", headers, { into: "gr-unknown" })).status,
			404,
		);
		// Beta/implemented games are neither valid sources nor valid targets.
		assert.strictEqual(
			(await api("POST", "/api/admin/feedback/game-requests/gr-beta/merge", headers, { into: "gr-own" })).status,
			404,
		);
		assert.strictEqual(
			(await api("POST", "/api/admin/feedback/game-requests/gr-own/merge", headers, { into: "gr-beta" })).status,
			404,
		);
		assert.strictEqual(
			(await api("POST", "/api/admin/feedback/game-requests/gr-own/merge", headers, { into: "gr-implemented" })).status,
			404,
		);
		// A request that gained version docs after being listed.
		assert.strictEqual(
			(await api("POST", "/api/admin/feedback/game-requests/gr-own/merge", headers, { into: "gr-race" })).status,
			409,
		);
		// Nothing was merged.
		assert.ok(await colls.gameMetadatas.findOne({ _id: "gr-own" }));
	});

	it("lets a per-game admin act on their own game's requests only", async () => {
		// gameAdmin holds gameinfo:gr-own — an exact-match grant — so only the
		// "gr-own" request itself is in their scope; multiGameAdmin holds
		// gameinfo:gr-own-src and gameinfo:gr-own-dst for the merge cases.
		const multiGameAdmin = await insertUserWithAuth("multi2", {
			adminGrants: ["gameinfo:gr-own-src", "gameinfo:gr-own-dst"],
		});
		await insertRequest("gr-other-delete");

		// Out of scope: the request survives.
		assert.strictEqual(
			(await api("DELETE", "/api/admin/feedback/game-requests/gr-other-delete", gameAdmin.authHeaders)).status,
			403,
		);
		assert.ok(await colls.gameMetadatas.findOne({ _id: "gr-other-delete" }));
		// Non-admins and unrelated scoped admins can't act at all. (A scoped admin
		// without a feedback-satisfying grant — users, or another game's
		// gameinfo:<game> — is stopped by the mount gate.)
		assert.strictEqual(
			(await api("DELETE", "/api/admin/feedback/game-requests/gr-own", requester.authHeaders)).status,
			403,
		);
		assert.strictEqual(
			(await api("DELETE", "/api/admin/feedback/game-requests/gr-own", usersAdmin.authHeaders)).status,
			403,
		);
		assert.strictEqual(
			(await api("DELETE", "/api/admin/feedback/game-requests/gr-own", otherGameAdmin.authHeaders)).status,
			403,
		);
		// In scope.
		const res = await api("DELETE", "/api/admin/feedback/game-requests/gr-own", gameAdmin.authHeaders);
		assert.strictEqual(res.status, 204, JSON.stringify(res.data));

		// Merge: both endpoints of the merge must be in the admin's scope.
		await insertRequest("gr-own-src");
		await insertRequest("gr-own-dst");
		assert.strictEqual(
			(
				await api("POST", "/api/admin/feedback/game-requests/gr-own-src/merge", multiGameAdmin.authHeaders, {
					into: "gr-other",
				})
			).status,
			403,
		);
		assert.strictEqual(
			(
				await api("POST", "/api/admin/feedback/game-requests/gr-other/merge", multiGameAdmin.authHeaders, {
					into: "gr-own-dst",
				})
			).status,
			403,
		);
		assert.strictEqual(
			(
				await api("POST", "/api/admin/feedback/game-requests/gr-own-src/merge", otherGameAdmin.authHeaders, {
					into: "gr-other",
				})
			).status,
			403,
		);
		assert.ok(await colls.gameMetadatas.findOne({ _id: "gr-own-src" }));
		assert.strictEqual(
			(
				await api("POST", "/api/admin/feedback/game-requests/gr-own-src/merge", multiGameAdmin.authHeaders, {
					into: "gr-own-dst",
				})
			).status,
			200,
		);
	});
});
