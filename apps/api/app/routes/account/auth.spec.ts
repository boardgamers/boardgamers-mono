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
function verifySocial(
	provider: string,
	profileId: string,
	currentUser?: unknown,
	profile?: { username?: string; profileUrl?: string },
): Promise<VerifyResult> {
	// oxlint-disable-next-line typescript/no-unsafe-type-assertion -- koa-passport types don't expose the strategy's _verify
	const strategy = passport._strategy(provider) as unknown as { _verify: (...args: unknown[]) => void };
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
	it("registers the github strategy", () => {
		assert.ok(passport._strategy("github"));
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

describe("Account API — Hugging Face social auth", () => {
	it("registers the huggingface strategy wired to HF's OAuth endpoints", () => {
		// oxlint-disable-next-line typescript/no-unsafe-type-assertion -- koa-passport types don't expose the strategy
		const strategy = passport._strategy("huggingface") as unknown as {
			_oauth2: { _authorizeUrl: string; _accessTokenUrl: string; _clientSecret?: string };
			_pkceMethod: string | false;
			_stateStore: { store(...args: unknown[]): void; verify(...args: unknown[]): void };
			userProfile: (accessToken: string, done: (err?: unknown, profile?: unknown) => void) => void;
		};
		assert.ok(strategy, "huggingface strategy must be registered");
		assert.strictEqual(strategy._oauth2._authorizeUrl, "https://huggingface.co/oauth/authorize");
		assert.strictEqual(strategy._oauth2._accessTokenUrl, "https://huggingface.co/oauth/token");
		assert.strictEqual(typeof strategy.userProfile, "function");
	});

	it("configures the huggingface strategy as a PKCE public client (no secret)", () => {
		// oxlint-disable-next-line typescript/no-unsafe-type-assertion -- koa-passport types don't expose the strategy
		const strategy = passport._strategy("huggingface") as unknown as {
			_oauth2: { _clientSecret?: string };
			_pkceMethod: string | false;
			_stateStore: { store(...args: unknown[]): void; verify(...args: unknown[]): void };
		};
		assert.ok(strategy);
		// PKCE on (S256) — passport-oauth2 requires state:true alongside it.
		assert.strictEqual(strategy._pkceMethod, "S256");
		assert.ok(strategy._stateStore, "pkce requires a state store");
		// No client secret configured: the strategy was built with undefined (not a placeholder).
		assert.strictEqual(strategy._oauth2._clientSecret, undefined);
	});

	it("other providers stay on the confidential-client flow (no PKCE)", () => {
		for (const provider of ["google", "discord", "facebook", "github"] as const) {
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

	it("the /huggingface entrypoint redirects to HF's authorize URL with a PKCE challenge", async () => {
		const res = await fetch(`${baseURL()}/api/account/auth/huggingface`, { redirect: "manual" });
		assert.strictEqual(res.status, 302);
		const location = res.headers.get("location") ?? "";
		assert.ok(
			location.startsWith("https://huggingface.co/oauth/authorize"),
			`expected redirect to HF authorize, got ${location}`,
		);
		const url = new URL(location);
		assert.ok(url.searchParams.get("client_id"), "client_id present");
		// PKCE: S256 challenge + method, plus a server-side state handle.
		assert.match(url.searchParams.get("code_challenge") ?? "", /^[A-Za-z0-9_-]{20,}$/);
		assert.strictEqual(url.searchParams.get("code_challenge_method"), "S256");
		assert.match(url.searchParams.get("state") ?? "", /^[A-Za-z0-9_-]{10,}$/);
	});

	after(() => db().dropDatabase());
});

describe("Account API — OAuth relay (redirect sharing)", () => {
	it("rejects a non-allowlisted returnTo on the relay start", async () => {
		const res = await fetch(
			`${baseURL()}/api/account/auth/huggingface?returnTo=${encodeURIComponent("https://evil.com")}`,
			{
				redirect: "manual",
			},
		);
		assert.strictEqual(res.status, 400);
		const body = await res.json();
		assert.match(body.message, /returnTo origin is not allowed/);
	});

	it("rejects lookalike hosts (evil-boardgamers.space) even though they contain the suffix", async () => {
		const res = await fetch(
			`${baseURL()}/api/account/auth/huggingface?returnTo=${encodeURIComponent("https://evil-boardgamers.space")}`,
			{ redirect: "manual" },
		);
		assert.strictEqual(res.status, 400);
	});

	// Drive the state store + consumeRelayReturnTo exactly as the live flow does:
	// start (capture returnTo+verifier) → verify (callback) → consume (bounce).
	it("carries an allowlisted returnTo through the OAuth state store, single-use", async () => {
		const returnTo = "https://pr-42.boardgamers.space";
		const res = await fetch(`${baseURL()}/api/account/auth/huggingface?returnTo=${encodeURIComponent(returnTo)}`, {
			redirect: "manual",
		});
		assert.strictEqual(res.status, 302);
		const location = res.headers.get("location") ?? "";
		const state = new URL(location).searchParams.get("state");
		assert.ok(state, "state handle present on the authorize URL");

		// oxlint-disable-next-line typescript/no-unsafe-type-assertion -- strategy internals
		const strategy = passport._strategy("huggingface") as unknown as {
			_stateStore: { verify(req: unknown, handle: string, cb: (err: unknown, ok?: unknown) => void): void };
		};
		const verifier = await new Promise((resolve, reject) => {
			strategy._stateStore.verify({}, state, (err: unknown, ok?: unknown) => (err ? reject(err) : resolve(ok)));
		});
		assert.ok(typeof verifier === "string" && verifier.length > 0, "code verifier recovered from state");

		// The verified state surfaces its returnTo exactly once.
		// oxlint-disable-next-line typescript/no-unsafe-type-assertion -- augmented in config/passport.ts
		const p = passport as unknown as { consumeRelayReturnTo(h: unknown): string | undefined };
		assert.strictEqual(p.consumeRelayReturnTo(state), returnTo);
		assert.strictEqual(p.consumeRelayReturnTo(state), undefined, "returnTo is single-use");

		// A replayed state handle fails verification outright.
		const replay = await new Promise((resolve) => {
			strategy._stateStore.verify({}, state, (_err: unknown, ok?: unknown) => resolve(ok));
		});
		assert.strictEqual(replay, false, "replayed state must fail");
	});

	it("exchange-code rejects an unknown code", async () => {
		const res = await fetch(`${baseURL()}/api/account/auth/relay/exchange-code`, {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({ code: "nope" }),
		});
		assert.strictEqual(res.status, 401);
	});

	it("the callback redirects to the allowlisted returnTo with a one-time code, which exchanges to auth info", async () => {
		// Seed a user the social login will resolve to.
		await colls.users.insertOne(
			testUser({ account: { username: "relayuser", email: "relay@test.com", social: { huggingface: "hf-relay-1" } } }),
		);

		// Build the user the way the verify callback would for an existing social account.
		const { user } = await verifySocial("huggingface", "hf-relay-1");
		isUserDoc(user);

		// Run the prod-side bounce directly (same function the callback route calls) and
		// capture the redirect target it produces.
		const { relayCallbackRedirect } = await import("./auth.ts");
		const returnTo = "https://pr-7.boardgamers.space";
		// oxlint-disable-next-line typescript/no-unsafe-type-assertion -- minimal ctx stub
		const ctx = {
			state: { user },
			redirectedTo: "",
			redirect(location: string) {
				this.redirectedTo = location;
			},
		} as unknown as Parameters<typeof relayCallbackRedirect>[0] & { redirectedTo: string };
		await relayCallbackRedirect(ctx, "huggingface", returnTo);
		const target = new URL(ctx.redirectedTo);
		assert.strictEqual(target.origin, returnTo);
		const code = target.searchParams.get("oauthCode");
		assert.ok(code, "one-time code attached to the bounce URL");

		// The preview exchanges the code on ITS OWN api (same process here) and gets auth info.
		const exchange = await fetch(`${baseURL()}/api/account/auth/relay/exchange-code`, {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({ code }),
		});
		assert.strictEqual(exchange.status, 200);
		const auth = await exchange.json();
		assert.strictEqual(auth.user.account.username, "relayuser");
		assert.ok(auth.accessToken.code, "access token minted");

		// The code is single-use.
		const replay = await fetch(`${baseURL()}/api/account/auth/relay/exchange-code`, {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({ code }),
		});
		assert.strictEqual(replay.status, 401);
	});

	it("relayCallbackRedirect rejects a non-allowlisted returnTo", async () => {
		const { relayCallbackRedirect } = await import("./auth.ts");
		// oxlint-disable-next-line typescript/no-unsafe-type-assertion -- minimal ctx stub
		const ctx = {
			state: { user: { _id: "x" } },
			redirect() {
				throw new Error("must not redirect");
			},
		} as unknown as Parameters<typeof relayCallbackRedirect>[0];
		await assert.rejects(() => relayCallbackRedirect(ctx, "huggingface", "https://evil.com"), /not allowed/);
	});

	after(() => db().dropDatabase());
});
