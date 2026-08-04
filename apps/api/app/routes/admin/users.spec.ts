import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { ObjectId } from "mongodb";
import { colls, db } from "../../config/db.ts";
import env from "../../config/env.ts";
import { testUser } from "../../config/test-helpers.ts";
import { createAccessToken, generateRefreshCode } from "../../models/jwtrefreshtokens.ts";
import { generateHash, resetPassword } from "../../models/user.ts";

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

const WEDNESDAY = new Date(Date.UTC(2026, 7, 5));

interface TrendBody {
	sessions: Record<string, number>;
	trend: { weeks: number; methods: string[]; loginsByWeek: ({ week: string } & Record<string, number>)[] };
}

const isoWeek = (d: Date) => `${d.getUTCFullYear()}-W${String(isoWeekNumber(d)).padStart(2, "0")}`;

const sessionCount = (body: TrendBody, method: string) => body.sessions[method] ?? 0;

const weeklyCount = (body: TrendBody, method: string, weeksAfterFixture: number) =>
	body.trend.loginsByWeek.find((w) => w.week === isoWeek(mondayOfWeek(weeksAfterFixture)))?.[method] ?? 0;

// Monday of the ISO week, `weeks` weeks after the Wednesday fixture date.
function mondayOfWeek(weeks: number): Date {
	const d = new Date(WEDNESDAY);
	d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7) + weeks * 7);
	return d;
}

// Mirrors the %G-W%V bucketing done by the endpoint (Mongo computes it from the date).
function isoWeekNumber(d: Date): number {
	const date = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
	date.setUTCDate(date.getUTCDate() + 3 - ((date.getUTCDay() + 6) % 7));
	const firstThursday = new Date(Date.UTC(date.getUTCFullYear(), 0, 4));
	firstThursday.setUTCDate(firstThursday.getUTCDate() + 3 - ((firstThursday.getUTCDay() + 6) % 7));
	return 1 + Math.round((date.getTime() - firstThursday.getTime()) / (7 * DAY));
}

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

			// Each method set must appear exactly once: recent/older buckets are merged into a
			// single row carrying both counts.
			const combos = (methods: string[]) =>
				body.combinations.filter(
					(c) => c.methods.length === methods.length && methods.every((m) => c.methods.includes(m)),
				);
			const combo = (methods: string[]) => {
				const rows = combos(methods);
				assert.strictEqual(rows.length, 1, `expected one row for [${methods}], got ${JSON.stringify(rows)}`);
				return rows[0];
			};
			// ["password"]: recentPasswordId (recent) + otherUserId (older — resetPassword gave it a hash)
			assert.deepStrictEqual(combo(["password"]), { methods: ["password"], recent: 1, older: 1 });
			assert.deepStrictEqual(combo(["google"]), { methods: ["google"], recent: 0, older: 1 });
			assert.deepStrictEqual(combo(["password", "google", "discord"]), {
				methods: ["password", "google", "discord"],
				recent: 1,
				older: 0,
			});
			// adminId, userId, noMethodId: testUser leaves password "" and no social → no usable method.
			// (May also count users from other spec files when the full suite shares the db.)
			assert.strictEqual(combo([]).recent, 0);
			assert.ok(combo([]).older >= 3);
		});

		describe("login trend + active sessions (refresh tokens)", () => {
			const trendUserId = new ObjectId();

			before(async () => {
				await colls.users.insertOne(testUser({ _id: trendUserId }));
				const token = (loginMethod: string | undefined, createdAt: Date, code: string) => ({
					user: trendUserId,
					code,
					createdAt,
					...(loginMethod ? { loginMethod } : {}),
				});
				await colls.jwtRefreshTokens.insertMany([
					token("password", mondayOfWeek(0), "trend-pw-0a"),
					token("password", mondayOfWeek(0), "trend-pw-0b"),
					token("password", mondayOfWeek(1), "trend-pw-1"),
					token("google", mondayOfWeek(1), "trend-google-1"),
					token(undefined, mondayOfWeek(1), "trend-unknown-1"),
					token("discord", mondayOfWeek(2), "trend-discord-2"),
				]);
			});

			it("returns a weekly trend bucketed by login method", async () => {
				const res = await api("GET", "/api/admin/users/login-methods", adminHeaders);
				assert.strictEqual(res.status, 200);
				// oxlint-disable-next-line typescript/no-unsafe-type-assertion -- trusted own-endpoint shape
				const body = res.data as TrendBody;

				assert.strictEqual(body.trend.weeks, 13);
				// Codes are unique-indexed, so these fixtures can't collide with other specs.
				assert.strictEqual(weeklyCount(body, "password", 0), 2);
				assert.strictEqual(weeklyCount(body, "password", 1), 1);
				assert.strictEqual(weeklyCount(body, "google", 1), 1);
				assert.strictEqual(weeklyCount(body, "discord", 2), 1);
				// Tokens without a loginMethod land in "unknown".
				assert.strictEqual(weeklyCount(body, "unknown", 1), 1);

				const passwordWeeks = body.trend.loginsByWeek.filter((w) => (w.password ?? 0) > 0);
				assert.strictEqual(passwordWeeks.length, 2);
			});

			it("counts active sessions per mechanism", async () => {
				const res = await api("GET", "/api/admin/users/login-methods", adminHeaders);
				assert.strictEqual(res.status, 200);
				// oxlint-disable-next-line typescript/no-unsafe-type-assertion -- trusted own-endpoint shape
				const body = res.data as TrendBody;

				assert.strictEqual(sessionCount(body, "password"), 3);
				assert.strictEqual(sessionCount(body, "google"), 1);
				assert.strictEqual(sessionCount(body, "discord"), 1);
				// The other docs without a method come from this spec's own fixtures above.
				assert.ok(sessionCount(body, "unknown") >= 1);
			});
		});

		describe("POST /account/login", () => {
			const loginUserId = new ObjectId();
			const email = "login-method-trend@test.com";
			const password = "test-password-123";

			before(async () => {
				await colls.users.insertOne(
					testUser({ _id: loginUserId, account: { email, password: await generateHash(password) } }),
				);
			});

			it("stamps loginMethod=password on the created refresh token", async () => {
				const res = await fetch(`${baseURL()}/api/account/login`, {
					method: "POST",
					headers: { "Content-Type": "application/json" },
					body: JSON.stringify({ email, password }),
				});
				assert.strictEqual(res.status, 200);

				const token = await colls.jwtRefreshTokens.findOne({ user: loginUserId });
				assert.ok(token);
				assert.strictEqual(token.loginMethod, "password");
			});
		});
	});
});
