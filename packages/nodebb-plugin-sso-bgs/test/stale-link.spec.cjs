"use strict";

/**
 * Stale-link healing tests — loginHealingStaleLink (library.js).
 *
 * The stock plugin's OAuth.login blindly trusts the `boardgamersId:uid` map:
 * a forum account deleted while its map entry survived (out-of-band cleanup,
 * an interrupted User.deleteAccount) resolves to a ghost uid — updateProfile
 * then re-creates a partial user doc (no username), the "login" produces a
 * broken session, and the silent SSO loops forever.
 *
 * The shim's guard: after OAuth.login, the uid must have a username on the
 * RAW user doc. If not, the stale map entry and the partial doc are dropped
 * and login runs once more, taking the account-creation path.
 *
 * Run: node --test test/
 * (harness deps: passport@0.7.0 passport-oauth@1.0.0 @nodebb/spider-detector@2.0.3
 *  in /tmp/sso-bgs-deps — see test/harness.cjs header)
 */

const { test, beforeEach } = require("node:test");
const assert = require("assert");
const { makeEnv, acpSaveStrategy, VALID_CONFIG, dbObjects, dbSortedSets } = require("./harness.cjs");

beforeEach(() => {
	dbObjects.clear();
	dbSortedSets.clear();
});

// Stubs must be in place BEFORE appLoad/reloadRoutes: building the strategy
// binds the stock plugin's getUserProfile at build time.
async function bootEnv({ id, displayName }) {
	await acpSaveStrategy(VALID_CONFIG);
	const env = makeEnv();
	env.fetchImpl = async () => ({
		ok: true,
		json: async () => ({ access_token: "at-1", refresh_token: "rt-1" }),
	});
	env.stockOAuth.getUserProfile = function (name, userRoute, accessToken, done) {
		done(null, { provider: name, id, displayName, email: "t@example.com", email_verified: true });
	};
	await env.appLoad();
	await env.reloadRoutes();
	return env;
}

async function manualLoginCallback(env, jar) {
	const kickoff = await env.kickoff("/auth/boardgamers", { session: {}, cookieJar: jar });
	const session = kickoff.session;
	const state = new URL(kickoff.location).searchParams.get("state");
	return env.callback(session, { code: "authcode", state }, { cookieJar: jar });
}

// A faithful transcription of the stock plugin's OAuth.login resolution order
// against the harness db: oauth-id map → verified-email fallback → create.
// This is what defeated the first version of the heal on the live forum: the
// map entry was scrubbed, but user.getUidByEmail resolved the SAME ghost uid
// through the stale email:uid entry and re-linked it.
function stockLikeLogin(env, { nextUid }) {
	const calls = [];
	env.stockOAuth.login = async (payload) => {
		calls.push(payload);
		let uid = (dbObjects.get("boardgamersId:uid") || {})[payload.oAuthid];
		if (!uid && payload.email && payload.email_verified) {
			uid = await env.db.sortedSetScore("email:uid", payload.email.toLowerCase());
		}
		if (!uid) {
			uid = nextUid; // user.create: a full account
			dbObjects.set(`user:${uid}`, { username: payload.handle, userslug: payload.handle.toLowerCase() });
			await env.db.sortedSetAdd("email:uid", uid, payload.email.toLowerCase());
			await env.db.sortedSetAdd("email:sorted", 0, `${payload.email.toLowerCase()}:${uid}`);
		}
		dbObjects.set("boardgamersId:uid", {
			...(dbObjects.get("boardgamersId:uid") || {}),
			[payload.oAuthid]: uid,
		});
		return { uid };
	};
	return calls;
}

test("a stale boardgamersId:uid entry (ghost uid, no username) is healed: link dropped, login re-run", async () => {
	const env = await bootEnv({ id: "bgs-ghost", displayName: "CoyoTech" });

	// The stale state: the map still points bgs-ghost → uid 9, but user:9 was
	// deleted (only a partial doc remains, as updateProfile re-creates it).
	dbObjects.set("boardgamersId:uid", { "bgs-ghost": 9 });
	dbObjects.set("user:9", { fullname: "CoyoTech", picture: "https://x/avatar" });

	const calls = stockLikeLogin(env, { nextUid: 10 });
	const cb = await manualLoginCallback(env, {});
	assert.strictEqual(cb.user.uid, 10, "logged into a freshly created account, not the ghost");
	assert.strictEqual(calls.length, 2, "login re-ran after the heal");
	assert.ok(!dbObjects.has("user:9"), "partial ghost doc dropped");
	assert.strictEqual(dbObjects.get("boardgamersId:uid")["bgs-ghost"], 10, "map re-points at the new account");
	assert.strictEqual(dbObjects.get("user:10").username, "CoyoTech");
});

test("REGRESSION (live forum): a stale email:uid entry re-resolving the ghost is scrubbed by the heal", async () => {
	const env = await bootEnv({ id: "bgs-ghost", displayName: "CoyoTech" });

	// The full stale state left by the account deletion: oauth-id map AND the
	// email maps still point at ghost uid 9. Without the email scrub, the
	// re-login's getUidByEmail fallback resolves uid 9 again and re-links the
	// ghost — an endless "link your forum account" loop site-side.
	dbObjects.set("boardgamersId:uid", { "bgs-ghost": 9 });
	dbObjects.set("user:9", { fullname: "CoyoTech", picture: "https://x/avatar" });
	await env.db.sortedSetAdd("email:uid", 9, "t@example.com");
	await env.db.sortedSetAdd("email:sorted", 0, "t@example.com:9");

	const calls = stockLikeLogin(env, { nextUid: 10 });
	const cb = await manualLoginCallback(env, {});
	assert.strictEqual(cb.user.uid, 10, "email fallback no longer resurrects the ghost");
	assert.strictEqual(calls.length, 2);
	assert.strictEqual(await env.db.sortedSetScore("email:uid", "t@example.com"), 10, "email now maps to the new uid");
	const sorted = await env.db.getSortedSetMembers("email:sorted");
	assert.ok(!sorted.includes("t@example.com:9"), "stale email:sorted member scrubbed");
	assert.strictEqual(dbObjects.get("user:10").username, "CoyoTech");
});

test("an unhealable link (re-login still resolves a ghost) fails the login instead of looping", async () => {
	const env = await bootEnv({ id: "bgs-ghost", displayName: "CoyoTech" });

	dbObjects.set("boardgamersId:uid", { "bgs-ghost": 9 });
	dbObjects.set("user:9", { fullname: "CoyoTech" });
	// A login that keeps resolving an incomplete account no matter what.
	env.stockOAuth.login = async () => {
		dbObjects.set("user:9", { fullname: "CoyoTech" });
		return { uid: 9 };
	};

	await assert.rejects(manualLoginCallback(env, {}), /could not heal stale forum link/);
});

test("a healthy linked account logs in with a single login call (guard is inert)", async () => {
	const env = await bootEnv({ id: "bgs-ok", displayName: "healthy" });

	let loginCalls = 0;
	env.stockOAuth.login = async () => {
		loginCalls += 1;
		dbObjects.set("user:5", { username: "healthy", userslug: "healthy" });
		return { uid: 5 };
	};

	const cb = await manualLoginCallback(env, {});
	assert.strictEqual(cb.user.uid, 5);
	assert.strictEqual(loginCalls, 1, "no heal, no second login");
});
