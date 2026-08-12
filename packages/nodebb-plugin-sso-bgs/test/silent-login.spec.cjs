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

	// silent round-trip: page → kickoff → callback(error=login_required)
	const page = await env.page("/recent", { cookieJar: jar });
	const kickoff = await env.kickoff("/auth/boardgamers?silent=1", { session: page.session, cookieJar: jar });
	const state = new URL(kickoff.location).searchParams.get("state");

	const cb = await env.callback(page.session, { error: "login_required", state }, { cookieJar: jar });
	assert.strictEqual(cb.gated, true, "the shim's callback gate ended the response (no OIDC error page)");
	assert.strictEqual(cb.redirected, "/", "bounced to the local homepage");
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

test("a SUCCESSFUL silent callback logs the user in (full round-trip) and arms NO cooldown", async () => {
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
	const page = await env.page("/recent", { cookieJar: jar });
	const kickoff = await env.kickoff("/auth/boardgamers?silent=1", { session: page.session, cookieJar: jar });
	const state = new URL(kickoff.location).searchParams.get("state");

	// provider returns a CODE (site session exists) → seamless login, NO cooldown
	const cb = await env.callback(page.session, { code: "silentcode", state }, { cookieJar: jar });
	assert.ok(!cb.gated, "not gated — normal code exchange runs");
	assert.strictEqual(cb.user.uid, 1, "logged in seamlessly");
	assert.ok(tokenPostBody, "token exchange happened");
	assert.ok(tokenPostBody.get("code_verifier"), "PKCE verifier redeemed");
	assert.ok(!cb.setCookies.some((c) => c.name === "bgs_silent"), "no cooldown cookie on success");

	// and a subsequent anonymous-style page view is moot (they're logged in now),
	// but even logged-out there's no cooldown blocking a retry
	const page2 = await env.page("/recent", { cookieJar: jar });
	assert.strictEqual(page2.location, "/auth/boardgamers?silent=1", "no cooldown → silent attempt still allowed");
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
