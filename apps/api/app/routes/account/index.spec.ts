// Run via `pnpm test` (the package.json script), NOT bare `node --test`. The script
// imports app/config/test-hooks.ts, which connects to the *-test database and starts
// the API server.
import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { ObjectId } from "mongodb";
import bcrypt from "bcryptjs";
import sharp from "sharp";
import { z } from "zod";
import { colls, db } from "../../config/db.ts";
import env from "../../config/env.ts";
import { setSendmailForTests, type MailSendData } from "../../config/sendmail.ts";
import { testUser, testGamePrefs } from "../../config/test-helpers.ts";
import { createAccessToken, generateRefreshCode, hashRefreshCode } from "../../models/jwtrefreshtokens.ts";
import { setWebhookFetchForTests, type WebhookCall } from "../../models/user.ts";
import { interceptS3Fetches, makeS3Mock } from "../../services/s3-mock.ts";
import { s3Fetch, setS3ClientsForTests } from "../../services/s3.ts";

const baseURL = () => `http://${env.listen.host}:${env.listen.port.api}`;

async function api(method: string, path: string, body?: unknown, headers?: Record<string, string>) {
	const res = await fetch(`${baseURL()}${path}`, {
		method,
		headers: { "Content-Type": "application/json", ...headers },
		body: body ? JSON.stringify(body) : undefined,
	});
	const data: unknown = res.headers.get("content-type")?.includes("application/json")
		? await res.json()
		: await res.text();
	return { status: res.status, data, ok: res.ok };
}

const countryOf = (data: unknown) =>
	z.object({ account: z.object({ country: z.string().nullish() }) }).parse(data).account.country;

const isWebp = (buf: Buffer) =>
	buf.subarray(0, 4).toString("ascii") === "RIFF" && buf.subarray(8, 12).toString("ascii") === "WEBP";

// The reset link's plaintext key is only in the emailed html: /reset?key=…&email=…
const sentResetKey = (mails: MailSendData[]) =>
	new URL(String(mails[0].html).match(/href='([^']+)'/)![1]).searchParams.get("key")!;

// 300x200 — wider than tall, so "cover" must crop to a square.
const makeAvatarUpload = (format: "jpeg" | "png") => {
	const image = sharp({ create: { width: 300, height: 200, channels: 3, background: { r: 200, g: 40, b: 40 } } });
	return format === "jpeg" ? image.jpeg().toBuffer() : image.png().toBuffer();
};

describe("Account API — country", () => {
	const userId = new ObjectId();
	let authHeaders: Record<string, string> = {};

	before(async () => {
		await colls.users.insertOne(
			testUser({
				_id: userId,
				account: { username: "countryuser", email: "country@test.com" },
				security: { confirmed: true, slug: "countryuser" },
			}),
		);
		const code = generateRefreshCode();
		const tokenDoc = { user: userId, codeHash: hashRefreshCode(code), createdAt: new Date() };
		await colls.jwtRefreshTokens.insertOne(tokenDoc);
		const token = await createAccessToken(tokenDoc, ["all"], false);
		authHeaders = { Authorization: `Bearer ${token}` };
	});

	it("defaults to no country", async () => {
		const res = await api("GET", "/api/account", undefined, authHeaders);
		assert.strictEqual(res.status, 200);
		assert.strictEqual(countryOf(res.data), undefined);
	});

	it("sets the country, uppercased", async () => {
		const res = await api("POST", "/api/account", { account: { country: "fr" } }, authHeaders);
		assert.strictEqual(res.status, 200);
		assert.strictEqual(countryOf(res.data), "FR");

		const stored = await colls.users.findOne({ _id: userId });
		assert.strictEqual(stored?.account.country, "FR");
	});

	it("clears the country with an empty string", async () => {
		const res = await api("POST", "/api/account", { account: { country: "" } }, authHeaders);
		assert.strictEqual(res.status, 200);
		assert.strictEqual(countryOf(res.data), null);
	});

	it("rejects invalid country codes", async () => {
		for (const country of ["F", "FRA", "12"]) {
			const res = await api("POST", "/api/account", { account: { country } }, authHeaders);
			assert.strictEqual(res.ok, false, `expected failure for ${country}`);
		}
		const stored = await colls.users.findOne({ _id: userId });
		assert.strictEqual(stored?.account.country, null);
	});

	it("exposes the country on the public user payload", async () => {
		await colls.users.updateOne({ _id: userId }, { $set: { "account.country": "BR" } });
		const res = await api("GET", `/api/user/infoByName/countryuser`);
		assert.strictEqual(res.status, 200);
		assert.strictEqual(countryOf(res.data), "BR");
	});

	it("exposes the country in boardgame rankings", async () => {
		await colls.gameInfos.insertOne({
			_id: { game: "countrygame", version: 1 },
			label: "Country Game",
			players: [2],
			meta: { public: true, needOwnership: false },
		});
		await colls.gamePreferences.insertOne(
			testGamePrefs({ user: userId, game: "countrygame", elo: { value: 120, games: 3 } }),
		);

		const res = await api("GET", `/api/boardgame/countrygame/elo`);
		assert.strictEqual(res.status, 200);
		const rankings = z
			.array(z.object({ user: z.object({ name: z.string(), country: z.string().optional() }) }))
			.parse(res.data);
		const entry = rankings.find((r) => r.user.name === "countryuser");
		assert.ok(entry, "expected countryuser in rankings");
		assert.strictEqual(entry.user.country, "BR");
	});

	after(() => db().dropDatabase());
});

describe("Account API — notification webhook (#85/#33)", () => {
	const userId = new ObjectId();
	let authHeaders: Record<string, string> = {};
	let webhookCalls: WebhookCall[];
	let webhookFails = false;

	const interceptWebhook = () => {
		webhookCalls = [];
		setWebhookFetchForTests(async (url, init) => {
			if (webhookFails) {
				throw new Error("connection refused");
			}
			webhookCalls.push({ url, ...init });
			return { statusCode: 200 };
		});
	};

	before(async () => {
		await colls.users.insertOne(
			testUser({
				_id: userId,
				account: { username: "webhookuser", email: "webhook@test.com" },
				security: { confirmed: true, slug: "webhookuser" },
			}),
		);
		const code = generateRefreshCode();
		const tokenDoc = { user: userId, codeHash: hashRefreshCode(code), createdAt: new Date() };
		await colls.jwtRefreshTokens.insertOne(tokenDoc);
		authHeaders = { Authorization: `Bearer ${await createAccessToken(tokenDoc, ["all"], false)}` };
		interceptWebhook();
	});

	it("rejects special-use (SSRF) webhook urls", async () => {
		for (const url of [
			"http://169.254.169.254/latest/meta-data",
			"https://10.0.0.1/hook",
			"https://192.168.1.1/hook",
		]) {
			const res = await api("POST", "/api/account", { settings: { notifications: { webhook: { url } } } }, authHeaders);
			assert.strictEqual(res.ok, false, `expected failure for ${url}`);
		}
		const stored = await colls.users.findOne({ _id: userId });
		assert.strictEqual(stored?.settings?.notifications, undefined);
	});

	it("sets a webhook; the url never leaves the api but hasWebhook does", async () => {
		const url = "https://discord.com/api/webhooks/123/abc";
		const res = await api(
			"POST",
			"/api/account",
			{ settings: { notifications: { webhook: { url, format: "discord", enabled: true } } } },
			authHeaders,
		);
		assert.strictEqual(res.status, 200, JSON.stringify(res.data));

		const responseWebhook = z
			.object({
				settings: z.object({
					notifications: z.object({
						webhook: z.object({ url: z.string().optional(), hasWebhook: z.boolean().optional() }),
					}),
				}),
			})
			.parse(res.data).settings.notifications.webhook;
		assert.strictEqual(responseWebhook.url, undefined, "the url must be stripped from the response");
		assert.strictEqual(responseWebhook.hasWebhook, true);

		const stored = await colls.users.findOne({ _id: userId });
		assert.strictEqual(stored?.settings?.notifications?.webhook?.url, url);
		assert.strictEqual(stored?.settings?.notifications?.webhook?.format, "discord");

		const get = await api("GET", "/api/account", undefined, authHeaders);
		const getWebhook = z
			.object({
				settings: z.object({
					notifications: z.object({
						webhook: z.object({ url: z.string().optional(), hasWebhook: z.boolean().optional() }),
					}),
				}),
			})
			.parse(get.data).settings.notifications.webhook;
		assert.strictEqual(getWebhook.url, undefined);
		assert.strictEqual(getWebhook.hasWebhook, true);
	});

	it("persists the webhook delivery delay (0 = immediate)", async () => {
		const res = await api(
			"POST",
			"/api/account",
			{ settings: { notifications: { webhook: { delay: 0 } } } },
			authHeaders,
		);
		assert.strictEqual(res.status, 200, JSON.stringify(res.data));
		let stored = await colls.users.findOne({ _id: userId });
		assert.strictEqual(stored?.settings?.notifications?.webhook?.delay, 0);

		await api("POST", "/api/account", { settings: { notifications: { webhook: { delay: 600 } } } }, authHeaders);
		stored = await colls.users.findOne({ _id: userId });
		assert.strictEqual(stored?.settings?.notifications?.webhook?.delay, 600);
	});

	it("rejects a negative webhook delay", async () => {
		const res = await api(
			"POST",
			"/api/account",
			{ settings: { notifications: { webhook: { delay: -5 } } } },
			authHeaders,
		);
		assert.strictEqual(res.status, 400);
	});

	it("POST /webhook/test posts a test notification to the configured url", async () => {
		const res = await api("POST", "/api/account/webhook/test", undefined, authHeaders);
		assert.strictEqual(res.status, 200);
		assert.deepStrictEqual(res.data, { success: true });
		assert.strictEqual(webhookCalls.length, 1);
		assert.strictEqual(webhookCalls[0].url, "https://discord.com/api/webhooks/123/abc");
		assert.strictEqual(webhookCalls[0].method, "POST");
		const payload = z.object({ content: z.string() }).parse(JSON.parse(webhookCalls[0].body));
		assert.match(payload.content, /test notification/i);
	});

	it("POST /webhook/test reports failure when the endpoint errors", async () => {
		webhookFails = true;
		try {
			const res = await api("POST", "/api/account/webhook/test", undefined, authHeaders);
			assert.strictEqual(res.status, 200);
			const body = z.object({ success: z.literal(false), error: z.string() }).parse(res.data);
			assert.match(body.error, /connection refused/);
		} finally {
			webhookFails = false;
		}
	});

	it("POST /webhook/test reports failure when no webhook is configured", async () => {
		const soloId = new ObjectId();
		await colls.users.insertOne(
			testUser({
				_id: soloId,
				account: { username: "nowebhook", email: "nowebhook@test.com" },
				security: { confirmed: true, slug: "nowebhook" },
			}),
		);
		const code = generateRefreshCode();
		const tokenDoc = { user: soloId, codeHash: hashRefreshCode(code), createdAt: new Date() };
		await colls.jwtRefreshTokens.insertOne(tokenDoc);
		const headers = { Authorization: `Bearer ${await createAccessToken(tokenDoc, ["all"], false)}` };

		const res = await api("POST", "/api/account/webhook/test", undefined, headers);
		assert.deepStrictEqual(res.data, { success: false, error: "No webhook configured" });
	});

	it("saving a new url resets the failure state", async () => {
		await colls.users.updateOne(
			{ _id: userId },
			{
				$set: {
					"settings.notifications.webhook.disabled": true,
					"settings.notifications.webhook.failingSince": new Date(),
					"settings.notifications.webhook.nextRetryAt": new Date(),
					"settings.notifications.webhook.lastError": "boom",
				},
			},
		);
		const res = await api(
			"POST",
			"/api/account",
			{ settings: { notifications: { webhook: { url: "https://discord.com/api/webhooks/123/def" } } } },
			authHeaders,
		);
		assert.strictEqual(res.status, 200, JSON.stringify(res.data));
		const stored = await colls.users.findOne({ _id: userId });
		const webhook = stored?.settings?.notifications?.webhook;
		assert.strictEqual(webhook?.url, "https://discord.com/api/webhooks/123/def");
		assert.ok(webhook && !("disabled" in webhook), "disabled must be reset");
		assert.ok(!("failingSince" in webhook));
		assert.ok(!("nextRetryAt" in webhook));
		assert.ok(!("lastError" in webhook));
	});

	it("clears the webhook when sent null", async () => {
		const res = await api("POST", "/api/account", { settings: { notifications: { webhook: null } } }, authHeaders);
		assert.strictEqual(res.status, 200, JSON.stringify(res.data));
		const stored = await colls.users.findOne({ _id: userId });
		assert.strictEqual(stored?.settings?.notifications?.webhook, undefined);
		// A null leaf must not clobber sibling settings.
		assert.ok(stored?.settings?.mailing, "sibling settings must survive");
	});

	it("rejects unknown keys inside the webhook block", async () => {
		const res = await api(
			"POST",
			"/api/account",
			{ settings: { notifications: { webhook: { url: "https://example.com/hook", evil: true } } } },
			authHeaders,
		);
		assert.strictEqual(res.ok, false);
	});

	after(() => {
		setWebhookFetchForTests(null);
		return db().dropDatabase();
	});
});

describe("Account API — avatar upload", () => {
	const userId = new ObjectId();
	let authHeaders: Record<string, string> = {};
	const s3Mock = makeS3Mock();
	// Lets s3Fetch() resolve the mock's public object URLs (redirect follow below).
	const restoreFetchInterceptor = interceptS3Fetches(s3Mock);

	before(async () => {
		setS3ClientsForTests(s3Mock.client);
		s3Mock.reset();
		await colls.users.insertOne(
			testUser({
				_id: userId,
				account: { username: "avataruser", email: "avatar@test.com" },
				security: { confirmed: true, slug: "avataruser" },
			}),
		);
		const code = generateRefreshCode();
		const tokenDoc = { user: userId, codeHash: hashRefreshCode(code), createdAt: new Date() };
		await colls.jwtRefreshTokens.insertOne(tokenDoc);
		const token = await createAccessToken(tokenDoc, ["all"], false);
		authHeaders = { Authorization: `Bearer ${token}` };
	});

	for (const format of ["jpeg", "png"] as const) {
		it(`encodes an uploaded ${format.toUpperCase()} as webp in all three sizes`, async () => {
			s3Mock.reset();
			const upload = await makeAvatarUpload(format);
			const res = await fetch(`${baseURL()}/api/account/avatar`, {
				method: "POST",
				headers: authHeaders,
				body: upload,
			});
			assert.strictEqual(res.status, 200);

			const doc = await colls.images.findOne({ ref: userId, key: "avatar", refType: "User" });
			assert.ok(doc, "expected an images doc");
			assert.deepStrictEqual([...doc.formats].sort(), ["128x128", "256x256", "64x64"]);

			for (const size of [256, 128, 64]) {
				const entry = doc.images[`${size}x${size}`];
				assert.ok(entry, `missing ${size}x${size}`);
				assert.strictEqual(entry.mime, "image/webp");
				// S3-only write: the doc is the metadata record (etag), no blob.
				assert.strictEqual(entry.raw, undefined, `expected no raw blob for ${size}x${size}`);
				assert.ok(entry.hash, `expected a stored hash (etag) for ${size}x${size}`);
				assert.ok(entry.size > 0);

				// S3 holds the actual bytes — verify they decode to the right size.
				const s3Body = s3Mock.buckets
					.get(s3Mock.bucketName)
					?.get(`avatars/${userId.toHexString()}/${size}x${size}.webp`);
				assert.ok(s3Body, `expected an S3 object for ${size}x${size}`);
				assert.strictEqual(entry.size, s3Body.body.length);
				assert.ok(isWebp(s3Body.body), `expected RIFF…WEBP magic bytes for ${size}x${size}`);
				const meta = await sharp(s3Body.body).metadata();
				assert.strictEqual(meta.format, "webp");
				assert.strictEqual(meta.width, size);
				assert.strictEqual(meta.height, size);
			}
			// Set outside the loop: on failure the loop assert kills the test first.
			assert.strictEqual(doc.s3, true);

			const user = await colls.users.findOne({ _id: userId });
			assert.strictEqual(user?.account.avatar, "upload");

			// The uploaded avatar serves as webp, in the requested size bucket. S3
			// is enabled and the doc is migrated → a 302 to the public object URL,
			// which the test client follows against the mock S3 store.
			const redirect = await fetch(`${baseURL()}/api/user/${userId.toHexString()}/avatar?size=64`, {
				redirect: "manual",
			});
			assert.strictEqual(redirect.status, 302);
			// The ETag is the stored upload-time hash — identical to what the old
			// mongo-serving path emitted, so existing caches revalidate cleanly.
			assert.strictEqual(redirect.headers.get("etag"), `"${doc.images["64x64"].hash}"`);
			const served = await s3Fetch(redirect.headers.get("location")!);
			assert.strictEqual(served.status, 200);
			assert.strictEqual(served.headers.get("content-type"), "image/webp");
			const body = Buffer.from(await served.arrayBuffer());
			assert.ok(isWebp(body), "expected RIFF…WEBP magic bytes on the served avatar");
			const servedMeta = await sharp(body).metadata();
			assert.strictEqual(servedMeta.width, 64);
			assert.strictEqual(servedMeta.height, 64);
		});
	}

	it("keeps mongo as the only copy when the S3 write fails (no s3 flag, 200 upload)", async () => {
		// Start clean: previous tests left the doc migrated; remove it so this
		// upload's s3 flag reflects only this request's (failing) S3 write.
		await colls.images.deleteOne({ ref: userId, key: "avatar", refType: "User" });
		s3Mock.reset();
		s3Mock.failing = true;
		try {
			const upload = await makeAvatarUpload("png");
			const res = await fetch(`${baseURL()}/api/account/avatar`, {
				method: "POST",
				headers: authHeaders,
				body: upload,
			});
			assert.strictEqual(res.status, 200);
		} finally {
			s3Mock.failing = false;
		}

		const doc = await colls.images.findOne({ ref: userId, key: "avatar", refType: "User" });
		assert.ok(doc, "expected an images doc");
		assert.ok(!doc.s3, "s3 flag must stay unset when the S3 write failed");
		assert.ok(doc.images["64x64"]?.raw, "mongo must still hold the bytes");
		assert.strictEqual(s3Mock.buckets.size, 0, "nothing should have landed in S3");

		// Serving still works, from mongo.
		const served = await fetch(`${baseURL()}/api/user/${userId.toHexString()}/avatar?size=64`, { redirect: "manual" });
		assert.strictEqual(served.status, 200);
		assert.strictEqual(served.headers.get("content-type"), "image/webp");
	});

	it("rejects a non-image body", async () => {
		const res = await fetch(`${baseURL()}/api/account/avatar`, {
			method: "POST",
			headers: authHeaders,
			body: Buffer.from("definitely not an image"),
		});
		assert.strictEqual(res.ok, false);
	});

	after(async () => {
		setS3ClientsForTests(null);
		restoreFetchInterceptor();
		await db().dropDatabase();
	});
});

describe("Account API — avatar upload with S3 disabled", () => {
	const userId = new ObjectId();
	let authHeaders: Record<string, string> = {};

	before(async () => {
		// No setS3ClientsForTests here: with no S3_* env vars in the test
		// environment, s3Enabled() is false and the upload is mongo-only.
		await colls.users.insertOne(
			testUser({
				_id: userId,
				account: { username: "avatarnos3", email: "avatarnos3@test.com" },
				security: { confirmed: true, slug: "avatarnos3" },
			}),
		);
		const code = generateRefreshCode();
		const tokenDoc = { user: userId, codeHash: hashRefreshCode(code), createdAt: new Date() };
		await colls.jwtRefreshTokens.insertOne(tokenDoc);
		const token = await createAccessToken(tokenDoc, ["all"], false);
		authHeaders = { Authorization: `Bearer ${token}` };
	});

	it("writes mongo only, without the s3 flag", async () => {
		const upload = await makeAvatarUpload("png");
		const res = await fetch(`${baseURL()}/api/account/avatar`, {
			method: "POST",
			headers: authHeaders,
			body: upload,
		});
		assert.strictEqual(res.status, 200);

		const doc = await colls.images.findOne({ ref: userId, key: "avatar", refType: "User" });
		assert.ok(doc, "expected an images doc");
		assert.ok(!doc.s3, "no s3 flag when S3 is disabled");
		assert.ok(doc.images["64x64"]?.raw, "mongo holds the bytes");

		const served = await fetch(`${baseURL()}/api/user/${userId.toHexString()}/avatar?size=64`);
		assert.strictEqual(served.status, 200);
		assert.strictEqual(served.headers.get("content-type"), "image/webp");
		assert.ok(isWebp(Buffer.from(await served.arrayBuffer())));
	});

	after(() => db().dropDatabase());
});

describe("Account API — auth email cooldown (#195)", () => {
	const userId = new ObjectId();
	const email = "reset-cooldown@test.com";
	let sentMails: MailSendData[];
	let authHeaders: Record<string, string> = {};

	before(async () => {
		await colls.users.insertOne(
			testUser({
				_id: userId,
				account: { username: "cooldownuser", email },
				security: { confirmed: true, slug: "cooldownuser" },
			}),
		);
		const code = generateRefreshCode();
		const tokenDoc = { user: userId, codeHash: hashRefreshCode(code), createdAt: new Date() };
		await colls.jwtRefreshTokens.insertOne(tokenDoc);
		authHeaders = { Authorization: `Bearer ${await createAccessToken(tokenDoc, ["all"], false)}` };
	});

	// Reinstalled before each send-asserting test: describes in this file run
	// concurrently and another one could swap the hook.
	const interceptMails = () => {
		sentMails = [];
		setSendmailForTests(async (data) => {
			sentMails.push(data);
		});
	};

	it("first /forget sends the reset email and stamps the cooldown", async () => {
		interceptMails();
		const res = await api("POST", "/api/account/forget", { email });
		assert.strictEqual(res.status, 200);
		assert.strictEqual(sentMails.length, 1);
		assert.match(String(sentMails[0].subject), /forgotten password/i);

		const user = (await colls.users.findOne({ _id: userId }))!;
		assert.ok(user.security.reset?.key, "a reset key must be stored");
		assert.ok(user.security.lastAuthEmailSentAt, "the cooldown stamp must be set");
	});

	it("a second /forget within the cooldown sends nothing, keeps the same key, still 200s", async () => {
		const keyBefore = (await colls.users.findOne({ _id: userId }))!.security.reset?.key;

		interceptMails();
		const res = await api("POST", "/api/account/forget", { email });
		assert.strictEqual(res.status, 200);
		assert.strictEqual(sentMails.length, 0, "no second email within the cooldown");

		const afterSkip = (await colls.users.findOne({ _id: userId }))!;
		assert.strictEqual(afterSkip.security.reset?.key, keyBefore, "the reset key must not be regenerated on a skip");
	});

	it("the reset link from the first (sent) email still works after skipped resends", async () => {
		// Its own user: describes in the file run concurrently and the previous tests
		// left ours outside the reset-email cooldown.
		const soloId = new ObjectId();
		const soloEmail = "reset-link-solo@test.com";
		await colls.users.insertOne(
			testUser({
				_id: soloId,
				account: { username: "resetlinksolo", email: soloEmail },
				security: { slug: "resetlinksolo" },
			}),
		);

		interceptMails();
		assert.strictEqual((await api("POST", "/api/account/forget", { email: soloEmail })).status, 200);
		assert.strictEqual(sentMails.length, 1);
		const firstKey = sentResetKey(sentMails);

		assert.strictEqual((await api("POST", "/api/account/forget", { email: soloEmail })).status, 200);
		assert.strictEqual(sentMails.length, 1, "the resend is skipped: still within the cooldown");
		assert.strictEqual((await api("POST", "/api/account/forget", { email: soloEmail })).status, 200);
		assert.strictEqual(sentMails.length, 1);

		const reset = await api("POST", "/api/account/reset", {
			email: soloEmail,
			resetKey: firstKey,
			password: "reset-hunter2",
		});
		assert.strictEqual(reset.status, 200, JSON.stringify(reset.data));
	});

	it("/forget still 404s on an unknown email", async () => {
		interceptMails();
		const res = await api("POST", "/api/account/forget", { email: "no-such-user-195@test.com" });
		assert.strictEqual(res.status, 404);
		assert.strictEqual(sentMails.length, 0);
	});

	it("a /forget past the cooldown sends again", async () => {
		await colls.users.updateOne(
			{ _id: userId },
			{ $set: { "security.lastAuthEmailSentAt": new Date(Date.now() - env.authEmailCooldownMs - 1) } },
		);
		interceptMails();
		const res = await api("POST", "/api/account/forget", { email });
		assert.strictEqual(res.status, 200);
		assert.strictEqual(sentMails.length, 1);
	});

	it("the email-change confirmation ALWAYS sends, even within the cooldown, and the change applies", async () => {
		// A reset email went out in the previous test → the per-email cooldown is
		// active. The logged-in email change ignores it (the per-user action rate
		// limit throttles this route instead): an email change applies
		// immediately, so the account must never be left changed-but-unconfirmable.
		sentMails = [];
		const res = await api("POST", "/api/account/email", { email: "cooldown-user-new@test.com" }, authHeaders);
		assert.strictEqual(res.status, 200);
		assert.strictEqual(
			sentMails.filter((m) => String(m.to) === "cooldown-user-new@test.com").length,
			1,
			"the confirm email to the new address goes out despite the cooldown",
		);
		const updated = (await colls.users.findOne({ _id: userId }))!;
		assert.strictEqual(updated.account.email, "cooldown-user-new@test.com");
		assert.strictEqual(updated.security.confirmed, false);

		// The bypass didn't stamp the cooldown — the stamp is still the one from
		// the previous test's /forget. Pretend that stamp is old: a /forget to
		// the new address then sends normally (the change didn't mute it)…
		await colls.users.updateOne(
			{ _id: userId },
			{ $set: { "security.lastAuthEmailSentAt": new Date(Date.now() - env.authEmailCooldownMs - 1) } },
		);
		sentMails = [];
		assert.strictEqual((await api("POST", "/api/account/forget", { email: "cooldown-user-new@test.com" })).status, 200);
		assert.strictEqual(sentMails.length, 1, "first /forget to the new address sends normally");

		// …and its OWN cooldown still suppresses immediate repeats.
		sentMails = [];
		assert.strictEqual((await api("POST", "/api/account/forget", { email: "cooldown-user-new@test.com" })).status, 200);
		assert.strictEqual(sentMails.length, 0, "second /forget within the cooldown stays suppressed");

		// Another email change, still within the cooldown stamped by /forget above:
		// the confirm email goes out again.
		sentMails = [];
		const res2 = await api("POST", "/api/account/email", { email: "cooldown-user-final@test.com" }, authHeaders);
		assert.strictEqual(res2.status, 200);
		assert.strictEqual(sentMails.filter((m) => String(m.to) === "cooldown-user-final@test.com").length, 1);
	});

	after(() => {
		setSendmailForTests(null);
		return db().dropDatabase();
	});
});

describe("Account API — session cookie over a TLS-terminating proxy", () => {
	// The api sits behind nginx (app.proxy = true) and decides the session cookie's
	// `secure`/`domain` from X-Forwarded-Host / X-Forwarded-Proto. Regression test for
	// the admin-panel login failure "Cannot send secure cookie over unencrypted
	// connection": when the reverse proxy forwards the real (https) proto, setting the
	// Secure session cookie must succeed; when the proto is missing, the request is
	// (correctly) seen as plain http and must fail loudly rather than silently issuing
	// a cookie the browser would reject.
	const password = "hunter2-test";
	let email = "";

	before(async () => {
		const user = testUser({
			account: { username: "cookieuser", email: "cookie@test.com" },
			security: { confirmed: true, slug: "cookieuser" },
		});
		user.account.password = await bcrypt.hash(password, 8);
		email = user.account.email;
		await colls.users.insertOne(user);
	});

	const proxyHeaders = {
		"X-Forwarded-Host": `admin.${env.domain}`,
		"X-Forwarded-Proto": "https",
	};

	it("login through an https proxy sets a Secure, domain-scoped session cookie", async () => {
		const res = await fetch(`${baseURL()}/api/account/login`, {
			method: "POST",
			headers: { "Content-Type": "application/json", ...proxyHeaders },
			body: JSON.stringify({ email, password }),
		});
		assert.strictEqual(res.status, 200);
		const setCookie = res.headers.get("set-cookie") ?? "";
		assert.match(setCookie, /refreshToken=/);
		assert.match(setCookie, /;\s*secure/i);
		assert.match(setCookie, new RegExp(`;\\s*domain=${env.domain.replace(".", "\\.")}`, "i"));
	});

	it("the session cookie authenticates cookie-based calls (mint + /account)", async () => {
		const login = await fetch(`${baseURL()}/api/account/login`, {
			method: "POST",
			headers: { "Content-Type": "application/json", ...proxyHeaders },
			body: JSON.stringify({ email, password }),
		});
		const setCookie = login.headers.get("set-cookie") ?? "";
		const cookie = setCookie.split(";")[0];

		const mint = await fetch(`${baseURL()}/api/account/mint`, {
			method: "POST",
			headers: { "Content-Type": "application/json", cookie, ...proxyHeaders },
			body: JSON.stringify({ scopes: ["all"] }),
		});
		assert.strictEqual(mint.status, 200);
		const token = z.object({ code: z.string() }).parse(await mint.json());

		const account = await fetch(`${baseURL()}/api/account`, {
			headers: { authorization: `Bearer ${token.code}`, ...proxyHeaders },
		});
		assert.strictEqual(account.status, 200);
	});

	it("login over perceived plain http fails loudly (the reported 500)", async () => {
		const res = await fetch(`${baseURL()}/api/account/login`, {
			method: "POST",
			// No X-Forwarded-Proto: the api sees an insecure connection for a public host.
			headers: { "Content-Type": "application/json", "X-Forwarded-Host": `admin.${env.domain}` },
			body: JSON.stringify({ email, password }),
		});
		assert.strictEqual(res.status, 500);
	});

	after(() => db().dropDatabase());
});

describe("secure-cookie-over-insecure diagnostic", () => {
	// Prod logs a chronic "Cannot send secure cookie over unencrypted connection" —
	// some requests reach the api with ctx.secure === false even though prod is HTTPS
	// and nginx sets X-Forwarded-Proto. While the root cause is unknown, a request
	// about to set a Secure cookie over an insecure connection records a diagnostic:
	// a structured warn log line + an apierrors record (meta.source="secure-cookie",
	// listed on the admin health page). The cookie itself stays `Secure` — the throw
	// behavior is unchanged.
	const userId = new ObjectId();
	const insecureHeaders = {
		// Public host, no X-Forwarded-Proto → the api sees plain http (app.proxy=true).
		"X-Forwarded-Host": `www.${env.domain}`,
		"User-Agent": "diag-spec-agent",
		Referer: "http://example.com/some-page",
	};
	let code = "";

	before(async () => {
		await colls.users.insertOne(
			testUser({
				_id: userId,
				account: { username: "diaguser", email: "diag@test.com" },
				security: { confirmed: true, slug: "diaguser" },
			}),
		);
		code = generateRefreshCode();
		await colls.jwtRefreshTokens.insertOne({ user: userId, codeHash: hashRefreshCode(code), createdAt: new Date() });
	});

	async function waitForDiagnostic() {
		// Filter by path AND user: describes within this file run concurrently,
		// and other requests that slide a Secure cookie over perceived http also
		// trigger the diagnostic. Only this describe's POST has this userId.
		for (let i = 0; i < 50; i++) {
			const doc = await colls.apiErrors.findOne({
				"meta.source": "secure-cookie",
				"request.path": "/api/account",
				user: userId,
			});
			if (doc) {
				return doc;
			}
			await new Promise((resolve) => setTimeout(resolve, 20));
		}
		assert.fail("expected a secure-cookie diagnostic record in apierrors");
	}

	it("captures the full request context when a mutating request slides the cookie over insecure http", async () => {
		const cookie = `refreshToken=${encodeURIComponent(JSON.stringify({ code }))}`;
		const res = await fetch(`${baseURL()}/api/account`, {
			method: "POST",
			headers: { "Content-Type": "application/json", cookie, ...insecureHeaders },
			body: JSON.stringify({ account: { newsletter: true } }),
		});
		// Behavior unchanged: cookies.set still throws on a Secure cookie over http,
		// which surfaces as a 500. The throw happens in the auth middleware (before
		// the error recorder), so the diagnostic record below is the only trace.
		assert.strictEqual(res.status, 500);

		const doc = await waitForDiagnostic();
		assert.strictEqual(doc.error.name, "SecureCookieOverInsecure");
		assert.strictEqual(doc.request.method, "POST");
		assert.strictEqual(doc.request.url, "/api/account");
		assert.strictEqual(doc.request.path, "/api/account");
		assert.strictEqual(doc.request.secure, false);
		assert.strictEqual(doc.request.protocol, "http");
		assert.strictEqual(doc.request.hostname, `www.${env.domain}`);
		assert.ok(doc.request.ip, "expected the client ip to be recorded");
		// Absent headers are omitted; present ones are recorded as received.
		assert.deepStrictEqual(doc.request.headers, {
			"x-forwarded-host": `www.${env.domain}`,
			host: doc.request.headers?.host,
			"user-agent": "diag-spec-agent",
			referer: "http://example.com/some-page",
		});
		assert.strictEqual(doc.meta?.proxy, true);
		assert.ok(doc.createdAt);
		assert.deepStrictEqual(doc.user, userId);
	});

	it("does not fire on a normal https request (ctx.secure === true)", async () => {
		await colls.apiErrors.deleteMany({});
		const cookie = `refreshToken=${encodeURIComponent(JSON.stringify({ code }))}`;
		const res = await fetch(`${baseURL()}/api/account`, {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				cookie,
				"X-Forwarded-Host": `www.${env.domain}`,
				"X-Forwarded-Proto": "https",
			},
			body: JSON.stringify({ account: { newsletter: false } }),
		});
		assert.strictEqual(res.status, 200);
		const setCookie = res.headers.getSetCookie().find((c) => c.startsWith("refreshToken=")) ?? "";
		if (setCookie) {
			// The slide is throttled per refresh code (60s): if the first test ran
			// within the window this request doesn't re-set the cookie at all. When it
			// does, it must be a normal Secure cookie with no diagnostic recorded.
			assert.match(setCookie, /;\s*secure/i);
		}
		const doc = await colls.apiErrors.findOne({ "meta.source": "secure-cookie" });
		assert.strictEqual(doc, null, "no diagnostic must be recorded on https");
	});

	after(() => db().dropDatabase());
});
