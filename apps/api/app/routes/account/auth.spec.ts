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
			_oauth2: { _authorizeUrl: string; _accessTokenUrl: string };
			userProfile: (accessToken: string, done: (err?: unknown, profile?: unknown) => void) => void;
		};
		assert.ok(strategy, "huggingface strategy must be registered");
		assert.strictEqual(strategy._oauth2._authorizeUrl, "https://huggingface.co/oauth/authorize");
		assert.strictEqual(strategy._oauth2._accessTokenUrl, "https://huggingface.co/oauth/token");
		assert.strictEqual(typeof strategy.userProfile, "function");
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

	it("the /huggingface entrypoint redirects to HF's authorize URL", async () => {
		const res = await fetch(`${baseURL()}/api/account/auth/huggingface`, { redirect: "manual" });
		assert.strictEqual(res.status, 302);
		const location = res.headers.get("location") ?? "";
		assert.ok(
			location.startsWith("https://huggingface.co/oauth/authorize"),
			`expected redirect to HF authorize, got ${location}`,
		);
		assert.match(location, /client_id=/);
	});

	after(() => db().dropDatabase());
});
