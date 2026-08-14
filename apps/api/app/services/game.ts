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
 * Inactivity sweep for one game (#94): warn in chat once stalled past
 * autoCancelWarnMs, cancel past autoCancelGraceMs — never drops anyone. Stalled
 * = a current player's deadline passed; no deadline → untouched. `cancelWarn`
 * holds the warned episode's start, so it warns once per episode and re-warns
 * after a move. Locks `game-cancel:<id>` like the manual cancel/quit/drop routes
 * (the move path's `game:<id>` split is #280, self-healing).
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

	if (stallAgeMs >= env.autoCancelGraceMs) {
		await cancelInactiveGame(game, now);
		return;
	}

	if (stallAgeMs >= env.autoCancelWarnMs && game.cancelWarn?.getTime() !== stallSince.getTime()) {
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
		await colls.games.updateOne({ _id: game._id }, { $set: { cancelWarn: stallSince } });
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
	// Prefilter (re-checked per game under the lock): a current player past the
	// warn threshold. Nothing happens before the warn point, so a game seconds
	// past its deadline is never fetched/locked. Dot-notation matches if any
	// array element matches — fine for this single-condition check.
	const candidates = await colls.games
		.find(
			{
				status: "active",
				"currentPlayers.deadline": { $lt: new Date(Date.now() - env.autoCancelWarnMs) },
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
