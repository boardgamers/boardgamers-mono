import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { ObjectId } from "mongodb";
import { colls, db } from "../../config/db.ts";
import env from "../../config/env.ts";
import { testUser } from "../../config/test-helpers.ts";
import { createAccessToken, generateRefreshCode } from "../../models/jwtrefreshtokens.ts";
import { resetPassword } from "../../models/user.ts";

const baseURL = () => `http://${env.listen.host}:${env.listen.port.api}`;

async function api(method: string, path: string, headers?: Record<string, string>) {
	const res = await fetch(`${baseURL()}${path}`, { method, headers });
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

const DAY = 24 * 3600 * 1000;

describe("Admin users API", () => {
	const adminId = new ObjectId();
	const userId = new ObjectId();
	const otherUserId = new ObjectId();
	let adminHeaders: Record<string, string>;

	before(async () => {
		await colls.users.insertOne(testUser({ _id: adminId, authority: "admin" }));
		adminHeaders = await makeAuthHeaders(adminId);
	});

	after(() => db().dropDatabase());

	describe("DELETE /admin/users/:userId/refresh-tokens", () => {
		before(async () => {
			await colls.users.insertOne(testUser({ _id: userId }));
			await colls.users.insertOne(testUser({ _id: otherUserId }));
			for (let i = 0; i < 3; i++) {
				await colls.jwtRefreshTokens.insertOne({ user: userId, code: `code-${i}`, createdAt: new Date() });
			}
			await colls.jwtRefreshTokens.insertOne({ user: otherUserId, code: "other-code", createdAt: new Date() });
		});

		it("rejects non-admin callers", async () => {
			const res = await api("DELETE", `/api/admin/users/${userId.toHexString()}/refresh-tokens`);
			assert.strictEqual(res.status, 403);
		});

		it("404s for an unknown user", async () => {
			const res = await api("DELETE", `/api/admin/users/${new ObjectId().toHexString()}/refresh-tokens`, adminHeaders);
			assert.strictEqual(res.status, 404);
		});

		it("deletes only the target user's tokens", async () => {
			const res = await api("DELETE", `/api/admin/users/${userId.toHexString()}/refresh-tokens`, adminHeaders);
			assert.strictEqual(res.status, 200);
			assert.deepStrictEqual(res.data, { deleted: 3 });

			assert.strictEqual(await colls.jwtRefreshTokens.countDocuments({ user: userId }), 0);
			assert.strictEqual(await colls.jwtRefreshTokens.countDocuments({ user: otherUserId }), 1);
		});
	});

	describe("resetPassword", () => {
		it("revokes the user's refresh tokens", async () => {
			const user = await colls.users.findOne({ _id: otherUserId });
			assert.ok(user);
			assert.strictEqual(await colls.jwtRefreshTokens.countDocuments({ user: otherUserId }), 1);

			await resetPassword(user, "new-password-123");

			assert.strictEqual(await colls.jwtRefreshTokens.countDocuments({ user: otherUserId }), 0);
			const updated = await colls.users.findOne({ _id: otherUserId });
			assert.ok(updated?.account.password);
			assert.strictEqual(updated?.security.reset, null);
		});
	});

	describe("GET /admin/users/login-methods", () => {
		const recentPasswordId = new ObjectId();
		const oldGoogleId = new ObjectId();
		const recentComboId = new ObjectId();
		const noMethodId = new ObjectId();

		before(async () => {
			const now = new Date();
			const old = new Date(Date.now() - 180 * DAY);
			await colls.users.insertOne(
				testUser({
					_id: recentPasswordId,
					account: { password: "hash" },
					security: { lastLogin: { ip: "", date: now } },
				}),
			);
			await colls.users.insertOne(
				testUser({
					_id: oldGoogleId,
					account: { social: { google: "g1" } },
					security: { lastLogin: { ip: "", date: old } },
				}),
			);
			await colls.users.insertOne(
				testUser({
					_id: recentComboId,
					account: { password: "hash", social: { google: "g2", discord: "d1" } },
					security: { lastLogin: { ip: "", date: now } },
				}),
			);
			// Empty password string + never logged in → no usable method, "older" bucket
			await colls.users.insertOne(
				testUser({ _id: noMethodId, security: { lastLogin: { ip: "", date: new Date(0) } } }),
			);
		});

		it("rejects non-admin callers", async () => {
			const res = await api("GET", "/api/admin/users/login-methods");
			assert.strictEqual(res.status, 403);
		});

		it("aggregates users by method and recency", async () => {
			const res = await api("GET", "/api/admin/users/login-methods", adminHeaders);
			assert.strictEqual(res.status, 200);

			interface LoginMethodsBody {
				recentDays: number;
				perMethod: { recent: Record<string, number>; older: Record<string, number> };
				combinations: { methods: string[]; recent: number; older: number }[];
			}
			// oxlint-disable-next-line typescript/no-unsafe-type-assertion -- trusted own-endpoint shape
			const body = res.data as LoginMethodsBody;
			assert.strictEqual(body.recentDays, 90);

			// Fixture users with a usable login method (social ids are unique-indexed, so counts
			// can't drift when this spec runs together with other specs against the same db).
			assert.strictEqual(body.perMethod.recent.password, 2);
			assert.strictEqual(body.perMethod.recent.google, 1);
			assert.strictEqual(body.perMethod.older.google, 1);
			assert.strictEqual(body.perMethod.recent.discord, 1);
			assert.strictEqual(body.perMethod.older.discord, 0);
			assert.ok(body.combinations.length > 0);

			// A method set can appear as separate recent/older rows — merge before asserting.
			const combo = (methods: string[]) =>
				body.combinations
					.filter((c) => c.methods.length === methods.length && methods.every((m) => c.methods.includes(m)))
					.reduce((acc, c) => ({ recent: acc.recent + c.recent, older: acc.older + c.older }), { recent: 0, older: 0 });
			// ["password"]: recentPasswordId (recent) + otherUserId (older — resetPassword gave it a hash)
			assert.deepStrictEqual(combo(["password"]), { recent: 1, older: 1 });
			assert.deepStrictEqual(combo(["google"]), { recent: 0, older: 1 });
			assert.deepStrictEqual(combo(["password", "google", "discord"]), { recent: 1, older: 0 });
			// adminId, userId, noMethodId: testUser leaves password "" and no social → no usable method.
			// (May also count users from other spec files when the full suite shares the db.)
			assert.strictEqual(combo([]).recent, 0);
			assert.ok(combo([]).older >= 3);
		});
	});
});
