import assert from "node:assert/strict";
import { after, before, describe, it, mock } from "node:test";
import { ObjectId } from "mongodb";
import { colls, db } from "../../config/db.ts";
import env from "../../config/env.ts";
import { testUser } from "../../config/test-helpers.ts";
import { createAccessToken, generateRefreshCode, hashRefreshCode } from "../../models/jwtrefreshtokens.ts";

const baseURL = () => `http://${env.listen.host}:${env.listen.port.api}`;

// Node's test runner runs spec files in separate processes, so stubbing the
// global fetch here only affects this file's process — the route module picks
// it up at call time. The real forum is never contacted.
const forumUrl = () => new URL(env.forumUrl);
let forumStatus = 200;
let forumFetchCount = 0;

const realFetch = globalThis.fetch;

describe("Admin serverinfo forum health", () => {
	let adminHeaders: Record<string, string>;

	before(async () => {
		const adminId = new ObjectId();
		await colls.users.insertOne(testUser({ _id: adminId, authority: "admin" }));
		const tokenDoc = { user: adminId, codeHash: hashRefreshCode(generateRefreshCode()), createdAt: new Date() };
		await colls.jwtRefreshTokens.insertOne(tokenDoc);
		const token = await createAccessToken(tokenDoc, ["all"], true);
		adminHeaders = { Authorization: `Bearer ${token}` };

		mock.method(globalThis, "fetch", async (input: string | URL | Request, init?: RequestInit) => {
			const url = new URL(typeof input === "string" || input instanceof URL ? input : input.url);
			if (url.origin === forumUrl().origin) {
				forumFetchCount++;
				if (forumStatus === 0) {
					throw new TypeError("fetch failed");
				}
				return new Response("{}", { status: forumStatus });
			}
			// Requests to the API server under test go through for real.
			return realFetch(input, init);
		});
	});

	after(async () => {
		mock.restoreAll();
		await db().dropDatabase();
	});

	async function serverinfo() {
		const res = await fetch(`${baseURL()}/api/admin/serverinfo`, { headers: adminHeaders });
		assert.equal(res.status, 200, "the endpoint itself must always succeed");
		const body: unknown = await res.json();
		// oxlint-disable-next-line typescript/no-unsafe-type-assertion -- trusted own-endpoint shape
		return (body as { forum: { ok: boolean; status: number | null } }).forum;
	}

	it("probes {forumUrl}/api/config and reports up on 200", async () => {
		forumStatus = 200;
		forumFetchCount = 0;
		assert.deepEqual(await serverinfo(), { ok: true, status: 200 });
		assert.ok(forumFetchCount > 0, "forum must be contacted");
	});

	it("reports down on a non-2xx forum response, with the status", async () => {
		forumStatus = 503;
		assert.deepEqual(await serverinfo(), { ok: false, status: 503 });
	});

	it("reports down with status null when the forum is unreachable, without failing the request", async () => {
		forumStatus = 0;
		assert.deepEqual(await serverinfo(), { ok: false, status: null });
	});
});
