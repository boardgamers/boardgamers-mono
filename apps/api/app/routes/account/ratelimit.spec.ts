// Run via `pnpm test` (the package.json script), NOT bare `node --test`. The script
// imports app/config/test-hooks.ts, which connects to the *-test database and starts
// the API server.
import assert from "node:assert/strict";
import { after, afterEach, before, describe, it } from "node:test";
import bcrypt from "bcryptjs";
import { colls, db } from "../../config/db.ts";
import env from "../../config/env.ts";
import { testUser } from "../../config/test-helpers.ts";

const baseURL = () => `http://${env.listen.host}:${env.listen.port.api}`;

async function post(path: string, body: unknown, headers: Record<string, string> = {}) {
	const res = await fetch(`${baseURL()}${path}`, {
		method: "POST",
		headers: { "Content-Type": "application/json", ...headers },
		body: JSON.stringify(body),
	});
	const data: unknown = res.headers.get("content-type")?.includes("application/json")
		? await res.json()
		: await res.text();
	return { status: res.status, data, retryAfter: res.headers.get("retry-after") };
}

const message = (data: unknown) =>
	typeof data === "object" && data !== null && "message" in data ? String(data.message) : "";

// The suite-wide config relaxes the limiter (see config/test-setup.ts) so the
// existing auth specs don't trip it; these describes opt back into tight limits
// via env + unique IPs / a unique window so they never interfere with them.
describe("auth endpoint rate limiting (#195)", () => {
	const registeredEmail = "ratelimit-registered@test.com";
	const password = "hunter2-ratelimit";
	let ipCounter = 0;

	// 127.0.0.1 is the suite-wide source IP and stays under the relaxed default —
	// these tests key the per-IP bucket on a unique XFF instead.
	const fromIp = () => {
		ipCounter += 1;
		return { "X-Forwarded-For": `10.99.${Math.floor(ipCounter / 250)}.${ipCounter % 250}` };
	};

	const saveLimit = () => ({ ...env.authRateLimit });

	afterEach(() => {
		Object.assign(env.authRateLimit, { windowMs: 60_000, maxPerIp: 100_000, maxPerEmail: 100_000 });
	});

	before(async () => {
		const user = testUser({
			account: { username: "ratelimituser", email: registeredEmail },
			security: { confirmed: true, slug: "ratelimituser" },
		});
		user.account.password = await bcrypt.hash(password, 8);
		await colls.users.insertOne(user);
	});

	it("keeps the intended registered/unregistered distinction under the limit", async () => {
		const ip = fromIp();
		const unknown = await post("/api/account/login", { email: "ratelimit-unknown@test.com", password }, ip);
		assert.strictEqual(unknown.status, 404);
		assert.match(message(unknown.data), /isn't registered/);

		const wrongPassword = await post("/api/account/login", { email: registeredEmail, password: "wrong" }, ip);
		assert.strictEqual(wrongPassword.status, 401);
		assert.match(message(wrongPassword.data), /Wrong password/);

		// No forget-on-registered here: it sends a real reset email (Mailgun), which
		// can't succeed in the test env — the per-email and 429 tests cover /forget.
		const unknownForget = await post("/api/account/forget", { email: "ratelimit-unknown@test.com" }, ip);
		assert.strictEqual(unknownForget.status, 404);
		assert.match(message(unknownForget.data), /introuvable/);
	});

	it("429s login attempts past the per-IP limit, with a generic message", async () => {
		Object.assign(env.authRateLimit, { maxPerIp: 5, maxPerEmail: 100_000 });
		const ip = fromIp();

		for (let i = 0; i < 5; i++) {
			const res = await post("/api/account/login", { email: registeredEmail, password: "wrong" }, ip);
			assert.strictEqual(res.status, 401, `attempt ${i + 1} should reach the handler`);
		}

		for (const email of [registeredEmail, "ratelimit-unknown@test.com"]) {
			const res = await post("/api/account/login", { email, password: "wrong" }, ip);
			assert.strictEqual(res.status, 429);
			assert.strictEqual(message(res.data), "Too many attempts, please try again later");
			assert.ok(res.retryAfter, "a Retry-After header is set");
			// The 429 must not leak whether the email is registered.
			assert.doesNotMatch(message(res.data), /registered|introuvable|@/);
		}

		// A different IP is unaffected.
		const other = await post("/api/account/login", { email: registeredEmail, password: "wrong" }, fromIp());
		assert.strictEqual(other.status, 401);
	});

	it("caps repeated probes of a single email across distinct IPs", async () => {
		Object.assign(env.authRateLimit, { maxPerIp: 100_000, maxPerEmail: 4 });
		const target = "ratelimit-per-email@test.com";

		for (let i = 0; i < 4; i++) {
			const res = await post("/api/account/forget", { email: target }, fromIp());
			assert.strictEqual(res.status, 404, `probe ${i + 1} should reach the handler`);
		}
		const blocked = await post("/api/account/forget", { email: target }, fromIp());
		assert.strictEqual(blocked.status, 429);

		// …while other emails still get their normal response.
		const other = await post("/api/account/forget", { email: "ratelimit-other@test.com" }, fromIp());
		assert.strictEqual(other.status, 404);
	});

	it("allows attempts again after the window rolls over", async () => {
		const saved = saveLimit();
		Object.assign(env.authRateLimit, { windowMs: 300, maxPerIp: 2, maxPerEmail: 100_000 });
		const ip = fromIp();
		const attempt = () => post("/api/account/login", { email: registeredEmail, password: "wrong" }, ip);

		try {
			assert.strictEqual((await attempt()).status, 401);
			assert.strictEqual((await attempt()).status, 401);
			assert.strictEqual((await attempt()).status, 429);

			await new Promise((resolve) => setTimeout(resolve, 350));
			assert.strictEqual((await attempt()).status, 401);
		} finally {
			Object.assign(env.authRateLimit, saved);
		}
	});

	after(() => db().dropDatabase());
});
