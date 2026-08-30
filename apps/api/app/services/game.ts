import { subHours, subWeeks } from "date-fns";
import { shuffle } from "@bgs/utils/array";
import { ObjectId } from "mongodb";
import locks from "../config/locks.ts";
import type { GameDoc, PlayerInfo } from "@bgs/models";
import { colls } from "../config/db.ts";
import env from "../config/env.ts";
import { signUnsubscribeToken } from "../models/user.ts";
import { sendMail } from "./mail.ts";

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
	// The singleton lock only guards the scan against a concurrent scan; each game's
	// write happens under its own `game:<id>` lock (#423) — a replaceOne from the scan's
	// stale snapshot could otherwise clobber a concurrent join on a scheduled game.
	await using scanLock = await locks.lock("game", "scheduled-games");
	if (!scanLock) {
		return;
	}
	const due = await colls.games
		.find({ status: "open", "options.timing.scheduledStart": { $lt: new Date() } }, { projection: { _id: 1 } })
		.toArray();

	for (const { _id } of due) {
		try {
			await using _lock = await locks.lockWait("game", _id);
			// Re-read under the lock: a join/unjoin/cancel may have landed since the scan.
			const g: GameDoc | null = await colls.games.findOne({
				_id,
				status: "open",
				"options.timing.scheduledStart": { $lt: new Date() },
			});
			if (!g) {
				continue;
			}

			if (!g.ready) {
				await colls.chatMessages.insertOne({
					_id: new ObjectId(),
					room: g._id,
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
		} catch (err) {
			// A contended game (423) or a one-off failure must not abort the whole sweep —
			// the game stays due and the next tick retries it.
			console.error(err);
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
			await using _lock = await locks.lockWait("game", toFetch._id);
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

export async function processStalledGame(gameId: string): Promise<void> {
	await using _lock = await locks.lockWait("game", gameId);
	const game = await colls.games.findOne({ _id: gameId });

	if (!game || game.status !== "active") {
		return;
	}

	const now = new Date();

	const expiredDeadlines = (game.currentPlayers ?? [])
		.map((cp) => cp.deadline)
		.filter((dl): dl is Date => dl !== undefined && dl.getTime() < now.getTime());
	if (expiredDeadlines.length === 0) {
		return;
	}

	// A bot whose clock expired is a bug, not inactivity — leave it for an admin.
	const stalledPlayers = (game.currentPlayers ?? [])
		.map((cp) => game.players.find((pl) => pl._id.equals(cp._id)))
		.filter((pl): pl is PlayerInfo => pl !== undefined && !pl.isBot && !pl.dropped && !pl.quit);
	if (stalledPlayers.length === 0) {
		return;
	}

	const stallSince = new Date(Math.min(...expiredDeadlines.map((dl) => dl.getTime())));
	const stallAgeMs = now.getTime() - stallSince.getTime();

	if (stallAgeMs >= env.autoCancelGraceMs) {
		await cancelInactiveGame(game, now);
		return;
	}

	if (stallAgeMs >= env.autoCancelWarnMs && !game.cancelWarn) {
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
		await colls.games.updateOne({ _id: game._id }, { $set: { cancelWarn: true } });
	}
}

// Shared end-state for cancelling an active game: a system chat message, the
// status/cancelled/currentPlayers mutation, and a gameEnded notification (so
// Elo/karma + game-end processing run exactly as a player-agreed cancel). Used by
// the inactivity auto-cancel and the admin cancel route.
export async function cancelGame(game: GameDoc, now: Date, reasonText: string): Promise<void> {
	await colls.chatMessages.insertOne({
		_id: new ObjectId(),
		room: game._id,
		type: "system",
		data: { text: reasonText },
	});
	await colls.games.updateOne({ _id: game._id }, { $set: { status: "ended", cancelled: true, currentPlayers: [] } });
	await colls.gameNotifications.insertOne({
		kind: "gameEnded",
		game: game._id,
		processed: false,
		createdAt: now,
		updatedAt: now,
	});
}

async function cancelInactiveGame(game: GameDoc, now: Date): Promise<void> {
	await cancelGame(game, now, "Game cancelled for inactivity");
	await emailCancelNotice(game);
}

// Best-effort email notice, after the cancel is committed. Bots have no account
// and are never emailed; honors the same opt-in as turn notifications.
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
			await sendMail({
				kind: "game-cancelled",
				to: user.account.email,
				subject: `Game ${game._id}: cancelled for inactivity`,
				html: `
				<p>Hello ${user.account.username}</p>
				<p>Your game <a href='${url}'>${game._id}</a> (${game.game.name}) was cancelled for inactivity.</p>`,
				unsubscribeToken: signUnsubscribeToken(user._id.toHexString(), "game"),
			}).catch(console.error);
		}),
	);
}

export async function processStalledGames(): Promise<void> {
	const now = Date.now();
	const projection = { projection: { _id: 1 } };

	// Unwarned games are candidates once past the warn threshold (to warn); already
	// warned games only once past the grace threshold (to cancel).
	const [toWarn, toCancel] = await Promise.all([
		colls.games
			.find(
				{
					status: "active",
					cancelWarn: { $ne: true },
					"currentPlayers.deadline": { $lt: new Date(now - env.autoCancelWarnMs) },
				},
				projection,
			)
			.toArray(),
		colls.games
			.find(
				{
					status: "active",
					cancelWarn: true,
					"currentPlayers.deadline": { $lt: new Date(now - env.autoCancelGraceMs) },
				},
				projection,
			)
			.toArray(),
	]);

	for (const { _id } of [...toWarn, ...toCancel]) {
		try {
			await processStalledGame(_id);
		} catch (err) {
			console.error(err);
		}
	}
}
