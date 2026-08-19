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
import { ACTION_RATE_LIMITS } from "../../services/actionratelimit.ts";

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

async function insertUserWithAuth(suffix: string, authority?: string) {
	const userId = new ObjectId();
	await colls.users.insertOne(
		testUser({
			_id: userId,
			account: { username: `fbuser${suffix}`, email: `fbuser${suffix}@test.com` },
			security: { confirmed: true, slug: `fbuser${suffix}` },
			...(authority ? { authority } : {}),
		}),
	);
	const code = generateRefreshCode();
	const tokenDoc = { user: userId, codeHash: hashRefreshCode(code), createdAt: new Date() };
	await colls.jwtRefreshTokens.insertOne(tokenDoc);
	const token = await createAccessToken(tokenDoc, ["all"], false);
	return { userId, authHeaders: { Authorization: `Bearer ${token}` } };
}

const feedbackItem = z.object({
	_id: z.string(),
	kind: z.enum(["site", "game"]),
	game: z.string().optional(),
	title: z.string(),
	body: z.string().optional(),
	likeCount: z.number(),
	status: z.enum(["open", "planned", "done", "declined"]),
	liked: z.boolean(),
	requestedBy: z.string().optional(),
	forumTid: z.number().optional(),
	createdAt: z.string().optional(),
});

describe("Feedback API — site + game-specific requests (#340)", () => {
	let alice: Awaited<ReturnType<typeof insertUserWithAuth>>;
	let bob: Awaited<ReturnType<typeof insertUserWithAuth>>;
	let admin: Awaited<ReturnType<typeof insertUserWithAuth>>;
	let siteRequestId: string;
	let gameRequestId: string;
	let savedNodebb: string;

	before(async () => {
		await colls.gameInfos.insertOne({
			_id: { game: "fbgame", version: 1 },
			viewer: { url: "//test.com/fbgame" },
			public: true,
		});
		await colls.gameMetadatas.insertOne({ _id: "fbgame", label: "FB Game", players: [2] });
		// A requested (not yet implemented) game: game-specific requests must reject it.
		await colls.gameMetadatas.insertOne({
			_id: "fbrequested",
			label: "FB Requested",
			players: [],
			status: "requested",
		});
		alice = await insertUserWithAuth("alice");
		bob = await insertUserWithAuth("bob");
		admin = await insertUserWithAuth("admin", "admin");

		// Site/game feedback is posted on the forum AS the user (#340), so the
		// create route requires a linked forum account. The forum-uid lookup reads
		// `env.database.nodebb` via its own short-lived connection — point it at the
		// SAME test db and seed the bgs→forum-uid link doc so alice/bob/admin have
		// forum accounts. Upserted (the specs share the process/db and interleave)
		// and restored in after().
		savedNodebb = env.database.nodebb;
		const bgsUrl = new URL(env.database.bgs.url.replace(/^mongodb:/, "http:"));
		env.database.nodebb = `mongodb://${bgsUrl.host}/${env.database.bgs.name}${bgsUrl.search}`;
		await db()
			.collection("objects")
			.updateOne(
				{ _key: "boardgamersId:uid" },
				{
					$set: {
						[alice.userId.toHexString()]: 11,
						[bob.userId.toHexString()]: 12,
						[admin.userId.toHexString()]: 13,
					},
				},
				{ upsert: true },
			);
	});

	it("requires authentication to create a request", async () => {
		assert.strictEqual((await api("POST", "/api/feedback", { kind: "site", title: "Anon" })).status, 401);
	});

	it("requires a linked forum account (forum_account_required)", async () => {
		// A user with no forum account (not in the boardgamersId:uid link doc).
		const noforum = await insertUserWithAuth("noforum");
		const res = await api("POST", "/api/feedback", { kind: "site", title: "No forum account" }, noforum.authHeaders);
		assert.strictEqual(res.status, 403);
		const code = typeof res.data === "object" && res.data !== null && "code" in res.data ? res.data.code : undefined;
		assert.strictEqual(code, "forum_account_required");
		// The request was NOT created.
		assert.strictEqual(await colls.feedbackRequests.countDocuments({ requestedBy: noforum.userId }), 0);
	});

	it("creates a site request", async () => {
		const res = await api(
			"POST",
			"/api/feedback",
			{ kind: "site", title: "Dark mode", body: "Please add a dark mode" },
			alice.authHeaders,
		);
		assert.strictEqual(res.status, 201);
		const created = feedbackItem.parse(res.data);
		assert.strictEqual(created.kind, "site");
		assert.strictEqual(created.title, "Dark mode");
		assert.strictEqual(created.body, "Please add a dark mode");
		assert.strictEqual(created.likeCount, 0);
		assert.strictEqual(created.status, "open");
		assert.strictEqual(created.liked, false);
		siteRequestId = created._id;
	});

	it("creates a game request for an existing game", async () => {
		const res = await api(
			"POST",
			"/api/feedback",
			{ kind: "game", game: "fbgame", title: "New expansion" },
			bob.authHeaders,
		);
		assert.strictEqual(res.status, 201);
		const created = feedbackItem.parse(res.data);
		assert.strictEqual(created.kind, "game");
		assert.strictEqual(created.game, "fbgame");
		gameRequestId = created._id;
	});

	it("validates the payload", async () => {
		// Title too short / missing / unknown kind.
		assert.strictEqual(
			(await api("POST", "/api/feedback", { kind: "site", title: "ab" }, alice.authHeaders)).status,
			400,
		);
		assert.strictEqual((await api("POST", "/api/feedback", { kind: "site" }, alice.authHeaders)).status, 400);
		assert.strictEqual(
			(await api("POST", "/api/feedback", { kind: "bug", title: "A bug" }, alice.authHeaders)).status,
			400,
		);
		// kind "game" without a game id, with an unknown game, or with a requested game.
		assert.strictEqual(
			(await api("POST", "/api/feedback", { kind: "game", title: "No game id" }, alice.authHeaders)).status,
			400,
		);
		assert.strictEqual(
			(await api("POST", "/api/feedback", { kind: "game", game: "nope", title: "Unknown game" }, alice.authHeaders))
				.status,
			404,
		);
		assert.strictEqual(
			(
				await api(
					"POST",
					"/api/feedback",
					{ kind: "game", game: "fbrequested", title: "Expansion for a requested game" },
					alice.authHeaders,
				)
			).status,
			404,
		);
	});

	it("lists site requests publicly, most-liked first, with per-user liked flags", async () => {
		// A second site request; bob votes on alice's so it outranks.
		await api("POST", "/api/feedback", { kind: "site", title: "Mobile app" }, bob.authHeaders);
		await api("PUT", `/api/feedback/${siteRequestId}/like`, undefined, bob.authHeaders);

		// Filter to this suite's fixtures: the DB may hold other specs' requests.
		const anonymous = z
			.array(feedbackItem)
			.parse((await api("GET", "/api/feedback?kind=site")).data)
			.filter((r) => ["Dark mode", "Mobile app"].includes(r.title));
		assert.deepStrictEqual(
			anonymous.map((r) => r.title),
			["Dark mode", "Mobile app"],
		);
		assert.deepStrictEqual(
			anonymous.map((r) => r.likeCount),
			[1, 0],
		);
		assert.deepStrictEqual(
			anonymous.map((r) => r.liked),
			[false, false],
		);
		assert.strictEqual(anonymous[0].requestedBy, "fbuseralice");

		const authed = z
			.array(feedbackItem)
			.parse((await api("GET", "/api/feedback?kind=site", undefined, bob.authHeaders)).data)
			.filter((r) => ["Dark mode", "Mobile app"].includes(r.title));
		assert.deepStrictEqual(
			authed.map((r) => r.liked),
			[true, false],
		);
	});

	it("lists game requests filtered by game", async () => {
		const res = z.array(feedbackItem).parse((await api("GET", "/api/feedback?kind=game&game=fbgame")).data);
		assert.deepStrictEqual(
			res.map((r) => r.title),
			["New expansion"],
		);
		// kind=game without a game id is a client error; the kinds don't leak into each other.
		assert.strictEqual((await api("GET", "/api/feedback?kind=game")).status, 400);
		const sites = z
			.array(feedbackItem)
			.parse((await api("GET", "/api/feedback?kind=site")).data)
			.filter((r) => r.title === "New expansion");
		assert.strictEqual(sites.length, 0);
	});

	it("requires authentication to vote", async () => {
		assert.strictEqual((await api("PUT", `/api/feedback/${siteRequestId}/like`)).status, 401);
		assert.strictEqual((await api("DELETE", `/api/feedback/${siteRequestId}/like`)).status, 401);
	});

	it("404s on unknown request ids", async () => {
		const unknown = new ObjectId().toHexString();
		assert.strictEqual((await api("PUT", `/api/feedback/${unknown}/like`, undefined, alice.authHeaders)).status, 404);
		assert.strictEqual(
			(await api("PATCH", `/api/feedback/${unknown}/status`, { status: "done" }, admin.authHeaders)).status,
			404,
		);
		assert.strictEqual((await api("PUT", "/api/feedback/not-an-id/like", undefined, alice.authHeaders)).status, 400);
	});

	it("votes and unvotes, idempotently, maintaining likeCount", async () => {
		const res = await api("PUT", `/api/feedback/${gameRequestId}/like`, undefined, alice.authHeaders);
		assert.deepStrictEqual(res.data, { liked: true, likeCount: 1 });

		const again = await api("PUT", `/api/feedback/${gameRequestId}/like`, undefined, alice.authHeaders);
		assert.deepStrictEqual(again.data, { liked: true, likeCount: 1 });
		assert.strictEqual(await colls.feedbackRequestLikes.countDocuments({ request: new ObjectId(gameRequestId) }), 1);

		const removed = await api("DELETE", `/api/feedback/${gameRequestId}/like`, undefined, alice.authHeaders);
		assert.deepStrictEqual(removed.data, { liked: false, likeCount: 0 });
		const removedAgain = await api("DELETE", `/api/feedback/${gameRequestId}/like`, undefined, alice.authHeaders);
		assert.deepStrictEqual(removedAgain.data, { liked: false, likeCount: 0 });
		assert.strictEqual((await colls.feedbackRequests.findOne({ _id: new ObjectId(gameRequestId) }))?.likeCount, 0);
	});

	it("lets admins transition the status", async () => {
		const res = await api("PATCH", `/api/feedback/${siteRequestId}/status`, { status: "planned" }, admin.authHeaders);
		assert.strictEqual(res.status, 200);
		assert.strictEqual(feedbackItem.parse(res.data).status, "planned");
		assert.strictEqual((await colls.feedbackRequests.findOne({ _id: new ObjectId(siteRequestId) }))?.status, "planned");
		// The new status is served on listings.
		const list = z.array(feedbackItem).parse((await api("GET", "/api/feedback?kind=site")).data);
		assert.strictEqual(list.find((r) => r._id === siteRequestId)?.status, "planned");
	});

	it("rejects status changes from non-admins and invalid statuses", async () => {
		assert.strictEqual(
			(await api("PATCH", `/api/feedback/${siteRequestId}/status`, { status: "done" }, alice.authHeaders)).status,
			403,
		);
		assert.strictEqual((await api("PATCH", `/api/feedback/${siteRequestId}/status`, { status: "done" })).status, 403);
		assert.strictEqual(
			(await api("PATCH", `/api/feedback/${siteRequestId}/status`, { status: "nope" }, admin.authHeaders)).status,
			400,
		);
	});

	it("caps the number of open requests per user", async () => {
		// Relax the per-day action rate limit (registered at 10/day, which this test
		// would otherwise trip) so only the open-requests cap is exercised.
		ACTION_RATE_LIMITS["feedback/create"] = { max: 1000, windowMs: 24 * 60 * 60 * 1000 };
		try {
			// Alice has 0 open requests ("Dark mode" is now "planned", so it no longer counts).
			for (let i = 1; i <= 10; i++) {
				const res = await api("POST", "/api/feedback", { kind: "site", title: `Alice bulk ${i}` }, alice.authHeaders);
				assert.strictEqual(res.status, 201, `request ${i}: ${JSON.stringify(res.data)}`);
			}
			const res = await api(
				"POST",
				"/api/feedback",
				{ kind: "site", title: "One request too many" },
				alice.authHeaders,
			);
			assert.strictEqual(res.status, 429);
		} finally {
			ACTION_RATE_LIMITS["feedback/create"] = { max: 10, windowMs: 24 * 60 * 60 * 1000 };
		}
	});

	after(async () => {
		env.database.nodebb = savedNodebb;
		await db().dropDatabase();
	});
});
