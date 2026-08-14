import { subHours, subWeeks } from "date-fns";
import { shuffle } from "@bgs/utils/array";
import { ObjectId } from "mongodb";
import locks from "../config/locks.ts";
import type { GameDoc, PlayerInfo } from "@bgs/models";
import { colls } from "../config/db.ts";
import env from "../config/env.ts";
import sendmail from "../config/sendmail.ts";

export async function notifyGameStart(game: GameDoc) {
	if (game.options.setup.playerOrder === "random") {
		const shuffled = shuffle(game.players);
		game.players = [];
		game.players.push(...shuffled);
		await colls.games.replaceOne({ _id: game._id }, game);
	}

	await colls.chatMessages.insertOne({
		_id: new ObjectId(),
		room: game._id,
		type: "system",
		data: { text: "Game started" },
	});
	const now = new Date();
	await colls.gameNotifications.insertOne({
		game: game._id,
		kind: "gameStarted",
		processed: false,
		createdAt: now,
		updatedAt: now,
	});
}

export async function cancelOldOpenGames() {
	// Remove live games an hour old
	await colls.games.deleteMany({
		status: "open",
		"options.timing.scheduledStart": { $exists: false },
		"options.timing.timePerGame": { $lte: 600 },
		createdAt: { $lt: subHours(Date.now(), 1) },
	});

	// Remove fast games three hours old
	await colls.games.deleteMany({
		status: "open",
		"options.timing.scheduledStart": { $exists: false },
		"options.timing.timePerGame": { $lte: 3600 },
		createdAt: { $lt: subHours(Date.now(), 3) },
	});

	// Remove games a week old
	await colls.games.deleteMany({
		status: "open",
		"options.timing.scheduledStart": { $exists: false },
		createdAt: { $lt: subWeeks(Date.now(), 1) },
	});
}

export async function processSchedulesGames() {
	{
		await using _lock = await locks.lock("game", "scheduled-games");
		const cursor = colls.games.find({
			status: "open",
			"options.timing.scheduledStart": { $lt: new Date() },
		});
		for await (const game of cursor) {
			const g: GameDoc = game;

			if (!g.ready) {
				await colls.chatMessages.insertOne({
					_id: new ObjectId(),
					room: game._id,
					type: "system",
					data: { text: "Game cancelled because it's not fully ready at scheduled start date" },
				});
				g.cancelled = true;
				g.status = "ended";
				await colls.games.replaceOne({ _id: g._id }, g);
				continue;
			}
			// Do this to avoid being caught in a loop again, before game server starts the game
			g.options.timing.scheduledStart = undefined;
			await colls.games.replaceOne({ _id: g._id }, g);
			await notifyGameStart(g);
		}
	}
}

export async function processUnreadyGames() {
	const gamesList = await colls.games
		.find(
			{
				ready: false,
				status: "open",
				"currentPlayers.0.deadline": { $lt: Date.now() },
			},
			{ projection: { _id: 1 } },
		)
		.toArray();

	for (const toFetch of gamesList) {
		try {
			await using _lock = await locks.lock("game", toFetch._id);
			const game = await colls.games.findOne({ _id: toFetch._id }, { projection: { status: 1 } });

			if (game?.status === "open") {
				await colls.chatMessages.insertOne({
					_id: new ObjectId(),
					room: game._id,
					type: "system",
					data: { text: "Game cancelled because host didn't set the final options in time" },
				});
				await colls.games.updateOne({ _id: game._id }, { $set: { cancelled: true, status: "ended" } });
			}
		} catch (err) {
			console.error(err);
		}
	}
}

function activeHumanPlayers(game: Pick<GameDoc, "players">): PlayerInfo[] {
	return game.players.filter((pl) => !pl.isBot && !pl.dropped && !pl.quit);
}

/**
 * One inactivity sweep over an already-loaded game (#94), with a warn-then-cancel
 * model — the sweep never drops anyone (that's the players'/game-server's call).
 *
 * A game is "stalled" when a current player's clock deadline has passed (the
 * window-aware `cp.deadline < now` signal). Games without a deadline (live/
 * realtime games, or any game whose current players have none) are never
 * touched.
 *
 * Once stalled, post a system chat warning ("will be cancelled in X days — the
 * other players can drop the inactive player to keep going") env.autoCancelWarnMs
 * after the deadline, then cancel if the game is still stalled after
 * env.autoCancelGraceMs. The warning is sent at most once per stall episode
 * (marker on the game doc); a game that moves and later stalls again gets a
 * fresh warning. Cancelling uses the manual vote-to-cancel shape (status=ended,
 * cancelled, currentPlayers=[], gameEnded notification), so it's penalty-free
 * (no Elo/karma).
 *
 * Locking: `game-cancel:<id>` — the same key the manual cancel/quit/drop routes use
 * (they're what these updates must serialize with). The game-server's move path
 * locks `game:<id>` instead; that pre-existing split (#280) self-heals (read-
 * modify-write `replaceOne`, and the game-server no-ops on a non-active game) and
 * is unchanged here.
 */
export async function processStalledGame(gameId: string): Promise<void> {
	await using _lock = await locks.lock("game-cancel", gameId);
	const game = await colls.games.findOne({ _id: gameId });

	if (!game || game.status !== "active") {
		return;
	}

	const now = new Date();

	// Stalled only when a current player's deadline has passed. No deadline →
	// nothing to cancel on.
	const expiredDeadlines = (game.currentPlayers ?? [])
		.map((cp) => cp.deadline)
		.filter((dl): dl is Date => dl !== undefined && dl.getTime() < now.getTime());
	if (expiredDeadlines.length === 0) {
		return;
	}

	// A stalled *current* human is who's waited on. A game stalled only on bots
	// (a broken bot is a bug, not inactivity) is left alone for an admin fix.
	const stalledPlayers = (game.currentPlayers ?? [])
		.map((cp) => game.players.find((pl) => pl._id.equals(cp._id)))
		.filter((pl): pl is PlayerInfo => pl !== undefined && !pl.isBot && !pl.dropped && !pl.quit);
	if (stalledPlayers.length === 0) {
		return;
	}

	// The stall is clocked from the earliest expired deadline.
	const stallSince = new Date(Math.min(...expiredDeadlines.map((dl) => dl.getTime())));
	const stallAgeMs = now.getTime() - stallSince.getTime();
	const stallMarker = `deadline:${stallSince.toISOString()}`;

	if (stallAgeMs >= env.autoCancelGraceMs) {
		await cancelInactiveGame(game, now);
		return;
	}

	if (stallAgeMs >= env.autoCancelWarnMs && game.cancelWarn !== stallMarker) {
		const daysLeft = Math.max(1, Math.ceil((env.autoCancelGraceMs - stallAgeMs) / (24 * 3600 * 1000)));
		const names = stalledPlayers.map((pl) => pl.name).join(", ") || "the current player(s)";
		await colls.chatMessages.insertOne({
			_id: new ObjectId(),
			room: game._id,
			type: "system",
			data: {
				text: `This game will be cancelled for inactivity in ${daysLeft} day${daysLeft > 1 ? "s" : ""} if no move is played. Waiting on ${names} — the other players can drop the inactive player to keep the game going.`,
			},
		});
		await colls.games.updateOne({ _id: game._id }, { $set: { cancelWarn: stallMarker } });
	}
}

// Cancel like the manual vote-to-cancel route does (same doc update + gameEnded
// notification, so Elo/karma handling matches a player-agreed cancel).
async function cancelInactiveGame(game: GameDoc, now: Date): Promise<void> {
	await colls.chatMessages.insertOne({
		_id: new ObjectId(),
		room: game._id,
		type: "system",
		data: { text: "Game cancelled for inactivity" },
	});
	game.status = "ended";
	game.cancelled = true;
	game.currentPlayers = [];
	await colls.games.replaceOne({ _id: game._id }, game);
	await colls.gameNotifications.insertOne({
		kind: "gameEnded",
		game: game._id,
		processed: false,
		createdAt: now,
		updatedAt: now,
	});
	await emailCancelNotice(game);
}

// Best-effort email notice, after the cancel is committed and the chat system
// message posted. Bots have no account (never emailed). Honors the same opt-in
// as turn notifications (settings.mailing.game.activated), and sendmail itself
// no-ops on installs without a mailing provider — so a failure here can never
// roll back the cancel.
async function emailCancelNotice(game: GameDoc): Promise<void> {
	const users = await colls.users
		.find(
			{ _id: { $in: activeHumanPlayers(game).map((pl) => pl._id) } },
			{
				projection: { "account.username": 1, "account.email": 1, "settings.mailing.game": 1, "security.confirmed": 1 },
			},
		)
		.toArray();
	const url = `https://${env.site}/game/${encodeURIComponent(game._id)}`;

	await Promise.all(
		users.map(async (user) => {
			if (!user.account.email || !user.security.confirmed || !user.settings?.mailing?.game?.activated) {
				return;
			}
			await sendmail({
				from: env.noreply,
				to: user.account.email,
				subject: `Game ${game._id}: cancelled for inactivity`,
				html: `
				<p>Hello ${user.account.username}</p>
				<p>Your game <a href='${url}'>${game._id}</a> (${game.game.name}) was cancelled for inactivity.</p>
				<p>You can change your email settings and unsubscribe
				<a href='https://${env.site}/account'>here</a>.</p>`,
			}).catch(console.error);
		}),
	);
}

export async function processStalledGames(): Promise<void> {
	// Loose prefilter (re-checked per game under the lock): any active game with a
	// current player whose deadline has already passed.
	const candidates = await colls.games
		.find(
			{
				status: "active",
				currentPlayers: { $elemMatch: { deadline: { $lt: new Date() } } },
			},
			{ projection: { _id: 1 } },
		)
		.toArray();

	for (const { _id } of candidates) {
		try {
			await processStalledGame(_id);
		} catch (err) {
			console.error(err);
		}
	}
}
