import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { ObjectId } from "mongodb";
import { z } from "zod";
import type { UserDoc } from "@bgs/models";
import { colls, db } from "../config/db.ts";
import { setSendmailForTests } from "../config/sendmail.ts";
import { testGame, testUser } from "../config/test-helpers.ts";
import { processCurrentMove } from "./gamenotification.ts";
import {
	deliverGameNotificationWebhook,
	sendGameNotificationEmail,
	setWebhookFetchForTests,
	webhookBackoffSeconds,
	WEBHOOK_BACKOFF_BASE_SECONDS,
	WEBHOOK_BACKOFF_MAX_SECONDS,
	WEBHOOK_DISABLE_AFTER_MS,
	type WebhookCall,
} from "./user.ts";

describe("user webhook — your-turn delivery (#85/#33)", () => {
	let calls: WebhookCall[];
	let failing = false;

	const intercept = () => {
		calls = [];
		setWebhookFetchForTests(async (url, init) => {
			if (failing) {
				throw new Error("webhook endpoint down");
			}
			calls.push({ url, ...init });
			return { statusCode: 200 };
		});
	};

	before(() => {
		intercept();
		setSendmailForTests(async () => {});
	});

	it("webhookBackoffSeconds doubles from 1min, capped at 1h", () => {
		assert.strictEqual(webhookBackoffSeconds(0), WEBHOOK_BACKOFF_BASE_SECONDS);
		assert.strictEqual(webhookBackoffSeconds(1), 60);
		assert.strictEqual(webhookBackoffSeconds(2), 120);
		assert.strictEqual(webhookBackoffSeconds(3), 240);
		assert.strictEqual(webhookBackoffSeconds(7), WEBHOOK_BACKOFF_MAX_SECONDS);
		assert.strictEqual(webhookBackoffSeconds(42), WEBHOOK_BACKOFF_MAX_SECONDS);
	});

	it("posts a discord-format your-turn payload (game name + link) on sendGameNotificationEmail", async () => {
		const userId = new ObjectId();
		const past = new Date(Date.now() - 3600 * 1000);
		const user = testUser({
			_id: userId,
			account: { username: "hooked" },
			settings: {
				notifications: {
					webhook: { url: "https://discord.com/api/webhooks/1/secret", format: "discord", enabled: true, delay: 1800 },
				},
			},
			// lastGameNotification must predate the game's timerStart: the countDocuments
			// guard ("games whose turn started after the last notification") must be 0.
			meta: { nextGameNotification: past, lastGameNotification: past },
		});
		// Absent, not "": the sparse unique index on account.email indexes "".
		delete user.account.email;
		await colls.users.insertOne(user);
		await colls.games.insertOne(
			testGame({
				_id: "hooked-game-1",
				game: { name: "Gaia Project", version: 1 },
				status: "active",
				players: [{ _id: userId }],
				currentPlayers: [{ _id: userId, timerStart: past }],
				lastMove: past,
			}),
		);

		await sendGameNotificationEmail((await colls.users.findOne({ _id: userId }))!);

		assert.strictEqual(calls.length, 1, "the webhook must fire");
		assert.strictEqual(calls[0].url, "https://discord.com/api/webhooks/1/secret");
		assert.strictEqual(calls[0].method, "POST");
		assert.strictEqual(calls[0].headers["Content-Type"], "application/json");
		const payload = z
			.object({ content: z.string(), embeds: z.array(z.object({ title: z.string(), url: z.string() })) })
			.parse(JSON.parse(calls[0].body));
		assert.match(payload.content, /your turn/);
		assert.match(payload.content, /Gaia Project/);
		assert.match(payload.content, /1 game waiting/);
		assert.match(payload.embeds[0].title, /Gaia Project/);
		assert.match(payload.embeds[0].url, /\/game\/hooked-game-1$/);

		// Successful delivery leaves no failure state behind.
		const stored = await colls.users.findOne({ _id: userId });
		const webhook = stored?.settings?.notifications?.webhook;
		assert.ok(webhook);
		assert.ok(!("failingSince" in webhook));
		assert.ok(!("nextRetryAt" in webhook));
	});

	type WebhookSettings = NonNullable<NonNullable<UserDoc["settings"]>["notifications"]>["webhook"];

	const insertWebhookUser = async (username: string, webhook: WebhookSettings) => {
		const userId = new ObjectId();
		const user = testUser({
			_id: userId,
			account: { username },
			settings: { notifications: { webhook } },
		});
		// Absent, not "": the sparse unique index on account.email indexes "".
		delete user.account.email;
		await colls.users.insertOne(user);
		return userId;
	};

	const oneGame = [{ _id: "g1", game: { name: "Gaia Project" } }];

	it("a failure sets failingSince + nextRetryAt (backoff), without disabling", async () => {
		const userId = await insertWebhookUser("hookfail", {
			url: "https://discord.com/api/webhooks/2/secret",
			format: "discord",
			enabled: true,
		});

		failing = true;
		try {
			await deliverGameNotificationWebhook((await colls.users.findOne({ _id: userId }))!, oneGame);
		} finally {
			failing = false;
		}

		const webhook = (await colls.users.findOne({ _id: userId }))!.settings!.notifications!.webhook!;
		assert.ok(webhook.failingSince, "failingSince must be set");
		assert.ok(webhook.nextRetryAt, "nextRetryAt must be set");
		assert.ok(new Date(webhook.nextRetryAt).getTime() > Date.now(), "nextRetryAt must be in the future");
		assert.ok(
			new Date(webhook.nextRetryAt).getTime() <= Date.now() + WEBHOOK_BACKOFF_BASE_SECONDS * 1000 + 5000,
			"the first backoff is the base interval",
		);
		assert.match(webhook.lastError!, /webhook endpoint down/);
		assert.ok(!webhook.disabled, "not disabled on the first failure");
	});

	it("the backoff doubles across consecutive failures", async () => {
		const userId = await insertWebhookUser("hookbackoff", {
			url: "https://discord.com/api/webhooks/3/secret",
			format: "discord",
			enabled: true,
		});
		// One failure already happened (retryCount 1, retry due 1s ago); the next
		// backoff must be 120s, not the base 60s again.
		await colls.users.updateOne(
			{ _id: userId },
			{
				$set: {
					"settings.notifications.webhook.failingSince": new Date(Date.now() - 60 * 1000),
					"settings.notifications.webhook.retryCount": 1,
					"settings.notifications.webhook.nextRetryAt": new Date(Date.now() - 1000),
				},
			},
		);
		const attemptStart = Date.now();

		failing = true;
		try {
			await deliverGameNotificationWebhook((await colls.users.findOne({ _id: userId }))!, oneGame);
		} finally {
			failing = false;
		}

		const webhook = (await colls.users.findOne({ _id: userId }))!.settings!.notifications!.webhook!;
		const delayMs = new Date(webhook.nextRetryAt!).getTime() - attemptStart;
		assert.ok(delayMs > 110 * 1000 && delayMs <= 120 * 1000 + 5000, `expected ~120s backoff, got ${delayMs}ms`);
	});

	it("disables the webhook after 24h of continuous failure", async () => {
		const userId = await insertWebhookUser("hookdisabled", {
			url: "https://discord.com/api/webhooks/4/secret",
			format: "discord",
			enabled: true,
		});
		await colls.users.updateOne(
			{ _id: userId },
			{ $set: { "settings.notifications.webhook.failingSince": new Date(Date.now() - 25 * 3600 * 1000) } },
		);

		failing = true;
		try {
			await deliverGameNotificationWebhook((await colls.users.findOne({ _id: userId }))!, oneGame);
		} finally {
			failing = false;
		}

		const webhook = (await colls.users.findOne({ _id: userId }))!.settings!.notifications!.webhook!;
		assert.strictEqual(webhook.disabled, true);
		assert.match(webhook.lastError!, /webhook endpoint down/);

		// Disabled ⇒ no further delivery attempts.
		calls = [];
		await deliverGameNotificationWebhook((await colls.users.findOne({ _id: userId }))!, oneGame);
		assert.strictEqual(calls.length, 0);
	});

	it("a success clears the failure streak", async () => {
		const userId = await insertWebhookUser("hookrecover", {
			url: "https://discord.com/api/webhooks/5/secret",
			format: "discord",
			enabled: true,
		});
		await colls.users.updateOne(
			{ _id: userId },
			{
				$set: {
					"settings.notifications.webhook.failingSince": new Date(Date.now() - 10 * 60 * 1000),
					"settings.notifications.webhook.nextRetryAt": new Date(Date.now() - 1000),
					"settings.notifications.webhook.lastError": "boom",
				},
			},
		);

		await deliverGameNotificationWebhook((await colls.users.findOne({ _id: userId }))!, oneGame);

		assert.strictEqual(calls.length, 1);
		const webhook = (await colls.users.findOne({ _id: userId }))!.settings!.notifications!.webhook!;
		assert.ok(!("failingSince" in webhook), "failingSince must be cleared");
		assert.ok(!("nextRetryAt" in webhook), "nextRetryAt must be cleared");
		assert.ok(!("lastError" in webhook), "lastError must be cleared");
	});

	it("skips delivery when disabled, turned off, or waiting for backoff", async () => {
		const userId = await insertWebhookUser("hookskip", {
			url: "https://discord.com/api/webhooks/6/secret",
			format: "discord",
			enabled: false,
		});
		calls = [];
		await deliverGameNotificationWebhook((await colls.users.findOne({ _id: userId }))!, oneGame);

		await colls.users.updateOne(
			{ _id: userId },
			{
				$set: {
					"settings.notifications.webhook.enabled": true,
					"settings.notifications.webhook.nextRetryAt": new Date(Date.now() + 3600 * 1000),
				},
			},
		);
		await deliverGameNotificationWebhook((await colls.users.findOne({ _id: userId }))!, oneGame);
		assert.strictEqual(calls.length, 0, "no delivery while enabled=false or inside the backoff window");
	});

	it("raw format carries event/user/waitingCount/games", async () => {
		const userId = await insertWebhookUser("hookraw", {
			url: "https://example.com/hook",
			format: "raw",
			enabled: true,
		});
		calls = [];
		await deliverGameNotificationWebhook((await colls.users.findOne({ _id: userId }))!, oneGame);
		assert.strictEqual(calls.length, 1);
		const payload = z
			.object({
				event: z.string(),
				user: z.string(),
				waitingCount: z.number(),
				games: z.array(z.object({ id: z.string(), name: z.string(), url: z.string() })),
			})
			.parse(JSON.parse(calls[0].body));
		assert.strictEqual(payload.event, "turn");
		assert.strictEqual(payload.user, "hookraw");
		assert.strictEqual(payload.waitingCount, 1);
		assert.deepStrictEqual(
			payload.games.map((g) => [g.id, g.name]),
			[["g1", "Gaia Project"]],
		);
		assert.ok(payload.games[0].url.endsWith("/game/g1"));
	});

	it("no webhook configured ⇒ no delivery, no error", async () => {
		assert.strictEqual(WEBHOOK_DISABLE_AFTER_MS, 24 * 3600 * 1000);
		const ghost = testUser({ settings: {} });
		delete ghost.account.email;
		await deliverGameNotificationWebhook({ ...ghost, _id: new ObjectId() }, oneGame);
	});

	describe("webhook timing — immediate vs batched", () => {
		it("immediate (delay 0) fires on the turn event even with turn emails off", async () => {
			const userId = await insertWebhookUser("hookimmediate", {
				url: "https://discord.com/api/webhooks/9/secret",
				format: "discord",
				enabled: true,
				delay: 0,
			});
			// Turn emails disabled — the immediate webhook must still fire.
			await colls.users.updateOne({ _id: userId }, { $set: { "settings.mailing.game.activated": false } });
			await colls.games.insertOne(
				testGame({
					_id: "immediate-game",
					game: { name: "Gaia Project", version: 1 },
					status: "active",
					players: [{ _id: userId }],
					currentPlayers: [{ _id: userId, timerStart: new Date() }],
				}),
			);
			await colls.gameNotifications.insertOne({
				game: "immediate-game",
				user: userId,
				kind: "currentMove",
				processed: false,
			});

			calls = [];
			await processCurrentMove();

			assert.strictEqual(calls.length, 1, "immediate webhook must fire on the turn event");
			assert.strictEqual(calls[0].url, "https://discord.com/api/webhooks/9/secret");
			assert.match(JSON.parse(calls[0].body).content, /Gaia Project/);
		});

		it("immediate webhook does not fire on the batched email pass", async () => {
			const userId = new ObjectId();
			const past = new Date(Date.now() - 3600 * 1000);
			const user = testUser({
				_id: userId,
				account: { username: "hookskipbatch" },
				settings: {
					notifications: {
						webhook: { url: "https://discord.com/api/webhooks/10/secret", format: "discord", enabled: true, delay: 0 },
					},
				},
				meta: { nextGameNotification: past, lastGameNotification: past },
			});
			delete user.account.email;
			await colls.users.insertOne(user);
			await colls.games.insertOne(
				testGame({
					_id: "skip-batch-game",
					game: { name: "Gaia Project", version: 1 },
					status: "active",
					players: [{ _id: userId }],
					currentPlayers: [{ _id: userId, timerStart: past }],
					lastMove: past,
				}),
			);

			calls = [];
			await sendGameNotificationEmail((await colls.users.findOne({ _id: userId }))!);
			assert.strictEqual(calls.length, 0, "delay 0 (immediate) must not ride the throttled email pass");
		});

		it("batched webhook does not fire on the immediate turn event", async () => {
			const userId = await insertWebhookUser("hookbatched", {
				url: "https://discord.com/api/webhooks/11/secret",
				format: "discord",
				enabled: true,
				delay: 1800,
			});
			await colls.games.insertOne(
				testGame({
					_id: "batched-game",
					game: { name: "Gaia Project", version: 1 },
					status: "active",
					players: [{ _id: userId }],
					currentPlayers: [{ _id: userId, timerStart: new Date() }],
				}),
			);
			await colls.gameNotifications.insertOne({
				game: "batched-game",
				user: userId,
				kind: "currentMove",
				processed: false,
			});

			calls = [];
			await processCurrentMove();
			assert.strictEqual(calls.length, 0, "batched webhook must not fire on the turn event");
		});

		it("a failing immediate webhook backs off without breaking the cron loop", async () => {
			const userId = await insertWebhookUser("hookimmfail", {
				url: "https://discord.com/api/webhooks/12/secret",
				format: "discord",
				enabled: true,
				delay: 0,
			});
			await colls.games.insertOne(
				testGame({
					_id: "imm-fail-game",
					game: { name: "Gaia Project", version: 1 },
					status: "active",
					players: [{ _id: userId }],
					currentPlayers: [{ _id: userId, timerStart: new Date() }],
				}),
			);
			await colls.gameNotifications.insertOne({
				game: "imm-fail-game",
				user: userId,
				kind: "currentMove",
				processed: false,
			});

			failing = true;
			calls = [];
			await processCurrentMove(); // must not throw
			failing = false;

			const stored = await colls.users.findOne({ _id: userId });
			const webhook = stored?.settings?.notifications?.webhook;
			assert.ok(webhook?.failingSince, "failure streak started");
			assert.ok(webhook?.nextRetryAt, "backoff scheduled");
			assert.ok(!webhook.disabled, "not disabled on first failure");
		});
	});

	after(() => {
		setWebhookFetchForTests(null);
		setSendmailForTests(null);
		return db().dropDatabase();
	});
});
