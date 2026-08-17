import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { deletedUserIndexes } from "@bgs/models";
import { ObjectId } from "mongodb";
import { colls, db } from "../../config/db.ts";
import env from "../../config/env.ts";
import { testUser } from "../../config/test-helpers.ts";
import { createAccessToken, generateRefreshCode, hashRefreshCode } from "../../models/jwtrefreshtokens.ts";
import { generateHash, resetPassword } from "../../models/user.ts";
import { lastAccessibleVersion } from "../../services/gameinfo.ts";

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
	const tokenDoc = { user: userId, codeHash: hashRefreshCode(code), createdAt: new Date() };
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
				await colls.jwtRefreshTokens.insertOne({
					user: userId,
					codeHash: hashRefreshCode(`code-${i}`),
					createdAt: new Date(),
				});
			}
			await colls.jwtRefreshTokens.insertOne({
				user: otherUserId,
				codeHash: hashRefreshCode("other-code"),
				createdAt: new Date(),
			});
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

	describe("beta access grants (GET/DELETE /admin/users/:userId/access)", () => {
		const betaUserId = new ObjectId();
		const betaUsername = "beta-tester";

		before(async () => {
			await colls.users.insertOne(
				testUser({ _id: betaUserId, account: { username: betaUsername }, security: { slug: betaUsername } }),
			);
			await colls.gameInfos.insertMany([
				{ _id: { game: "betagame", version: 1 }, viewer: { url: "//v1" }, public: true, meta: {} },
				{ _id: { game: "betagame", version: 2 }, viewer: { url: "//v2" }, public: false, meta: {} },
			]);
			await colls.gameMetadatas.insertOne({ _id: "betagame", label: "Beta Game", players: [2] });
			await colls.gamePreferences.insertOne({ user: betaUserId, game: "betagame", access: { maxVersion: 2 } });
			// A doc without a grant (elo only) must not show up as a beta.
			await colls.gamePreferences.insertOne({
				user: betaUserId,
				game: "othergame",
				elo: { value: 1200, games: 3 },
			});
		});

		it("rejects non-admin callers", async () => {
			assert.strictEqual((await api("GET", `/api/admin/users/${betaUserId.toHexString()}/access`)).status, 403);
			assert.strictEqual(
				(await api("DELETE", `/api/admin/users/${betaUserId.toHexString()}/access/betagame`)).status,
				403,
			);
		});

		it("404s for an unknown user", async () => {
			const unknown = new ObjectId().toHexString();
			assert.strictEqual((await api("GET", `/api/admin/users/${unknown}/access`, adminHeaders)).status, 404);
			assert.strictEqual(
				(await api("DELETE", `/api/admin/users/${unknown}/access/betagame`, adminHeaders)).status,
				404,
			);
		});

		it("lists the user's beta grants with label and maxVersion", async () => {
			const res = await api("GET", `/api/admin/users/${betaUserId.toHexString()}/access`, adminHeaders);
			assert.strictEqual(res.status, 200);
			assert.deepStrictEqual(res.data, [{ game: "betagame", label: "Beta Game", maxVersion: 2 }]);
		});

		it("revokes a grant: the user falls back to the latest public version", async () => {
			const res = await api("DELETE", `/api/admin/users/${betaUserId.toHexString()}/access/betagame`, adminHeaders);
			assert.strictEqual(res.status, 200);

			const pref = await colls.gamePreferences.findOne({ user: betaUserId, game: "betagame" });
			assert.strictEqual(pref?.access?.maxVersion, undefined);

			const accessible = await lastAccessibleVersion("betagame", (await colls.users.findOne({ _id: betaUserId }))!);
			assert.strictEqual(accessible?._id.version, 1);

			const res2 = await api("GET", `/api/admin/users/${betaUserId.toHexString()}/access`, adminHeaders);
			assert.deepStrictEqual(res2.data, []);
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

	describe("GET /admin/users/countries", () => {
		const jpId = new ObjectId();
		const jp2Id = new ObjectId();
		const caId = new ObjectId();
		const unsetId = new ObjectId();
		const engagedId = new ObjectId();

		before(async () => {
			// JP/CA are used by no other spec (the account country spec uses FR/BR), so
			// these exact counts can't drift when the suite shares one db.
			await colls.users.insertOne(testUser({ _id: jpId, account: { country: "JP" } }));
			await colls.users.insertOne(testUser({ _id: jp2Id, account: { country: "JP" } }));
			await colls.users.insertOne(testUser({ _id: caId, account: { country: "CA" } }));
			// Explicitly no country — testUser leaves account.country undefined.
			await colls.users.insertOne(testUser({ _id: unsetId }));
			// One user with every engagement signal on, to assert the counts move. Its
			// lastLogin stays at the epoch default (older bucket) — the login-methods
			// spec below accounts for it in older.discord.
			await colls.users.insertOne(
				testUser({
					_id: engagedId,
					account: { country: "JP", bio: "hello", social: { discord: "engaged-discord-1" } },
					settings: {
						mailing: { newsletter: true },
						notifications: { webhook: { url: "https://discord.test/hook", format: "discord", enabled: true } },
					},
				}),
			);
		});

		it("rejects non-admin callers", async () => {
			const res = await api("GET", "/api/admin/users/countries");
			assert.strictEqual(res.status, 403);
		});

		it("aggregates users by country, sorted desc, with an unset count", async () => {
			const res = await api("GET", "/api/admin/users/countries", adminHeaders);
			assert.strictEqual(res.status, 200);

			interface CountriesBody {
				countries: { country: string; count: number }[];
				unset: number;
			}
			// oxlint-disable-next-line typescript/no-unsafe-type-assertion -- trusted own-endpoint shape
			const body = res.data as CountriesBody;

			const byCountry = new Map(body.countries.map((c) => [c.country, c.count]));
			assert.strictEqual(byCountry.get("JP"), 3);
			assert.strictEqual(byCountry.get("CA"), 1);

			// Sorted desc by count.
			const counts = body.countries.map((c) => c.count);
			assert.deepStrictEqual(
				counts,
				[...counts].sort((a, b) => b - a),
			);

			// unsetId has no country; the fixtures from the outer before() (adminId,
			// userId, otherUserId) don't set one either. Use >= for suite-shared drift.
			assert.ok(body.unset >= 4, `expected >= 4 unset, got ${body.unset}`);
		});

		it("returns engagement counts (newsletter, webhook, discord, bio)", async () => {
			const res = await api("GET", "/api/admin/users/countries", adminHeaders);
			assert.strictEqual(res.status, 200);

			interface CountriesBody {
				engagement: { newsletter: number; webhook: number; discord: number; bio: number };
			}
			// oxlint-disable-next-line typescript/no-unsafe-type-assertion -- trusted own-endpoint shape
			const { engagement } = res.data as CountriesBody;

			// engagedId contributes one of each; other specs may add more (>= not ===).
			assert.ok(engagement.newsletter >= 1, `newsletter: ${engagement.newsletter}`);
			assert.ok(engagement.webhook >= 1, `webhook: ${engagement.webhook}`);
			assert.ok(engagement.discord >= 1, `discord: ${engagement.discord}`);
			assert.ok(engagement.bio >= 1, `bio: ${engagement.bio}`);
		});
	});

	describe("GET /admin/users/login-methods", () => {
		const recentPasswordId = new ObjectId();
		const oldGoogleId = new ObjectId();
		const recentComboId = new ObjectId();
		const noMethodId = new ObjectId();
		const recentGithubId = new ObjectId();
		const oldHuggingfaceId = new ObjectId();

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
			await colls.users.insertOne(
				testUser({
					_id: recentGithubId,
					account: { social: { github: "gh-lm-1" } },
					security: { lastLogin: { ip: "", date: now } },
				}),
			);
			await colls.users.insertOne(
				testUser({
					_id: oldHuggingfaceId,
					account: { social: { huggingface: "hf-lm-1" } },
					security: { lastLogin: { ip: "", date: old } },
				}),
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
			// The countries spec's engagedId fixture links discord with an epoch lastLogin
			// (older bucket), so older.discord is 1, not 0.
			assert.strictEqual(body.perMethod.older.discord, 1);
			assert.strictEqual(body.perMethod.recent.github, 1);
			assert.strictEqual(body.perMethod.older.github, 0);
			assert.strictEqual(body.perMethod.recent.huggingface, 0);
			assert.strictEqual(body.perMethod.older.huggingface, 1);
			assert.ok(body.combinations.length > 0);

			// Each method set must appear exactly once: recent/older buckets are merged into a
			// single row carrying both counts.
			const combos = (methods: string[]) =>
				body.combinations.filter(
					(c) => c.methods.length === methods.length && methods.every((m) => c.methods.includes(m)),
				);
			const combo = (methods: string[]) => {
				const rows = combos(methods);
				assert.strictEqual(rows.length, 1, `expected one row for [${methods.join(",")}], got ${JSON.stringify(rows)}`);
				return rows[0];
			};
			// ["password"]: recentPasswordId (recent) + otherUserId (older — resetPassword gave it a hash)
			assert.deepStrictEqual(combo(["password"]), { methods: ["password"], recent: 1, older: 1 });
			// ["google"]: oldGoogleId (older). No standalone-google fixture is recent.
			assert.deepStrictEqual(combo(["google"]), { methods: ["google"], recent: 0, older: 1 });
			// ["discord"]: the countries spec's engagedId fixture (older, epoch lastLogin).
			assert.deepStrictEqual(combo(["discord"]), { methods: ["discord"], recent: 0, older: 1 });
			assert.deepStrictEqual(combo(["password", "google", "discord"]), {
				methods: ["password", "google", "discord"],
				recent: 1,
				older: 0,
			});
			assert.deepStrictEqual(combo(["github"]), { methods: ["github"], recent: 1, older: 0 });
			assert.deepStrictEqual(combo(["huggingface"]), { methods: ["huggingface"], recent: 0, older: 1 });
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
					codeHash: hashRefreshCode(code),
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
				// Tokens without a loginMethod land in "unknown". Other spec files may also
				// create tokens in the same week, so use >= instead of strict equality.
				assert.ok(
					weeklyCount(body, "unknown", 1) >= 1,
					`expected >= 1 unknown in week 1, got ${weeklyCount(body, "unknown", 1)}`,
				);

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

	describe("deleted (archived) users", () => {
		const deletedUserId = new ObjectId();
		const deletedUser2Id = new ObjectId();
		const deletedAt = new Date("2026-01-02T03:04:05Z");

		before(async () => {
			// Archive fixtures built like cleanupDeadUsers does: full user doc minus _id,
			// plus userId/deletedAt.
			const archive = (id: ObjectId, username: string, when: Date) => {
				const { _id, ...rest } = testUser({ _id: id, account: { username }, security: { slug: username } });
				return { ...rest, userId: id, deletedAt: when };
			};
			await colls.deletedUsers.insertMany([
				archive(deletedUserId, "ghost-one", deletedAt),
				archive(deletedUser2Id, "ghost-two", new Date("2026-01-03T00:00:00Z")),
			]);
		});

		it("GET /admin/users/deleted rejects non-admin callers", async () => {
			const res = await api("GET", "/api/admin/users/deleted");
			assert.strictEqual(res.status, 403);
		});

		it("GET /admin/users/deleted lists archived users, most recent first, paginated", async () => {
			const res = await api("GET", "/api/admin/users/deleted?page=1&limit=1", adminHeaders);
			assert.strictEqual(res.status, 200);

			interface DeletedBody {
				users: { userId: string; account: { username: string }; deletedAt: string }[];
				total: number;
				page: number;
				limit: number;
			}
			// oxlint-disable-next-line typescript/no-unsafe-type-assertion -- trusted own-endpoint shape
			const body = res.data as DeletedBody;
			assert.strictEqual(body.total, 2);
			assert.strictEqual(body.page, 1);
			assert.strictEqual(body.limit, 1);
			assert.strictEqual(body.users.length, 1);
			assert.strictEqual(body.users[0].account.username, "ghost-two");
			assert.strictEqual(body.users[0].userId, deletedUser2Id.toHexString());

			const res2 = await api("GET", "/api/admin/users/deleted?page=2&limit=1", adminHeaders);
			// oxlint-disable-next-line typescript/no-unsafe-type-assertion -- trusted own-endpoint shape
			const body2 = res2.data as DeletedBody;
			assert.strictEqual(body2.users[0].account.username, "ghost-one");
		});

		it("GET /admin/users/infoByName/:username returns an archived marker for a deleted user", async () => {
			const res = await api("GET", "/api/admin/users/infoByName/ghost-one", adminHeaders);
			assert.strictEqual(res.status, 200);

			// oxlint-disable-next-line typescript/no-unsafe-type-assertion -- trusted own-endpoint shape
			const body = res.data as { archived: boolean; userId: string; account: { username: string }; deletedAt: string };
			assert.strictEqual(body.archived, true);
			assert.strictEqual(body.userId, deletedUserId.toHexString());
			assert.strictEqual(body.account.username, "ghost-one");
			assert.strictEqual(new Date(body.deletedAt).toISOString(), deletedAt.toISOString());
		});

		it("declares a non-unique index on security.slug (the infoByName fallback's primary lookup)", async () => {
			const declared = deletedUserIndexes.filter((i) => "security.slug" in i.key);
			assert.strictEqual(declared.length, 1);
			assert.strictEqual(declared[0].unique ?? false, false);

			const live = (await colls.deletedUsers.indexes()).find((i) => "security.slug" in i.key);
			assert.ok(live, "expected a live security.slug index on deletedUsers");
			assert.strictEqual(live.unique ?? false, false);
		});

		it("GET /admin/users/infoByName/:username finds an archived user by slug", async () => {
			const res = await api("GET", "/api/admin/users/infoByName/GHOST-TWO", adminHeaders);
			assert.strictEqual(res.status, 200);

			// oxlint-disable-next-line typescript/no-unsafe-type-assertion -- trusted own-endpoint shape
			const body = res.data as { archived: boolean; userId: string; account: { username: string } };
			assert.strictEqual(body.archived, true);
			assert.strictEqual(body.userId, deletedUser2Id.toHexString());
			assert.strictEqual(body.account.username, "ghost-two");
		});

		it("GET /admin/users/infoByName/:username still 404s for a never-existing user", async () => {
			const res = await api("GET", "/api/admin/users/infoByName/no-such-user-xyz", adminHeaders);
			assert.strictEqual(res.status, 404);
		});

		it("GET /admin/users/infoByName/:username still returns active users (no archived flag)", async () => {
			const user = await colls.users.findOne({ _id: userId });
			const res = await api("GET", `/api/admin/users/infoByName/${user!.account.username}`, adminHeaders);
			assert.strictEqual(res.status, 200);
			// oxlint-disable-next-line typescript/no-unsafe-type-assertion -- trusted own-endpoint shape
			const body = res.data as { archived?: boolean; account: { username: string } };
			assert.strictEqual(body.archived, undefined);
			assert.strictEqual(body.account.username, user!.account.username);
		});
	});
});
