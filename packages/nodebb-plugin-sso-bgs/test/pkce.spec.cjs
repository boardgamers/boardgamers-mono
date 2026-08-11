"use strict";

/**
 * Regression tests for the live-forum bug: `GET /auth/boardgamers` redirected
 * to the provider's authorize URL WITHOUT code_challenge /
 * code_challenge_method, which the PKCE-only provider 403s.
 *
 * Root cause: the PKCE strategy used to be built once inside `filter:auth.init`
 * (fired a single time per route reload). If the ACP strategy config was saved
 * after that one firing — the normal order when installing the shim on a live
 * forum — the shim no-oped and the stock plugin's non-PKCE strategy (registered
 * on the next reload, `passport.use` being last-write-wins) kept answering
 * /auth/boardgamers.
 *
 * Fix: the passport strategy NodeBB resolves for `boardgamers` now builds the
 * PKCE strategy from the CURRENT db config at REQUEST TIME.
 *
 * Run: node --test test/
 * (harness deps: `npm i --no-save passport@0.7.0 passport-oauth@1.0.0` into
 * /tmp/sso-bgs-deps — see test/harness.cjs header)
 */

const { test, beforeEach } = require("node:test");
const assert = require("assert");
const crypto = require("crypto");
const { createRequire } = require("module");
const depsRequire = createRequire("/tmp/sso-bgs-deps/node_modules/");
const { makeEnv, acpSaveStrategy, VALID_CONFIG, authorizeParams, dbObjects, dbSortedSets } = require("./harness.cjs");

beforeEach(() => {
	dbObjects.clear();
	dbSortedSets.clear();
});

function assertPkceAuthorizeUrl(location, { scope = "openid profile email role" } = {}) {
	assert.ok(location, "expected a redirect Location");
	const url = new URL(location);
	assert.strictEqual(`${url.origin}${url.pathname}`, VALID_CONFIG.authUrl);
	const params = url.searchParams;
	const challenge = params.get("code_challenge");
	assert.ok(challenge && challenge.length >= 43, "code_challenge present (base64url sha256)");
	assert.strictEqual(params.get("code_challenge_method"), "S256");
	assert.ok(params.get("state"), "state present (PKCE store handle)");
	assert.strictEqual(params.get("response_type"), "code");
	assert.strictEqual(params.get("client_id"), VALID_CONFIG.id);
	assert.strictEqual(params.get("scope"), scope);
	return params;
}

test("strategy saved in ACP AFTER boot (the live-forum order): PKCE params are emitted", async () => {
	const env = makeEnv();

	await env.reloadRoutes(); // boot: no config yet
	assert.strictEqual(env.loginStrategies.length, 0, "no login button without config");

	await acpSaveStrategy(VALID_CONFIG); // ACP save — does NOT reload routes
	await env.reloadRoutes(); // later restart / route reload picks it up

	// Stock plugin's non-PKCE strategy registered at priority 10 during this
	// reload; the shim's old code would have left it in place.
	const { location } = await env.kickoff("/auth/boardgamers");
	const params = assertPkceAuthorizeUrl(location);
	assert.ok(params.get("redirect_uri").endsWith("/auth/boardgamers/callback"));
});

test("LIVE BUG EXACT: config saved after boot, stock overwrote the wrapper, and NO reload fires before the request", async () => {
	// The precise live-forum scenario: shim active (wrapper registered at module
	// load), stock plugin's loadStrategies overwrites passport's registration
	// with its non-PKCE strategy, the ACP config is saved, and a request arrives
	// WITHOUT any route reload in between. The wrapper must still resolve the
	// PKCE strategy — this is what the old hook-time-only build got wrong.
	await acpSaveStrategy(VALID_CONFIG);
	const env = makeEnv(); // wrapper registered at module load

	// Simulate the stock plugin's registration winning (as it does at priority
	// 10 during a reload) WITHOUT firing the shim's loadStrategies afterward.
	const { OAuth2Strategy } = depsRequire("passport-oauth");
	const stock = new OAuth2Strategy(
		{
			authorizationURL: VALID_CONFIG.authUrl,
			tokenURL: VALID_CONFIG.tokenUrl,
			clientID: VALID_CONFIG.id,
			clientSecret: VALID_CONFIG.secret,
			callbackURL: "https://forum.boardgamers.space/auth/boardgamers/callback",
			passReqToCallback: true,
		},
		async (req, t, s, p, done) => done(null, { uid: 1 })
	);
	env.passport.use("boardgamers", stock);
	env.loginStrategies = [
		{
			name: "boardgamers",
			url: "/auth/boardgamers",
			callbackURL: "/auth/boardgamers/callback",
			scope: VALID_CONFIG.scope,
			// NOTE: stock descriptor has no checkState:false — core sets a string state
		},
	];
	env.routes = new Map([
		["/auth/boardgamers", env.loginStrategies[0]],
		["/auth/boardgamers/callback", env.loginStrategies[0]],
	]);

	// Before the request, the registered strategy is the stock non-PKCE one —
	// the exact live failure shape.
	const before = env.passport._strategies.boardgamers;
	assert.strictEqual(before._pkceMethod, undefined, "stock non-PKCE strategy is registered (the live bug setup)");

	// The shim's filter:auth.options hook fires on the kickoff (core does this
	// per request) and re-registers the request-time-resolving wrapper, so the
	// authorize redirect now carries the PKCE params even though no reload ran.
	const { location } = await env.kickoff("/auth/boardgamers");
	const params = new URL(location).searchParams;
	assert.ok(params.get("code_challenge"), "code_challenge emitted even with no reload after ACP save");
	assert.strictEqual(params.get("code_challenge_method"), "S256");
	assert.ok(params.get("state"), "PKCE store state handle present");
});

test("config exists BEFORE boot (stock plugin registers first): PKCE params are emitted", async () => {
	await acpSaveStrategy(VALID_CONFIG);
	const env = makeEnv();
	await env.reloadRoutes();

	const { location } = await env.kickoff("/auth/boardgamers");
	assertPkceAuthorizeUrl(location);

	// exactly one button, with the ACP scope and core's ssoState gate disabled
	assert.strictEqual(env.loginStrategies.filter((s) => s.name === "boardgamers").length, 1);
	assert.strictEqual(env.loginStrategies[0].checkState, false);
	assert.strictEqual(env.loginStrategies[0].scope, "openid profile email role");
});

test("config edited in the ACP (no restart): the next kickoff uses the NEW endpoints/client config", async () => {
	await acpSaveStrategy(VALID_CONFIG);
	const env = makeEnv();
	await env.reloadRoutes();
	const first = await env.kickoff("/auth/boardgamers"); // builds + caches the strategy
	assertPkceAuthorizeUrl(first.location);

	// Edit the provider endpoints + client_id. NO reloadRoutes: a live request
	// must still pick up the edit (request-time resolution rebuilds the
	// strategy). NOTE: the login-button descriptor's `scope` is captured at
	// route-reload time by NodeBB core (it lives in loginStrategies), so a scope
	// change still needs a restart to reach the kickoff — but the endpoints,
	// client_id and PKCE behaviour never go stale.
	await acpSaveStrategy({
		...VALID_CONFIG,
		authUrl: "https://auth.boardgamers.space/api/oauth2/authorize",
		tokenUrl: "https://auth.boardgamers.space/api/oauth2/token",
		id: "https://forum.boardgamers.space/client-metadata.json?v=2",
	});

	const { location } = await env.kickoff("/auth/boardgamers");
	const url = new URL(location);
	assert.strictEqual(url.origin, "https://auth.boardgamers.space", "rebuilt with the new authorization endpoint");
	assert.strictEqual(url.searchParams.get("client_id"), "https://forum.boardgamers.space/client-metadata.json?v=2");
	assert.ok(url.searchParams.get("code_challenge"), "still PKCE after the edit");
});

test("strategy disabled in the ACP: the login button disappears and the kickoff bounces to /login", async () => {
	await acpSaveStrategy(VALID_CONFIG);
	const env = makeEnv();
	await env.reloadRoutes();
	assert.strictEqual(env.loginStrategies.length, 1);

	await acpSaveStrategy({ ...VALID_CONFIG, enabled: false });
	await env.reloadRoutes();

	assert.strictEqual(env.loginStrategies.length, 0, "button gone");
	const { location } = await env.kickoff("/auth/boardgamers").catch(() => ({ location: null }));
	// No route is registered once the descriptor is gone, so kickoff() can't
	// even run — but if it could (stale route table), the strategy must NOT
	// send the user to authorize.
	assert.ok(!location || !location.startsWith(VALID_CONFIG.authUrl), "never redirects to authorize when disabled");
});

test("full round-trip: kickoff persists a code_verifier, callback redeems it (single-use), token POST has no client_secret", async () => {
	await acpSaveStrategy(VALID_CONFIG);
	const env = makeEnv();

	// Stub the network edges BEFORE the strategy build (reloadRoutes below):
	// token exchange + userinfo. The build binds getUserProfile, so the stub
	// must be in place first.
	let tokenPostBody = null;
	let profileCalls = 0;
	env.fetchImpl = async (url, init) => {
		assert.strictEqual(url, VALID_CONFIG.tokenUrl);
		tokenPostBody = new URLSearchParams(init.body);
		return {
			ok: true,
			json: async () => ({ access_token: "at-123", refresh_token: "rt-456" }),
		};
	};
	env.stockOAuth.getUserProfile = function (name, userRoute, accessToken, done) {
		profileCalls += 1;
		assert.strictEqual(accessToken, "at-123");
		done(null, {
			provider: name,
			id: "bgs-user-1",
			displayName: "coyotte508",
			email: "coyotte508@example.com",
			email_verified: true,
		});
	};

	await env.reloadRoutes();

	// 1. kickoff → authorize redirect with PKCE params, verifier in session
	const { location, session } = await env.kickoff("/auth/boardgamers");
	const params = assertPkceAuthorizeUrl(location);
	const state = params.get("state");

	// 2. provider redirects back; core callback runs
	const { user } = await env.callback(session, { code: "authcode-1", state });
	assert.strictEqual(user.uid, 1);
	assert.strictEqual(profileCalls, 1);

	// token exchange: PKCE public client — verifier, NO secret
	assert.ok(tokenPostBody, "token exchange happened");
	assert.strictEqual(tokenPostBody.get("grant_type"), "authorization_code");
	assert.strictEqual(tokenPostBody.get("code"), "authcode-1");
	assert.ok(tokenPostBody.get("code_verifier"), "code_verifier sent");
	assert.strictEqual(tokenPostBody.get("client_id"), VALID_CONFIG.id);
	assert.ok(!tokenPostBody.has("client_secret"), "no client_secret key at all");

	// verifier ↔ challenge actually match (S256)
	const expectedChallenge = crypto
		.createHash("sha256")
		.update(tokenPostBody.get("code_verifier"))
		.digest("base64")
		.replace(/\+/g, "-")
		.replace(/\//g, "_")
		.replace(/=+$/, "");
	assert.strictEqual(expectedChallenge, params.get("code_challenge"));

	// 3. state handle is single-use: replaying the callback fails (PKCE store
	// consumed the verifier on first use), it does NOT succeed again.
	const replay = await env.callback(session, { code: "authcode-1", state });
	assert.strictEqual(replay.user, false, "replayed state handle must not authenticate");
});

test("a string opts.state (core's ssoState) can no longer reach passport-oauth2 — the override strips it", async () => {
	// Directly exercises the scenario where a route descriptor WITHOUT
	// checkState:false (e.g. the stock plugin's own button) drives the
	// strategy: core passes a string opts.state, which would make
	// passport-oauth2 skip its PKCE session store. The shim strips it.
	await acpSaveStrategy(VALID_CONFIG);
	const env = makeEnv();
	await env.reloadRoutes();

	// force the stock-plugin calling convention even though our descriptor
	// has checkState:false
	const descriptor = env.loginStrategies.find((s) => s.name === "boardgamers");
	descriptor.checkState = true;

	const { location, session } = await env.kickoff("/auth/boardgamers");
	const params = assertPkceAuthorizeUrl(location);
	assert.notStrictEqual(params.get("state"), "CORE-SSO-STATE-STRING", "state is the PKCE store handle, not core's string");
	assert.ok(session, "session exists");
});
