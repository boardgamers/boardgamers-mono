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

	// Current players whose own deadline has expired, paired with the game player.
	// A bot whose clock expired is a bug, not inactivity — leave it for an admin.
	const stalled = (game.currentPlayers ?? [])
		.flatMap((cp) => {
			const player = game.players.find((pl) => pl._id.equals(cp._id));
			return cp.deadline !== undefined && cp.deadline.getTime() < now.getTime() && player
				? [{ cp, deadline: cp.deadline, player }]
				: [];
		})
		.filter(({ player }) => !player.isBot && !player.dropped && !player.quit);
	if (stalled.length === 0) {
		return;
	}

	const stallSince = new Date(Math.min(...stalled.map(({ deadline }) => deadline.getTime())));
	const stallAgeMs = now.getTime() - stallSince.getTime();

	// Safety net: whatever the warn said (drop or cancel), a game still stalled after
	// the full grace — auto-drop off, or the drop path failing — is cancelled penalty-free.
	if (stallAgeMs >= env.autoCancelGraceMs) {
		await cancelInactiveGame(game, now);
		return;
	}

	// The notice promised by the warning (normally warn at deadline+24h, drop at
	// deadline+3d → 2 days). The drop also waits for it to elapse *since the warning*
	// (dropWarnAt), so a warning posted late (sweep backlog/outage) can't collapse
	// the notice to the next sweep tick.
	const noticeMs = Math.max(0, env.autoDropGraceMs - env.autoCancelWarnMs);

	// Auto-drop stage: only players who got the drop warning (dropWarn — a game warned
	// with the old cancel-only message keeps the penalty-free cancel it was promised)
	// at least noticeMs ago, and whose own deadline is autoDropGraceMs past. Same path
	// as the manual /drop/:userId route: a dropPlayer notification the game-server
	// processes under the game lock (engine dropPlayer, karma, afterMove advancing or
	// cancelling).
	const noticeElapsed = game.dropWarnAt === undefined || now.getTime() - game.dropWarnAt.getTime() >= noticeMs;
	if (env.autoDrop !== "off" && noticeElapsed && (game.dropWarn || (env.autoDrop === "dry-run" && game.cancelWarn))) {
		const toDrop = stalled.filter(({ deadline }) => now.getTime() - deadline.getTime() >= env.autoDropGraceMs);
		if (toDrop.length > 0) {
			if (env.autoDrop === "dry-run") {
				console.log(
					`[autoDrop dry-run] would drop ${toDrop.map(({ player }) => player.name).join(", ")} from game ${game._id}`,
				);
				return;
			}
			await autoDropPlayers(game, toDrop, now);
			return;
		}
	}

	if (stallAgeMs >= env.autoCancelWarnMs && !game.cancelWarn && !game.dropWarn) {
		const names = stalled.map(({ player }) => player.name).join(", ") || "the current player(s)";
		if (env.autoDrop === "on") {
			// The drop happens at max(deadline + autoDropGraceMs, warning + notice).
			const daysLeft = Math.max(
				1,
				Math.ceil(Math.max(env.autoDropGraceMs - stallAgeMs, noticeMs) / (24 * 3600 * 1000)),
			);
			await colls.chatMessages.insertOne({
				_id: new ObjectId(),
				room: game._id,
				type: "system",
				data: {
					text: `${names} will be dropped for inactivity in ${daysLeft} day${daysLeft > 1 ? "s" : ""} if no move is played (the other players can drop them sooner). The game then continues without them, or is cancelled if it can't continue.`,
				},
			});
			await colls.games.updateOne({ _id: game._id }, { $set: { dropWarn: true, dropWarnAt: now } });
			await emailDropWarning(
				game,
				stalled.map(({ player }) => player),
				daysLeft,
			);
		} else {
			const daysLeft = Math.max(1, Math.ceil((env.autoCancelGraceMs - stallAgeMs) / (24 * 3600 * 1000)));
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
}

// Insert the dropPlayer notification(s) the game-server acts on — the exact shape the
// manual /drop/:userId route produces, minus `dropper` (plus `auto` for the logs).
// Skips players with a still-unprocessed drop notification so an hourly re-sweep
// doesn't double-drop while the game-server is behind.
async function autoDropPlayers(
	game: GameDoc,
	toDrop: { cp: NonNullable<GameDoc["currentPlayers"]>[number]; deadline: Date; player: PlayerInfo }[],
	now: Date,
): Promise<void> {
	for (const { cp, deadline, player } of toDrop) {
		const pending = await colls.gameNotifications.findOne({
			kind: "dropPlayer",
			game: game._id,
			user: player._id,
			processed: false,
		});
		if (pending) {
			continue;
		}
		await colls.gameNotifications.insertOne({
			kind: "dropPlayer",
			user: player._id,
			game: game._id,
			processed: false,
			createdAt: now,
			updatedAt: now,
			meta: {
				auto: true,
				deadline,
				timerStart: cp.timerStart,
				remainingTime: player.remainingTime,
			},
		});
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

// Best-effort pre-drop warning email to the stalled player(s) themselves, sent with
// the chat warning. Same opt-in/confirmed rules as the other game emails.
async function emailDropWarning(game: GameDoc, stalledPlayers: PlayerInfo[], daysLeft: number): Promise<void> {
	const users = await colls.users
		.find(
			{ _id: { $in: stalledPlayers.map((pl) => pl._id) } },
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
				kind: "drop-warning",
				to: user.account.email,
				subject: `Game ${game._id}: you will be dropped for inactivity in ${daysLeft} day${daysLeft > 1 ? "s" : ""}`,
				html: `
				<p>Hello ${user.account.username}</p>
				<p>Your clock ran out in <a href='${url}'>${game._id}</a> (${game.game.name}). If you don't play a move within ${daysLeft} day${daysLeft > 1 ? "s" : ""}, you will be dropped from the game.</p>`,
				unsubscribeToken: signUnsubscribeToken(user._id.toHexString(), "game"),
			}).catch(console.error);
		}),
	);
}

export async function processStalledGames(): Promise<void> {
	const now = Date.now();
	const projection = { projection: { _id: 1 } };

	// Unwarned games are candidates once past the warn threshold (to warn); warned
	// games once past the drop threshold (to drop) or the grace threshold (to cancel).
	const [toWarn, toDrop, toCancel] = await Promise.all([
		colls.games
			.find(
				{
					status: "active",
					cancelWarn: { $ne: true },
					dropWarn: { $ne: true },
					"currentPlayers.deadline": { $lt: new Date(now - env.autoCancelWarnMs) },
				},
				projection,
			)
			.toArray(),
		env.autoDrop === "off"
			? Promise.resolve([])
			: colls.games
					.find(
						{
							status: "active",
							$or: [{ dropWarn: true }, { cancelWarn: true }],
							"currentPlayers.deadline": { $lt: new Date(now - env.autoDropGraceMs) },
						},
						projection,
					)
					.toArray(),
		colls.games
			.find(
				{
					status: "active",
					$or: [{ dropWarn: true }, { cancelWarn: true }],
					"currentPlayers.deadline": { $lt: new Date(now - env.autoCancelGraceMs) },
				},
				projection,
			)
			.toArray(),
	]);

	const ids = new Set([...toWarn, ...toDrop, ...toCancel].map(({ _id }) => _id));
	for (const _id of ids) {
		try {
			await processStalledGame(_id);
		} catch (err) {
			console.error(err);
		}
	}
}
