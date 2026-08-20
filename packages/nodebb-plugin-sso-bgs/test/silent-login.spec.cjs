"use strict";

/**
 * Silent (passive) SSO tests — the prompt=none auto-login flow.
 *
 * Flow under test (library.js):
 *  1. an anonymous page GET (non-bot, no cooldown, not the SSO/login/logout
 *     path) is redirected ONCE to `/auth/boardgamers?silent=1`, and the session
 *     is flagged `bgsSilent`;
 *  2. that kickoff route adds `prompt=none` to the authorize redirect, reusing
 *     the exact PKCE machinery (code_challenge/state) of the manual button;
 *  3. the callback, when the provider returns `error=login_required` (any
 *     prompt=none failure), arms a timestamped cooldown cookie and bounces to
 *     `/` — the user never sees an OIDC error page;
 *  4. while the cooldown cookie is fresh, page GETs do NOT redirect again (no
 *     redirect loop for logged-out users);
 *  5. a logged-in page GET never triggers a silent attempt, and spiders
 *     (req.isSpider / UA) are never redirected.
 *
 * Run: node --test test/
 * (harness deps: passport@0.7.0 passport-oauth@1.0.0 @nodebb/spider-detector@2.0.3
 *  in /tmp/sso-bgs-deps — see test/harness.cjs header)
 */

const { test, beforeEach } = require("node:test");
const assert = require("assert");
const { makeEnv, acpSaveStrategy, VALID_CONFIG, authorizeParams, dbObjects, dbSortedSets } = require("./harness.cjs");

const CHROME_UA = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/120 Safari/537.36";
const GOOGLEBOT_UA = "Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)";

beforeEach(() => {
	dbObjects.clear();
	dbSortedSets.clear();
});

async function bootEnv() {
	await acpSaveStrategy(VALID_CONFIG);
	const env = makeEnv();
	await env.appLoad(); // static:app.load → mounts the silent-login page middleware
	await env.reloadRoutes();
	return env;
}

test("an anonymous page GET redirects ONCE to the kickoff, which emits prompt=none + PKCE params", async () => {
	const env = await bootEnv();

	// 1. page middleware → local redirect to the SSO kickoff, session flagged
	const jar = {};
	const page = await env.page("/recent", { cookieJar: jar });
	assert.strictEqual(page.statusCode, 302);
	assert.strictEqual(page.location, "/auth/boardgamers?silent=1");
	assert.strictEqual(page.session.bgsSilent, true, "session flagged for the silent round-trip");

	// 2. the kickoff route (what the browser hits next) → authorize URL with
	//    prompt=none AND the same PKCE params the manual button produces
	const kickoff = await env.kickoff("/auth/boardgamers?silent=1", { session: page.session, cookieJar: jar });
	const params = authorizeParams(kickoff.location);
	assert.strictEqual(`${new URL(kickoff.location).origin}${new URL(kickoff.location).pathname}`, VALID_CONFIG.authUrl);
	assert.strictEqual(params.get("prompt"), "none", "prompt=none added");
	assert.ok(params.get("code_challenge"), "code_challenge present (PKCE reused)");
	assert.strictEqual(params.get("code_challenge_method"), "S256");
	assert.ok(params.get("state"), "PKCE state handle present");
	assert.strictEqual(params.get("client_id"), VALID_CONFIG.id);
	assert.ok(params.get("redirect_uri").endsWith("/auth/boardgamers/callback"));
	// the PKCE store persisted the prompt=none marker (what the callback reads)
	const pkceKey = Object.keys(kickoff.session).find((k) => k.startsWith("oauth2:"));
	assert.ok(kickoff.session[pkceKey].state.code_verifier, "code_verifier persisted");
	assert.strictEqual(kickoff.session[pkceKey].state.state.prompt, "none", "prompt=none marker persisted in PKCE state");
});

test("the manual login button does NOT get prompt=none (stays an interactive login)", async () => {
	const env = await bootEnv();
	const { location } = await env.kickoff("/auth/boardgamers");
	const params = authorizeParams(location);
	assert.strictEqual(params.get("prompt"), null, "no prompt=none on the manual button");
	assert.ok(params.get("code_challenge"), "manual button still PKCE");
});

test("a callback with error=login_required arms the cooldown and bounces to /; the next page GET does NOT redirect again", async () => {
	const env = await bootEnv();
	const jar = {};

	// Regression guard for the PR-review blocker: core's callback route does NOT
	// fire filter:auth.options (kickoff-only), so the cooldown gate MUST run as
	// an app-level middleware on the callback path. env.callback is faithful to
	// core: it runs the shim's mounted callback middleware, NOT the hook — so if
	// the gate still lived in ensureStrategy (filter:auth.options), this test
	// would see NO cooldown and NO redirect.
	assert.strictEqual(
		env.plugins.hooks.listeners("filter:auth.options").length,
		1,
		"only the shim's kickoff hook is registered",
	);

	// silent round-trip: page → kickoff → callback(error=login_required)
	const page = await env.page("/recent", { cookieJar: jar });
	const kickoff = await env.kickoff("/auth/boardgamers?silent=1", { session: page.session, cookieJar: jar });
	const state = new URL(kickoff.location).searchParams.get("state");

	const cb = await env.callback(page.session, { error: "login_required", state }, { cookieJar: jar });
	assert.strictEqual(cb.gated, true, "the shim's callback gate ended the response (no OIDC error page)");
	assert.strictEqual(cb.redirected, "/recent", "bounced back to the page the user was on (not home)");
	const cooldown = cb.setCookies.find((c) => c.name === "bgs_silent");
	assert.ok(cooldown, "cooldown cookie set");
	assert.ok(Number(cooldown.value) > 0, "cookie carries the failure timestamp");
	assert.strictEqual(cb.session.bgsSilent, undefined, "session flag cleared");

	// subsequent page GET (cookie sent) → NO second silent attempt (no loop)
	const jar2 = { bgs_silent: cooldown.value };
	const page2 = await env.page("/recent", { cookieJar: jar2 });
	assert.strictEqual(page2.proceeded, true, "page proceeded without a redirect");
	assert.strictEqual(page2.location, null);
	assert.strictEqual(page2.session.bgsSilent, undefined);
});

test("REGRESSION (PR #254 review): the silent-error cooldown runs on the CALLBACK path, NOT filter:auth.options", async () => {
	// Core's callback route never fires filter:auth.options (kickoff-only), so a
	// gate placed there is dead code live → redirect loop. This test proves the
	// gate is the app-level middleware mounted at CALLBACK_URL: it (a) checks
	// the mount exists, and (b) drives an error callback through env.callback —
	// which faithfully does NOT fire filter:auth.options — and asserts the
	// cooldown + redirect still happen.
	const env = await bootEnv();

	// (a) the silent handling is mounted on the app at the callback path (gate +
	// success-redirect), running before core's handler
	const mounts = env.app.middleware.filter((m) => m.path === "/auth/boardgamers/callback");
	assert.ok(mounts.length >= 1, "silent-callback middleware is app-mounted at the callback path");

	// (b) drive the full silent round-trip; the error callback must be gated
	const jar = {};
	const page = await env.page("/recent", { cookieJar: jar });
	const kickoff = await env.kickoff("/auth/boardgamers?silent=1", { session: page.session, cookieJar: jar });
	const state = new URL(kickoff.location).searchParams.get("state");
	const cb = await env.callback(page.session, { error: "login_required", state }, { cookieJar: jar });
	assert.strictEqual(cb.gated, true, "gated on the real callback path (no filter:auth.options involved)");
	assert.strictEqual(cb.redirected, "/recent", "returns to the original page");
	assert.ok(
		cb.setCookies.some((c) => c.name === "bgs_silent"),
		"cooldown armed on the real callback path",
	);

	// no loop: the next anonymous page GET with the cooldown does not redirect
	const page2 = await env.page("/recent", { cookieJar: jar });
	assert.strictEqual(page2.location, null, "no second silent redirect — loop prevented");
});

test("a prompt=none error WITHOUT session metadata (cookie-less bot, lost session) is still failed gracefully", async () => {
	const env = await bootEnv();
	// No page/kickoff first: the callback arrives with a session that carries
	// no PKCE metadata — the real-world shape of a cookie-less crawler hitting
	// the callback URL, or a session that expired mid-round-trip. Before the
	// fix this fell through to passport, which threw an AuthorizationError
	// (error page + stack trace in the logs on every such visit).
	const cb = await env.callback({}, { error: "login_required" }, { cookieJar: {} });
	assert.strictEqual(cb.gated, true, "gated — never reaches passport's AuthorizationError");
	assert.strictEqual(cb.redirected, "/", "lands on the forum home");
	assert.ok(
		cb.setCookies.some((c) => c.name === "bgs_silent"),
		"cooldown armed",
	);
});

test("a NON-prompt=none error without metadata still falls through to core (manual-flow errors untouched)", async () => {
	const env = await bootEnv();
	// access_denied can come from a manual (interactive) flow — with no
	// metadata to say otherwise, it must reach core/passport untouched
	// (passport turns it into a login failure, not the shim's silent bounce).
	const cb = await env.callback({}, { error: "access_denied" }, { cookieJar: {} });
	assert.ok(!cb.gated, "not gated by the shim");
	assert.ok(!cb.user, "passport failed the login (core handles the failure)");
	assert.ok(!cb.setCookies.some((c) => c.name === "bgs_silent"), "no silent cooldown for a manual-flow error");
});

test("a SUCCESSFUL silent callback logs the user in (full round-trip) and arms the cooldown", async () => {
	// Stub the network edges BEFORE anything builds the strategy (the build binds
	// getUserProfile): makeEnv → set stubs → appLoad → reloadRoutes.
	await acpSaveStrategy(VALID_CONFIG);
	const env = makeEnv();
	let tokenPostBody = null;
	env.fetchImpl = async (url, init) => {
		assert.strictEqual(url, VALID_CONFIG.tokenUrl);
		tokenPostBody = new URLSearchParams(init.body);
		return { ok: true, json: async () => ({ access_token: "at-silent", refresh_token: "rt-silent" }) };
	};
	env.stockOAuth.getUserProfile = function (name, userRoute, accessToken, done) {
		assert.strictEqual(accessToken, "at-silent");
		done(null, {
			provider: name,
			id: "bgs-7",
			displayName: "silentUser",
			email: "s@example.com",
			email_verified: true,
		});
	};
	await env.appLoad();
	await env.reloadRoutes();

	const jar = {};
	const page = await env.page("/topic/123/foo", { cookieJar: jar });
	const kickoff = await env.kickoff("/auth/boardgamers?silent=1", { session: page.session, cookieJar: jar });
	const state = new URL(kickoff.location).searchParams.get("state");

	// provider returns a CODE (site session exists) → seamless login, and the
	// post-login redirect lands back on the page the user was reading
	const cb = await env.callback(page.session, { code: "silentcode", state }, { cookieJar: jar });
	assert.ok(!cb.gated, "not gated — normal code exchange runs");
	assert.strictEqual(cb.user.uid, 1, "logged in seamlessly");
	assert.ok(tokenPostBody, "token exchange happened");
	assert.ok(tokenPostBody.get("code_verifier"), "PKCE verifier redeemed");
	// The cooldown is armed on the success leg too — the loop-breaker of last
	// resort: when a "successful" login doesn't stick (ghost account, forum-side
	// failure), the provider would keep answering prompt=none with a fresh code
	// and the failure-path cooldown would never fire. For a login that DOES
	// stick the cookie is moot: logged-in users never enter the silent
	// middleware.
	assert.ok(
		cb.setCookies.some((c) => c.name === "bgs_silent"),
		"cooldown armed on success (loop-breaker)",
	);
	assert.strictEqual(cb.redirected, "/topic/123/foo", "silent success returns to the original page");
});

test("silent SUCCESS and FAILURE both return to the original page; tampered/external returnTo falls back to /", async () => {
	await acpSaveStrategy(VALID_CONFIG);
	const env = makeEnv();
	env.fetchImpl = async (url, init) => ({
		ok: true,
		json: async () => ({ access_token: "at-1", refresh_token: "rt-1" }),
	});
	env.stockOAuth.getUserProfile = function (name, userRoute, accessToken, done) {
		done(null, { provider: name, id: "u1", displayName: "u1", email: "u1@example.com", email_verified: true });
	};
	await env.appLoad();
	await env.reloadRoutes();

	// helper: run a silent attempt from `pagePath`, return { session, state }
	const startSilent = async (pagePath) => {
		const jar = {};
		const page = await env.page(pagePath, { cookieJar: jar });
		const kickoff = await env.kickoff("/auth/boardgamers?silent=1", { session: page.session, cookieJar: jar });
		return { session: page.session, state: new URL(kickoff.location).searchParams.get("state"), jar };
	};

	// FAILURE from a deep page → back to that page
	const f1 = await startSilent("/topic/123/foo");
	const failCb = await env.callback(f1.session, { error: "login_required", state: f1.state }, { cookieJar: f1.jar });
	assert.strictEqual(failCb.redirected, "/topic/123/foo", "silent failure returns to the original page");

	// SUCCESS from a deep page → back to that page
	const s1 = await startSilent("/category/2/general");
	const okCb = await env.callback(s1.session, { code: "c1", state: s1.state }, { cookieJar: s1.jar });
	assert.strictEqual(okCb.user.uid, 1);
	assert.strictEqual(okCb.redirected, "/category/2/general", "silent success returns to the original page");

	// OPEN-REDIRECT GUARD: a tampered/external returnTo in the PKCE metadata must
	// fall back to "/" for BOTH paths. Simulate tampering by overwriting the
	// persisted metadata's returnTo with a malicious value.
	for (const evil of [
		"//evil.com/phish",
		"/\\evil.com",
		"\\/evil.com",
		"\\\\evil.com",
		"https://evil.com",
		"http://evil.com/x",
		"/auth/boardgamers",
		"/auth/boardgamers/callback",
		"/login",
		"/logout",
		"/api/users",
		"javascript:alert(1)",
		"not-a-path",
		"",
	]) {
		const t = await startSilent("/recent");
		const key = Object.keys(t.session).find((k) => k.startsWith("oauth2:"));
		t.session[key].state.state.returnTo = evil; // tamper
		const failT = await env.callback(t.session, { error: "login_required", state: t.state }, { cookieJar: t.jar });
		assert.strictEqual(failT.redirected, "/", `failure: evil returnTo ${JSON.stringify(evil)} → /`);

		const t2 = await startSilent("/recent");
		const key2 = Object.keys(t2.session).find((k) => k.startsWith("oauth2:"));
		t2.session[key2].state.state.returnTo = evil;
		const okT = await env.callback(t2.session, { code: "c", state: t2.state }, { cookieJar: t2.jar });
		assert.strictEqual(okT.redirected, "/", `success: evil returnTo ${JSON.stringify(evil)} → /`);
	}

	// the manual login button is NOT rewritten to the original page (no silent
	// marker): a manual kickoff's callback keeps core's default landing.
	const manual = await env.kickoff("/auth/boardgamers");
	const mState = new URL(manual.location).searchParams.get("state");
	const manualCb = await env.callback(manual.session, { code: "mc", state: mState }, {});
	assert.strictEqual(manualCb.user.uid, 1);
	assert.strictEqual(manualCb.redirected, "/", "manual login keeps core's default (/) landing");
});

test("REGRESSION (PR #254 review): silent success rewrite works with core's 2-arg res.redirect(307, url)", async () => {
	// NodeBB core's helpers.redirect calls res.redirect(307, url) — TWO args. A
	// 1-arg res.redirect(url) wrap sees url=307 (a number), the `=== "/"` check
	// fails, and the return-to-page silently no-ops. This drives the silent
	// success through the faithful 2-arg shape (env.callback now uses
	// res.redirect(307, url)) and asserts the rewrite actually fires.
	await acpSaveStrategy(VALID_CONFIG);
	const env = makeEnv();
	env.fetchImpl = async () => ({ ok: true, json: async () => ({ access_token: "at-1" }) });
	env.stockOAuth.getUserProfile = function (name, userRoute, accessToken, done) {
		done(null, { provider: name, id: "u1", displayName: "u1", email: "u1@example.com", email_verified: true });
	};
	await env.appLoad();
	await env.reloadRoutes();

	const jar = {};
	const page = await env.page("/topic/9/deep-dive", { cookieJar: jar });
	const kickoff = await env.kickoff("/auth/boardgamers?silent=1", { session: page.session, cookieJar: jar });
	const state = new URL(kickoff.location).searchParams.get("state");

	const cb = await env.callback(page.session, { code: "c", state }, { cookieJar: jar });
	assert.strictEqual(cb.user.uid, 1, "logged in");
	assert.strictEqual(cb.redirected, "/topic/9/deep-dive", "rewritten to returnTo even via res.redirect(307, url)");
});

test("an EXPIRED cooldown cookie allows a fresh silent attempt", async () => {
	const env = await bootEnv();
	const stale = String(Date.now() - 2 * 60 * 60 * 1000); // 2 h ago (> 1 h cooldown)
	const jar = { bgs_silent: stale };
	const page = await env.page("/recent", { cookieJar: jar });
	assert.strictEqual(page.location, "/auth/boardgamers?silent=1", "expired cooldown → silent attempt resumes");
	assert.strictEqual(page.session.bgsSilent, true);
});

test("a logged-in (session cookie) page GET does NOT trigger silent login", async () => {
	const env = await bootEnv();
	const page = await env.page("/recent", { loggedIn: true });
	assert.strictEqual(page.proceeded, true);
	assert.strictEqual(page.location, null);
	assert.strictEqual(page.session.bgsSilent, undefined);
});

test("bots/spiders never trigger a silent redirect (UA detection + req.isSpider)", async () => {
	const env = await bootEnv();

	// via the real spider-detector UA parsing (Googlebot UA)
	const byUa = await env.page("/recent", { ua: GOOGLEBOT_UA });
	assert.strictEqual(byUa.location, null, "bot UA → no redirect");
	assert.strictEqual(byUa.session.bgsSilent, undefined);

	// via core's req.isSpider() (uid -1 path)
	const byFlag = await env.page("/recent", { spider: true, ua: GOOGLEBOT_UA });
	assert.strictEqual(byFlag.location, null);
	assert.strictEqual(byFlag.session.bgsSilent, undefined);
});

test("an explicit logout (?logout) is respected — no instant silent re-login", async () => {
	const env = await bootEnv();
	const page = await env.page("/", { query: { logout: "" } });
	assert.strictEqual(page.proceeded, true, "no silent redirect right after an explicit logout");
	assert.strictEqual(page.location, null);
	assert.strictEqual(page.session.bgsSilent, undefined);
});

test("the SSO login/callback paths themselves never trigger the page middleware (no self-loop)", async () => {
	const env = await bootEnv();
	for (const p of ["/auth/boardgamers", "/auth/boardgamers/callback", "/login", "/logout"]) {
		const page = await env.page(p, { session: {} });
		assert.strictEqual(page.location, null, `${p} not redirected`);
		assert.strictEqual(page.session.bgsSilent, undefined, `${p} not flagged`);
	}
});

test("API / non-GET / asset requests never trigger silent login", async () => {
	const env = await bootEnv();
	const cases = [
		["/api/recent", {}],
		["/assets/stylesheet.css", {}],
		["/uploads/picture.png", {}],
		["/recent", { method: "POST" }],
	];
	for (const [p, extra] of cases) {
		const page = await env.page(p, extra);
		assert.strictEqual(page.location, null, `${extra.method || "GET"} ${p} → no silent redirect`);
		assert.strictEqual(page.session.bgsSilent, undefined);
	}
});

test("a manual login click right after a silent attempt does NOT inherit prompt=none", async () => {
	const env = await bootEnv();

	// silent attempt sets the session flag, but the user then clicks the
	// manual button instead of completing the silent round-trip.
	const page = await env.page("/recent", { cookieJar: {} });
	assert.strictEqual(page.session.bgsSilent, true);

	// Manual button = /auth/boardgamers WITHOUT ?silent → flag consumed, no
	// prompt=none (the session flag alone must never trigger silent mode).
	const manual = await env.kickoff("/auth/boardgamers", { session: page.session });
	const params = authorizeParams(manual.location);
	assert.strictEqual(params.get("prompt"), null, "no prompt=none leaked into the manual flow");
	assert.strictEqual(manual.session.bgsSilent, undefined, "flag consumed on the manual kickoff");
});
