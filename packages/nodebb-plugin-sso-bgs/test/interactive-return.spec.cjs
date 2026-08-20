"use strict";

/**
 * Interactive return-to tests — the website-originated "Link forum account"
 * flow (the website kicks off `/auth/boardgamers?next=<url>`).
 *
 * Flow under test (library.js):
 *  1. the website's kickoff carries `?next=<current page>` — validated by
 *     safeReturnOrigin (same-origin forum path OR an absolute URL on the
 *     allowlisted Boardgamers origins — never an open redirect) and threaded
 *     through the PKCE state-store metadata (`{ returnTo }`, no prompt=none);
 *  2. on the callback, interactiveReturnRedirect wraps res.redirect so core's
 *     default post-login landing (`strategy.successUrl || '/'`) goes to the
 *     return destination instead of `/` (or a polluted session.returnTo
 *     dead-end like /admin);
 *  3. a fresh registration (the live forum shows a GDPR interstitial) lands
 *     on the return destination too, via the filter:register.complete hook
 *     (completeRegistration) overriding `next` → req.session.returnTo;
 *  4. a tampered/external `next` is dropped (param-less behaviour), and a
 *     manual forum login (no param) keeps core's default `/` landing.
 *
 * Run: node --test test/
 * (harness deps: passport@0.7.0 passport-oauth@1.0.0 @nodebb/spider-detector@2.0.3
 *  in /tmp/sso-bgs-deps — see test/harness.cjs header)
 */

const { test, beforeEach } = require("node:test");
const assert = require("assert");
const { makeEnv, acpSaveStrategy, VALID_CONFIG, authorizeParams, dbObjects, dbSortedSets } = require("./harness.cjs");

const BGS_PAGE = "https://boardgamers.space/boardgame/gaia-project";

beforeEach(() => {
	dbObjects.clear();
	dbSortedSets.clear();
});

// Boot an env whose network edges (token exchange + userinfo) are stubbed so a
// full interactive round-trip can run. newUser: the stock-plugin stub reports
// a freshly-CREATED account (drives core's registration behaviour).
async function bootEnv({ newUser = false } = {}) {
	await acpSaveStrategy(VALID_CONFIG);
	const env = makeEnv();
	env.newUser = newUser;
	env.fetchImpl = async (url, init) => {
		assert.strictEqual(url, VALID_CONFIG.tokenUrl);
		return { ok: true, json: async () => ({ access_token: "at-1", refresh_token: "rt-1" }) };
	};
	env.stockOAuth.getUserProfile = function (name, userRoute, accessToken, done) {
		done(null, { provider: name, id: "u1", displayName: "u1", email: "u1@example.com", email_verified: true });
	};
	await env.appLoad();
	await env.reloadRoutes();
	return env;
}

// Drive an interactive kickoff with `?next=` and return { session, state, params }.
async function startInteractive(env, next) {
	const kickoff = await env.kickoff(`/auth/boardgamers?next=${encodeURIComponent(next)}`);
	return {
		session: kickoff.session,
		state: new URL(kickoff.location).searchParams.get("state"),
		params: authorizeParams(kickoff.location),
	};
}

test("an interactive kickoff with ?next= threads the returnTo through the PKCE metadata (not the URL, no prompt=none)", async () => {
	const env = await bootEnv();
	const { session, state, params } = await startInteractive(env, BGS_PAGE);

	// The authorize URL itself stays clean: no `next`, no returnTo, no prompt.
	assert.strictEqual(params.get("prompt"), null, "interactive — no prompt=none");
	assert.strictEqual(params.get("next"), null, "next never reaches the authorize URL");
	assert.ok(params.get("code_challenge"), "still PKCE");
	assert.ok(state, "PKCE state handle present");

	// The returnTo rode server-side in the PKCE state-store metadata.
	const pkceKey = Object.keys(session).find((k) => k.startsWith("oauth2:"));
	assert.ok(pkceKey, "PKCE store entry persisted");
	// (property assertions, not deepStrictEqual: the metadata object is built
	// inside the shim's vm sandbox, so its prototype is cross-realm)
	assert.strictEqual(session[pkceKey].state.state.returnTo, BGS_PAGE, "returnTo in the PKCE metadata");
	assert.strictEqual(session[pkceKey].state.state.prompt, undefined, "no silent marker");
});

test("an interactive callback with a valid returnTo lands there (not /, not /admin)", async () => {
	const env = await bootEnv();
	const { session, state } = await startInteractive(env, BGS_PAGE);

	const cb = await env.callback(session, { code: "c1", state });
	assert.strictEqual(cb.user.uid, 1, "logged in");
	assert.strictEqual(cb.redirected, BGS_PAGE, "post-login landing is the return destination");
});

test("a same-origin forum path also works as the interactive returnTo", async () => {
	const env = await bootEnv();
	const { session, state } = await startInteractive(env, "/recent");
	const cb = await env.callback(session, { code: "c1", state });
	assert.strictEqual(cb.redirected, "/recent");
});

test("a deep BGS page (path + query) on the allowlisted origin is preserved verbatim", async () => {
	const env = await bootEnv();
	const deep = "https://boardgamers.space/boardgame/gaia-project?tab=requests#feedback";
	const { session, state } = await startInteractive(env, deep);
	const cb = await env.callback(session, { code: "c1", state });
	assert.strictEqual(cb.redirected, deep, "the full allowlisted URL (path+query+hash) is the landing");
});

test("a protocol-relative BGS URL is NOT treated as allowlisted (must be absolute http(s))", async () => {
	const env = await bootEnv();
	// `//boardgamers.space/...` is protocol-relative, not an absolute http(s)
	// URL — safeReturnOrigin must not honour it as a cross-origin return.
	const { session, state } = await startInteractive(env, "//boardgamers.space/boardgame/gaia-project");
	const cb = await env.callback(session, { code: "c1", state });
	assert.strictEqual(cb.redirected, "/", "protocol-relative → default / landing");
});

test("a website-originated REGISTRATION (GDPR interstitial) lands on the return destination, not /admin", async () => {
	// The reported bug: a brand-new forum account completes the interstitial
	// and lands on a dead-end (/admin → access denied) because the session's
	// returnTo was polluted by an earlier 403. The filter:register.complete
	// hook must override that landing with the website-originated returnTo.
	const env = await bootEnv({ newUser: true });
	const { session, state } = await startInteractive(env, BGS_PAGE);

	// Simulate the polluted session.returnTo (an earlier /admin 403) — core's
	// registerAndLoginUser would otherwise use it as the post-registration
	// landing.
	session.returnTo = "/admin";

	const cb = await env.callback(session, { code: "c1", state }, { registration: { interstitial: true } });
	assert.strictEqual(cb.user.uid, 1, "account created + logged in");
	assert.strictEqual(cb.registered, true, "core's registration path ran (filter:register.complete fired)");
	assert.strictEqual(cb.interstitial, true, "a registration interstitial was shown");
	assert.strictEqual(cb.redirected, BGS_PAGE, "post-interstitial landing is the return destination, NOT /admin");
	assert.strictEqual(session.bgsInteractiveReturn, undefined, "the stashed flag is single-use (consumed)");
});

test("a registration WITHOUT an interstitial also lands on the return destination", async () => {
	const env = await bootEnv({ newUser: true });
	const { session, state } = await startInteractive(env, BGS_PAGE);
	const cb = await env.callback(session, { code: "c1", state });
	assert.strictEqual(cb.registered, true);
	assert.ok(!cb.interstitial, "no interstitial in this run");
	assert.strictEqual(cb.redirected, BGS_PAGE, "core's default / landing rewritten to the return destination");
});

test("a tampered/external ?next is dropped at kickoff — the callback falls back to the safe default", async () => {
	const env = await bootEnv();
	for (const evil of [
		"https://evil.com/phish",
		"https://boardgamers.space.evil.com/",
		"https://evil-boardgamers.space/",
		"//evil.com/phish",
		"javascript:alert(1)",
		"/auth/boardgamers",
		"/login",
		"/api/users",
	]) {
		const { session, state, params } = await startInteractive(env, evil);
		const pkceKey = Object.keys(session).find((k) => k.startsWith("oauth2:"));
		assert.strictEqual(
			session[pkceKey].state.state,
			undefined,
			`evil next ${JSON.stringify(evil)} → no returnTo metadata (state stays core's ssoState string)`,
		);
		assert.strictEqual(params.get("next"), null, "evil next never reaches the authorize URL");
		const cb = await env.callback(session, { code: "c1", state });
		assert.strictEqual(cb.redirected, "/", `evil next ${JSON.stringify(evil)} → default / landing`);
	}
});

test("a tampered returnTo inside the PKCE metadata is re-validated on the callback", async () => {
	// Defense in depth: even if the server-side metadata were tampered with,
	// the callback re-runs safeReturnOrigin before wrapping res.redirect.
	const env = await bootEnv();
	const { session, state } = await startInteractive(env, BGS_PAGE);
	const pkceKey = Object.keys(session).find((k) => k.startsWith("oauth2:"));
	session[pkceKey].state.state.returnTo = "https://evil.com/phish"; // tamper
	const cb = await env.callback(session, { code: "c1", state });
	assert.strictEqual(cb.redirected, "/", "tampered metadata returnTo → default / landing");
});

test("a manual forum login (no ?next) is unchanged — lands on /", async () => {
	const env = await bootEnv();
	const kickoff = await env.kickoff("/auth/boardgamers");
	const state = new URL(kickoff.location).searchParams.get("state");
	const pkceKey = Object.keys(kickoff.session).find((k) => k.startsWith("oauth2:"));
	assert.strictEqual(kickoff.session[pkceKey].state.state, undefined, "no returnTo metadata on a manual login");
	const cb = await env.callback(kickoff.session, { code: "mc", state });
	assert.strictEqual(cb.user.uid, 1);
	assert.strictEqual(cb.redirected, "/", "manual login keeps core's default (/) landing");
});

test("the interactive returnTo does NOT turn the round-trip silent (no prompt=none, no cooldown)", async () => {
	const env = await bootEnv();
	const { session, state, params } = await startInteractive(env, BGS_PAGE);
	assert.strictEqual(params.get("prompt"), null, "no prompt=none");

	// A provider ERROR on an interactive round-trip is NOT gated by the silent
	// failure path (no cooldown, no bounce-to-returnTo): it falls through to
	// core's error handling like any manual login.
	const cb = await env.callback(session, { error: "access_denied", state });
	assert.ok(!cb.gated, "interactive error is not silent-gated");
	assert.ok(!cb.setCookies.some((c) => c.name === "bgs_silent"), "no silent cooldown cookie");
});
