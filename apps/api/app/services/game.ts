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
 * One inactivity sweep over an already-loaded game (#94): drop the current players
 * whose deadline expired past the grace window, or cancel the game outright when
 * no active human would remain — or when it's an abandoned live game. Reuses the
 * existing drop machinery (`dropPlayer` game
 * notification → game-server runs `engine.dropPlayer` → Elo/karma/chat exactly like
 * a manual drop) and the manual cancel's doc update + `gameEnded` notification.
 *
 * Only *inactive current players* are ever dropped — a player is inactive when
 * their deadline expired past env.autoCancelGraceMs (primary "out of clock"
 * trigger) or when no move happened for env.autoCancelIdleMs (absolute backstop).
 * A player who still has time is never dropped. When dropping the inactives would
 * leave no active human, the game is cancelled instead — and cancel is
 * penalty-free (no Elo/karma), so nobody with time left is ever punished: they
 * either keep playing (after the inactive one is dropped) or get a no-penalty
 * cancel.
 *
 * Locking: `game-cancel:<id>` — the same key the manual cancel/quit/drop routes use
 * (they're what these updates must serialize with). The game-server's move path
 * locks `game:<id>` instead; that pre-existing split (#280) self-heals (read-
 * modify-write `replaceOne`, and the game-server no-ops on a non-active game) and
 * is unchanged here.
 *
 * Conservative on purpose — never touches a game with a move younger than
 * env.autoCancelIdleMs, skips a stale player who is a bot (a broken bot is a
 * bug, not inactivity — the game stays for an admin/engine fix). Live games
 * (timePerGame ≤ env.autoCancelLiveThresholdSec) are never dropped for
 * inactivity — only cancelled outright once idle past env.autoCancelIdleMs.
 */
export async function processStalledGame(gameId: string): Promise<void> {
	await using _lock = await locks.lock("game-cancel", gameId);
	const game = await colls.games.findOne({ _id: gameId });

	if (!game || game.status !== "active") {
		return;
	}

	const now = new Date();
	const reference = game.lastMove ?? game.updatedAt ?? game.createdAt;

	const idleMs = reference ? now.getTime() - reference.getTime() : 0;
	const isLive = (game.options.timing.timePerGame ?? 0) <= env.autoCancelLiveThresholdSec;
	if (isLive) {
		// Live games never drop anyone (kicking a player mid-blitz is wrong), but a
		// game with no move for days is abandoned, not stalling: cancel it outright.
		if (idleMs >= env.autoCancelIdleMs) {
			await cancelInactiveGame(game, now);
		}
		return;
	}

	// Players the game-server is already dropping (from an earlier sweep or a manual
	// request) count as inactive — otherwise the sweep would re-queue them every hour
	// while the notification sits unprocessed (idempotency).
	const pendingDropIds = new Set(
		(
			await colls.gameNotifications
				.find({ kind: "dropPlayer", game: game._id, processed: false }, { projection: { user: 1 } })
				.toArray()
		)
			.map((n) => n.user?.toString())
			.filter((id) => id !== undefined),
	);

	const inactivePlayers: { player: PlayerInfo; timerStart: Date; deadline: Date; alreadyQueued: boolean }[] = [];
	for (const cp of game.currentPlayers ?? []) {
		const player = game.players.find((pl) => pl._id.equals(cp._id));
		if (!player || player.isBot || player.dropped || player.quit) {
			continue;
		}
		if (pendingDropIds.has(player._id.toString())) {
			inactivePlayers.push({ player, timerStart: cp.timerStart, deadline: cp.deadline ?? now, alreadyQueued: true });
			continue;
		}
		// A player is inactive only when their deadline expired past the grace window
		// (primary trigger: they're out of clock) or when no move happened for
		// autoCancelIdleMs (absolute backstop). A player who still has time is never
		// dropped; a current player with time left means the game isn't stalled on
		// this sweep.
		const outOfClock = cp.deadline !== undefined && cp.deadline.getTime() + env.autoCancelGraceMs < now.getTime();
		if (!outOfClock && idleMs < env.autoCancelIdleMs) {
			return;
		}
		inactivePlayers.push({ player, timerStart: cp.timerStart, deadline: cp.deadline ?? now, alreadyQueued: false });
	}
	if (inactivePlayers.length === 0) {
		return;
	}

	const names = inactivePlayers.map(({ player }) => player.name).join(", ");
	const remaining = activeHumanPlayers(game).filter(
		(pl) => !inactivePlayers.some((inactive) => inactive.player._id.equals(pl._id)),
	);
	// Young async games (younger than autoCancelMinAgeMs) are left alone for now —
	// the sweep revisits them on a later run once they're old enough to cancel.
	const tooYoungToCancel =
		game.createdAt !== undefined && now.getTime() - game.createdAt.getTime() < env.autoCancelMinAgeMs;

	// Cancel only when no active human would remain after the drops. Nobody who
	// still has time is dropped — a cancel means everyone left was inactive, and
	// cancelling is penalty-free (no Elo/karma), so the cancel path never punishes
	// anyone: players with time left either keep playing (once the inactive player
	// is dropped) or see the game cancelled with no penalty at all.
	if (remaining.length === 0) {
		if (tooYoungToCancel) {
			return;
		}
		await cancelInactiveGame(game, now);
		return;
	}

	for (const { player, timerStart, deadline, alreadyQueued } of inactivePlayers) {
		if (alreadyQueued) {
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
				inactivity: true,
				deadline,
				timerStart,
				remainingTime: player.remainingTime,
			},
		});
	}
	const newlyDropped = inactivePlayers.filter(({ alreadyQueued }) => !alreadyQueued);
	if (newlyDropped.length > 0) {
		await colls.chatMessages.insertOne({
			_id: new ObjectId(),
			room: game._id,
			type: "system",
			data: { text: `${names} will be dropped for inactivity` },
		});
		await emailInactivityNotice(game, names, "been dropped from the game for inactivity");
	}
}

// Cancel like the manual vote-to-cancel route does (same doc update + gameEnded
// notification, so Elo/karma handling matches a player-agreed cancel). Used by
// both the live path (abandoned live game) and the async path (no active human
// would remain after inactivity drops).
async function cancelInactiveGame(game: GameDoc, now: Date): Promise<void> {
	await colls.chatMessages.insertOne({
		_id: new ObjectId(),
		room: game._id,
		type: "system",
		data: { text: "Game cancelled: all remaining players have been inactive for too long" },
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
	await emailInactivityNotice(
		game,
		activeHumanPlayers(game)
			.map((pl) => pl.name)
			.join(", "),
		"the game was cancelled after everyone went inactive",
	);
}

// Best-effort email notice, after the state change is committed and the chat
// system message posted. Bots have no account (never emailed). Honors the same
// opt-in as turn notifications (settings.mailing.game.activated), and sendmail
// itself no-ops on installs without a mailing provider — so a failure here can
// never roll back the drop/cancel.
async function emailInactivityNotice(game: GameDoc, names: string, action: string): Promise<void> {
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
				subject: `Game ${game._id}: inactivity`,
				html: `
				<p>Hello ${user.account.username}</p>
				<p>In your game <a href='${url}'>${game._id}</a> (${game.game.name}), ${names} ${action}.</p>
				<p>You can change your email settings and unsubscribe
				<a href='https://${env.site}/account'>here</a>.</p>`,
			}).catch(console.error);
		}),
	);
}

export async function processStalledGames(): Promise<void> {
	// Loose prefilter (re-checked per game under the lock): anything idle past
	// autoCancelIdleMs, plus async games old enough that a current player's
	// deadline may have expired past autoCancelGraceMs (the async path's primary
	// trigger doesn't depend on idle time). Games with a missing timePerGame are
	// picked up too — the per-game check treats missing as 0 and routes them to
	// live.
	const now = Date.now();
	const idleSince = (ms: number) => [
		{ lastMove: { $lt: new Date(now - ms) } },
		// Legacy active docs predate lastMove (added later); fall back to updatedAt
		// like the per-game check does.
		{ lastMove: { $exists: false }, updatedAt: { $lt: new Date(now - ms) } },
	];
	const candidates = await colls.games
		.find(
			{
				status: "active",
				$or: [
					...idleSince(env.autoCancelIdleMs),
					{
						"options.timing.timePerGame": { $gt: env.autoCancelLiveThresholdSec },
						updatedAt: { $lt: new Date(now - env.autoCancelGraceMs) },
					},
				],
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
