// Run via `pnpm test` (the package.json script), NOT bare `node --test` — see
// routes/game/index.spec.ts. Fixtures are built inline via test-helpers, per repo
// convention (no shared seed).
//
// Time travel: env.autoCancel* are shrunk in before() so a sweep sees "1 day
// stalled" / "10 days stalled" fixtures without real waits (the env is read per
// sweep, and processStalledGames is called directly — no fake timers needed).
import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { ObjectId } from "mongodb";
import { subDays } from "date-fns";
import { colls, db } from "../config/db.ts";
import env from "../config/env.ts";
import { setSendmailForTests, type MailSendData } from "../config/sendmail.ts";
import { testGame, testUser } from "../config/test-helpers.ts";
import { processStalledGame, processStalledGames } from "./game.ts";

const day = 24 * 3600 * 1000;

// Push a deadline back into the past in place — DB writes keep BSON Date
// instances, unlike replacing the field with a new Date.
function ago(d: Date, ms: number): Date {
	d.setTime(d.getTime() - ms);
	return d;
}

// Scaled-down inactivity thresholds (real ms): grace 100s, warn 10s. Fixture
// "days" are built from real seconds, so the fixture clock runs ~864× fast: a
// deadline 25 fixture-hours back is ~104 real seconds back.
const S = { grace: 100 * 1000, warn: 10 * 1000 };

describe("processStalledGames — warn-then-auto-cancel for stalled games (#94)", () => {
	// Timing windows scaled like the thresholds (timer.end: 86400s would map to 100
	// real seconds → every "past" deadline would be jumped to the next window start,
	// i.e. the future). 120s/90s keep past deadlines past and future ones future.
	const timing = { timePerGame: 2 * 24 * 3600, timePerMove: 3600, timer: { start: 0, end: 120 } };
	const liveTiming = { timePerGame: 600, timePerMove: 60, timer: { start: 0, end: 90 } };
	const pA = new ObjectId();
	const pB = new ObjectId();
	const pC = new ObjectId();
	const pD = new ObjectId();
	const botId = new ObjectId();
	let mails: MailSendData[] = [];
	const orig = { grace: 0, warn: 0 };

	before(async () => {
		await db().dropDatabase();
		orig.grace = env.autoCancelGraceMs;
		orig.warn = env.autoCancelWarnMs;
		env.autoCancelGraceMs = S.grace;
		env.autoCancelWarnMs = S.warn;
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
			// Opted-in second player, for the "everyone gets the cancel email" check.
			testUser({
				_id: pD,
				account: { username: "dave" },
				settings: { mailing: { game: { activated: true } } },
				security: { confirmed: true },
			}),
		]);

		await colls.games.insertMany([
			// Warn point: deadline passed 25 real seconds ago (> warn 10s, < grace
			// 100s) → warned, not cancelled. Dates are built in the future and
			// shifted back in place (ago()) so DB writes keep them BSON Dates — a
			// driver-serialized date would defeat getTime() comparisons.
			testGame({
				_id: "warn-point",
				game: { name: "test", version: 1 },
				status: "active",
				players: [
					{ _id: pA, name: "alice", remainingTime: 3600 },
					{ _id: pB, name: "bob", remainingTime: 3600 },
				],
				currentPlayers: [
					{
						_id: pA,
						timerStart: ago(new Date(Date.now() + day), day + 25_000),
						deadline: ago(new Date(Date.now() + day), day + 25_000),
					},
				],
				options: { setup: { seed: "s", nbPlayers: 2, playerOrder: "random" }, timing },
				lastMove: new Date(Date.now() - 25_000),
				createdAt: subDays(new Date(), 60),
			}),
			// Freshly stalled: deadline passed 5 real seconds ago (< warn 10s) → untouched.
			testGame({
				_id: "fresh-stall",
				game: { name: "test", version: 1 },
				status: "active",
				players: [
					{ _id: pA, name: "alice", remainingTime: 3600 },
					{ _id: pB, name: "bob", remainingTime: 3600 },
				],
				currentPlayers: [
					{
						_id: pA,
						timerStart: ago(new Date(Date.now() + day), day + 5_000),
						deadline: ago(new Date(Date.now() + day), day + 5_000),
					},
				],
				options: { setup: { seed: "s", nbPlayers: 2, playerOrder: "random" }, timing },
				lastMove: new Date(Date.now() - 5_000),
				createdAt: subDays(new Date(), 60),
			}),
			// Full grace: deadline passed 110 real seconds ago (> grace 100s) → cancelled.
			testGame({
				_id: "full-grace",
				game: { name: "test", version: 1 },
				status: "active",
				players: [
					{ _id: pA, name: "alice", remainingTime: 3600 },
					{ _id: pD, name: "dave", remainingTime: 3600 },
					{ _id: pC, name: "carol", remainingTime: 0, dropped: true },
				],
				currentPlayers: [
					{
						_id: pA,
						timerStart: ago(new Date(Date.now() + day), day + 110_000),
						deadline: ago(new Date(Date.now() + day), day + 110_000),
					},
				],
				options: { setup: { seed: "s", nbPlayers: 3, playerOrder: "random" }, timing },
				lastMove: new Date(Date.now() - 110_000),
				createdAt: subDays(new Date(), 60),
			}),
			// No deadline on the current player (live/realtime games between timer
			// jumps, or any game where the clock isn't running) → never touched.
			testGame({
				_id: "no-deadline",
				game: { name: "test", version: 1 },
				status: "active",
				players: [
					{ _id: pA, name: "alice", remainingTime: 500 },
					{ _id: pB, name: "bob", remainingTime: 500 },
				],
				currentPlayers: [{ _id: pA, timerStart: new Date(Date.now() - 1_200_000) }],
				options: { setup: { seed: "s", nbPlayers: 2, playerOrder: "random" }, timing: liveTiming },
				lastMove: new Date(Date.now() - 1_200_000),
				createdAt: subDays(new Date(), 12),
			}),
			// Healthy game (deadline in the future) → untouched.
			testGame({
				_id: "healthy",
				game: { name: "test", version: 1 },
				status: "active",
				players: [
					{ _id: pA, name: "alice", remainingTime: 3600 },
					{ _id: pB, name: "bob", remainingTime: 3600 },
				],
				currentPlayers: [{ _id: pA, timerStart: new Date(), deadline: new Date(Date.now() + day) }],
				options: { setup: { seed: "s", nbPlayers: 2, playerOrder: "random" }, timing },
				lastMove: new Date(),
				createdAt: subDays(new Date(), 60),
			}),
			// A bot whose clock ran out never stalls a game (a broken bot is a bug,
			// not inactivity) → untouched, left for an admin fix.
			testGame({
				_id: "bot-clock",
				game: { name: "test", version: 1 },
				status: "active",
				players: [
					{ _id: pA, name: "alice", remainingTime: 3600 },
					{ _id: botId, name: "Rob (bot 1)", isBot: true, remainingTime: 3600 },
				],
				currentPlayers: [
					{
						_id: botId,
						timerStart: ago(new Date(Date.now() + day), day + 110_000),
						deadline: ago(new Date(Date.now() + day), day + 110_000),
					},
				],
				options: { setup: { seed: "s", nbPlayers: 2, playerOrder: "random" }, timing },
				lastMove: new Date(),
				createdAt: subDays(new Date(), 60),
			}),
		]);
	});

	after(async () => {
		env.autoCancelGraceMs = orig.grace;
		env.autoCancelWarnMs = orig.warn;
		setSendmailForTests(null);
		await db().dropDatabase();
	});

	it("warns in chat ~24h after the deadline passes, naming the stalled player and the manual drop", async () => {
		await processStalledGames();

		const chat = await colls.chatMessages.findOne({ room: "warn-point", type: "system" });
		assert.match(chat?.data?.text ?? "", /cancelled for inactivity in \d+ days?/);
		assert.match(chat?.data?.text ?? "", /alice/);
		assert.match(chat?.data?.text ?? "", /drop the inactive player/);

		// Warned, not cancelled, and the warning is marked.
		const game = await colls.games.findOne({ _id: "warn-point" });
		assert.equal(game?.status, "active");
		assert.equal(game?.cancelled, false);
		assert.equal(game?.cancelWarn, true);
	});

	it("cancels a game still stalled after the full grace period (penalty-free cancel shape)", async () => {
		const game = await colls.games.findOne({ _id: "full-grace" });
		assert.equal(game?.status, "ended");
		assert.equal(game?.cancelled, true);
		assert.deepEqual(game?.currentPlayers, []);
		assert.equal(
			await colls.gameNotifications.countDocuments({ game: "full-grace", kind: "gameEnded", processed: false }),
			1,
			"full-grace must get a gameEnded notification",
		);
		const chat = await colls.chatMessages.findOne({ room: "full-grace", type: "system" });
		assert.match(chat?.data?.text ?? "", /cancelled for inactivity/);
	});

	it("the prefilter selects unwarned games past the warn threshold and warned games past grace", async () => {
		// Self-contained fixtures (the shared games are mutated by the sweep tests
		// above); cleaned up at the end. Mirrors the two prefilter queries.
		const warnAgo = env.autoCancelWarnMs + 1000;
		const graceAgo = env.autoCancelGraceMs + 1000;
		const pfGame = (id: string, over: { deadline: Date; cancelWarn?: boolean }) =>
			testGame({
				_id: id,
				game: { name: "test", version: 1 },
				status: "active",
				players: [{ _id: pA, name: "alice", remainingTime: 3600 }],
				currentPlayers: [{ _id: pA, timerStart: new Date(), deadline: over.deadline }],
				options: { setup: { seed: "s", nbPlayers: 2, playerOrder: "random" }, timing },
				createdAt: subDays(new Date(), 60),
				...(over.cancelWarn ? { cancelWarn: true } : {}),
			});
		const ids = ["pf-fresh", "pf-unwarned", "pf-warned-pregrace", "pf-warned-grace"];
		await colls.games.insertMany([
			pfGame("pf-fresh", { deadline: ago(new Date(), env.autoCancelWarnMs - 6000) }),
			pfGame("pf-unwarned", { deadline: ago(new Date(), warnAgo) }),
			pfGame("pf-warned-pregrace", { deadline: ago(new Date(), warnAgo), cancelWarn: true }),
			pfGame("pf-warned-grace", { deadline: ago(new Date(), graceAgo), cancelWarn: true }),
		]);

		const now = Date.now();
		const projection = { projection: { _id: 1 } };
		const toWarn = (
			await colls.games
				.find(
					{
						status: "active",
						_id: { $in: ids },
						cancelWarn: { $ne: true },
						"currentPlayers.deadline": { $lt: new Date(now - env.autoCancelWarnMs) },
					},
					projection,
				)
				.toArray()
		).map((g) => g._id);
		const toCancel = (
			await colls.games
				.find(
					{
						status: "active",
						_id: { $in: ids },
						cancelWarn: true,
						"currentPlayers.deadline": { $lt: new Date(now - env.autoCancelGraceMs) },
					},
					projection,
				)
				.toArray()
		).map((g) => g._id);

		assert.deepEqual(toWarn.sort(), ["pf-unwarned"]);
		assert.deepEqual(toCancel.sort(), ["pf-warned-grace"]);

		await colls.games.deleteMany({ _id: { $in: ids } });
	});

	it("never drops players: no dropPlayer notification anywhere", async () => {
		assert.equal(await colls.gameNotifications.countDocuments({ kind: "dropPlayer" }), 0);
	});

	it("leaves healthy, freshly-stalled, deadline-less and bot-stalled games alone", async () => {
		for (const id of ["healthy", "fresh-stall", "no-deadline", "bot-clock"]) {
			const game = await colls.games.findOne({ _id: id });
			assert.equal(game?.status, "active", `${id} must stay active`);
			assert.equal(game?.cancelWarn, undefined, `${id} must not be warned`);
			assert.equal(await colls.chatMessages.countDocuments({ room: id }), 0, `${id} must get no chat message`);
		}
	});

	it("emails the cancel notice to opted-in humans only (never bots, opt-outs or unconfirmed)", () => {
		// Cancel emails only (warns are chat-only). full-grace: alice (opted-in) +
		// dave (opted-in), carol dropped & unconfirmed → 2 mails, all opted-in.
		assert.equal(mails.length, 2);
		assert.ok(mails.every((m) => m.subject?.includes("cancelled for inactivity")));
		assert.equal(
			mails.filter((m) => m.subject?.includes("Game full-grace:")).length,
			2,
			"both opted-in players of full-grace emailed",
		);
	});

	it("the cancel email is shaped per #2: text part, tag, Reply-To, subdomain From, unsubscribe", () => {
		const accountUrl = `https://${env.site}/account`;
		for (const mail of mails) {
			assert.deepEqual(mail["o:tag"], ["game-cancelled"]);
			assert.equal(mail["h:Reply-To"], env.contact);
			assert.match(String(mail.from), new RegExp(`@mg\\.${env.domain.replaceAll(".", "\\.")}>`));
			assert.ok(mail.text, "a text part must be present");
			assert.match(mail.text, /cancelled for inactivity/);
			assert.equal(mail["h:List-Unsubscribe"], `<${accountUrl}>`);
			assert.ok(String(mail.html).includes(`href="${accountUrl}"`), "the HTML body links to the account page");
			assert.ok(mail.text.includes(accountUrl), "the text part links to the account page");
		}
	});

	it("does not re-post the warning on a re-sweep (once per stall episode)", async () => {
		await processStalledGames();

		assert.equal(await colls.chatMessages.countDocuments({ room: "warn-point", type: "system" }), 1);
		assert.equal(await colls.chatMessages.countDocuments({ room: "full-grace", type: "system" }), 1);
		assert.equal(await colls.gameNotifications.countDocuments({ game: "full-grace", kind: "gameEnded" }), 1);
	});

	it("a move during grace resets the episode: no cancel, and a fresh warning on the next stall", async () => {
		// Simulate a move: refresh lastMove and give the player a fresh future
		// deadline — stalled no longer → the sweep leaves the game alone (per-game
		// call: fresh-stall/full-grace ages are tuned for the very first sweep).
		await colls.games.updateOne(
			{ _id: "warn-point" },
			{
				$set: {
					lastMove: new Date(),
					"currentPlayers.0.timerStart": new Date(),
					"currentPlayers.0.deadline": new Date(Date.now() + day),
				},
				// The game-server clears the warning marker on a move.
				$unset: { cancelWarn: "" },
			},
		);
		await processStalledGame("warn-point");
		let game = await colls.games.findOne({ _id: "warn-point" });
		assert.equal(game?.status, "active", "a move during grace prevents the cancel");

		// The player stalls again (new deadline, 25 real seconds in the past → past
		// warn, short of grace) → a fresh warning is posted for the new episode.
		await colls.games.updateOne(
			{ _id: "warn-point" },
			{
				$set: {
					lastMove: new Date(Date.now() - 25_000),
					"currentPlayers.0.timerStart": ago(new Date(Date.now() + day), day + 25_000),
					"currentPlayers.0.deadline": ago(new Date(Date.now() + day), day + 25_000),
				},
			},
		);
		await processStalledGame("warn-point");
		assert.equal(
			await colls.chatMessages.countDocuments({ room: "warn-point", type: "system" }),
			2,
			"a fresh warning is posted for the new stall episode",
		);
		game = await colls.games.findOne({ _id: "warn-point" });
		assert.equal(game?.status, "active");
	});
});
