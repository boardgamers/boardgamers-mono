// Run via `pnpm test` (the package.json script), NOT bare `node --test`. The script
// imports app/config/test-hooks.ts, which connects to the *-test database and starts
// the API server.
import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { ObjectId } from "mongodb";
import bcrypt from "bcryptjs";
import { z } from "zod";
import { colls, db } from "../../config/db.ts";
import env from "../../config/env.ts";
import { testUser, testGamePrefs } from "../../config/test-helpers.ts";
import { createAccessToken, generateRefreshCode } from "../../models/jwtrefreshtokens.ts";

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
	return { status: res.status, data, ok: res.ok };
}

const countryOf = (data: unknown) =>
	z.object({ account: z.object({ country: z.string().nullish() }) }).parse(data).account.country;

describe("Account API — country", () => {
	const userId = new ObjectId();
	let authHeaders: Record<string, string> = {};

	before(async () => {
		await colls.users.insertOne(
			testUser({
				_id: userId,
				account: { username: "countryuser", email: "country@test.com" },
				security: { confirmed: true, slug: "countryuser" },
			}),
		);
		const code = generateRefreshCode();
		const tokenDoc = { user: userId, code, createdAt: new Date() };
		await colls.jwtRefreshTokens.insertOne(tokenDoc);
		const token = await createAccessToken(tokenDoc, ["all"], false);
		authHeaders = { Authorization: `Bearer ${token}` };
	});

	it("defaults to no country", async () => {
		const res = await api("GET", "/api/account", undefined, authHeaders);
		assert.strictEqual(res.status, 200);
		assert.strictEqual(countryOf(res.data), undefined);
	});

	it("sets the country, uppercased", async () => {
		const res = await api("POST", "/api/account", { account: { country: "fr" } }, authHeaders);
		assert.strictEqual(res.status, 200);
		assert.strictEqual(countryOf(res.data), "FR");

		const stored = await colls.users.findOne({ _id: userId });
		assert.strictEqual(stored?.account.country, "FR");
	});

	it("clears the country with an empty string", async () => {
		const res = await api("POST", "/api/account", { account: { country: "" } }, authHeaders);
		assert.strictEqual(res.status, 200);
		assert.strictEqual(countryOf(res.data), null);
	});

	it("rejects invalid country codes", async () => {
		for (const country of ["F", "FRA", "12"]) {
			const res = await api("POST", "/api/account", { account: { country } }, authHeaders);
			assert.strictEqual(res.ok, false, `expected failure for ${country}`);
		}
		const stored = await colls.users.findOne({ _id: userId });
		assert.strictEqual(stored?.account.country, null);
	});

	it("exposes the country on the public user payload", async () => {
		await colls.users.updateOne({ _id: userId }, { $set: { "account.country": "BR" } });
		const res = await api("GET", `/api/user/infoByName/countryuser`);
		assert.strictEqual(res.status, 200);
		assert.strictEqual(countryOf(res.data), "BR");
	});

	it("exposes the country in boardgame rankings", async () => {
		await colls.gameInfos.insertOne({
			_id: { game: "countrygame", version: 1 },
			label: "Country Game",
			players: [2],
			meta: { public: true, needOwnership: false },
		});
		await colls.gamePreferences.insertOne(
			testGamePrefs({ user: userId, game: "countrygame", elo: { value: 120, games: 3 } }),
		);

		const res = await api("GET", `/api/boardgame/countrygame/elo`);
		assert.strictEqual(res.status, 200);
		const rankings = z
			.array(z.object({ user: z.object({ name: z.string(), country: z.string().optional() }) }))
			.parse(res.data);
		const entry = rankings.find((r) => r.user.name === "countryuser");
		assert.ok(entry, "expected countryuser in rankings");
		assert.strictEqual(entry.user.country, "BR");
	});

	after(() => db().dropDatabase());
});

describe("Account API — session cookie over a TLS-terminating proxy", () => {
	// The api sits behind nginx (app.proxy = true) and decides the session cookie's
	// `secure`/`domain` from X-Forwarded-Host / X-Forwarded-Proto. Regression test for
	// the admin-panel login failure "Cannot send secure cookie over unencrypted
	// connection": when the reverse proxy forwards the real (https) proto, setting the
	// Secure session cookie must succeed; when the proto is missing, the request is
	// (correctly) seen as plain http and must fail loudly rather than silently issuing
	// a cookie the browser would reject.
	const password = "hunter2-test";
	let email = "";

	before(async () => {
		const user = testUser({
			account: { username: "cookieuser", email: "cookie@test.com" },
			security: { confirmed: true, slug: "cookieuser" },
		});
		user.account.password = await bcrypt.hash(password, 8);
		email = user.account.email;
		await colls.users.insertOne(user);
	});

	const proxyHeaders = {
		"X-Forwarded-Host": `admin.${env.domain}`,
		"X-Forwarded-Proto": "https",
	};

	it("login through an https proxy sets a Secure, domain-scoped session cookie", async () => {
		const res = await fetch(`${baseURL()}/api/account/login`, {
			method: "POST",
			headers: { "Content-Type": "application/json", ...proxyHeaders },
			body: JSON.stringify({ email, password }),
		});
		assert.strictEqual(res.status, 200);
		const setCookie = res.headers.get("set-cookie") ?? "";
		assert.match(setCookie, /refreshToken=/);
		assert.match(setCookie, /;\s*secure/i);
		assert.match(setCookie, new RegExp(`;\\s*domain=${env.domain.replace(".", "\\.")}`, "i"));
	});

	it("the session cookie authenticates cookie-based calls (mint + /account)", async () => {
		const login = await fetch(`${baseURL()}/api/account/login`, {
			method: "POST",
			headers: { "Content-Type": "application/json", ...proxyHeaders },
			body: JSON.stringify({ email, password }),
		});
		const setCookie = login.headers.get("set-cookie") ?? "";
		const cookie = setCookie.split(";")[0];

		const mint = await fetch(`${baseURL()}/api/account/mint`, {
			method: "POST",
			headers: { "Content-Type": "application/json", cookie, ...proxyHeaders },
			body: JSON.stringify({ scopes: ["all"] }),
		});
		assert.strictEqual(mint.status, 200);
		const token = z.object({ code: z.string() }).parse(await mint.json());

		const account = await fetch(`${baseURL()}/api/account`, {
			headers: { authorization: `Bearer ${token.code}`, ...proxyHeaders },
		});
		assert.strictEqual(account.status, 200);
	});

	it("login over perceived plain http fails loudly (the reported 500)", async () => {
		const res = await fetch(`${baseURL()}/api/account/login`, {
			method: "POST",
			// No X-Forwarded-Proto: the api sees an insecure connection for a public host.
			headers: { "Content-Type": "application/json", "X-Forwarded-Host": `admin.${env.domain}` },
			body: JSON.stringify({ email, password }),
		});
		assert.strictEqual(res.status, 500);
	});

	after(() => db().dropDatabase());
});
