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
			account: { username: `fbadmin${suffix}`, email: `fbadmin${suffix}@test.com` },
			security: { confirmed: true, slug: `fbadmin${suffix}` },
			...extra,
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
	requestedBy: z.string().optional(),
	createdAt: z.string().optional(),
});

describe("Admin feedback listing API", () => {
	let fullAdmin: Awaited<ReturnType<typeof insertUserWithAuth>>;
	let feedbackAdmin: Awaited<ReturnType<typeof insertUserWithAuth>>;
	let usersAdmin: Awaited<ReturnType<typeof insertUserWithAuth>>;
	let requester: Awaited<ReturnType<typeof insertUserWithAuth>>;

	before(async () => {
		fullAdmin = await insertUserWithAuth("full", { authority: "admin" });
		feedbackAdmin = await insertUserWithAuth("scoped", { adminGrants: ["feedback"] });
		usersAdmin = await insertUserWithAuth("users", { adminGrants: ["users"] });
		requester = await insertUserWithAuth("requester");

		await colls.feedbackRequests.insertMany([
			{
				kind: "site",
				title: "Admin list site open",
				body: "An open site request",
				requestedBy: requester.userId,
				likeCount: 5,
				status: "open",
			},
			{
				kind: "site",
				title: "Admin list site done",
				requestedBy: requester.userId,
				likeCount: 2,
				status: "done",
			},
			{
				kind: "game",
				game: "fbadmingame",
				title: "Admin list game planned",
				requestedBy: requester.userId,
				likeCount: 3,
				status: "planned",
			},
			// A pre-status doc: no status field — listed as "open".
			{
				kind: "game",
				game: "fbadmingame",
				title: "Admin list game legacy",
				requestedBy: requester.userId,
			},
			// Order fixtures: same likeCount as "Admin list site open" (5) but newer —
			// ties break newest-first.
			{
				kind: "site",
				title: "Admin list tie newest",
				requestedBy: requester.userId,
				likeCount: 5,
				status: "open",
				createdAt: new Date("2024-06-01T00:00:00Z"),
			},
			{
				kind: "site",
				title: "Admin list tie oldest",
				requestedBy: requester.userId,
				likeCount: 5,
				status: "open",
				createdAt: new Date("2024-01-01T00:00:00Z"),
			},
		]);
	});

	after(() => db().dropDatabase());

	it("requires the feedback permission", async () => {
		assert.strictEqual((await api("GET", "/api/admin/feedback")).status, 403);
		assert.strictEqual((await api("GET", "/api/admin/feedback", requester.authHeaders)).status, 403);
		// A scoped admin holding another permission doesn't pass.
		assert.strictEqual((await api("GET", "/api/admin/feedback", usersAdmin.authHeaders)).status, 403);
	});

	it("lists all kinds and games in one call, for scoped and full admins", async () => {
		for (const headers of [feedbackAdmin.authHeaders, fullAdmin.authHeaders]) {
			const res = await api("GET", "/api/admin/feedback", headers);
			assert.strictEqual(res.status, 200);
			const items = z
				.array(feedbackItem)
				.parse(res.data)
				.filter((r) => r.title.startsWith("Admin list"));
			assert.deepStrictEqual(
				items.map((r) => r.title),
				[
					"Admin list tie newest",
					"Admin list tie oldest",
					"Admin list site open",
					"Admin list game planned",
					"Admin list site done",
					"Admin list game legacy",
				],
			);
			assert.deepStrictEqual(
				items.map((r) => [r.kind, r.status]),
				[
					["site", "open"],
					["site", "open"],
					["site", "open"],
					["game", "planned"],
					["site", "done"],
					["game", "open"], // legacy doc without a status field
				],
			);
			assert.strictEqual(items[3].game, "fbadmingame");
			assert.strictEqual(items[0].requestedBy, "fbadminrequester");
		}
	});

	it("sorts by likes first, then most recent", async () => {
		const res = await api("GET", "/api/admin/feedback", feedbackAdmin.authHeaders);
		assert.strictEqual(res.status, 200);
		const items = z
			.array(feedbackItem)
			.parse(res.data)
			.filter((r) => r.title.startsWith("Admin list"));
		// likeCount desc; the three 5-like ties order newest-first by createdAt
		// (docs without createdAt sort last).
		assert.deepStrictEqual(
			items.map((r) => [r.title, r.likeCount] as const),
			[
				["Admin list tie newest", 5],
				["Admin list tie oldest", 5],
				["Admin list site open", 5],
				["Admin list game planned", 3],
				["Admin list site done", 2],
				["Admin list game legacy", 0],
			],
		);
	});

	it("filters by kind, status, and game", async () => {
		const headers = feedbackAdmin.authHeaders;
		const titles = (data: unknown) =>
			z
				.array(feedbackItem)
				.parse(data)
				.filter((r) => r.title.startsWith("Admin list"))
				.map((r) => r.title);

		assert.deepStrictEqual(titles((await api("GET", "/api/admin/feedback?kind=site", headers)).data), [
			"Admin list tie newest",
			"Admin list tie oldest",
			"Admin list site open",
			"Admin list site done",
		]);
		// status=open also matches the legacy doc without a status field.
		assert.deepStrictEqual(titles((await api("GET", "/api/admin/feedback?status=open", headers)).data), [
			"Admin list tie newest",
			"Admin list tie oldest",
			"Admin list site open",
			"Admin list game legacy",
		]);
		assert.deepStrictEqual(titles((await api("GET", "/api/admin/feedback?status=planned", headers)).data), [
			"Admin list game planned",
		]);
		assert.deepStrictEqual(titles((await api("GET", "/api/admin/feedback?game=fbadmingame", headers)).data), [
			"Admin list game planned",
			"Admin list game legacy",
		]);
	});

	it("rejects invalid filter values", async () => {
		assert.strictEqual((await api("GET", "/api/admin/feedback?kind=nope", feedbackAdmin.authHeaders)).status, 400);
		assert.strictEqual((await api("GET", "/api/admin/feedback?status=nope", feedbackAdmin.authHeaders)).status, 400);
	});

	it("a scoped feedback admin can change a request's status", async () => {
		const doc = await colls.feedbackRequests.findOne({ title: "Admin list site open" });
		const res = await api("PATCH", `/api/feedback/${doc!._id.toHexString()}/status`, feedbackAdmin.authHeaders, {
			status: "declined",
		});
		assert.strictEqual(res.status, 200);
		assert.strictEqual(feedbackItem.parse(res.data).status, "declined");
		assert.strictEqual((await colls.feedbackRequests.findOne({ _id: doc!._id }))?.status, "declined");
	});
});
