// Run via `pnpm test` (the package.json script), NOT bare `node --test`. The script
// imports app/config/test-hooks.ts, which connects to the *-test database and starts
// the API server.
import assert from "node:assert/strict";
import { after, describe, it } from "node:test";
import { ObjectId } from "mongodb";
import { z } from "zod";
import { ensureIndexes, ensureValidation, planIndexChanges } from "@bgs/models";
import { colls, db } from "../config/db.ts";
import env from "../config/env.ts";
import { setSendmailForTests, type MailSendData } from "../config/sendmail.ts";
import { testUser } from "../config/test-helpers.ts";
import { createAccessToken, generateRefreshCode, hashRefreshCode } from "../models/jwtrefreshtokens.ts";
import { ACTION_RATE_LIMITS, actionRateLimit, recordUserAction } from "./actionratelimit.ts";

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
	return { status: res.status, data, ok: res.ok, retryAfter: res.headers.get("retry-after") };
}

// A fresh user + bearer token per test, so per-user counters never bleed
// between tests (and describes in the file can run concurrently).
async function makeAuthedUser(username: string) {
	const userId = new ObjectId();
	await colls.users.insertOne(
		testUser({
			_id: userId,
			account: { username, email: `${username}@test.com` },
			security: { confirmed: true, slug: username },
		}),
	);
	const code = generateRefreshCode();
	const tokenDoc = { user: userId, codeHash: hashRefreshCode(code), createdAt: new Date() };
	await colls.jwtRefreshTokens.insertOne(tokenDoc);
	const token = await createAccessToken(tokenDoc, ["all"], false);
	return { userId, authHeaders: { Authorization: `Bearer ${token}` } };
}

const limit = { max: 3, windowMs: 60_000 };

describe("recordUserAction — fixed-window counter", () => {
	it("allows up to max hits, then blocks until the window rolls over", async () => {
		const userId = new ObjectId();
		// Fixed reference time: the window math (and Retry-After) is exercised
		// without sleeping.
		const t0 = 1_700_000_000_123;

		for (let i = 0; i < limit.max; i++) {
			const { allowed } = await recordUserAction(userId, "unit/action", limit, t0);
			assert.strictEqual(allowed, true, `hit ${i + 1} must be allowed`);
		}

		const blocked = await recordUserAction(userId, "unit/action", limit, t0);
		assert.strictEqual(blocked.allowed, false);
		assert.ok(
			blocked.retryAfterSeconds > 0 && blocked.retryAfterSeconds <= limit.windowMs / 1000,
			`retry-after must point at the window rollover, got ${blocked.retryAfterSeconds}`,
		);

		// Next fixed window: the counter starts fresh.
		const { allowed } = await recordUserAction(userId, "unit/action", limit, t0 + limit.windowMs);
		assert.strictEqual(allowed, true);
	});

	it("isolates counters per user and per action", async () => {
		const userA = new ObjectId();
		const userB = new ObjectId();
		const t0 = Date.now();

		for (let i = 0; i <= limit.max; i++) {
			await recordUserAction(userA, "unit/action", limit, t0);
		}
		// userA is blocked on that action…
		assert.strictEqual((await recordUserAction(userA, "unit/action", limit, t0)).allowed, false);
		// …but not on another action…
		assert.strictEqual((await recordUserAction(userA, "unit/other", limit, t0)).allowed, true);
		// …and userB is unaffected on the same action.
		assert.strictEqual((await recordUserAction(userB, "unit/action", limit, t0)).allowed, true);
	});

	it("counts exactly one per call under concurrent first hits (E11000 replay)", async () => {
		const userId = new ObjectId();
		// 2 * max + 1 concurrent hits on a fresh counter: each must be recorded
		// exactly once, so exactly `max` pass and `max + 1` are rejected.
		const results = await Promise.all(
			Array.from({ length: 2 * limit.max + 1 }, () => recordUserAction(userId, "unit/race", limit)),
		);
		assert.strictEqual(results.filter((r) => r.allowed).length, limit.max);
		assert.strictEqual(results.filter((r) => !r.allowed).length, limit.max + 1);

		const doc = await colls.userActions.findOne({ userId, action: "unit/race" });
		assert.strictEqual(doc?.count, 2 * limit.max + 1);
		assert.ok(doc.expiresAt.getTime() > doc.windowStart, "the TTL date must be past the window start");
	});

	it("declares its unique + TTL indexes on the collection (boot reconciliation)", async () => {
		const indexes = await colls.userActions.indexes();
		const byName = new Map(indexes.map((index) => [index.name, index]));

		const unique = byName.get("user_action_window_unique");
		assert.ok(unique, "the (userId, action, windowStart) unique index must exist");
		assert.deepStrictEqual(unique.key, { userId: 1, action: 1, windowStart: 1 });
		assert.strictEqual(unique.unique, true);

		const ttl = byName.get("expiresAt_ttl");
		assert.ok(ttl, "the expiresAt TTL index must exist");
		assert.strictEqual(ttl.expireAfterSeconds, 0);
	});

	it("boots on a fresh db: collection + validator + indexes, with no drift afterwards", async () => {
		const scratch = db().client.db(`${env.database.bgs.name}-actionratelimit-scratch`);
		try {
			await scratch.dropDatabase();
			// ensureIndexes creates the collection implicitly via createIndex…
			const actions = await ensureIndexes(scratch);
			const names = actions.filter((a) => a.collection === "useractions").map((a) => a.name);
			assert.deepStrictEqual(names.sort(), ["expiresAt_ttl", "user_action_window_unique"]);

			// …and ensureValidation attaches the Zod validator to it.
			await ensureValidation(scratch);
			const [info] = await scratch.listCollections({ name: "useractions" }).toArray();
			const validator = z.object({ options: z.object({ validator: z.looseObject({ $jsonSchema: z.object({}) }) }) });
			assert.doesNotThrow(() => validator.parse(info), "the collection must carry a $jsonSchema validator");

			// A second pass is a no-op: nothing to create, drop or rebuild.
			assert.deepStrictEqual(await planIndexChanges(scratch), [], "no index drift on the fresh db");
		} finally {
			await scratch.dropDatabase();
		}
	});

	after(async () => {
		await colls.userActions.deleteMany({});
	});
});

describe("actionRateLimit middleware", () => {
	const hit = async (userId: ObjectId, max: number) => {
		const middleware = actionRateLimit("unit/middleware", { max, windowMs: 60_000 });
		// Minimal Koa ctx stand-in: the middleware only reads state.user._id and
		// sets the Retry-After header.
		const headers = new Map<string, string>();
		// oxlint-disable-next-line typescript/no-unsafe-type-assertion -- minimal ctx stand-in for the middleware under test
		const ctx = {
			state: { user: { _id: userId } },
			set: (name: string, value: string) => void headers.set(name.toLowerCase(), value),
		} as unknown as Parameters<typeof middleware>[0];
		try {
			await middleware(ctx, async () => {});
			return { status: 200, retryAfter: null as string | null };
		} catch (err) {
			// oxlint-disable-next-line typescript/no-unsafe-type-assertion -- the middleware only throws http-errors
			const httpError = err as { statusCode?: number };
			return { status: httpError.statusCode ?? 500, retryAfter: headers.get("retry-after") };
		}
	};

	it("passes up to max then 429s with Retry-After, per user", async () => {
		const userA = new ObjectId();
		const userB = new ObjectId();

		for (let i = 0; i < limit.max; i++) {
			assert.strictEqual((await hit(userA, limit.max)).status, 200, `hit ${i + 1} must pass`);
		}
		const blocked = await hit(userA, limit.max);
		assert.strictEqual(blocked.status, 429);
		assert.ok(Number(blocked.retryAfter) > 0, "Retry-After must be set on the 429");

		// Another user — even through another middleware instance — is unaffected.
		assert.strictEqual((await hit(userB, limit.max)).status, 200);
	});

	after(async () => {
		await colls.userActions.deleteMany({});
	});
});

describe("actionRateLimit — site-admin bypass of the translate caps", () => {
	// Same ctx stand-in as the middleware suite above, plus an authority field.
	const hit = async (user: { _id: ObjectId; authority?: string }, action: string, max: number) => {
		const middleware = actionRateLimit(action, { max, windowMs: 60_000 });
		// oxlint-disable-next-line typescript/no-unsafe-type-assertion -- minimal ctx stand-in for the middleware under test
		const ctx = { state: { user }, set: () => {} } as unknown as Parameters<typeof middleware>[0];
		try {
			await middleware(ctx, async () => {});
			return 200;
		} catch (err) {
			// oxlint-disable-next-line typescript/no-unsafe-type-assertion -- the middleware only throws http-errors
			return (err as { statusCode?: number }).statusCode ?? 500;
		}
	};

	it("a site admin exceeds the admin/translate-* caps without 429 and records no hits", async () => {
		const admin = { _id: new ObjectId(), authority: "admin" };
		for (const action of [
			"admin/translate-page",
			"admin/translate-bulk",
			"admin/translate-gameinfo",
			"admin/translate-gameinfo-bulk",
		]) {
			for (let i = 0; i < limit.max + 2; i++) {
				assert.strictEqual(await hit(admin, action, limit.max), 200, `${action} hit ${i + 1} must pass`);
			}
			assert.strictEqual(
				await colls.userActions.countDocuments({ userId: admin._id, action }),
				0,
				"exempt hits are not counted — an admin later demoted starts with a clean slate",
			);
		}
	});

	it("a scoped admin (gameinfo grant, no site authority) is still capped", async () => {
		const scoped = { _id: new ObjectId(), adminGrants: ["gameinfo:gaia"] };
		for (let i = 0; i < limit.max; i++) {
			assert.strictEqual(await hit(scoped, "admin/translate-bulk", limit.max), 200, `hit ${i + 1} must pass`);
		}
		assert.strictEqual(await hit(scoped, "admin/translate-bulk", limit.max), 429);
	});

	it("the bypass does not leak to other actions, not even for a site admin", async () => {
		const admin = { _id: new ObjectId(), authority: "admin" };
		for (let i = 0; i < limit.max; i++) {
			assert.strictEqual(await hit(admin, "account/email", limit.max), 200, `hit ${i + 1} must pass`);
		}
		assert.strictEqual(await hit(admin, "account/email", limit.max), 429);
	});

	after(async () => {
		await colls.userActions.deleteMany({});
	});
});

describe("POST /api/account/email — per-user action rate limit", () => {
	it("throttles email changes after the cap (generic 429 + Retry-After)", async () => {
		const { userId, authHeaders } = await makeAuthedUser("emailcapped");
		// The email change always sends its confirmation now — intercept mail so
		// the throttle test doesn't call Mailgun.
		setSendmailForTests(async () => {});
		// Tighten the registered limit for this test only; test-setup relaxed it
		// for the rest of the suite.
		const max = 3;
		ACTION_RATE_LIMITS["account/email"] = { max, windowMs: 60_000 };
		try {
			for (let i = 0; i < max; i++) {
				const res = await api("POST", "/api/account/email", { email: `emailcapped-${i}@test.com` }, authHeaders);
				assert.strictEqual(res.status, 200, `change ${i + 1} must succeed: ${JSON.stringify(res.data)}`);
			}

			const blocked = await api("POST", "/api/account/email", { email: "emailcapped-x@test.com" }, authHeaders);
			assert.strictEqual(blocked.status, 429);
			assert.ok(Number(blocked.retryAfter) > 0, "the 429 must carry a Retry-After header");
			assert.deepStrictEqual(blocked.data, { message: "Too many requests, try again later" });

			// The blocked attempt did not change the email.
			const user = (await colls.users.findOne({ _id: userId }))!;
			assert.strictEqual(user.account.email, `emailcapped-${max - 1}@test.com`);

			// The cap is per user: another user can still change their email.
			const other = await makeAuthedUser("emailother");
			const res = await api("POST", "/api/account/email", { email: "emailother-new@test.com" }, other.authHeaders);
			assert.strictEqual(res.status, 200);
		} finally {
			delete ACTION_RATE_LIMITS["account/email"];
			setSendmailForTests(null);
		}
	});

	it("still sends the confirmation email when the per-email cooldown (#233) is active", async () => {
		const { userId, authHeaders } = await makeAuthedUser("emailconfirm");
		// Simulate a very recent auth email (e.g. a /forget): within the 15-min
		// per-email cooldown. An email change must still send its confirmation —
		// the change applies immediately, so the account can't be left
		// unconfirmable. The action rate limit is this route's throttle instead.
		await colls.users.updateOne({ _id: userId }, { $set: { "security.lastAuthEmailSentAt": new Date() } });

		let sentMails: MailSendData[] = [];
		setSendmailForTests(async (data) => {
			sentMails.push(data);
		});
		try {
			const res = await api("POST", "/api/account/email", { email: "emailconfirm-new@test.com" }, authHeaders);
			assert.strictEqual(res.status, 200);

			const confirmMails = sentMails.filter((m) => String(m.to) === "emailconfirm-new@test.com");
			assert.strictEqual(confirmMails.length, 1, "the confirmation email must go out despite the cooldown");

			const user = (await colls.users.findOne({ _id: userId }))!;
			assert.strictEqual(user.account.email, "emailconfirm-new@test.com");
			assert.strictEqual(user.security.confirmed, false);

			// …while /forget — an unauthenticated route — still respects the
			// cooldown for that same address.
			sentMails = [];
			assert.strictEqual(
				(await api("POST", "/api/account/forget", { email: "emailconfirm-new@test.com" })).status,
				200,
			);
			assert.strictEqual(sentMails.length, 0, "/forget stays cooldown-suppressed");
		} finally {
			setSendmailForTests(null);
		}
	});

	after(() => db().dropDatabase());
});
