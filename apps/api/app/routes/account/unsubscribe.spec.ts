// Run via `pnpm test` (the package.json script), NOT bare `node --test` — see
// routes/game/index.spec.ts. Covers the signed unsubscribe links (#2): stateless
// HMAC tokens of {userId, scope}, verified server-side, no login required.
import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { ObjectId } from "mongodb";
import { colls, db } from "../../config/db.ts";
import env from "../../config/env.ts";
import { testUser } from "../../config/test-helpers.ts";
import { applyUnsubscribe, signUnsubscribeToken, unsubscribeUrl, verifyUnsubscribeToken } from "../../models/user.ts";

const baseURL = () => `http://${env.listen.host}:${env.listen.port.api}`;

describe("Signed unsubscribe tokens (#2)", () => {
	const userId = new ObjectId();

	it("mints a token that verifies back to the same {userId, scope}", () => {
		for (const scope of ["game", "newsletter"] as const) {
			assert.deepEqual(verifyUnsubscribeToken(signUnsubscribeToken(userId.toHexString(), scope)), {
				userId: userId.toHexString(),
				scope,
			});
		}
	});

	it("rejects tampered, wrong-scope, wrong-user and malformed tokens", () => {
		const id = userId.toHexString();
		const token = signUnsubscribeToken(id, "game");
		const [uid, scope, sig] = token.split(".");

		assert.equal(verifyUnsubscribeToken(`${uid}.newsletter.${sig}`), null, "signature doesn't cross scopes");
		assert.equal(verifyUnsubscribeToken(`${new ObjectId().toHexString()}.${scope}.${sig}`), null, "nor users");
		assert.equal(verifyUnsubscribeToken(`${uid}.${scope}.${sig.slice(0, -2)}aa`), null, "tampered signature");
		assert.equal(verifyUnsubscribeToken(`${uid}.admin.${sig}`), null, "unknown scope");
		assert.equal(verifyUnsubscribeToken("not-a-token"), null);
		assert.equal(verifyUnsubscribeToken(`${uid}.${scope}.${sig}.extra`), null, "no extra segments");
		assert.equal(verifyUnsubscribeToken(`deadbeef.${scope}.${sig}`), null, "invalid user id");
	});

	it("unsubscribeUrl embeds the signed token and points at the web landing page", () => {
		const url = unsubscribeUrl(userId.toHexString(), "game");
		assert.ok(url.startsWith(`https://${env.site}/unsubscribe?token=`));
		const token = new URL(url).searchParams.get("token")!;
		assert.deepEqual(verifyUnsubscribeToken(token), { userId: userId.toHexString(), scope: "game" });
	});
});

describe("Unsubscribe API (#2)", () => {
	const gameUserId = new ObjectId();
	const newsUserId = new ObjectId();
	const gameToken = () => signUnsubscribeToken(gameUserId.toHexString(), "game");
	const newsToken = () => signUnsubscribeToken(newsUserId.toHexString(), "newsletter");

	before(async () => {
		await db().dropDatabase();
		await colls.users.insertMany([
			testUser({
				_id: gameUserId,
				account: { username: "unsub-game" },
				settings: { mailing: { game: { activated: true }, newsletter: true } },
				meta: { nextGameNotification: new Date(Date.now() + 3600_000) },
			}),
			testUser({
				_id: newsUserId,
				account: { username: "unsub-news" },
				settings: { mailing: { game: { activated: true }, newsletter: true } },
			}),
		]);
	});

	after(() => db().dropDatabase());

	it("GET /unsubscribe/:token returns the scope + username without a login", async () => {
		const res = await fetch(`${baseURL()}/api/account/unsubscribe/${gameToken()}`);
		assert.equal(res.status, 200);
		assert.deepEqual(await res.json(), { scope: "game", username: "unsub-game" });
	});

	it("POST /unsubscribe flips game notifications off (and clears the pending notification)", async () => {
		const res = await fetch(`${baseURL()}/api/account/unsubscribe`, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ token: gameToken() }),
		});
		assert.equal(res.status, 200);
		const user = (await colls.users.findOne({ _id: gameUserId }))!;
		assert.equal(user.settings?.mailing?.game?.activated, false);
		assert.equal(user.settings?.mailing?.newsletter, true, "other mailing settings untouched");
		assert.equal(user.meta?.nextGameNotification, undefined);
	});

	it("a newsletter-scoped token flips the newsletter setting, not game notifications", async () => {
		const res = await fetch(`${baseURL()}/api/account/unsubscribe`, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ token: newsToken() }),
		});
		assert.equal(res.status, 200);
		const user = (await colls.users.findOne({ _id: newsUserId }))!;
		assert.equal(user.settings?.mailing?.newsletter, false);
		assert.equal(user.settings?.mailing?.game?.activated, true, "game notifications untouched");
	});

	it("rejects tampered and wrong-scope-replay tokens with 404, changing nothing", async () => {
		const [uid, , sig] = newsToken().split(".");
		for (const bad of [`${uid}.game.${sig}`, `${uid}.newsletter.${sig.slice(0, -2)}aa`, "garbage"]) {
			const res = await fetch(`${baseURL()}/api/account/unsubscribe`, {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ token: bad }),
			});
			assert.equal(res.status, 404, bad);
		}
		const user = (await colls.users.findOne({ _id: newsUserId }))!;
		assert.equal(user.settings?.mailing?.game?.activated, true);
	});

	it("404s on a token for a deleted user", async () => {
		const ghost = signUnsubscribeToken(new ObjectId().toHexString(), "game");
		const res = await fetch(`${baseURL()}/api/account/unsubscribe/${ghost}`);
		assert.equal(res.status, 404);
	});

	it("GET /unsubscribe?token= only describes the token — no state change on GET (prefetch-safe)", async () => {
		const target = new ObjectId();
		await colls.users.insertOne(
			testUser({
				_id: target,
				account: { username: "unsub-get" },
				settings: { mailing: { game: { activated: true } } },
			}),
		);
		const token = signUnsubscribeToken(target.toHexString(), "game");
		const res = await fetch(`${baseURL()}/api/account/unsubscribe?token=${encodeURIComponent(token)}`);
		assert.equal(res.status, 200);
		assert.deepEqual(await res.json(), { scope: "game", username: "unsub-get" });
		assert.equal(
			(await colls.users.findOne({ _id: target }))!.settings?.mailing?.game?.activated,
			true,
			"a GET must never apply the unsubscribe (mail-scanner prefetch)",
		);
	});

	it("applyUnsubscribe is idempotent", async () => {
		await applyUnsubscribe(gameUserId.toHexString(), "game");
		const user = (await colls.users.findOne({ _id: gameUserId }))!;
		assert.equal(user.settings?.mailing?.game?.activated, false);
	});

	// --- RFC 8058 one-click (the List-Unsubscribe header target) ---------------

	function oneClickUser() {
		const id = new ObjectId();
		return {
			id,
			insert: () =>
				colls.users.insertOne(
					testUser({
						_id: id,
						account: { username: `unsub-oneclick-${id.toHexString().slice(-4)}` },
						settings: { mailing: { game: { activated: true } } },
					}),
				),
			token: () => signUnsubscribeToken(id.toHexString(), "game"),
		};
	}

	function postOneClick(token: string, body: string | null) {
		return fetch(`${baseURL()}/api/account/unsubscribe/one-click?token=${encodeURIComponent(token)}`, {
			method: "POST",
			...(body === null ? {} : { headers: { "Content-Type": "application/x-www-form-urlencoded" }, body }),
		});
	}

	it("POST one-click with the RFC 8058 form body applies the unsubscribe", async () => {
		const u = oneClickUser();
		await u.insert();
		const res = await postOneClick(u.token(), "List-Unsubscribe=One-Click");
		assert.equal(res.status, 200);
		assert.equal((await colls.users.findOne({ _id: u.id }))!.settings?.mailing?.game?.activated, false);
	});

	it("POST one-click WITHOUT the RFC body is a 400 and changes nothing (scanner replay)", async () => {
		const u = oneClickUser();
		await u.insert();
		for (const body of [null, "", "List-Unsubscribe=Two-Clicks", "foo=bar"]) {
			const res = await postOneClick(u.token(), body);
			assert.equal(res.status, 400, JSON.stringify(body));
		}
		assert.equal((await colls.users.findOne({ _id: u.id }))!.settings?.mailing?.game?.activated, true);
	});

	it("POST one-click with a tampered token 404s without applying", async () => {
		const u = oneClickUser();
		await u.insert();
		const res = await postOneClick(`${u.token()}aa`, "List-Unsubscribe=One-Click");
		assert.equal(res.status, 404);
		assert.equal((await colls.users.findOne({ _id: u.id }))!.settings?.mailing?.game?.activated, true);
	});

	it("GET one-click redirects to the landing page without applying (browser opening the header URL)", async () => {
		const u = oneClickUser();
		await u.insert();
		const token = u.token();
		const res = await fetch(`${baseURL()}/api/account/unsubscribe/one-click?token=${encodeURIComponent(token)}`, {
			redirect: "manual",
		});
		assert.equal(res.status, 302);
		assert.equal(res.headers.get("location"), `https://${env.site}/unsubscribe?token=${token}`);
		assert.equal(
			(await colls.users.findOne({ _id: u.id }))!.settings?.mailing?.game?.activated,
			true,
			"a GET must never apply the unsubscribe",
		);
	});
});
