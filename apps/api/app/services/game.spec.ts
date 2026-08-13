// Run via `pnpm test` (the package.json script), NOT bare `node --test` — see
// routes/game/index.spec.ts. Fixtures are built inline via test-helpers, per repo
// convention (no shared seed).
import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { ObjectId } from "mongodb";
import { subDays } from "date-fns";
import { colls, db } from "../config/db.ts";
import env from "../config/env.ts";
import { setSendmailForTests, type MailSendData } from "../config/sendmail.ts";
import { testGame, testUser } from "../config/test-helpers.ts";
import { processStalledGames } from "./game.ts";

const day = 24 * 3600 * 1000;

describe("processStalledGames — auto-drop / auto-cancel for inactivity (#94)", () => {
	const active = { timePerGame: 2 * 24 * 3600, timePerMove: 3600, timer: { start: 0, end: 86400 } };
	const pA = new ObjectId();
	const pB = new ObjectId();
	const pC = new ObjectId();
	const botId = new ObjectId();
	let mails: MailSendData[];
	// Snapshot of `mails` after the first sweep, before the idempotency test resets it.
	let firstRunMails: MailSendData[] = [];

	// past(cp) = deadline 10 days ago (grace is 3d → 7 days past), timerStart 20 days ago
	const staleCp = (id: ObjectId) => ({
		_id: id,
		timerStart: new Date(Date.now() - 20 * day),
		deadline: new Date(Date.now() - 10 * day),
	});

	before(async () => {
		await db().dropDatabase();
		mails = [];
		setSendmailForTests(async (data) => {
			mails.push(data);
		});
		await colls.users.insertMany([
			testUser({
				_id: pA,
				account: { username: "alice" },
				settings: { mailing: { game: { activated: true } } },
				security: { confirmed: true },
			}),
			// Mailing off → never emailed.
			testUser({ _id: pB, account: { username: "bob" }, settings: { mailing: { game: { activated: false } } } }),
			// Unconfirmed account → never emailed (same rule as turn notifications).
			testUser({ _id: pC, account: { username: "carol" }, security: { confirmed: false } }),
		]);

		await colls.games.insertMany([
			// Stalled: A's deadline expired 7 days past the grace → dropped; B continues.
			testGame({
				_id: "stall-drop",
				game: { name: "test", version: 1 },
				status: "active",
				players: [
					{ _id: pA, name: "alice", remainingTime: 3600 },
					{ _id: pB, name: "bob", remainingTime: 3600 },
				],
				currentPlayers: [staleCp(pA)],
				options: { setup: { seed: "s", nbPlayers: 2, playerOrder: "random" }, timing: active },
				lastMove: subDays(new Date(), 10),
				createdAt: subDays(new Date(), 60),
			}),
			// Stalled and every remaining human is inactive (one already dropped) → cancel.
			testGame({
				_id: "stall-cancel",
				game: { name: "test", version: 1 },
				status: "active",
				players: [
					{ _id: pA, name: "alice", remainingTime: 3600 },
					{ _id: pB, name: "bob", remainingTime: 3600 },
					{ _id: pC, name: "carol", remainingTime: 0, dropped: true },
				],
				currentPlayers: [staleCp(pA), staleCp(pB)],
				options: { setup: { seed: "s", nbPlayers: 3, playerOrder: "random" }, timing: active },
				lastMove: subDays(new Date(), 10),
				createdAt: subDays(new Date(), 60),
			}),
			// Active game: A's deadline is still in the future → untouched.
			testGame({
				_id: "stall-active",
				game: { name: "test", version: 1 },
				status: "active",
				players: [
					{ _id: pA, name: "alice", remainingTime: 3600 },
					{ _id: pB, name: "bob", remainingTime: 3600 },
				],
				currentPlayers: [{ _id: pA, timerStart: new Date(), deadline: new Date(Date.now() + day) }],
				options: { setup: { seed: "s", nbPlayers: 2, playerOrder: "random" }, timing: active },
				lastMove: new Date(),
				createdAt: subDays(new Date(), 60),
			}),
			// Live/realtime game (timePerGame ≤ live threshold), idle past
			// autoCancelLiveIdleMs → cancelled outright, no drops.
			testGame({
				_id: "stall-live",
				game: { name: "test", version: 1 },
				status: "active",
				players: [
					{ _id: pA, name: "alice", remainingTime: 500 },
					{ _id: pB, name: "bob", remainingTime: 500 },
				],
				currentPlayers: [staleCp(pA)],
				options: {
					setup: { seed: "s", nbPlayers: 2, playerOrder: "random" },
					timing: { timePerGame: 600, timePerMove: 60, timer: { start: 0, end: 86400 } },
				},
				lastMove: subDays(new Date(), 30),
				createdAt: subDays(new Date(), 31),
			}),
			// A bot whose clock ran out is never dropped (a broken bot is a bug, not
			// inactivity); the game is left alone for an admin/engine fix.
			testGame({
				_id: "stall-bot",
				game: { name: "test", version: 1 },
				status: "active",
				players: [
					{ _id: pA, name: "alice", remainingTime: 3600 },
					{ _id: botId, name: "Rob (bot 1)", isBot: true, remainingTime: 3600 },
				],
				currentPlayers: [staleCp(botId)],
				options: { setup: { seed: "s", nbPlayers: 2, playerOrder: "random" }, timing: active },
				lastMove: subDays(new Date(), 10),
				createdAt: subDays(new Date(), 60),
			}),
			// Recent move but an expired deadline (clock restarted by a chat/ping):
			// the absolute idle floor protects it.
			testGame({
				_id: "stall-recent",
				game: { name: "test", version: 1 },
				status: "active",
				players: [
					{ _id: pA, name: "alice", remainingTime: 3600 },
					{ _id: pB, name: "bob", remainingTime: 3600 },
				],
				currentPlayers: [staleCp(pA)],
				options: { setup: { seed: "s", nbPlayers: 2, playerOrder: "random" }, timing: active },
				lastMove: subDays(new Date(), 2),
				createdAt: subDays(new Date(), 60),
			}),
			// Everyone inactive but the game is young → skipped until old enough to cancel.
			testGame({
				_id: "stall-young",
				game: { name: "test", version: 1 },
				status: "active",
				players: [
					{ _id: pA, name: "alice", remainingTime: 3600 },
					{ _id: pB, name: "bob", remainingTime: 3600 },
				],
				currentPlayers: [staleCp(pA), staleCp(pB)],
				options: { setup: { seed: "s", nbPlayers: 2, playerOrder: "random" }, timing: active },
				lastMove: subDays(new Date(), 10),
				createdAt: subDays(new Date(), 12),
			}),
		]);
	});

	after(async () => {
		setSendmailForTests(null);
		await db().dropDatabase();
	});

	it("drops the inactive current player in a stalled game (manual-drop notification shape)", async () => {
		await processStalledGames();

		const drops = await colls.gameNotifications.find({ game: "stall-drop", kind: "dropPlayer" }).toArray();
		assert.equal(drops.length, 1);
		assert.ok(drops[0].user?.equals(pA));
		assert.equal(drops[0].processed, false);
		assert.equal(drops[0].meta?.inactivity, true);
		assert.ok(drops[0].meta?.deadline instanceof Date);
		assert.ok(drops[0].meta?.timerStart instanceof Date);
		assert.equal(drops[0].meta?.remainingTime, 3600);

		// The game doc itself is untouched: the game-server performs the drop
		// (engine.dropPlayer → Elo/karma/chat, same as a manual drop).
		const game = await colls.games.findOne({ _id: "stall-drop" });
		assert.equal(game?.status, "active");
		assert.equal(game?.cancelled, false);
		assert.equal(game?.players.find((pl) => pl._id.equals(pA))?.dropped, false);

		const chat = await colls.chatMessages.findOne({ room: "stall-drop", type: "system" });
		assert.match(chat?.data?.text ?? "", /alice will be dropped for inactivity/);

		// Snapshot for the email test: the whole first sweep (drop + cancel) ran here.
		firstRunMails = mails;
	});

	it("cancels a stalled game with no active human left (gameEnded, not drops)", async () => {
		const game = await colls.games.findOne({ _id: "stall-cancel" });
		assert.equal(game?.status, "ended");
		assert.equal(game?.cancelled, true);
		assert.deepEqual(game?.currentPlayers, []);

		assert.equal(
			await colls.gameNotifications.countDocuments({ game: "stall-cancel", kind: "gameEnded", processed: false }),
			1,
		);
		assert.equal(await colls.gameNotifications.countDocuments({ game: "stall-cancel", kind: "dropPlayer" }), 0);

		const chat = await colls.chatMessages.findOne({ room: "stall-cancel", type: "system" });
		assert.match(chat?.data?.text ?? "", /cancelled/);
	});

	it("leaves active, bot-stalled, recently-moved and too-young games alone", async () => {
		for (const id of ["stall-active", "stall-bot", "stall-recent", "stall-young"]) {
			const game = await colls.games.findOne({ _id: id });
			assert.equal(game?.status, "active", `${id} must stay active`);
			assert.equal(game?.cancelled, false, `${id} must not be cancelled`);
			assert.equal(
				await colls.gameNotifications.countDocuments({ game: id, kind: { $in: ["dropPlayer", "gameEnded"] } }),
				0,
				`${id} must get no drop/end notification`,
			);
		}
	});

	it("emailed the affected players once (opted-in only), never the gameless bot", () => {
		// From the first run (before the idempotency test's reset). alice was in all
		// three handled games (dropped from stall-drop, cancelled stall-cancel and
		// stall-live) → exactly 3 mails, all to her. bob (mailing off), carol
		// (unconfirmed) and the bot (no account) got none.
		assert.equal(firstRunMails.length, 3);
		assert.ok(firstRunMails.every((m) => typeof m.to === "string" && m.to.includes("@test.com")));
		assert.ok(firstRunMails.every((m) => m.subject?.includes("inactivity")));
	});

	it("is idempotent: a re-run drops/cancels nothing twice", async () => {
		mails = [];
		await processStalledGames();

		assert.equal(await colls.gameNotifications.countDocuments({ game: "stall-drop", kind: "dropPlayer" }), 1);
		assert.equal(await colls.gameNotifications.countDocuments({ game: "stall-cancel", kind: "gameEnded" }), 1);
		assert.equal((await colls.games.findOne({ _id: "stall-cancel" }))?.status, "ended");
		assert.equal((await colls.games.findOne({ _id: "stall-live" }))?.status, "ended");
		assert.equal(mails.length, 0, "no second round of emails");
	});
});

describe("processStalledGames — abandoned live games (#94 follow-up)", () => {
	const liveTiming = { timePerGame: 600, timePerMove: 60, timer: { start: 0, end: 86400 } };
	const pD = new ObjectId();
	const pE = new ObjectId();
	const origLiveIdleMs = env.autoCancelLiveIdleMs;

	before(async () => {
		// Shrink the live-idle bar so "recent" fixtures (2d) stay recent while
		// "abandoned" ones (8d) trip it — defaults are 3d vs a 7d idle floor, too
		// close to express both sides comfortably.
		env.autoCancelLiveIdleMs = day;
		await colls.users.insertMany([
			testUser({ _id: pD, account: { username: "dave" } }),
			testUser({ _id: pE, account: { username: "erin" } }),
		]);
		await colls.games.insertMany([
			// Abandoned live game: last move 8 days ago → cancelled outright.
			testGame({
				_id: "live-cancel",
				game: { name: "test", version: 1 },
				status: "active",
				players: [
					{ _id: pD, name: "dave", remainingTime: 500 },
					{ _id: pE, name: "erin", remainingTime: 500 },
				],
				currentPlayers: [{ _id: pD, timerStart: subDays(new Date(), 8), deadline: subDays(new Date(), 8) }],
				options: { setup: { seed: "s", nbPlayers: 2, playerOrder: "random" }, timing: liveTiming },
				lastMove: subDays(new Date(), 8),
				createdAt: subDays(new Date(), 9),
			}),
			// Live game with a move 2 days ago (past liveIdle, short of the 7d
			// minIdle floor): recent enough → untouched.
			testGame({
				_id: "live-recent",
				game: { name: "test", version: 1 },
				status: "active",
				players: [
					{ _id: pD, name: "dave", remainingTime: 500 },
					{ _id: pE, name: "erin", remainingTime: 500 },
				],
				currentPlayers: [{ _id: pD, timerStart: subDays(new Date(), 2), deadline: subDays(new Date(), 2) }],
				options: { setup: { seed: "s", nbPlayers: 2, playerOrder: "random" }, timing: liveTiming },
				lastMove: subDays(new Date(), 2),
				createdAt: subDays(new Date(), 9),
			}),
			// Young abandoned live game: cancelled too — autoCancelMinAgeMs only
			// gates the async cancel (its "everyone dropped into engine limbo"
			// concern doesn't apply: live games never drop anyone).
			testGame({
				_id: "live-young",
				game: { name: "test", version: 1 },
				status: "active",
				players: [
					{ _id: pD, name: "dave", remainingTime: 500 },
					{ _id: pE, name: "erin", remainingTime: 500 },
				],
				currentPlayers: [{ _id: pD, timerStart: subDays(new Date(), 8), deadline: subDays(new Date(), 8) }],
				options: { setup: { seed: "s", nbPlayers: 2, playerOrder: "random" }, timing: liveTiming },
				lastMove: subDays(new Date(), 8),
				createdAt: subDays(new Date(), 9),
			}),
		]);
	});

	after(async () => {
		env.autoCancelLiveIdleMs = origLiveIdleMs;
	});

	it("cancels an abandoned live game outright — never drops anyone", async () => {
		await processStalledGames();

		for (const id of ["live-cancel", "live-young"]) {
			const game = await colls.games.findOne({ _id: id });
			assert.equal(game?.status, "ended", `${id} must be ended`);
			assert.equal(game?.cancelled, true, `${id} must be cancelled`);
			assert.deepEqual(game?.currentPlayers, []);
			assert.equal(
				await colls.gameNotifications.countDocuments({ game: id, kind: "gameEnded", processed: false }),
				1,
				`${id} must get a gameEnded notification`,
			);
		}
		assert.equal(
			await colls.gameNotifications.countDocuments({
				game: { $in: ["live-cancel", "live-young"] },
				kind: "dropPlayer",
			}),
			0,
			"live games never drop anyone",
		);
		const chat = await colls.chatMessages.findOne({ room: "live-cancel", type: "system" });
		assert.match(chat?.data?.text ?? "", /cancelled/);
	});

	it("leaves a recently-active live game alone", async () => {
		const game = await colls.games.findOne({ _id: "live-recent" });
		assert.equal(game?.status, "active");
		assert.equal(game?.cancelled, false);
		assert.equal(
			await colls.gameNotifications.countDocuments({ game: "live-recent", kind: { $in: ["dropPlayer", "gameEnded"] } }),
			0,
		);
	});
});
