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

test("a stale boardgamersId:uid entry (ghost uid, no username) is healed: link dropped, login re-run", async () => {
	const env = await bootEnv({ id: "bgs-ghost", displayName: "CoyoTech" });

	// The stale state: the map still points bgs-ghost → uid 9, but user:9 was
	// deleted (only a partial doc remains, as updateProfile re-creates it).
	dbObjects.set("boardgamersId:uid", { "bgs-ghost": 9 });
	dbObjects.set("user:9", { fullname: "CoyoTech", picture: "https://x/avatar" });

	const loginCalls = [];
	env.stockOAuth.login = async (payload) => {
		loginCalls.push({
			linkEntry: (dbObjects.get("boardgamersId:uid") || {})["bgs-ghost"],
			ghostDoc: dbObjects.has("user:9"),
		});
		if (loginCalls.length === 1) {
			// Stock behaviour on a stale link: return the mapped uid unchecked.
			return { uid: 9 };
		}
		// Second call: the link is gone, so the real plugin takes the CREATE
		// path — a full user with a username, and a fresh map entry.
		dbObjects.set("user:9", { username: payload.handle, userslug: payload.handle.toLowerCase() });
		dbObjects.set("boardgamersId:uid", { [payload.oAuthid]: 9 });
		return { uid: 9 };
	};

	const cb = await manualLoginCallback(env, {});
	assert.strictEqual(cb.user.uid, 9, "logged into the re-created account");
	assert.strictEqual(loginCalls.length, 2, "login re-ran after the heal");
	// First call saw the stale state…
	assert.strictEqual(loginCalls[0].linkEntry, 9);
	assert.strictEqual(loginCalls[0].ghostDoc, true);
	// …the re-run saw the healed state: no map entry, no partial doc.
	assert.strictEqual(loginCalls[1].linkEntry, undefined, "stale map entry dropped before the re-run");
	assert.strictEqual(loginCalls[1].ghostDoc, false, "partial user doc dropped before the re-run");
	// And the re-created account is intact.
	assert.strictEqual(dbObjects.get("user:9").username, "CoyoTech");
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
