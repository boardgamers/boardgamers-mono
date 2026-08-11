// Run via `pnpm test` (the package.json script), NOT bare `node --test`. The script
// imports app/config/test-hooks.ts, which connects to the *-test database and starts
// the API server.
import assert from "node:assert/strict";
import { after, afterEach, before, describe, it } from "node:test";
import bcrypt from "bcryptjs";
import { colls, db } from "../../config/db.ts";
import env from "../../config/env.ts";
import { testUser } from "../../config/test-helpers.ts";
import { resetRateLimitCounters } from "../../services/ratelimit.ts";

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

// IPv6 addresses inside one /56 (differ only below bit 56).
const from6 = (host: number) => ({ "X-Forwarded-For": `2001:db8:cafe:5a${String(host).padStart(2, "0")}::1` });

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
		Object.assign(env.authRateLimit, { windowMs: 60_000, maxPerIp: 100_000 });
		resetRateLimitCounters();
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
		Object.assign(env.authRateLimit, { maxPerIp: 5 });
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

	it("buckets IPv6 clients by /56 — address rotation within the prefix doesn't evade", async () => {
		Object.assign(env.authRateLimit, { maxPerIp: 3 });

		// Three addresses in the same /56 (differ only below bit 56).
		assert.strictEqual(
			(await post("/api/account/login", { email: registeredEmail, password: "wrong" }, from6(1))).status,
			401,
		);
		assert.strictEqual(
			(await post("/api/account/login", { email: registeredEmail, password: "wrong" }, from6(2))).status,
			401,
		);
		assert.strictEqual(
			(await post("/api/account/login", { email: registeredEmail, password: "wrong" }, from6(3))).status,
			401,
		);
		// A fourth address in the same /56 is over the shared limit…
		const blocked = await post("/api/account/login", { email: registeredEmail, password: "wrong" }, from6(4));
		assert.strictEqual(blocked.status, 429);
		// …while the neighboring /56 has its own bucket.
		const neighbor = await post(
			"/api/account/login",
			{ email: registeredEmail, password: "wrong" },
			{ "X-Forwarded-For": "2001:db8:cafe:5b00::1" },
		);
		assert.strictEqual(neighbor.status, 401);
	});

	it("allows attempts again after the window rolls over", async () => {
		const saved = saveLimit();
		Object.assign(env.authRateLimit, { windowMs: 300, maxPerIp: 2 });
		const ip = fromIp();
		const attempt = () => post("/api/account/login", { email: registeredEmail, password: "wrong" }, ip);
		// Windows align to wall-clock multiples of windowMs: landing the first
		// attempts near the end of one would let the window roll before the 429
		// assertion. Wait for a fresh window so the whole burst lands inside it.
		const waitForFreshWindow = () =>
			new Promise<void>((resolve) => {
				const delay = env.authRateLimit.windowMs - (Date.now() % env.authRateLimit.windowMs) + 20;
				setTimeout(resolve, delay);
			});

		try {
			await waitForFreshWindow();
			assert.strictEqual((await attempt()).status, 401);
			assert.strictEqual((await attempt()).status, 401);
			assert.strictEqual((await attempt()).status, 429);

			await waitForFreshWindow();
			assert.strictEqual((await attempt()).status, 401);
		} finally {
			Object.assign(env.authRateLimit, saved);
		}
	});

	// A signup attempt against the already-registered email 409s ("email taken")
	// without sending mail — safe to drive the limiter. A valid signup would send
	// a confirmation email (Mailgun), which can't succeed in the test env.
	const signupBody = { email: registeredEmail, password, username: "whatever", termsAndConditions: true };

	it("throttles signup on the same shared per-IP cap, with a generic 429", async () => {
		Object.assign(env.authRateLimit, { maxPerIp: 3 });
		const ip = fromIp();

		for (let i = 0; i < 3; i++) {
			const res = await post("/api/account/signup", signupBody, ip);
			assert.strictEqual(res.status, 409, `signup ${i + 1} should reach the handler`);
		}
		const blocked = await post("/api/account/signup", signupBody, ip);
		assert.strictEqual(blocked.status, 429);
		assert.strictEqual(message(blocked.data), "Too many attempts, please try again later");
		assert.ok(blocked.retryAfter, "a Retry-After header is set");
		assert.doesNotMatch(message(blocked.data), /taken|registered|@/);
	});

	it("signup and login share one per-IP budget", async () => {
		Object.assign(env.authRateLimit, { maxPerIp: 3 });
		const ip = fromIp();

		// Two logins consume two of the three shared attempts…
		assert.strictEqual(
			(await post("/api/account/login", { email: registeredEmail, password: "wrong" }, ip)).status,
			401,
		);
		assert.strictEqual(
			(await post("/api/account/login", { email: registeredEmail, password: "wrong" }, ip)).status,
			401,
		);
		// …a signup reaches the handler (the 3rd)…
		assert.strictEqual((await post("/api/account/signup", signupBody, ip)).status, 409);
		// …and now both are over the shared cap.
		assert.strictEqual((await post("/api/account/signup", signupBody, ip)).status, 429);
		assert.strictEqual(
			(await post("/api/account/login", { email: registeredEmail, password: "wrong" }, ip)).status,
			429,
		);
	});

	it("buckets signup IPv6 clients by /56 too", async () => {
		Object.assign(env.authRateLimit, { maxPerIp: 2 });
		// Two distinct addresses in one /56 share the cap; the neighboring /56 doesn't.
		assert.strictEqual((await post("/api/account/signup", signupBody, from6(10))).status, 409);
		assert.strictEqual((await post("/api/account/signup", signupBody, from6(11))).status, 409);
		assert.strictEqual((await post("/api/account/signup", signupBody, from6(12))).status, 429);
		const neighbor = await post("/api/account/signup", signupBody, { "X-Forwarded-For": "2001:db8:cafe:5b00::1" });
		assert.strictEqual(neighbor.status, 409);
	});

	after(() => db().dropDatabase());
});
