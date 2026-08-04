import assert from "node:assert/strict";
import { after, before, describe, it, mock } from "node:test";
import { ObjectId } from "mongodb";
import { colls, db } from "../../config/db.ts";
import env from "../../config/env.ts";
import { testUser } from "../../config/test-helpers.ts";
import { createAccessToken, generateRefreshCode } from "../../models/jwtrefreshtokens.ts";

const baseURL = () => `http://${env.listen.host}:${env.listen.port.api}`;

// Node's test runner runs spec files in separate processes, so stubbing the
// global fetch here only affects this file's process — the route module picks
// it up at call time. No real Loki is ever contacted.
const lokiUrls: URL[] = [];

function lokiUrlFromRequest(input: string | URL | Request): URL {
	if (typeof input === "string" || input instanceof URL) {
		return new URL(input);
	}
	return new URL(input.url);
}

const lokiOk = () => new Response(JSON.stringify({ status: "success", data: { result: [] } }), { status: 200 });

const realFetch = globalThis.fetch;

describe("Admin Loki proxy", () => {
	let adminHeaders: Record<string, string>;

	before(async () => {
		const adminId = new ObjectId();
		await colls.users.insertOne(testUser({ _id: adminId, authority: "admin" }));
		const tokenDoc = { user: adminId, code: generateRefreshCode(), createdAt: new Date() };
		await colls.jwtRefreshTokens.insertOne(tokenDoc);
		const token = await createAccessToken(tokenDoc, ["all"], true);
		adminHeaders = { Authorization: `Bearer ${token}` };

		mock.method(globalThis, "fetch", async (input: string | URL | Request, init?: RequestInit) => {
			const url = lokiUrlFromRequest(input);
			if (url.pathname.startsWith("/loki/")) {
				lokiUrls.push(url);
				return lokiOk();
			}
			// Requests to the API server under test go through for real.
			return realFetch(input, init);
		});
	});

	after(async () => {
		mock.restoreAll();
		await db().dropDatabase();
	});

	async function query(key: string, params?: Record<string, string>) {
		lokiUrls.length = 0;
		const search = params ? `?${new URLSearchParams(params)}` : "";
		const res = await fetch(`${baseURL()}/api/admin/loki/query/${key}${search}`, { headers: adminHeaders });
		return { status: res.status, lokiUrl: lokiUrls[0] };
	}

	it("evaluates instant queries at a single timestamp (start === end), not a 1h span", async () => {
		for (const key of ["statusCounts", "slowEndpoints", "errorEndpoints"]) {
			const { status, lokiUrl } = await query(key);
			assert.equal(status, 200, key);
			assert.equal(lokiUrl.pathname, "/loki/api/v1/query");
			assert.equal(lokiUrl.searchParams.get("start"), lokiUrl.searchParams.get("end"), key);
			assert.equal(lokiUrl.searchParams.has("step"), false, key);
			const time = Number(lokiUrl.searchParams.get("time"));
			assert.ok(Number.isFinite(time) && time > 0, `${key}: time=${lokiUrl.searchParams.get("time")}`);
		}
	});

	it("honours the requested end for instant queries", async () => {
		const end = Date.now() - 60_000;
		const { status, lokiUrl } = await query("statusCounts", { end: String(end) });
		assert.equal(status, 200);
		assert.equal(lokiUrl.searchParams.get("time"), String(Math.floor(end / 1000)));
	});

	it("passes a step param and expands $__interval for query_range queries", async () => {
		for (const key of ["requestRate", "errorRate", "latency"]) {
			const { status, lokiUrl } = await query(key);
			assert.equal(status, 200, key);
			assert.equal(lokiUrl.pathname, "/loki/api/v1/query_range");
			const step = Number(lokiUrl.searchParams.get("step"));
			assert.ok(Number.isFinite(step) && step >= 15, `${key}: step=${step}`);
			const logql = lokiUrl.searchParams.get("query") ?? "";
			assert.ok(!logql.includes("$__interval"), `${key}: ${logql}`);
			assert.ok(logql.includes(`[${step}s]`), `${key}: ${logql}`);
		}
	});

	it("coarsens the step for larger windows (~60 points per window)", async () => {
		const end = Date.now();
		const { status, lokiUrl } = await query("requestRate", {
			start: String(end - 3600_000),
			end: String(end),
		});
		assert.equal(status, 200);
		assert.equal(lokiUrl.searchParams.get("step"), "60");
	});

	it("rejects windows larger than 6h with 400", async () => {
		const end = Date.now();
		const { status, lokiUrl } = await query("recentErrors", {
			start: String(end - 7 * 3600_000),
			end: String(end),
		});
		assert.equal(status, 400);
		assert.equal(lokiUrl, undefined, "Loki must not be contacted");
	});

	it("rejects unknown query keys with 400", async () => {
		const { status, lokiUrl } = await query("dropDatabase");
		assert.equal(status, 400);
		assert.equal(lokiUrl, undefined, "Loki must not be contacted");
	});
});
