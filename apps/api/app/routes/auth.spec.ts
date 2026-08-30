import assert from "node:assert/strict";
import { after, describe, it } from "node:test";
import jwt from "jsonwebtoken";
import passport from "koa-passport";
import type { WithId } from "mongodb";
import type { UserDoc } from "@bgs/models";
import "../config/passport.ts";
import { colls, db } from "../config/db.ts";
import env from "../config/env.ts";
import { testUser } from "../config/test-helpers.ts";
import { lookupRefreshToken } from "../models/jwtrefreshtokens.ts";
import { verifySocialProfile } from "../config/passport.ts";
import { createOAuthState, verifyOAuthState } from "../models/oauthflows.ts";

type SocialFeedback = {
	createSocialAccount: boolean;
	provider: string;
	id: string;
	socialMeta?: { username: string; url: string; avatarUrl?: string };
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

// Calls verifySocialProfile directly — the same function the passport verify callbacks
// and the PKCE callback handler both use.
async function verifySocial(
	provider: "discord" | "google" | "facebook" | "github" | "huggingface",
	profileId: string,
	currentUser?: WithId<UserDoc>,
	profile?: {
		username?: string;
		profileUrl?: string;
		photos?: { value: string }[];
		avatar?: string | null;
		avatarUrl?: string;
	},
): Promise<{ err?: unknown; user?: unknown }> {
	try {
		const user = await verifySocialProfile(provider, { user: currentUser }, { id: profileId, ...profile });
		return { user };
	} catch (err) {
		return { err };
	}
}

const baseURL = () => `http://${env.listen.host}:${env.listen.port.api}`;

describe("Account API — GitHub social auth", () => {
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
		assert.ok(!("email" in doc.account), "account.email must be ABSENT when the provider returned none");
	});

	it("lets TWO no-email social signups coexist (no E11000 on the sparse account.email index)", async () => {
		// Regression: the unique sparse index on account.email skips docs where the field is
		// ABSENT but indexes "" — storing "" used to make every second no-email social
		// signup fail with E11000.
		for (const [socialId, username] of [
			["gh-noemail-1", "ghnoemail1"],
			["gh-noemail-2", "ghnoemail2"],
		] as const) {
			const { err, user } = await verifySocial("github", socialId);
			assert.ifError(err);
			isSocialFeedback(user);

			const token = jwt.sign(user, env.jwt.keys.private, { expiresIn: "1h", algorithm: env.jwt.algorithm });
			const res = await fetch(`${baseURL()}/api/account/signup/social`, {
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({ jwt: token, username, termsAndConditions: true }),
			});
			const text = await res.text();
			assert.strictEqual(res.status, 200, `no-email social signup failed: ${res.status} ${text}`);
		}

		const docs = await colls.users.find({ "account.username": { $in: ["ghnoemail1", "ghnoemail2"] } }).toArray();
		assert.strictEqual(docs.length, 2, "both no-email social signups must succeed");
		for (const doc of docs) {
			assert.ok(!("email" in doc.account), `account.email must be absent on ${doc.account.username}`);
		}
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
	it("google/discord/facebook stay on the confidential-client passport flow (no PKCE)", () => {
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

describe("Account API — social avatar URL capture (Codeberg #34)", () => {
	const link = async (username: string) => {
		const doc = await colls.users.insertOne(testUser({ account: { username, email: `${username}@test.com` } }));
		const current = await colls.users.findOne({ _id: doc.insertedId });
		return { userId: doc.insertedId, current: current! };
	};

	it("builds the discord avatar URL from the CDN hash on link", async () => {
		const { userId, current } = await link("avcap1");
		const { err } = await verifySocial("discord", "d-av-1", current, { username: "gamer", avatar: "abc123" });
		assert.ifError(err);
		const stored = await colls.users.findOne({ _id: userId });
		assert.deepStrictEqual(stored?.account.socialMeta?.discord, {
			username: "gamer",
			url: "https://discord.com/users/d-av-1",
			avatarUrl: "https://cdn.discordapp.com/avatars/d-av-1/abc123.png?size=256",
		});
	});

	it("stores no avatarUrl for a default discord avatar (null hash)", async () => {
		const { userId, current } = await link("avcap2");
		const { err } = await verifySocial("discord", "d-av-2", current, { username: "gamer2", avatar: null });
		assert.ifError(err);
		const stored = await colls.users.findOne({ _id: userId });
		assert.deepStrictEqual(stored?.account.socialMeta?.discord, {
			username: "gamer2",
			url: "https://discord.com/users/d-av-2",
		});
	});

	it("captures the google avatar from the passport photos convention (no profile URL needed)", async () => {
		const { userId, current } = await link("avcap3");
		const { err } = await verifySocial("google", "g-av-1", current, {
			photos: [{ value: "https://lh3.googleusercontent.com/a/token=s96-c" }],
		});
		assert.ifError(err);
		const stored = await colls.users.findOne({ _id: userId });
		assert.deepStrictEqual(stored?.account.socialMeta?.google, {
			username: "g-av-1",
			avatarUrl: "https://lh3.googleusercontent.com/a/token=s96-c",
		});
	});

	it("drops avatar URLs that are not https on the provider's known CDN", async () => {
		const { userId, current } = await link("avcap4");
		const { err } = await verifySocial("github", "gh-av-1", current, {
			username: "octocat",
			profileUrl: "https://github.com/octocat",
			avatarUrl: "https://evil.example/avatar.png",
		});
		assert.ifError(err);
		const stored = await colls.users.findOne({ _id: userId });
		assert.deepStrictEqual(stored?.account.socialMeta?.github, {
			username: "octocat",
			url: "https://github.com/octocat",
		});
	});

	it("drops a huggingface avatar URL outside the known /avatars/ path at capture", async () => {
		// Bare huggingface.co also serves arbitrary user repo content — only the
		// default-avatar path shape from the OIDC `picture` claim is acceptable.
		const { userId, current } = await link("avcap6");
		const { err } = await verifySocial("huggingface", "hf-av-1", current, {
			username: "hfuser6",
			avatarUrl: "https://huggingface.co/someuser/somerepo/resolve/main/payload.png",
		});
		assert.ifError(err);
		const stored = await colls.users.findOne({ _id: userId });
		assert.deepStrictEqual(stored?.account.socialMeta?.huggingface, {
			username: "hfuser6",
			url: "https://huggingface.co/hfuser6",
		});
	});

	it("refreshes stale meta on login (rotated discord avatar hash)", async () => {
		const { userId, current } = await link("avcap5");
		await verifySocial("discord", "d-av-5", current, { username: "gamer5", avatar: "oldhash" });

		// Login (no current user) with a new hash: the stored URL must follow.
		const { err, user } = await verifySocial("discord", "d-av-5", undefined, { username: "gamer5", avatar: "newhash" });
		assert.ifError(err);
		isUserDoc(user);
		const stored = await colls.users.findOne({ _id: userId });
		assert.strictEqual(
			stored?.account.socialMeta?.discord?.avatarUrl,
			"https://cdn.discordapp.com/avatars/d-av-5/newhash.png?size=256",
		);
	});

	after(() => db().dropDatabase());
});

describe("Account API — PKCE authorize redirects", () => {
	it("the /github entrypoint redirects to GitHub's authorize URL with a PKCE challenge", async () => {
		const res = await fetch(`${baseURL()}/auth/github`, { redirect: "manual" });
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
		const res = await fetch(`${baseURL()}/auth/huggingface`, { redirect: "manual" });
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

	it("the HF handshake advertises the top-level /auth callback (#248)", async () => {
		// Regression: the callback must be /auth/huggingface/callback — historically it
		// moved from the bare /auth/… (which nginx routed to the web SPA → 404, #138 bug)
		// to /api/account/auth/…, and #248 moved it back to /auth/… (now api-served).
		const res = await fetch(`${baseURL()}/auth/huggingface`, { redirect: "manual" });
		const url = new URL(res.headers.get("location") ?? "");
		const redirectUri = new URL(url.searchParams.get("redirect_uri") ?? "");
		assert.strictEqual(
			redirectUri.pathname,
			"/auth/huggingface/callback",
			"redirect_uri must be the api-mounted /auth callback (requires nginx to route /auth/* to the api)",
		);
		assert.strictEqual(redirectUri.hostname, new URL(baseURL()).hostname);
	});

	it("the api-mounted callback route exists (a bad code fails the handshake, not 404)", async () => {
		// Hitting the real callback path must reach the api router. With an invalid/unknown
		// state the PKCE flow throws → the global error handler records it and returns
		// the error message (it must NOT be a 404 from an unmounted route).
		const res = await fetch(`${baseURL()}/auth/huggingface/callback?code=nope&state=nope`, {
			redirect: "manual",
		});
		assert.notStrictEqual(res.status, 404, "callback route must be mounted (not 404)");
		assert.strictEqual(res.status, 403, "invalid state → 403, got " + res.status);
		// oxlint-disable-next-line typescript/no-unsafe-type-assertion -- trusted own-endpoint shape
		const body = (await res.json()) as { message: string };
		assert.match(body.message, /PKCE state invalid or expired/);
	});

	it("persists the PKCE state server-side in Mongo, single-use", async () => {
		const res = await fetch(`${baseURL()}/auth/huggingface`, { redirect: "manual" });
		const state = new URL(res.headers.get("location") ?? "").searchParams.get("state");
		assert.ok(state, "state handle present on the authorize URL");

		// The state is in Mongo (survives restarts / readable from any process).
		const stored = await colls.oauthFlows.findOne({ _id: state });
		assert.ok(stored, "state persisted in the oauthflows collection");
		assert.strictEqual(stored.kind, "oauth-state");

		// The stored verifier round-trips through verifyOAuthState exactly once.
		const verifier = await verifyOAuthState(state);
		assert.ok(typeof verifier === "string" && verifier.length > 0, "code verifier recovered from state");
		assert.strictEqual(await verifyOAuthState(state), false, "replayed state must fail");
	});

	it("the old relay routes are gone (no /relay/callback, no returnTo)", async () => {
		const res = await fetch(`${baseURL()}/auth/relay/callback?code=nope`, { redirect: "manual" });
		// koa-router matches /:provider/callback for "relay" → PKCE callback without a
		// valid state → 303 to /login?error=. Either way it must NOT be a relay exchange.
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
			`${baseURL()}/auth/huggingface?returnTo=${encodeURIComponent("https://pr-42.boardgamers.space")}`,
			{ redirect: "manual" },
		);
		assert.strictEqual(res.status, 302);
		const url = new URL(res.headers.get("location") ?? "");
		// The handshake is for THIS env's CIMD client, not a prod one.
		assert.strictEqual(url.searchParams.get("client_id"), `${baseURL()}/.well-known/oauth-cimd`);
	});
});

// A Koa ctx stub shaped for finishSocialAuth: cookie capture + redirect capture.
// `cookies.set` keys the jar by name+domain like a browser: setRefreshCookie sets the
// host-only cookie AND clears the legacy Domain= one (#153) — a name-only jar would
// let the clear wipe the set. (The Domain variant stays out of `jar`, which models
// the cookies the browser sends back on the response host.)
function makeCtx(user: unknown) {
	const jar: Record<string, string> = {};
	const clearedDomains: string[] = [];
	return {
		state: { user },
		protocol: "http",
		host: "bgs.test",
		hostname: "bgs.test",
		status: 0,
		jar,
		clearedDomains,
		cookies: {
			set(name: string, value: string | null, opts?: { domain?: string }) {
				if (opts?.domain) {
					// The Domain variant is a distinct cookie never sent back to this host —
					// keep it out of `jar`, just record the clear (see above).
					if (value === null) {
						clearedDomains.push(opts.domain);
					}
				} else if (value === null) {
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
		// The transitional legacy-Domain cleanup rides along (#153, removal tracked in #283).
		assert.deepStrictEqual(ctx.clearedDomains, [env.domain]);
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

describe("Account API — PKCE OAuth round-trip", () => {
	// These tests drive the REAL Koa app routes over HTTP against a mocked fetch
	// (for the token exchange + userinfo calls). The PKCE flow is hand-rolled in
	// config/pkce.ts — no passport involved.

	const originalFetch = globalThis.fetch;

	function mockPkceEndpoints(profile: object) {
		globalThis.fetch = async (input, init) => {
			const url = typeof input === "string" ? input : input.url;
			if (url.includes("/oauth/token") || url.includes("/login/oauth/access_token")) {
				return new Response(JSON.stringify({ access_token: "mock-access-token" }), {
					status: 200,
					headers: { "content-type": "application/json" },
				});
			}
			if (url.includes("/oauth/userinfo") || url.includes("api.github.com/user")) {
				return new Response(JSON.stringify(profile), {
					status: 200,
					headers: { "content-type": "application/json" },
				});
			}
			return originalFetch(input, init);
		};
	}

	function restoreFetch() {
		globalThis.fetch = originalFetch;
	}

	// Hit the real callback route with a valid PKCE state.
	async function pkceCallbackReq(provider: string, state: string) {
		return fetch(`${baseURL()}/auth/${provider}/callback?code=pkce-code&state=${state}`, {
			redirect: "manual",
		});
	}

	it("a NEW HF user completes the handshake → 303 to /signup?ticket=", async () => {
		const state = await createOAuthState({ codeVerifier: "v", expiresAt: new Date(Date.now() + 60000) });

		mockPkceEndpoints({ sub: "hf-e2e-new", preferred_username: "hugger" });
		try {
			const res = await pkceCallbackReq("huggingface", state);
			assert.strictEqual(res.status, 303, `expected 303, got ${res.status}`);
			const location = res.headers.get("location") ?? "";
			assert.match(
				location,
				/\/signup\?ticket=/,
				`new HF user should be sent to signup with a ticket, got ${location}`,
			);
			assert.ok(!res.headers.get("set-cookie"), "no session cookie before signup completes");
		} finally {
			restoreFetch();
		}
	});

	it("an EXISTING HF user gets a session cookie + 303 to /account", async () => {
		await colls.users.insertOne(
			testUser({
				account: { username: "existinghf", email: "existinghf@test.com", social: { huggingface: "hf-e2e-old" } },
			}),
		);
		const state = await createOAuthState({ codeVerifier: "v", expiresAt: new Date(Date.now() + 60000) });

		mockPkceEndpoints({ sub: "hf-e2e-old", preferred_username: "hugger" });
		try {
			const res = await pkceCallbackReq("huggingface", state);
			assert.strictEqual(res.status, 303, `expected 303, got ${res.status}`);
			assert.match(res.headers.get("location") ?? "", /\/account$/, "existing user should land on /account");
			assert.match(res.headers.get("set-cookie") ?? "", /refreshToken=/, "session cookie set on the callback response");
		} finally {
			restoreFetch();
		}
	});

	it("PKCE state is single-use: replaying the callback state → 403 with a clear message", async () => {
		await colls.users.insertOne(
			testUser({
				account: { username: "replayhf", email: "replayhf@test.com", social: { huggingface: "hf-e2e-replay" } },
			}),
		);
		const state = await createOAuthState({ codeVerifier: "v", expiresAt: new Date(Date.now() + 60000) });

		mockPkceEndpoints({ sub: "hf-e2e-replay", preferred_username: "hugger" });
		try {
			const first = await pkceCallbackReq("huggingface", state);
			assert.strictEqual(first.status, 303);
			assert.match(first.headers.get("location") ?? "", /\/account$/, "first handshake succeeds");
		} finally {
			restoreFetch();
		}

		// Replay the same state: verifyOAuthState already consumed it → 403.
		const second = await pkceCallbackReq("huggingface", state);
		assert.strictEqual(second.status, 403);
		// oxlint-disable-next-line typescript/no-unsafe-type-assertion -- trusted own-endpoint shape
		const body = (await second.json()) as { message: string };
		assert.match(body.message, /PKCE state invalid or expired/);
	});

	it("an EXISTING GitHub user gets a session cookie + 303 to /account", async () => {
		await colls.users.insertOne(
			testUser({
				account: { username: "ghuser2", email: "gh2@test.com", social: { github: "gh-e2e-old" } },
			}),
		);
		const state = await createOAuthState({ codeVerifier: "v", expiresAt: new Date(Date.now() + 60000) });

		mockPkceEndpoints({
			id: "gh-e2e-old",
			login: "ghuser2",
			html_url: "https://github.com/ghuser2",
			avatar_url: "https://avatars.githubusercontent.com/u/9919?v=4",
		});
		try {
			const res = await pkceCallbackReq("github", state);
			assert.strictEqual(res.status, 303, `expected 303, got ${res.status}`);
			assert.match(res.headers.get("location") ?? "", /\/account$/, "existing user should land on /account");
			assert.match(res.headers.get("set-cookie") ?? "", /refreshToken=/, "session cookie set on the callback response");
		} finally {
			restoreFetch();
		}

		// The userinfo's avatar_url was captured (backfilled on login) into socialMeta.
		const stored = await colls.users.findOne({ "account.social.github": "gh-e2e-old" });
		assert.strictEqual(
			stored?.account.socialMeta?.github?.avatarUrl,
			"https://avatars.githubusercontent.com/u/9919?v=4",
		);
	});

	it("a NEW GitHub user completes the handshake → 303 to /signup?ticket=", async () => {
		const state = await createOAuthState({ codeVerifier: "v", expiresAt: new Date(Date.now() + 60000) });

		mockPkceEndpoints({ id: "gh-e2e-new", login: "newgh", html_url: "https://github.com/newgh" });
		try {
			const res = await pkceCallbackReq("github", state);
			assert.strictEqual(res.status, 303, `expected 303, got ${res.status}`);
			const location = res.headers.get("location") ?? "";
			assert.match(
				location,
				/\/signup\?ticket=/,
				`new GH user should be sent to signup with a ticket, got ${location}`,
			);
			assert.ok(!res.headers.get("set-cookie"), "no session cookie before signup completes");
		} finally {
			restoreFetch();
		}
	});

	it("a bad token exchange → 502 with the provider's error message", async () => {
		const state = await createOAuthState({ codeVerifier: "v", expiresAt: new Date(Date.now() + 60000) });

		// Mock the token endpoint to return an error
		globalThis.fetch = async (input, init) => {
			const url = typeof input === "string" ? input : input.url;
			if (url.includes("/oauth/token") || url.includes("/login/oauth/access_token")) {
				return new Response("bad request", { status: 400 });
			}
			return originalFetch(input, init);
		};
		try {
			const res = await pkceCallbackReq("huggingface", state);
			assert.strictEqual(res.status, 502);
			// oxlint-disable-next-line typescript/no-unsafe-type-assertion -- trusted own-endpoint shape
			const body = (await res.json()) as { message: string };
			assert.match(body.message, /huggingface token exchange failed/);
		} finally {
			restoreFetch();
		}
	});

	it("a provider error redirect (?error=access_denied) → 403 with the description", async () => {
		const res = await fetch(
			`${baseURL()}/auth/github/callback?error=access_denied&error_description=The+user+denied+access`,
			{ redirect: "manual" },
		);
		assert.strictEqual(res.status, 403);
		// oxlint-disable-next-line typescript/no-unsafe-type-assertion -- trusted own-endpoint shape
		const body = (await res.json()) as { message: string };
		assert.match(body.message, /github: The user denied access/);
	});

	it("a provider error redirect without description → 403 with the error code", async () => {
		const res = await fetch(`${baseURL()}/auth/github/callback?error=server_error`, {
			redirect: "manual",
		});
		assert.strictEqual(res.status, 403);
		// oxlint-disable-next-line typescript/no-unsafe-type-assertion -- trusted own-endpoint shape
		const body = (await res.json()) as { message: string };
		assert.match(body.message, /github: server_error/);
	});

	after(() => db().dropDatabase());
});
