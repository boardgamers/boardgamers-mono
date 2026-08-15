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
	buildWebhookPayload,
	deliverGameNotificationWebhook,
	resolveGameLabels,
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
		// The gaia-project GameInfo (label "Gaia Project") is seeded in before().
		await colls.games.insertOne(
			testGame({
				_id: "hooked-game-1",
				game: { name: "gaia-project", version: 1 },
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
		assert.match(payload.content, /Gaia Project \(hooked-game-1\)/, "display name + full game id");
		assert.doesNotMatch(payload.content, /gaia-project/, "the display name replaces the internal slug");
		assert.match(payload.content, /1 game waiting/);
		assert.match(payload.embeds[0].title, /Gaia Project \(hooked-game-1\)/);
		assert.doesNotMatch(payload.embeds[0].title, /gaia-project/);
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

	// game.name is the internal slug; the payload must show the GameInfo label.
	const oneGame = [{ _id: "g1", game: { name: "gaia-project", version: 1 } }];

	before(async () => {
		await colls.gameInfos.insertOne({
			_id: { game: "gaia-project", version: 1 },
			meta: { public: true },
		});
		// Game-level metadata (label/players) lives on `gameMetadatas` (#298).
		await colls.gameMetadatas.insertOne({ _id: "gaia-project", label: "Gaia Project", players: [2] });
	});

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

	it("raw format carries event/user/waitingCount/games with slug + display name", async () => {
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
				games: z.array(z.object({ id: z.string(), game: z.string(), name: z.string(), url: z.string() })),
			})
			.parse(JSON.parse(calls[0].body));
		assert.strictEqual(payload.event, "turn");
		assert.strictEqual(payload.user, "hookraw");
		assert.strictEqual(payload.waitingCount, 1);
		assert.deepStrictEqual(
			payload.games.map((g) => [g.id, g.game, g.name]),
			[["g1", "gaia-project", "Gaia Project"]],
			"raw games[] keeps the slug in `game` and the display name in `name`",
		);
		assert.ok(payload.games[0].url.endsWith("/game/g1"));

		// The full id stays in the raw payload even when it's a long ObjectId hex.
		const longId = "0123456789abcdef01234567";
		const raw = z
			.object({ games: z.array(z.object({ id: z.string() })) })
			.parse(
				buildWebhookPayload("raw", (await colls.users.findOne({ _id: userId }))!, [
					{ _id: longId, game: { name: "gaia-project", version: 1, label: "Gaia Project" } },
				]),
			);
		assert.strictEqual(raw.games[0].id, longId, "raw games[].id is the full, untruncated id");
	});

	it("slack format shows the display name, not the slug", async () => {
		const userId = await insertWebhookUser("hookslack", {
			url: "https://hooks.slack.com/services/T/B/secret",
			format: "slack",
			enabled: true,
		});
		calls = [];
		await deliverGameNotificationWebhook((await colls.users.findOne({ _id: userId }))!, oneGame);
		assert.strictEqual(calls.length, 1);
		const payload = z.object({ text: z.string() }).parse(JSON.parse(calls[0].body));
		assert.match(payload.text, /Gaia Project \(g1\)/, "display name + full game id");
		assert.doesNotMatch(payload.text, /gaia-project/);
	});

	it("multiple waiting games are each listed as Label (full id)", async () => {
		const games = await resolveGameLabels([
			{ _id: "abcdef1234567890", game: { name: "gaia-project", version: 1 } },
			{ _id: "abcdef1234567891", game: { name: "gaia-project", version: 1 } },
			{ _id: "game-b", game: { name: "no-such-game", version: 1 } },
		]);
		const user = testUser({ account: { username: "hookmulti" } });
		const discord = z.object({ content: z.string() }).parse(buildWebhookPayload("discord", user, games));
		assert.match(
			discord.content,
			/Gaia Project \(abcdef1234567890\), Gaia Project \(abcdef1234567891\), no-such-game \(game-b\)/,
			"every waiting game is listed, with the full id telling duplicates apart",
		);
		assert.match(discord.content, /3 games waiting/);
		// The raw payload keeps the FULL ids, untruncated.
		const raw = z
			.object({ games: z.array(z.object({ id: z.string(), game: z.string(), name: z.string() })) })
			.parse(buildWebhookPayload("raw", user, games));
		assert.deepStrictEqual(raw.games, [
			{ id: "abcdef1234567890", game: "gaia-project", name: "Gaia Project" },
			{ id: "abcdef1234567891", game: "gaia-project", name: "Gaia Project" },
			{ id: "game-b", game: "no-such-game", name: "no-such-game" },
		]);
	});

	it("games without a GameInfo doc fall back to the slug", async () => {
		const games = await resolveGameLabels([{ _id: "g-unknown", game: { name: "no-such-game", version: 1 } }]);
		const user = testUser({ account: { username: "hookunknown" } });
		const discord = z.object({ content: z.string() }).parse(buildWebhookPayload("discord", user, games));
		assert.match(discord.content, /no-such-game \(g-unknown\)/);
		const raw = z
			.object({ games: z.array(z.object({ id: z.string(), game: z.string(), name: z.string() })) })
			.parse(buildWebhookPayload("raw", user, games));
		assert.deepStrictEqual(raw.games, [{ id: "g-unknown", game: "no-such-game", name: "no-such-game" }]);
	});

	it("an aliased game is shown under its alias, with the canonical name as basedOn", async () => {
		// Issue #106: a trademarked game is displayed under its alias everywhere,
		// webhooks included; the raw payload also exposes the rules source.
		await colls.gameInfos.insertOne({
			_id: { game: "splendor", version: 1 },
			meta: { public: true },
		});
		await colls.gameMetadatas.insertOne({
			_id: "splendor",
			label: "💎 Splendor",
			alias: "Gem Trader",
			players: [2, 3, 4],
		});
		const games = await resolveGameLabels([{ _id: "g-alias", game: { name: "splendor", version: 1 } }]);
		assert.strictEqual(games[0].game.label, "Gem Trader");
		assert.strictEqual(games[0].game.basedOn, "💎 Splendor");
		const user = testUser({ account: { username: "hookalias" } });
		const discord = z.object({ content: z.string() }).parse(buildWebhookPayload("discord", user, games));
		assert.match(discord.content, /Gem Trader \(g-alias\)/);
		assert.doesNotMatch(discord.content, /Splendor/);
		const raw = z
			.object({
				games: z.array(
					z.object({ id: z.string(), game: z.string(), name: z.string(), basedOn: z.string().optional() }).loose(),
				),
			})
			.parse(buildWebhookPayload("raw", user, games));
		const { url: _url, ...rawGame } = raw.games[0];
		assert.deepStrictEqual(rawGame, { id: "g-alias", game: "splendor", name: "Gem Trader", basedOn: "💎 Splendor" });
	});

	it("resolveGameLabels resolves by game (labels are shared across versions)", async () => {
		// Label is game-level metadata (#298): every version of a game shares it.
		await colls.gameInfos.insertOne({
			_id: { game: "versioned", version: 2 },
			meta: { public: true },
		});
		await colls.gameMetadatas.insertOne({ _id: "versioned", label: "Versioned Two", players: [2] });
		const games = await resolveGameLabels([
			{ _id: "gv1", game: { name: "versioned", version: 1 } },
			{ _id: "gv2", game: { name: "versioned", version: 2 } },
		]);
		assert.strictEqual(games[0].game.label, "Versioned Two");
		assert.strictEqual(games[1].game.label, "Versioned Two");
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
					game: { name: "gaia-project", version: 1 },
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
			assert.match(JSON.parse(calls[0].body).content, /Gaia Project \(immediate-game\)/);
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
					game: { name: "gaia-project", version: 1 },
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
					game: { name: "gaia-project", version: 1 },
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
					game: { name: "gaia-project", version: 1 },
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
