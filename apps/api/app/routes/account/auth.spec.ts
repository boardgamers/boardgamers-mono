import assert from "node:assert/strict";
import { after, describe, it } from "node:test";
import jwt from "jsonwebtoken";
import passport from "koa-passport";
import type { WithId } from "mongodb";
import type { UserDoc } from "@bgs/models";
import "../../config/passport.ts";
import { colls, db } from "../../config/db.ts";
import env from "../../config/env.ts";
import { testUser } from "../../config/test-helpers.ts";
import { lookupRefreshToken } from "../../models/jwtrefreshtokens.ts";

type VerifyResult = { err?: unknown; user?: unknown };
type SocialFeedback = {
	createSocialAccount: boolean;
	provider: string;
	id: string;
	socialMeta?: { username: string; url: string };
};

function isSocialFeedback(user: unknown): asserts user is SocialFeedback {
	assert.ok(
		typeof user === "object" && user !== null && "createSocialAccount" in user,
		`expected a createSocialAccount feedback object, got ${JSON.stringify(user)}`,
	);
}

function isUserDoc(user: unknown): asserts user is WithId<UserDoc> {
	assert.ok(
		typeof user === "object" && user !== null && "_id" in user,
		`expected a user doc, got ${JSON.stringify(user)}`,
	);
}

// Invokes the social strategy's verify callback (the function makeSocialStrategy passes to
// passport) directly, without a real OAuth round-trip.
async function verifySocial(
	provider: string,
	profileId: string,
	currentUser?: unknown,
	profile?: { username?: string; profileUrl?: string },
): Promise<VerifyResult> {
	// Hugging Face is a per-origin CIMD strategy, not a named passport strategy.
	const raw: unknown =
		provider === "huggingface"
			? (await import("../../config/passport.ts")).huggingfaceStrategy("https://test.local")
			: // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- koa-passport types don't expose the strategy's _verify
				passport._strategy(provider);
	// oxlint-disable-next-line typescript/no-unsafe-type-assertion -- strategy internals
	const strategy = raw as { _verify: (...args: unknown[]) => void };
	assert.ok(strategy, `passport strategy "${provider}" must be registered`);
	return new Promise((resolve) => {
		strategy._verify(
			{ user: currentUser },
			"token",
			"secret",
			{ id: profileId, ...profile },
			(err: unknown, user?: unknown) => resolve({ err, user }),
		);
	});
}

const baseURL = () => `http://${env.listen.host}:${env.listen.port.api}`;

describe("Account API — GitHub social auth", () => {
	it("registers the github strategy as a PKCE public client on GitHub's endpoints", () => {
		// oxlint-disable-next-line typescript/no-unsafe-type-assertion -- koa-passport types don't expose the strategy
		const strategy = passport._strategy("github") as unknown as {
			_oauth2: { _authorizeUrl: string; _accessTokenUrl: string; _clientSecret?: string };
			_pkceMethod: string | false;
			_stateStore: { store(...args: unknown[]): void; verify(...args: unknown[]): void };
			userProfile: (accessToken: string, done: (err?: unknown, profile?: unknown) => void) => void;
		};
		assert.ok(strategy, "github strategy must be registered");
		assert.strictEqual(strategy._oauth2._authorizeUrl, "https://github.com/login/oauth/authorize");
		assert.strictEqual(strategy._oauth2._accessTokenUrl, "https://github.com/login/oauth/access_token");
		// PKCE on (S256) — passport-oauth2 requires state:true alongside it.
		assert.strictEqual(strategy._pkceMethod, "S256");
		assert.ok(strategy._stateStore, "pkce requires a state store");
		// No client secret configured: the strategy was built with undefined (not a placeholder).
		assert.strictEqual(strategy._oauth2._clientSecret, undefined);
		assert.strictEqual(typeof strategy.userProfile, "function");
	});

	it("creates a social account from a github OAuth profile (empty email tolerated)", async () => {
		const { err, user } = await verifySocial("github", "gh-1001");
		assert.ifError(err);
		isSocialFeedback(user);
		assert.deepStrictEqual(user, { createSocialAccount: true, provider: "github", id: "gh-1001" });

		const token = jwt.sign(user, env.jwt.keys.private, { expiresIn: "1h", algorithm: env.jwt.algorithm });
		const res = await fetch(`${baseURL()}/api/account/signup/social`, {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({ jwt: token, username: "ghuser", termsAndConditions: true }),
		});
		const text = await res.text();
		assert.strictEqual(res.status, 200, `social signup failed: ${res.status} ${text}`);
		assert.match(text, /ghuser/);

		const doc = await colls.users.findOne({ "account.username": "ghuser" });
		assert.ok(doc);
		assert.strictEqual(doc.account.social?.github, "gh-1001");
		assert.strictEqual(doc.account.email, "");
	});

	it("logs in an existing user via the github strategy", async () => {
		const { err, user } = await verifySocial("github", "gh-1001");
		assert.ifError(err);
		isUserDoc(user);
		const doc = await colls.users.findOne({ "account.username": "ghuser" });
		assert.deepStrictEqual(user._id, doc?._id);
	});

	it("links a github account to a logged-in user", async () => {
		const doc = await colls.users.insertOne(testUser({ account: { username: "linkme", email: "linkme@test.com" } }));
		const current = await colls.users.findOne({ _id: doc.insertedId });

		const { err, user } = await verifySocial("github", "gh-2002", current);
		assert.ifError(err);
		isUserDoc(user);
		assert.strictEqual(user.account.social?.github, "gh-2002");

		const stored = await colls.users.findOne({ _id: doc.insertedId });
		assert.strictEqual(stored?.account.social?.github, "gh-2002");
	});

	it("refuses to link a github account already connected to another user", async () => {
		const doc = await colls.users.insertOne(testUser({ account: { username: "linkme2", email: "linkme2@test.com" } }));
		const current = await colls.users.findOne({ _id: doc.insertedId });

		const { err } = await verifySocial("github", "gh-1001", current);
		assert.match(String(err), /already connected/);
	});

	it("stores only non-sensitive display meta (username + url) when linking", async () => {
		const doc = await colls.users.insertOne(testUser({ account: { username: "linkme3", email: "linkme3@test.com" } }));
		const current = await colls.users.findOne({ _id: doc.insertedId });

		const { err, user } = await verifySocial("github", "gh-3003", current, {
			username: "octocat",
			profileUrl: "https://github.com/octocat",
		});
		assert.ifError(err);
		isUserDoc(user);

		const stored = await colls.users.findOne({ _id: doc.insertedId });
		assert.deepStrictEqual(stored?.account.socialMeta?.github, {
			username: "octocat",
			url: "https://github.com/octocat",
		});
		// Only the two whitelisted display fields may be stored — never tokens or _json.
		assert.deepStrictEqual(Object.keys(stored?.account.socialMeta ?? {}), ["github"]);
	});

	after(() => db().dropDatabase());
});

describe("Account API — Hugging Face social auth (CIMD)", () => {
	// HF is no longer a named passport strategy: it's built per origin by
	// huggingfaceStrategy() because the CIMD client_id is origin-specific.
	it("builds the huggingface strategy per origin, with the CIMD URL as client_id", async () => {
		const { huggingfaceStrategy } = await import("../../config/passport.ts");
		// oxlint-disable-next-line typescript/no-unsafe-type-assertion -- strategy internals
		const strategy = huggingfaceStrategy("https://www.boardgamers.space") as {
			_oauth2: { _authorizeUrl: string; _accessTokenUrl: string; _clientId: string; _clientSecret?: string };
			_pkceMethod: string | false;
			_stateStore: { store(...args: unknown[]): void; verify(...args: unknown[]): void };
			userProfile: (accessToken: string, done: (err?: unknown, profile?: unknown) => void) => void;
		};
		assert.ok(strategy, "huggingface strategy must be built");
		assert.strictEqual(strategy._oauth2._authorizeUrl, "https://huggingface.co/oauth/authorize");
		assert.strictEqual(strategy._oauth2._accessTokenUrl, "https://huggingface.co/oauth/token");
		// CIMD: the client_id IS the env's own metadata doc URL.
		assert.strictEqual(strategy._oauth2._clientId, "https://www.boardgamers.space/.well-known/oauth-cimd");
		// PKCE on (S256) — passport-oauth2 requires state:true alongside it.
		assert.strictEqual(strategy._pkceMethod, "S256");
		assert.ok(strategy._stateStore, "pkce requires a state store");
		// No client secret configured: CIMD is a public client (token_endpoint_auth_method "none").
		assert.strictEqual(strategy._oauth2._clientSecret, undefined);
		assert.strictEqual(typeof strategy.userProfile, "function");
	});

	it("caches one strategy per origin and keys the client_id off the origin", async () => {
		const { huggingfaceStrategy } = await import("../../config/passport.ts");
		const a = huggingfaceStrategy("https://pr-1.boardgamers.space");
		const b = huggingfaceStrategy("https://pr-2.boardgamers.space");
		assert.notStrictEqual(a, b, "different origins get different strategies (different client_id)");
		assert.strictEqual(huggingfaceStrategy("https://pr-1.boardgamers.space"), a, "same origin is cached");
		// oxlint-disable-next-line typescript/no-unsafe-type-assertion -- strategy internals
		const bClientId = (b as { _oauth2: { _clientId: string } })._oauth2._clientId;
		assert.strictEqual(bClientId, "https://pr-2.boardgamers.space/.well-known/oauth-cimd");
	});

	it("google/discord/facebook stay on the confidential-client flow (no PKCE)", () => {
		for (const provider of ["google", "discord", "facebook"] as const) {
			// oxlint-disable-next-line typescript/no-unsafe-type-assertion -- koa-passport types don't expose the strategy
			const strategy = passport._strategy(provider) as unknown as { _pkceMethod?: string | false };
			assert.ok(strategy, `${provider} strategy must be registered`);
			assert.ok(!strategy._pkceMethod, `${provider} must NOT use PKCE`);
		}
	});

	it("creates a social account carrying the HF display meta through signup", async () => {
		const { err, user } = await verifySocial("huggingface", "hf-1001", undefined, { username: "hfuser" });
		assert.ifError(err);
		isSocialFeedback(user);
		assert.deepStrictEqual(user, {
			createSocialAccount: true,
			provider: "huggingface",
			id: "hf-1001",
			socialMeta: { username: "hfuser", url: "https://huggingface.co/hfuser" },
		});

		const token = jwt.sign(user, env.jwt.keys.private, { expiresIn: "1h", algorithm: env.jwt.algorithm });
		const res = await fetch(`${baseURL()}/api/account/signup/social`, {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({ jwt: token, username: "hfuser", termsAndConditions: true }),
		});
		const text = await res.text();
		assert.strictEqual(res.status, 200, `social signup failed: ${res.status} ${text}`);

		const doc = await colls.users.findOne({ "account.username": "hfuser" });
		assert.ok(doc);
		assert.strictEqual(doc.account.social?.huggingface, "hf-1001");
		assert.deepStrictEqual(doc.account.socialMeta?.huggingface, {
			username: "hfuser",
			url: "https://huggingface.co/hfuser",
		});
	});

	it("logs in an existing user via the huggingface strategy", async () => {
		const { err, user } = await verifySocial("huggingface", "hf-1001");
		assert.ifError(err);
		isUserDoc(user);
		const doc = await colls.users.findOne({ "account.username": "hfuser" });
		assert.deepStrictEqual(user._id, doc?._id);
	});

	after(() => db().dropDatabase());
});

describe("Account API — PKCE authorize redirects", () => {
	it("the /github entrypoint redirects to GitHub's authorize URL with a PKCE challenge", async () => {
		const res = await fetch(`${baseURL()}/api/account/auth/github`, { redirect: "manual" });
		assert.strictEqual(res.status, 302);
		const location = res.headers.get("location") ?? "";
		assert.ok(
			location.startsWith("https://github.com/login/oauth/authorize"),
			`expected redirect to GitHub authorize, got ${location}`,
		);
		const url = new URL(location);
		assert.ok(url.searchParams.get("client_id"), "client_id present");
		assert.strictEqual(url.searchParams.get("scope"), "read:user");
		// PKCE: S256 challenge + method, plus a server-side state handle.
		assert.match(url.searchParams.get("code_challenge") ?? "", /^[A-Za-z0-9_-]{20,}$/);
		assert.strictEqual(url.searchParams.get("code_challenge_method"), "S256");
		assert.match(url.searchParams.get("state") ?? "", /^[A-Za-z0-9_-]{10,}$/);
	});

	it("the /huggingface entrypoint redirects to HF's authorize URL with a CIMD client_id + PKCE challenge", async () => {
		const res = await fetch(`${baseURL()}/api/account/auth/huggingface`, { redirect: "manual" });
		assert.strictEqual(res.status, 302);
		const location = res.headers.get("location") ?? "";
		assert.ok(
			location.startsWith("https://huggingface.co/oauth/authorize"),
			`expected redirect to HF authorize, got ${location}`,
		);
		const url = new URL(location);
		// CIMD: the client_id is THIS env's own metadata doc URL (derived from the request host).
		assert.strictEqual(url.searchParams.get("client_id"), `${baseURL()}/.well-known/oauth-cimd`);
		// PKCE: S256 challenge + method, plus a server-side state handle.
		assert.match(url.searchParams.get("code_challenge") ?? "", /^[A-Za-z0-9_-]{20,}$/);
		assert.strictEqual(url.searchParams.get("code_challenge_method"), "S256");
		assert.match(url.searchParams.get("state") ?? "", /^[A-Za-z0-9_-]{10,}$/);
	});

	it("the HF handshake advertises the api-mounted callback (nginx routes /api/* to the api)", async () => {
		// Regression: the callback must be /api/account/auth/huggingface/callback, NOT the bare
		// /auth/huggingface/callback (which nginx routes to the web SPA → 404). #138 bug.
		const res = await fetch(`${baseURL()}/api/account/auth/huggingface`, { redirect: "manual" });
		const url = new URL(res.headers.get("location") ?? "");
		// The strategy builds the callback from ctx.hostname (no port) — the same origin the
		// CIMD doc names in redirect_uris. Assert the path, the routing-critical part.
		const redirectUri = new URL(url.searchParams.get("redirect_uri") ?? "");
		assert.strictEqual(
			redirectUri.pathname,
			"/api/account/auth/huggingface/callback",
			"redirect_uri must be the api-mounted callback that nginx routes to the api (not bare /auth/…)",
		);
		assert.strictEqual(redirectUri.hostname, new URL(baseURL()).hostname);
	});

	it("the api-mounted callback route exists (a bad code fails the handshake, not 404)", async () => {
		// Hitting the real callback path must reach the api router. With an invalid/unknown
		// code+state the OAuth handshake fails → our custom callback 303s to /login?error=
		// (it must NOT be a 404 from an unmounted route).
		const res = await fetch(`${baseURL()}/api/account/auth/huggingface/callback?code=nope&state=nope`, {
			redirect: "manual",
		});
		assert.notStrictEqual(res.status, 404, "callback route must be mounted (not 404)");
		// A bad/expired code+state fails the handshake → strategy.fail() → our custom callback
		// 303s to /login?error= (it must NOT crash into a 500 on the undefined user).
		assert.strictEqual(res.status, 303, "failed handshake should 303 to /login, got " + res.status);
		assert.match(res.headers.get("location") ?? "", /\/login\?error=/);
	});

	it("persists the HF PKCE state server-side in Mongo, single-use", async () => {
		const res = await fetch(`${baseURL()}/api/account/auth/huggingface`, { redirect: "manual" });
		const state = new URL(res.headers.get("location") ?? "").searchParams.get("state");
		assert.ok(state, "state handle present on the authorize URL");

		// The state is in Mongo (survives restarts / readable from any process).
		const stored = await colls.oauthFlows.findOne({ _id: state });
		assert.ok(stored, "state persisted in the oauthflows collection");
		assert.strictEqual(stored.kind, "oauth-state");

		// The stored verifier round-trips through verifyOAuthState exactly once.
		const { verifyOAuthState } = await import("../../models/oauthflows.ts");
		const verifier = await verifyOAuthState(state);
		assert.ok(typeof verifier === "string" && verifier.length > 0, "code verifier recovered from state");
		assert.strictEqual(await verifyOAuthState(state), false, "replayed state must fail");
	});

	it("the old relay routes are gone (no /relay/callback, no returnTo)", async () => {
		const res = await fetch(`${baseURL()}/api/account/auth/relay/callback?code=nope`, { redirect: "manual" });
		// koa-router matches /:provider/callback for "relay" → github-style callback without a
		// code → passport fails → our custom callback 303s to /login?error=. Either way it must
		// NOT be a relay exchange (401 with "relay code") anymore.
		assert.notStrictEqual(res.status, 401, "no relay ticket exchange anymore");
	});

	after(() => db().dropDatabase());
});

describe("Account API — Hugging Face CIMD (no relay)", () => {
	it("the HF start ignores any legacy returnTo param (relay removed — CIMD is direct)", async () => {
		// Before CIMD, ?returnTo= drove the prod→preview relay. Now every env serves its own
		// CIMD doc and does HF login directly, so returnTo must NOT trigger any relay behavior —
		// the flow just starts a normal direct handshake for this origin.
		const res = await fetch(
			`${baseURL()}/api/account/auth/huggingface?returnTo=${encodeURIComponent("https://pr-42.boardgamers.space")}`,
			{ redirect: "manual" },
		);
		assert.strictEqual(res.status, 302);
		const url = new URL(res.headers.get("location") ?? "");
		// The handshake is for THIS env's CIMD client, not a prod one.
		assert.strictEqual(url.searchParams.get("client_id"), `${baseURL()}/.well-known/oauth-cimd`);
	});
});

// A Koa ctx stub shaped for finishSocialAuth: cookie capture + redirect capture.
function makeCtx(user: unknown) {
	const jar: Record<string, string> = {};
	return {
		state: { user },
		protocol: "http",
		host: "bgs.test",
		hostname: "bgs.test",
		status: 0,
		jar,
		cookies: {
			set(name: string, value: string | null) {
				if (value === null) {
					delete jar[name];
				} else {
					jar[name] = value;
				}
			},
		},
		redirectedTo: "",
		redirect(location: string) {
			this.redirectedTo = location;
		},
	};
}

describe("Account API — redirect-only social flow (#155)", () => {
	it("an existing user gets a session cookie and a 303 to /account — no interstitial, no JSON", async () => {
		await colls.users.insertOne(
			testUser({ account: { username: "directuser", email: "direct@test.com", social: { github: "gh-direct-1" } } }),
		);
		const { user } = await verifySocial("github", "gh-direct-1");
		isUserDoc(user);

		const { finishSocialAuth } = await import("./auth.ts");
		// oxlint-disable-next-line typescript/no-unsafe-type-assertion -- minimal ctx stub
		const ctx = makeCtx(user) as unknown as Parameters<typeof finishSocialAuth>[0] & {
			redirectedTo: string;
			status: number;
			jar: Record<string, string>;
		};
		await finishSocialAuth(ctx, "github");

		assert.strictEqual(ctx.status, 303);
		assert.strictEqual(ctx.redirectedTo, "http://bgs.test/account");
		assert.match(ctx.jar.refreshToken ?? "", /"code"/, "session cookie set on the callback response");
		// The session is real: the refresh code resolves in Mongo (stored hashed, #164).
		const code = JSON.parse(ctx.jar.refreshToken).code;
		const rt = await lookupRefreshToken(code);
		assert.ok(rt, "refresh token persisted");
	});

	it("a new social user is redirected to /signup with a single-use ticket (no JWT in the URL)", async () => {
		const { user } = await verifySocial("huggingface", "hf-new-1", undefined, { username: "newbie" });
		isSocialFeedback(user);

		const { finishSocialAuth } = await import("./auth.ts");
		// oxlint-disable-next-line typescript/no-unsafe-type-assertion -- minimal ctx stub
		const ctx = makeCtx(user) as unknown as Parameters<typeof finishSocialAuth>[0] & {
			redirectedTo: string;
			status: number;
			jar: Record<string, string>;
		};
		await finishSocialAuth(ctx, "huggingface");

		assert.strictEqual(ctx.status, 303);
		assert.match(ctx.redirectedTo, /^http:\/\/bgs\.test\/signup\?ticket=/);
		assert.ok(!ctx.redirectedTo.includes("jwt"), "no JWT leaks into the redirect URL");
		assert.strictEqual(ctx.jar.refreshToken, undefined, "no session before signup completes");

		// The ticket completes the social signup exactly once.
		const ticket = new URL(ctx.redirectedTo).searchParams.get("ticket")!;
		const signup = await fetch(`${baseURL()}/api/account/signup/social`, {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({ ticket, username: "newbie", termsAndConditions: true }),
		});
		const text = await signup.text();
		assert.strictEqual(signup.status, 200, `ticket signup failed: ${signup.status} ${text}`);
		const doc = await colls.users.findOne({ "account.username": "newbie" });
		assert.ok(doc);
		assert.strictEqual(doc.account.social?.huggingface, "hf-new-1");

		const replay = await fetch(`${baseURL()}/api/account/signup/social`, {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({ ticket, username: "newbie2", termsAndConditions: true }),
		});
		assert.strictEqual(replay.status, 401, "ticket is single-use");
	});

	after(() => db().dropDatabase());
});

describe("Account API — HF OAuth round-trip (#138 ctx.state.user)", () => {
	// Regression for the pr-138 500: with a custom callback passport does NOT logIn the
	// user (it delegates), so the callback itself must assign ctx.state.user for
	// finishSocialAuth. These tests drive the REAL Koa app + passport middleware over HTTP
	// against a mocked HF token/userinfo endpoint, and assert ctx.state.user drove
	// finishSocialAuth (session cookie set / signup ticket issued — never a 500).

	type OAuth2Proto = {
		getOAuthAccessToken: (
			code: string,
			params: object,
			cb: (e: unknown, at?: string, rt?: string, p?: object) => void,
		) => void;
		get: (url: string, token: string, cb: (e: unknown, body?: string) => void) => void;
	};

	// Stub HF's two outbound HTTP calls on the cached HF strategy instance for the test
	// origin (huggingfaceStrategy(origin) caches per origin; the api app reads the request
	// Host — 127.0.0.1 here — so stub THAT origin's instance). Restored in a finally.
	async function withHfProfile<T>(profile: object, run: () => Promise<T>): Promise<T> {
		const { huggingfaceStrategy } = await import("../../config/passport.ts");
		const origin = `http://${new URL(baseURL()).host}`;
		// oxlint-disable-next-line typescript/no-unsafe-type-assertion -- strategy internals
		const strategy = huggingfaceStrategy(origin) as unknown as { _oauth2: OAuth2Proto };
		const target = strategy._oauth2;
		const origGet = target.getOAuthAccessToken;
		const origGet2 = target.get;
		target.getOAuthAccessToken = (_code, _params, cb) => cb(null, "hf-access-token", "hf-refresh", {});
		target.get = (_url, _token, cb) => cb(null, JSON.stringify(profile));
		try {
			return await run();
		} finally {
			target.getOAuthAccessToken = origGet;
			target.get = origGet2;
		}
	}

	// Hit the real callback route. `state` must be a live PKCE handle (createOAuthState).
	async function hfCallback(state: string) {
		return fetch(`${baseURL()}/api/account/auth/huggingface/callback?code=hf-code&state=${state}`, {
			redirect: "manual",
		});
	}

	it("a NEW HF user completes the handshake → 303 to /signup?ticket= (ctx.state.user set, no 500)", async () => {
		const { createOAuthState } = await import("../../models/oauthflows.ts");
		const state = await createOAuthState({ codeVerifier: "v", expiresAt: new Date(Date.now() + 60000) });

		const res = await withHfProfile({ sub: "hf-e2e-new", preferred_username: "hugger" }, () => hfCallback(state));

		assert.strictEqual(res.status, 303, `expected 303, got ${res.status}`);
		const location = res.headers.get("location") ?? "";
		assert.match(location, /\/signup\?ticket=/, `new HF user should be sent to signup with a ticket, got ${location}`);
		assert.ok(!res.headers.get("set-cookie"), "no session cookie before signup completes");
	});

	it("an EXISTING HF user gets a session cookie + 303 to /account (no 500)", async () => {
		await colls.users.insertOne(
			testUser({
				account: { username: "existinghf", email: "existinghf@test.com", social: { huggingface: "hf-e2e-old" } },
			}),
		);
		const { createOAuthState } = await import("../../models/oauthflows.ts");
		const state = await createOAuthState({ codeVerifier: "v", expiresAt: new Date(Date.now() + 60000) });

		const res = await withHfProfile({ sub: "hf-e2e-old", preferred_username: "hugger" }, () => hfCallback(state));

		assert.strictEqual(res.status, 303, `expected 303, got ${res.status}`);
		assert.match(res.headers.get("location") ?? "", /\/account$/, "existing user should land on /account");
		assert.match(res.headers.get("set-cookie") ?? "", /refreshToken=/, "session cookie set on the callback response");
	});

	it("PKCE state is single-use: replaying the callback state → clean 303 to /login?error= (no 500)", async () => {
		await colls.users.insertOne(
			testUser({
				account: { username: "replayhf", email: "replayhf@test.com", social: { huggingface: "hf-e2e-replay" } },
			}),
		);
		const { createOAuthState } = await import("../../models/oauthflows.ts");
		const state = await createOAuthState({ codeVerifier: "v", expiresAt: new Date(Date.now() + 60000) });

		await withHfProfile({ sub: "hf-e2e-replay", preferred_username: "hugger" }, async () => {
			const first = await hfCallback(state);
			assert.strictEqual(first.status, 303);
			assert.match(first.headers.get("location") ?? "", /\/account$/, "first handshake succeeds");
		});

		// Replay the same state: verifyOAuthState already consumed it → strategy.fail → /login.
		const second = await hfCallback(state);
		assert.strictEqual(second.status, 303);
		assert.match(
			second.headers.get("location") ?? "",
			/\/login\?error=/,
			"replayed state must bounce to /login, not 500",
		);
	});

	after(() => db().dropDatabase());
});
