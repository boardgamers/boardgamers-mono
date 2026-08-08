// Run via `pnpm test` (the package.json script), NOT bare `node --test`. The script
// imports app/config/test-hooks.ts, which connects to the *-test database and starts
// the API server.
import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { createHash } from "node:crypto";
import { ObjectId } from "mongodb";
import { colls, db } from "../../config/db.ts";
import env from "../../config/env.ts";
import { testUser } from "../../config/test-helpers.ts";
import { createAdminToken } from "../../models/admintokens.ts";
import { createAccessToken, generateRefreshCode } from "../../models/jwtrefreshtokens.ts";

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

async function makeAuthHeaders(userId: ObjectId) {
	const code = generateRefreshCode();
	const tokenDoc = { user: userId, code, createdAt: new Date() };
	await colls.jwtRefreshTokens.insertOne(tokenDoc);
	const token = await createAccessToken(tokenDoc, ["all"], true);
	return { Authorization: `Bearer ${token}` };
}

const sha256 = (s: string) => createHash("sha256").update(s).digest("hex");

const DAY_MS = 24 * 3600 * 1000;

interface CreatedTokenBody {
	_id: string;
	name: string;
	createdAt: string;
	expiresAt: string;
	token: string;
}

interface ListedTokenBody {
	_id: string;
	name: string;
	createdAt: string;
	expiresAt: string;
	lastUsedAt?: string;
	revokedAt?: string;
}

describe("Admin tokens API", () => {
	const adminId = new ObjectId();
	const otherAdminId = new ObjectId();
	const userId = new ObjectId();
	let adminHeaders: Record<string, string>;
	let userHeaders: Record<string, string>;

	before(async () => {
		await colls.users.insertOne(testUser({ _id: adminId, authority: "admin" }));
		await colls.users.insertOne(testUser({ _id: otherAdminId, authority: "admin" }));
		await colls.users.insertOne(testUser({ _id: userId }));
		adminHeaders = await makeAuthHeaders(adminId);
		userHeaders = await makeAuthHeaders(userId);
	});

	after(() => db().dropDatabase());

	describe("management endpoints", () => {
		it("creates a token: raw token returned once, only the hash is stored", async () => {
			const res = await api("POST", "/api/admin/tokens", adminHeaders, { name: "ci script", ttlDays: 7 });
			assert.strictEqual(res.status, 201);

			// oxlint-disable-next-line typescript/no-unsafe-type-assertion -- trusted own-endpoint shape
			const body = res.data as CreatedTokenBody;
			assert.equal(body.name, "ci script");
			assert.ok(body.token.length >= 40);
			const ttl = new Date(body.expiresAt).getTime() - new Date(body.createdAt).getTime();
			assert.ok(Math.abs(ttl - 7 * DAY_MS) < 5000, `ttl ~7 days, got ${ttl}ms`);

			const stored = await colls.adminTokens.findOne({ _id: new ObjectId(body._id) });
			assert.ok(stored);
			assert.equal(stored.tokenHash, sha256(body.token));
			assert.equal(stored.user.toHexString(), adminId.toHexString());
			// The raw token is stored nowhere.
			assert.ok(!JSON.stringify(stored).includes(body.token));
		});

		it("defaults ttlDays to 30 and rejects ttls over 90 days", async () => {
			const def = await api("POST", "/api/admin/tokens", adminHeaders, { name: "default" });
			assert.strictEqual(def.status, 201);
			// oxlint-disable-next-line typescript/no-unsafe-type-assertion -- trusted own-endpoint shape
			const defBody = def.data as CreatedTokenBody;
			const defTtl = new Date(defBody.expiresAt).getTime() - new Date(defBody.createdAt).getTime();
			assert.ok(Math.abs(defTtl - 30 * DAY_MS) < 5000, `default ttl ~30 days, got ${defTtl}ms`);

			// Over the max → 400 (schema bound), never silently stored with a huge TTL.
			const over = await api("POST", "/api/admin/tokens", adminHeaders, { name: "forever", ttlDays: 10000 });
			assert.strictEqual(over.status, 400);
		});

		it("lists own tokens without leaking the hash", async () => {
			const res = await api("GET", "/api/admin/tokens", adminHeaders);
			assert.strictEqual(res.status, 200);

			// oxlint-disable-next-line typescript/no-unsafe-type-assertion -- trusted own-endpoint shape
			const tokens = res.data as ListedTokenBody[];
			assert.ok(tokens.length >= 2);
			for (const t of tokens) {
				const keys = Object.keys(t);
				assert.ok(!keys.includes("tokenHash"), "list must not expose the hash");
				assert.ok(!keys.includes("token"));
				assert.ok(!keys.includes("user"));
				assert.ok(t.name && t.createdAt && t.expiresAt);
			}
			// Other admins' tokens are not visible.
			assert.ok(tokens.every((t) => t.name !== "other-admin-token"));
		});

		it("requires admin for all management endpoints", async () => {
			assert.strictEqual((await api("POST", "/api/admin/tokens", undefined, { name: "x" })).status, 403);
			assert.strictEqual((await api("GET", "/api/admin/tokens")).status, 403);
			assert.strictEqual((await api("POST", "/api/admin/tokens", userHeaders, { name: "x" })).status, 403);
			assert.strictEqual((await api("GET", "/api/admin/tokens", userHeaders)).status, 403);
		});
	});

	describe("authentication", () => {
		let rawToken: string;

		before(async () => {
			({ token: rawToken } = await createAdminToken(adminId, "auth-tests", DAY_MS));
			await createAdminToken(otherAdminId, "other-admin-token", DAY_MS);
		});

		it("authenticates as the owning admin on admin routes", async () => {
			const res = await api("GET", "/api/admin/users/stats", { Authorization: `Bearer ${rawToken}` });
			assert.strictEqual(res.status, 200);
			// oxlint-disable-next-line typescript/no-unsafe-type-assertion -- trusted own-endpoint shape
			const body = res.data as { totalUsers: number };
			assert.ok(body.totalUsers >= 3);
		});

		it("touches lastUsedAt on use", async () => {
			const doc = await colls.adminTokens.findOne({ tokenHash: sha256(rawToken) });
			assert.ok(doc?.lastUsedAt);
		});

		it("rejects garbage tokens", async () => {
			assert.strictEqual(
				(await api("GET", "/api/admin/users/stats", { Authorization: "Bearer not-a-token-at-all" })).status,
				403,
			);
		});

		it("does not leak a session: no refresh cookie is set", async () => {
			const res = await fetch(`${baseURL()}/api/admin/users/stats`, {
				headers: { Authorization: `Bearer ${rawToken}` },
			});
			assert.strictEqual(res.status, 200);
			const cookies = res.headers.getSetCookie();
			assert.ok(!cookies.some((c) => c.startsWith("refreshToken=")), `no refresh cookie, got ${cookies.join()}`);
		});

		it("cannot mint access tokens (no session upgrade)", async () => {
			const res = await api("POST", "/api/account/mint", { Authorization: `Bearer ${rawToken}` }, {});
			assert.strictEqual(res.status, 403);
		});

		it("cannot mutate the account", async () => {
			const res = await api("POST", "/api/account/", { Authorization: `Bearer ${rawToken}` }, { settings: {} });
			assert.strictEqual(res.status, 403);
		});

		it("stops working when the owner is demoted from admin, works again if re-promoted", async () => {
			await colls.users.updateOne({ _id: adminId }, { $set: { authority: "user" } });
			const demoted = await api("GET", "/api/admin/users/stats", { Authorization: `Bearer ${rawToken}` });
			assert.strictEqual(demoted.status, 403);

			await colls.users.updateOne({ _id: adminId }, { $set: { authority: "admin" } });
			const repromoted = await api("GET", "/api/admin/users/stats", { Authorization: `Bearer ${rawToken}` });
			assert.strictEqual(repromoted.status, 200);
		});

		it("rejects expired tokens", async () => {
			const { token } = await createAdminToken(adminId, "expired", -1);
			const res = await api("GET", "/api/admin/users/stats", { Authorization: `Bearer ${token}` });
			assert.strictEqual(res.status, 403);
		});
	});

	describe("revocation & rotation", () => {
		it("revokes a token: it stops authenticating, and a new one can be created", async () => {
			const created = await api("POST", "/api/admin/tokens", adminHeaders, { name: "rotate me", ttlDays: 1 });
			assert.strictEqual(created.status, 201);
			// oxlint-disable-next-line typescript/no-unsafe-type-assertion -- trusted own-endpoint shape
			const { _id, token } = created.data as CreatedTokenBody;

			assert.strictEqual(
				(await api("GET", "/api/admin/users/stats", { Authorization: `Bearer ${token}` })).status,
				200,
			);

			const revoked = await api("DELETE", `/api/admin/tokens/${_id}`, adminHeaders);
			assert.strictEqual(revoked.status, 200);

			assert.strictEqual(
				(await api("GET", "/api/admin/users/stats", { Authorization: `Bearer ${token}` })).status,
				403,
			);

			// The revoked token still shows up in the list, flagged.
			const listRes = await api("GET", "/api/admin/tokens", adminHeaders);
			// oxlint-disable-next-line typescript/no-unsafe-type-assertion -- trusted own-endpoint shape
			const list = listRes.data as ListedTokenBody[];
			assert.ok(list.find((t) => t._id === _id)?.revokedAt);

			// Rotation: create a fresh token, it works.
			const rotated = await api("POST", "/api/admin/tokens", adminHeaders, { name: "rotated", ttlDays: 1 });
			assert.strictEqual(rotated.status, 201);
			// oxlint-disable-next-line typescript/no-unsafe-type-assertion -- trusted own-endpoint shape
			const rotatedToken = (rotated.data as CreatedTokenBody).token;
			assert.strictEqual(
				(await api("GET", "/api/admin/users/stats", { Authorization: `Bearer ${rotatedToken}` })).status,
				200,
			);
		});

		it("cannot revoke another admin's token", async () => {
			const other = await colls.adminTokens.findOne({ user: otherAdminId, revokedAt: { $exists: false } });
			assert.ok(other);
			const res = await api("DELETE", `/api/admin/tokens/${other._id.toHexString()}`, adminHeaders);
			assert.strictEqual(res.status, 404);
			assert.ok(!(await colls.adminTokens.findOne({ _id: other._id }))?.revokedAt);
		});

		it("404s on an unknown token id", async () => {
			const res = await api("DELETE", `/api/admin/tokens/${new ObjectId().toHexString()}`, adminHeaders);
			assert.strictEqual(res.status, 404);
		});
	});
});
