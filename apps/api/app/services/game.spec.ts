// Run via `pnpm test` (the package.json script), NOT bare `node --test` — see
// routes/game/index.spec.ts. Fixtures are built inline via test-helpers, per repo
// convention (no shared seed).
//
// Time travel: env.autoCancel*/autoDrop* are shrunk in before() so a sweep sees "1 day
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
import { signUnsubscribeToken } from "../models/user.ts";
import { unsubscribeOneClickUrl, unsubscribePageUrl } from "./mail.ts";
import { processStalledGame, processStalledGames } from "./game.ts";

const day = 24 * 3600 * 1000;

// Push a deadline back into the past in place — DB writes keep BSON Date
// instances, unlike replacing the field with a new Date.
function ago(d: Date, ms: number): Date {
	d.setTime(d.getTime() - ms);
	return d;
}

// Scaled-down inactivity thresholds (real ms): cancel grace 600s, drop grace 300s,
// warn 10s. Fixture stall ages are real seconds, comfortably inside their bracket so
// the suite's own runtime (repeated sweeps) can't push a fixture across a threshold.
const S = { grace: 600 * 1000, drop: 300 * 1000, warn: 10 * 1000 };

describe("processStalledGames — warn, auto-drop, then auto-cancel for stalled games (#94)", () => {
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
	const orig = { grace: 0, drop: 0, warn: 0, autoDrop: env.autoDrop };

	before(async () => {
		await db().dropDatabase();
		orig.grace = env.autoCancelGraceMs;
		orig.drop = env.autoDropGraceMs;
		orig.warn = env.autoCancelWarnMs;
		orig.autoDrop = env.autoDrop;
		env.autoCancelGraceMs = S.grace;
		env.autoDropGraceMs = S.drop;
		env.autoCancelWarnMs = S.warn;
		env.autoDrop = "on";
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
			// Warn point: deadline passed 25 real seconds ago (> warn 10s, < drop
			// 300s) → warned, not dropped or cancelled. Dates are built in the future and
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
			// Full grace: deadline passed 610 real seconds ago (> grace 600s) → cancelled.
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
						timerStart: ago(new Date(Date.now() + day), day + 610_000),
						deadline: ago(new Date(Date.now() + day), day + 610_000),
					},
				],
				options: { setup: { seed: "s", nbPlayers: 3, playerOrder: "random" }, timing },
				lastMove: new Date(Date.now() - 610_000),
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
			// Drop point: warned (dropWarn), deadline passed 310 real seconds ago
			// (> drop 300s, < grace 600s) → a dropPlayer notification is inserted.
			testGame({
				_id: "drop-point",
				game: { name: "test", version: 1 },
				status: "active",
				players: [
					{ _id: pA, name: "alice", remainingTime: 3600 },
					{ _id: pB, name: "bob", remainingTime: 3600 },
					{ _id: pD, name: "dave", remainingTime: 3600 },
				],
				currentPlayers: [
					{
						_id: pA,
						timerStart: ago(new Date(Date.now() + day), day + 310_000),
						deadline: ago(new Date(Date.now() + day), day + 310_000),
					},
				],
				dropWarn: true,
				options: { setup: { seed: "s", nbPlayers: 3, playerOrder: "random" }, timing },
				lastMove: new Date(Date.now() - 310_000),
				createdAt: subDays(new Date(), 60),
			}),
			// Two current players, only one of them past their own deadline → only
			// the expired one is dropped.
			testGame({
				_id: "multi-current",
				game: { name: "test", version: 1 },
				status: "active",
				players: [
					{ _id: pA, name: "alice", remainingTime: 3600 },
					{ _id: pD, name: "dave", remainingTime: 3600 },
				],
				currentPlayers: [
					{
						_id: pA,
						timerStart: ago(new Date(Date.now() + day), day + 310_000),
						deadline: ago(new Date(Date.now() + day), day + 310_000),
					},
					{ _id: pD, timerStart: new Date(), deadline: new Date(Date.now() + day) },
				],
				dropWarn: true,
				options: { setup: { seed: "s", nbPlayers: 2, playerOrder: "random" }, timing },
				lastMove: new Date(Date.now() - 310_000),
				createdAt: subDays(new Date(), 60),
			}),
			// Warned before auto-drop existed (cancelWarn, not dropWarn): keeps the
			// penalty-free cancel it was promised — never dropped, cancelled at grace.
			testGame({
				_id: "legacy-warned",
				game: { name: "test", version: 1 },
				status: "active",
				players: [
					{ _id: pA, name: "alice", remainingTime: 3600 },
					{ _id: pB, name: "bob", remainingTime: 3600 },
				],
				currentPlayers: [
					{
						_id: pA,
						timerStart: ago(new Date(Date.now() + day), day + 310_000),
						deadline: ago(new Date(Date.now() + day), day + 310_000),
					},
				],
				cancelWarn: true,
				options: { setup: { seed: "s", nbPlayers: 2, playerOrder: "random" }, timing },
				lastMove: new Date(Date.now() - 310_000),
				createdAt: subDays(new Date(), 60),
			}),
			// Stalled past the drop grace but never warned → warn first (drop on a
			// later sweep). Stalled player is bob (mailing off) → no warn email.
			testGame({
				_id: "warn-first",
				game: { name: "test", version: 1 },
				status: "active",
				players: [
					{ _id: pB, name: "bob", remainingTime: 3600 },
					{ _id: pA, name: "alice", remainingTime: 3600 },
				],
				currentPlayers: [
					{
						_id: pB,
						timerStart: ago(new Date(Date.now() + day), day + 310_000),
						deadline: ago(new Date(Date.now() + day), day + 310_000),
					},
				],
				options: { setup: { seed: "s", nbPlayers: 2, playerOrder: "random" }, timing },
				lastMove: new Date(Date.now() - 310_000),
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
						timerStart: ago(new Date(Date.now() + day), day + 610_000),
						deadline: ago(new Date(Date.now() + day), day + 610_000),
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
		env.autoDropGraceMs = orig.drop;
		env.autoCancelWarnMs = orig.warn;
		env.autoDrop = orig.autoDrop;
		setSendmailForTests(null);
		await db().dropDatabase();
	});

	it("warns in chat ~24h after the deadline passes, naming the stalled player and the coming drop", async () => {
		await processStalledGames();

		const chat = await colls.chatMessages.findOne({ room: "warn-point", type: "system" });
		assert.match(chat?.data?.text ?? "", /will be dropped for inactivity in \d+ days?/);
		assert.match(chat?.data?.text ?? "", /alice/);
		assert.match(chat?.data?.text ?? "", /drop them sooner/);

		// Warned, not cancelled or dropped, and the warning is marked.
		const game = await colls.games.findOne({ _id: "warn-point" });
		assert.equal(game?.status, "active");
		assert.equal(game?.cancelled, false);
		assert.equal(game?.dropWarn, true);
		assert.equal(game?.cancelWarn, undefined);
		assert.equal(await colls.gameNotifications.countDocuments({ game: "warn-point", kind: "dropPlayer" }), 0);
	});

	it("emails the pre-drop warning to the stalled player (opted-in only)", async () => {
		const warnMails = mails.filter((m) => m["o:tag"]?.[0] === "drop-warning");
		assert.equal(warnMails.length, 1, "only warn-point's alice is warned by mail (warn-first's bob opted out)");
		assert.match(String(warnMails[0].subject), /you will be dropped for inactivity in 1 day/);
		assert.match(String(warnMails[0].html), /Your clock ran out/);
	});

	it("auto-drops the warned player past the drop grace via the manual-drop notification path", async () => {
		const notifications = await colls.gameNotifications.find({ game: "drop-point", kind: "dropPlayer" }).toArray();
		assert.equal(notifications.length, 1);
		assert.ok(notifications[0].user?.equals(pA));
		assert.equal(notifications[0].processed, false, "the game-server applies the drop, not the sweep");
		assert.equal(notifications[0].meta?.auto, true);
		assert.ok(notifications[0].meta?.deadline instanceof Date);

		// The sweep itself doesn't mutate the game — the game-server does, under the game lock.
		const game = await colls.games.findOne({ _id: "drop-point" });
		assert.equal(game?.status, "active");
	});

	it("with several current players, only the one past their own deadline is dropped", async () => {
		const notifications = await colls.gameNotifications.find({ game: "multi-current", kind: "dropPlayer" }).toArray();
		assert.equal(notifications.length, 1);
		assert.ok(notifications[0].user?.equals(pA), "dave (future deadline) is not dropped");
	});

	it("a game warned with the cancel-only message (pre-auto-drop) is never dropped", async () => {
		assert.equal(await colls.gameNotifications.countDocuments({ game: "legacy-warned", kind: "dropPlayer" }), 0);
		const game = await colls.games.findOne({ _id: "legacy-warned" });
		assert.equal(game?.status, "active", "cancelled only at the full grace, as promised");
	});

	it("an unwarned game past the drop grace is warned first, dropped on a later sweep", async () => {
		assert.equal(await colls.gameNotifications.countDocuments({ game: "warn-first", kind: "dropPlayer" }), 0);
		const game = await colls.games.findOne({ _id: "warn-first" });
		assert.equal(game?.status, "active");
		assert.equal(game?.dropWarn, true);
		const chat = await colls.chatMessages.findOne({ room: "warn-first", type: "system" });
		assert.match(chat?.data?.text ?? "", /bob will be dropped for inactivity/);
	});

	it("a re-sweep doesn't duplicate a still-unprocessed drop notification", async () => {
		await processStalledGames();
		assert.equal(await colls.gameNotifications.countDocuments({ game: "drop-point", kind: "dropPlayer" }), 1);
		assert.equal(await colls.gameNotifications.countDocuments({ game: "multi-current", kind: "dropPlayer" }), 1);
		// …while warn-first, warned on the first sweep and already past the drop
		// grace, is dropped by this one.
		assert.equal(await colls.gameNotifications.countDocuments({ game: "warn-first", kind: "dropPlayer" }), 1);
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

	it("the prefilter selects unwarned games past warn, warned games past drop grace, and past full grace", async () => {
		// Self-contained fixtures (the shared games are mutated by the sweep tests
		// above); cleaned up at the end. Mirrors the three prefilter queries.
		const warnAgo = env.autoCancelWarnMs + 1000;
		const dropAgo = env.autoDropGraceMs + 1000;
		const graceAgo = env.autoCancelGraceMs + 1000;
		const pfGame = (id: string, over: { deadline: Date; cancelWarn?: boolean; dropWarn?: boolean }) =>
			testGame({
				_id: id,
				game: { name: "test", version: 1 },
				status: "active",
				players: [{ _id: pA, name: "alice", remainingTime: 3600 }],
				currentPlayers: [{ _id: pA, timerStart: new Date(), deadline: over.deadline }],
				options: { setup: { seed: "s", nbPlayers: 2, playerOrder: "random" }, timing },
				createdAt: subDays(new Date(), 60),
				...(over.cancelWarn ? { cancelWarn: true } : {}),
				...(over.dropWarn ? { dropWarn: true } : {}),
			});
		const ids = ["pf-fresh", "pf-unwarned", "pf-warned-pregrace", "pf-dropwarned-drop", "pf-warned-grace"];
		await colls.games.insertMany([
			pfGame("pf-fresh", { deadline: ago(new Date(), env.autoCancelWarnMs - 6000) }),
			pfGame("pf-unwarned", { deadline: ago(new Date(), warnAgo) }),
			pfGame("pf-warned-pregrace", { deadline: ago(new Date(), warnAgo), cancelWarn: true }),
			pfGame("pf-dropwarned-drop", { deadline: ago(new Date(), dropAgo), dropWarn: true }),
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
						dropWarn: { $ne: true },
						"currentPlayers.deadline": { $lt: new Date(now - env.autoCancelWarnMs) },
					},
					projection,
				)
				.toArray()
		).map((g) => g._id);
		const toDrop = (
			await colls.games
				.find(
					{
						status: "active",
						_id: { $in: ids },
						$or: [{ dropWarn: true }, { cancelWarn: true }],
						"currentPlayers.deadline": { $lt: new Date(now - env.autoDropGraceMs) },
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
						$or: [{ dropWarn: true }, { cancelWarn: true }],
						"currentPlayers.deadline": { $lt: new Date(now - env.autoCancelGraceMs) },
					},
					projection,
				)
				.toArray()
		).map((g) => g._id);

		assert.deepEqual(toWarn.sort(), ["pf-unwarned"]);
		assert.deepEqual(toDrop.sort(), ["pf-dropwarned-drop", "pf-warned-grace"]);
		assert.deepEqual(toCancel.sort(), ["pf-warned-grace"]);

		await colls.games.deleteMany({ _id: { $in: ids } });
	});

	it("only drops where warranted: exactly the three auto-drop notifications exist", async () => {
		assert.equal(await colls.gameNotifications.countDocuments({ kind: "dropPlayer" }), 3);
	});

	it("leaves healthy, freshly-stalled, deadline-less and bot-stalled games alone", async () => {
		for (const id of ["healthy", "fresh-stall", "no-deadline", "bot-clock"]) {
			const game = await colls.games.findOne({ _id: id });
			assert.equal(game?.status, "active", `${id} must stay active`);
			assert.equal(game?.cancelWarn, undefined, `${id} must not be warned`);
			assert.equal(game?.dropWarn, undefined, `${id} must not be warned`);
			assert.equal(await colls.chatMessages.countDocuments({ room: id }), 0, `${id} must get no chat message`);
		}
	});

	it("emails the cancel notice to opted-in humans only (never bots, opt-outs or unconfirmed)", () => {
		// full-grace: alice (opted-in) + dave (opted-in), carol dropped & unconfirmed
		// → 2 cancel mails, all opted-in.
		const cancelMails = mails.filter((m) => m["o:tag"]?.[0] === "game-cancelled");
		assert.equal(cancelMails.length, 2);
		assert.ok(cancelMails.every((m) => m.subject?.includes("cancelled for inactivity")));
		assert.equal(
			cancelMails.filter((m) => m.subject?.includes("Game full-grace:")).length,
			2,
			"both opted-in players of full-grace emailed",
		);
		assert.equal(mails.length, 3, "no mails beyond the 2 cancel notices and alice's pre-drop warning");
	});

	it("the sweep emails are shaped per #2: text part, tag, Reply-To, subdomain From, signed unsubscribe", async () => {
		for (const mail of mails) {
			assert.equal((mail["o:tag"] ?? []).length, 1);
			assert.match(String(mail["o:tag"]?.[0]), /^(game-cancelled|drop-warning)$/);
			assert.equal(mail["h:Reply-To"], env.contact);
			assert.match(String(mail.from), new RegExp(`@mg\\.${env.domain.replaceAll(".", "\\.")}>`));
			assert.ok(mail.text, "a text part must be present");
			assert.match(mail.text, /cancelled for inactivity|you will be dropped/);

			// List-Unsubscribe targets the RFC 8058 one-click endpoint with the
			// per-user signed token; the body links to the human landing page.
			const recipient = await colls.users.findOne({ "account.email": String(mail.to) });
			const token = signUnsubscribeToken(recipient!._id.toHexString(), "game");
			assert.equal(mail["h:List-Unsubscribe"], `<${unsubscribeOneClickUrl(token)}>`);
			assert.equal(mail["h:List-Unsubscribe-Post"], "List-Unsubscribe=One-Click");
			const pageUrl = unsubscribePageUrl(token);
			assert.ok(String(mail.html).includes(`href="${pageUrl}"`), "the HTML body links to the unsubscribe page");
			assert.ok(mail.text.includes(pageUrl), "the text part links to the unsubscribe page");
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
				// The game-server clears the warning markers on a move.
				$unset: { cancelWarn: "", dropWarn: "" },
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

	// Self-contained mode tests: flip env.autoDrop, insert a fixture, sweep it directly.
	const modeGame = (id: string, over: { ageMs: number; cancelWarn?: boolean; dropWarn?: boolean }) =>
		testGame({
			_id: id,
			game: { name: "test", version: 1 },
			status: "active",
			players: [
				{ _id: pA, name: "alice", remainingTime: 3600 },
				{ _id: pB, name: "bob", remainingTime: 3600 },
			],
			currentPlayers: [
				{
					_id: pA,
					timerStart: ago(new Date(Date.now() + day), day + over.ageMs),
					deadline: ago(new Date(Date.now() + day), day + over.ageMs),
				},
			],
			options: { setup: { seed: "s", nbPlayers: 2, playerOrder: "random" }, timing },
			lastMove: new Date(Date.now() - over.ageMs),
			createdAt: subDays(new Date(), 60),
			...(over.cancelWarn ? { cancelWarn: true } : {}),
			...(over.dropWarn ? { dropWarn: true } : {}),
		});

	it("autoDrop=dry-run: warns with the cancel message and never inserts a drop notification", async () => {
		env.autoDrop = "dry-run";
		try {
			await colls.games.insertMany([
				modeGame("dry-warn", { ageMs: 25_000 }),
				modeGame("dry-drop", { ageMs: 310_000, cancelWarn: true }),
			]);
			await processStalledGame("dry-warn");
			await processStalledGame("dry-drop");

			const warned = await colls.games.findOne({ _id: "dry-warn" });
			assert.equal(warned?.cancelWarn, true, "dry-run keeps the cancel-only warning");
			assert.equal(warned?.dropWarn, undefined);
			const chat = await colls.chatMessages.findOne({ room: "dry-warn", type: "system" });
			assert.match(chat?.data?.text ?? "", /cancelled for inactivity/);

			const dropped = await colls.games.findOne({ _id: "dry-drop" });
			assert.equal(dropped?.status, "active");
			assert.equal(await colls.gameNotifications.countDocuments({ game: "dry-drop", kind: "dropPlayer" }), 0);
		} finally {
			env.autoDrop = "on";
			await colls.games.deleteMany({ _id: { $in: ["dry-warn", "dry-drop"] } });
		}
	});

	it("autoDrop=off: warn-then-cancel only — no drops, cancel at the full grace still applies", async () => {
		env.autoDrop = "off";
		try {
			await colls.games.insertMany([
				modeGame("off-drop", { ageMs: 310_000, dropWarn: true }),
				modeGame("off-grace", { ageMs: 610_000, dropWarn: true }),
			]);
			await processStalledGame("off-drop");
			await processStalledGame("off-grace");

			assert.equal(await colls.gameNotifications.countDocuments({ kind: "dropPlayer", game: /^off-/ }), 0);
			assert.equal((await colls.games.findOne({ _id: "off-drop" }))?.status, "active");
			const cancelled = await colls.games.findOne({ _id: "off-grace" });
			assert.equal(cancelled?.status, "ended");
			assert.equal(cancelled?.cancelled, true, "the penalty-free cancel safety net still fires");
		} finally {
			env.autoDrop = "on";
			await colls.games.deleteMany({ _id: { $in: ["off-drop", "off-grace"] } });
		}
	});
});
