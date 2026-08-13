import { omit } from "@bgs/utils/object";
import { timerDuration } from "@bgs/utils/time";
import assert from "node:assert";
import { addDays } from "date-fns";
import createError from "http-errors";
import type { Context } from "koa";
import Router from "koa-router";
import { z } from "zod";
import { playerOrderSchema, type GameDoc, type RoomMetaDataDoc } from "@bgs/models";
import { ObjectId } from "mongodb";
import { colls } from "../../config/db.ts";
import { env } from "../../config/index.ts";
import locks from "../../config/locks.ts";
import { zObjectId } from "../../utils/zod.ts";
import { notifyGameStart } from "../../services/game.ts";
import { getUserElo } from "../../services/elo.ts";
import { isAdmin, isConfirmed, loggedIn } from "../utils.ts";
import listings, { myBoardgames } from "./listings.ts";

function withoutData(game: GameDoc): Omit<GameDoc, "data"> {
	const { data: _data, ...rest } = game;
	return rest;
}

const gameIdPattern = /^[A-Za-z0-9_-]+$/;

// Bot slots get placeholder ObjectIds — no user account exists for them. Bots are
// excluded from emails, karma and Elo by filtering on `isBot` at those call sites.
const botNames = ["Rob", "Ada", "Turing", "Shannon", "Babbage", "Lovelace", "Hopper", "Zuse"];

function makeBotPlayer(index: number, timePerGame: number | undefined): GameDoc["players"][number] {
	return {
		_id: new ObjectId(),
		remainingTime: timePerGame,
		dropped: false,
		quit: false,
		score: 0,
		name: `${botNames[index % botNames.length]} (bot ${index + 1})`,
		isBot: true,
	};
}

// Once every seat is filled (and no invite is still pending), the game is either
// ready to start, or waiting on the host to pick setup options (playerOrder "host").
// Shared by the create and join routes so a game filled at creation (e.g. with bot
// seats) starts exactly like one filled by the last join.
async function markGameReadyIfFull(game: GameDoc): Promise<void> {
	if (game.players.length !== game.options.setup.nbPlayers || game.players.some((pl) => pl.pending)) {
		return;
	}

	if (game.options.setup.playerOrder === "host") {
		game.currentPlayers = [{ _id: game.creator, timerStart: new Date(), deadline: addDays(new Date(), 1) }];
	} else {
		game.ready = true;
	}

	if (game.ready && !game.options.timing.scheduledStart) {
		await notifyGameStart(game);
	}
}

const newGameSchema = z.object({
	game: z.object({
		game: z.string(),
		version: z.number().int(),
	}),
	gameId: z.string().regex(gameIdPattern, "Wrong format for game id"),
	players: z.number().int().positive(),
	// How many of the player slots are filled by platform bots (engine auto-play).
	bots: z.number().int().nonnegative().optional(),
	expansions: z.array(z.string()).optional(),
	timePerGame: z.number().positive("Wrong amount of time per game"),
	timePerMove: z.number().positive("Wrong amount of time per move"),
	timerStart: z.number().optional(),
	timerEnd: z.number().optional(),
	minimumKarma: z.number().int().nonnegative().optional().nullable(),
	eloRange: z
		.object({
			min: z.number().int().nonnegative(),
			max: z.number().int().positive(),
		})
		.optional()
		.nullable(),
	scheduledStart: z.number().optional(),
	seed: z.string().regex(gameIdPattern).optional(),
	options: z.record(z.string(), z.union([z.string(), z.boolean()])).optional(),
});

const router = new Router<Application.DefaultState, Context>();

router.get("/my-boardgames", myBoardgames);

router.use("/status", listings.routes(), listings.allowedMethods());

router.post("/new-game", loggedIn, isConfirmed, async (ctx) => {
	const user = ctx.state.user!;
	const body = newGameSchema.parse(ctx.request.body);
	const {
		game: gameInfoId,
		gameId,
		players,
		bots,
		expansions,
		timePerGame,
		timePerMove,
		timerStart,
		timerEnd,
		minimumKarma,
		eloRange,
		scheduledStart,
	} = body;
	const options: Record<string, string | boolean> = {};

	const gameInfo = await colls.gameInfos.findOne({ _id: gameInfoId });

	if (!gameInfo) {
		ctx.status = 404;
		return;
	}

	if (
		!gameInfo.meta.public &&
		!(await colls.gamePreferences.findOne({
			game: gameInfoId.game,
			user: user._id,
			"access.maxVersion": { $gte: gameInfoId.version },
		}))
	) {
		ctx.status = 403;
		return;
	}

	if (gameInfo.meta.needOwnership) {
		assert(
			await colls.gamePreferences.findOne({
				game: gameInfoId.game,
				user: user._id,
				"access.ownership": true,
			}),
			"You need to own the game in order to host a new game. Check your account settings.",
		);
	}

	const seed = body.seed || gameId;

	assert(timePerMove && !isNaN(timePerMove), "Wrong amount of time per move");
	assert(timePerGame && !isNaN(timePerGame), "Wrong amount of time per game");

	if (!gameInfo.players.includes(players)) {
		throw createError(400, "Wrong number of players");
	}

	const botCount = bots ?? 0;
	if (botCount > 0) {
		assert(gameInfo.meta.bots, "This game does not support bot players");
		assert(botCount < players, "There must be at least one human player");
	}

	if (await colls.games.findOne({ _id: gameId })) {
		throw createError(400, `A game with the id '${gameId}' already exists`);
	}

	// Cap the number of open games a user can host at once — they all show in the
	// open-games lobby. Unlisted games count too: the cap is about games one
	// created, not just lobby visibility.
	if (env.maxOpenGamesPerUser > 0) {
		const openGames = await colls.games.countDocuments({ creator: user._id, status: "open", cancelled: { $ne: true } });
		assert(
			openGames < env.maxOpenGamesPerUser,
			`You can't have more than ${env.maxOpenGamesPerUser} open games at the same time`,
		);
	}

	for (const [key, val] of Object.entries(body.options ?? {})) {
		if (typeof val !== "string" && typeof val !== "boolean") {
			continue;
		}

		if (val === "$none") {
			continue;
		}

		if (["join", "unlisted"].includes(key)) {
			assert(typeof val === "boolean", "Invalid value for option: " + key);
		} else if (key === "playerOrder") {
			assert(playerOrderSchema.safeParse(val).success, "Invalid value for option: " + key);
		} else {
			const item = (gameInfo.options ?? []).find((opt) => opt.name === key);
			if (!item) {
				continue;
			}

			if (item.type === "checkbox") {
				assert(typeof val === "boolean", "Invalid value for option: " + key);
			} else if (item.type === "select") {
				assert(
					typeof val === "string" && item.items?.some((it) => it.name === val),
					"Invalid value for option: " + key,
				);
			} else {
				continue;
			}
		}

		options[key] = val;
	}

	// Bots can fill every seat but one — but the remaining seat must go to a human.
	// The creator only occupies it when `options.join` is set, so bots == players - 1
	// without it would leave a game of only bots, playing itself.
	assert(
		botCount < players - 1 || options.join === true,
		"There must be at least one human player — join the game yourself or leave a seat open",
	);

	const now = new Date();
	const timing: GameDoc["options"]["timing"] = {
		timePerMove,
		timePerGame,
		timer: { start: 0, end: 24 * 3600 - 1 },
	};
	if (scheduledStart) {
		assert(scheduledStart > Date.now(), "The scheduled start must not be in the past");
		assert(
			scheduledStart < Date.now() + 10 * 24 * 3600 * 1000,
			"The scheduled start must not be more than 10 days in the future",
		);
		timing.scheduledStart = new Date(scheduledStart);
	}

	if (
		timerStart !== timerEnd &&
		typeof timerStart === "number" &&
		typeof timerEnd === "number" &&
		!isNaN(timerStart) &&
		!isNaN(timerEnd)
	) {
		assert(
			timerDuration({ start: timerStart, end: timerEnd }) >= 3 * 3600,
			"You need at least have a 3 hour window of play time",
		);
		timing.timer = { start: timerStart, end: timerEnd };
	}

	const meta: GameDoc["options"]["meta"] = {
		unlisted: !!options.unlisted,
	};
	if (minimumKarma !== undefined && minimumKarma !== null) {
		assert(+minimumKarma === minimumKarma && Math.floor(minimumKarma) === minimumKarma && minimumKarma >= 0);
		assert(minimumKarma + 5 <= user.account.karma, "You can't create a game with that high of a karma restriction");
		meta.minimumKarma = minimumKarma;
	}
	if (eloRange !== undefined && eloRange !== null) {
		assert(eloRange.max - eloRange.min >= 100, "The Elo range must be at least 100 wide");
		const creatorElo = await getUserElo(user._id, gameInfoId.game);
		assert(
			creatorElo >= eloRange.min && creatorElo <= eloRange.max,
			`Your Elo (${creatorElo}) must be within the game's Elo range`,
		);
		meta.eloRange = eloRange;
	}

	const gameExpansions = gameInfo.expansions ?? [];
	const initialPlayers: GameDoc["players"] =
		options.join === true
			? [
					{
						_id: user._id,
						remainingTime: timePerGame,
						dropped: false,
						score: 0,
						name: user.account.username,
						quit: false,
					},
				]
			: [];
	// Bots occupy seats from creation on; they can't be invited/joined over later.
	for (let i = 0; i < botCount; i++) {
		initialPlayers.push(makeBotPlayer(i, timePerGame));
	}
	const game: GameDoc = {
		_id: gameId,
		creator: user._id,
		players: initialPlayers,
		currentPlayers: [],
		data: {},
		context: { round: 0 },
		options: {
			setup: {
				seed,
				nbPlayers: players,
				playerOrder: playerOrderSchema.parse(options.playerOrder ?? "random"),
			},
			timing,
			meta,
		},
		game: {
			name: gameInfo._id.game,
			version: gameInfo._id.version,
			expansions: (expansions ?? []).filter((exp: string) => gameExpansions.some((exp2) => exp2.name === exp)),
			options: omit(options, "join", "playerOrder", "unlisted"),
		},
		status: "open",
		ready: false,
		cancelled: false,
		createdAt: now,
		updatedAt: now,
		lastMove: now,
	};

	await markGameReadyIfFull(game);

	await colls.games.insertOne(game);

	// Creating a game re-pins its boardgame in the "My games" sidebar group.
	await colls.users.updateOne(
		{ _id: ctx.state.user!._id },
		{ $pull: { "settings.home.forgottenGames": game.game.name } },
	);

	ctx.status = 200;
});

router.param("gameId", async (gameId, ctx, next) => {
	const game = await colls.games.findOne({ _id: gameId });

	if (!game) {
		throw createError(404, "Game not found: " + gameId);
	}

	ctx.state.game = game;
	await next();
});

// Metadata about the game
router.get("/:gameId", (ctx) => {
	ctx.body = withoutData(ctx.state.game!);
});

router.get("/:gameId/players", async (ctx) => {
	const game = ctx.state.game!;
	const ret = [];
	const ids = [...game.players.map((pl) => pl._id), game.creator];
	const userDocs = await colls.users.find({ _id: { $in: ids } }, { projection: { "account.username": 1 } }).toArray();
	const gamePrefs = await colls.gamePreferences
		.find({
			game: game.game.name,
			user: { $in: userDocs.map((user) => user._id) },
		})
		.toArray();
	for (const user of userDocs) {
		const gamePref = gamePrefs.find((pref) => pref.user.equals(user._id));
		// @fixme: Remove 'id' when fully moved to svelte frontend
		ret.push({ id: user._id, _id: user._id, name: user.account.username, elo: gamePref?.elo?.value ?? 0 });
	}
	// Bots have no user document — surface them from the game's own player list.
	for (const player of game.players) {
		if (player.isBot) {
			ret.push({ id: player._id, _id: player._id, name: player.name, elo: 0 });
		}
	}
	ctx.body = ret;
});

router.post("/:gameId/chat", loggedIn, isConfirmed, async (ctx) => {
	const user = ctx.state.user!;
	const game = ctx.state.game!;
	assert(
		user.authority === "admin" || game.players.some((pl) => pl._id.equals(user._id)),
		"You must be a player of the game to chat!",
	);
	const body = z
		.object({
			type: z.enum(["text", "emoji"]),
			data: z.object({ text: z.string().min(1, "Empty chat message") }),
		})
		.parse(ctx.request.body);

	await colls.chatMessages.insertOne({
		_id: new ObjectId(),
		room: game._id,
		author: {
			_id: user._id,
			name: user.account.username,
		},
		data: {
			text: body.data.text,
		},
		type: body.type,
	});
	ctx.status = 200;
});

router.post("/:gameId/invite", loggedIn, async (ctx) => {
	const user = ctx.state.user!;
	assert(user._id.equals(ctx.state.game!.creator), "You must be the creator of the game to invite other players");
	const { userId } = z.object({ userId: zObjectId() }).parse(ctx.request.body);

	{
		await using _lock = await locks.lock("game", ctx.params.gameId);
		const game = await colls.games.findOne({
			_id: ctx.params.gameId,
			status: "open",
		});

		assert(game, "Game not found");
		assert(game.players.length < game.options.setup.nbPlayers, "Too many people have joined the game");
		assert(!game.players.some((pl) => pl._id.equals(userId)), "That user is already in the player list");

		const userDoc = await colls.users.findOne({ _id: userId }, { projection: { "account.username": 1 } });
		assert(userDoc, "User not found");
		const userName = userDoc.account.username;

		game.players.push({
			_id: userId,
			remainingTime: game.options.timing.timePerGame,
			quit: false,
			dropped: false,
			score: 0,
			name: userName,
			pending: true,
		});

		game.currentPlayers = game.currentPlayers ?? [];
		game.currentPlayers.push({ _id: userId, timerStart: new Date(), deadline: game.options.timing.scheduledStart });

		await colls.games.replaceOne({ _id: game._id }, game);
	}

	ctx.body = withoutData(ctx.state.game!);
});

router.post("/:gameId/join", loggedIn, isConfirmed, async (ctx) => {
	const user = ctx.state.user!;
	const initialGame = ctx.state.game!;
	// Do basic checks before creating the lock
	assert(initialGame.status === "open");
	const karma = user.account.karma;

	const checkEloRange = async (game: GameDoc) => {
		const eloRange = game.options.meta?.eloRange;
		if (eloRange) {
			const elo = await getUserElo(user._id, game.game.name);
			assert(
				elo >= eloRange.min && elo <= eloRange.max,
				`Your Elo (${elo}) is outside this game's Elo range (${eloRange.min} - ${eloRange.max})`,
			);
		}
	};

	if (initialGame.players.some((pl) => pl._id.equals(user._id) && pl.pending)) {
		// The player is pending, so was invited by the host, he can bypass restrictions
	} else {
		assert(
			initialGame.options.meta?.minimumKarma === undefined || karma >= initialGame.options.meta.minimumKarma,
			"You do not have enough karma to join this game",
		);
		await checkEloRange(initialGame);

		if (karma < 50) {
			const activeGames = await colls.games
				.find({ "players._id": user._id, status: { $ne: "ended" } })
				.limit(2)
				.toArray();
			assert(
				activeGames.length < 2,
				"You can't join more than two games at the same time when your karma is less than 50",
			);
		}
	}

	{
		await using _lock = await locks.lock("game", ctx.params.gameId);
		const game = await colls.games.findOne({
			_id: ctx.params.gameId,
			status: "open",
		});

		if (!game) {
			ctx.status = 404;
			return;
		}

		const existingPlayer = game.players.find((pl) => pl._id.equals(user._id));
		if (existingPlayer?.pending) {
			existingPlayer.pending = false;
			game.currentPlayers = (game.currentPlayers ?? []).filter((pl) => !pl._id.equals(existingPlayer._id));
		} else {
			assert(!existingPlayer, "You already joined the game");
			// A game whose seats were all filled at creation (bots) is already ready:
			// joining it would push it past its player count.
			assert(!game.ready, "Game is starting");
			assert(game.players.length < game.options.setup.nbPlayers, "Too many people have joined the game");
			// Re-check on the freshly loaded doc: the range may have been added (or the
			// player's elo changed) since the pre-lock check.
			await checkEloRange(game);

			game.players.push({
				_id: user._id,
				remainingTime: game.options.timing.timePerGame,
				quit: false,
				dropped: false,
				score: 0,
				name: user.account.username,
			});
		}

		await markGameReadyIfFull(game);

		await colls.games.replaceOne({ _id: game._id }, game);

		// Joining a game re-pins its boardgame in the "My games" sidebar group.
		await colls.users.updateOne({ _id: user._id }, { $pull: { "settings.home.forgottenGames": game.game.name } });

		ctx.state.game = game;
	}
	ctx.body = withoutData(ctx.state.game);
});

router.post("/:gameId/unjoin", loggedIn, async (ctx) => {
	const user = ctx.state.user!;
	{
		await using _lock = await locks.lock("game", ctx.params.gameId);
		const game = await colls.games.findOne({ _id: ctx.params.gameId, status: "open" });

		if (!game) {
			ctx.status = 404;
			return;
		}

		const index = game.players.findIndex((pl) => pl._id.equals(user._id));
		assert(index >= 0, "You're not part of that game");
		assert(!game.ready, "You can't unjoin a game that's ready to start");

		game.players = game.players.filter((pl) => !pl._id.equals(user._id));
		// In case host needed to choose options after all players joined, and player unjoined before
		// he could chose the options, he now has to wait again
		game.currentPlayers = (game.currentPlayers ?? []).filter(
			(pl) => !pl._id.equals(user._id) && !pl._id.equals(game.creator),
		);

		if (/* user._id.equals(game.creator) && */ game.players.length === 0) {
			// Remove game if its own creator leaves, and there's no one else
			await colls.games.deleteOne({ _id: game._id });
		} else {
			await colls.games.replaceOne({ _id: game._id }, game);
		}

		ctx.state.game = game;
	}
	ctx.body = withoutData(ctx.state.game);
});

router.post("/:gameId/start", loggedIn, async (ctx) => {
	const user = ctx.state.user!;
	{
		await using _lock = await locks.lock("game", ctx.params.gameId);
		const game = await colls.games.findOne({
			_id: ctx.params.gameId,
			status: "open",
			ready: false,
			creator: user._id,
		});

		if (!game) {
			ctx.status = 404;
			return;
		}

		assert(
			game.players.length === game.options.setup.nbPlayers,
			"You can only start the game when all players have joined",
		);

		const { playerOrder } = z.object({ playerOrder: z.array(z.string()).optional() }).parse(ctx.request.body);

		if (playerOrder) {
			game.players = [...game.players].toSorted(
				(p1, p2) => playerOrder.indexOf(p1._id.toString()) - playerOrder.indexOf(p2._id.toString()),
			);
		}
		game.ready = true;

		await colls.games.replaceOne({ _id: game._id }, game);

		if (!game.options.timing.scheduledStart) {
			await notifyGameStart(game);
		}

		ctx.state.game = game;
	}
	ctx.body = withoutData(ctx.state.game);
});

router.post("/:gameId/cancel", loggedIn, async (ctx) => {
	const user = ctx.state.user!;
	const stateGame = ctx.state.game!;
	assert(
		stateGame.players.some((pl) => pl._id.equals(user._id)),
		"You must be a player of the game to vote!",
	);

	{
		await using _lock = await locks.lock("game-cancel", ctx.params.gameId);
		const game = await colls.games.findOne({ _id: ctx.params.gameId });

		assert(game, createError(404));
		assert(game.status === "active", "The game is not ongoing");

		const player = game.players.find((pl) => pl._id.equals(user._id));
		assert(player, "You must be a player of the game to vote!");
		assert(!player.voteCancel, "You already voted to cancel the game");

		player.voteCancel = true;
		await colls.chatMessages.insertOne({
			_id: new ObjectId(),
			room: game._id,
			type: "system",
			data: { text: `${player.name} voted to cancel this game` },
		});

		// Bots auto-consent: no one can act for a bot, so it would otherwise block
		// the vote forever. Only human players' votes are required.
		if (game.players.every((pl) => pl.voteCancel || pl.dropped || pl.isBot)) {
			await colls.chatMessages.insertOne({
				_id: new ObjectId(),
				room: game._id,
				type: "system",
				data: { text: `Game cancelled` },
			});
			game.status = "ended";
			game.cancelled = true;
			game.currentPlayers = [];
		}

		await colls.games.replaceOne({ _id: game._id }, game);

		if (game.status === "ended") {
			// Possible concurrency issue if game is cancelled at the exact same time as being finished
			const now2 = new Date();
			await colls.gameNotifications.insertOne({
				kind: "gameEnded",
				game: game._id,
				processed: false,
				createdAt: now2,
				updatedAt: now2,
			});
		}
	}

	ctx.status = 200;
});

router.post("/:gameId/quit", loggedIn, async (ctx) => {
	const user = ctx.state.user!;
	const stateGame = ctx.state.game!;
	assert(
		stateGame.players.some((pl) => pl._id.equals(user._id)),
		"You must be a player of the game to quit!",
	);

	{
		await using _lock = await locks.lock("game-cancel", ctx.params.gameId);
		const game = await colls.games.findOne<Pick<GameDoc, "_id" | "players" | "status">>(
			{ _id: ctx.params.gameId },
			{ projection: { players: 1, status: 1 } },
		);

		assert(game, "Game not found");
		assert(game.status === "active", "The game is not ongoing");

		const player = game.players.find((pl) => pl._id.equals(user._id));
		assert(player, "You must be a player of the game to quit!");
		assert(!player.quit && !player.dropped, "You already quit the game");

		const quitNow = new Date();
		await colls.gameNotifications.insertOne({
			kind: "playerQuit",
			user: user._id,
			game: game._id,
			processed: false,
			createdAt: quitNow,
			updatedAt: quitNow,
		});
	}

	ctx.status = 200;
});

router.post("/:gameId/drop/:userId", loggedIn, async (ctx) => {
	const user = ctx.state.user!;
	const stateGame = ctx.state.game!;
	assert(
		stateGame.players.some((pl) => pl._id.equals(user._id)),
		"You must be a player of the game!",
	);
	const targetId = ctx.params.userId;
	assert(
		targetId && stateGame.players.some((pl) => pl._id.equals(targetId)),
		"The target must be a player of the game!",
	);

	{
		await using _lock = await locks.lock("game-cancel", ctx.params.gameId);
		const game = await colls.games.findOne<Pick<GameDoc, "_id" | "currentPlayers" | "players" | "status">>(
			{ _id: ctx.params.gameId },
			{ projection: { currentPlayers: 1, players: 1, status: 1 } },
		);

		assert(game, "Game not found");
		assert(game.status === "active", "The game is not ongoing");

		const player = game.players.find((pl) => pl._id.equals(targetId));
		assert(player, "The target must be a player of the game!");
		assert(!player.quit && !player.dropped, "That player already quit the game");

		const currentPlayer = (game.currentPlayers ?? []).find((pl) => pl._id.equals(targetId));

		assert(currentPlayer, "It's not that player's turn to play");
		assert(currentPlayer.deadline && currentPlayer.deadline < new Date(), "The player's time is not elapsed");

		const dropNow = new Date();
		await colls.gameNotifications.insertOne({
			kind: "dropPlayer",
			user: player._id,
			game: game._id,
			processed: false,
			createdAt: dropNow,
			updatedAt: dropNow,
			meta: {
				dropper: user._id,
				deadline: currentPlayer.deadline,
				timerStart: currentPlayer.timerStart,
				remainingTime: player.remainingTime,
			},
		});
	}

	ctx.status = 200;
});

router.post("/:roomId/notes", loggedIn, async (ctx) => {
	const user = ctx.state.user!;
	const { notes } = z.object({ notes: z.string() }).parse(ctx.request.body);
	await colls.roomMetaData.updateOne(
		{
			room: ctx.params.roomId,
			user: user._id,
		},
		{ $set: { notes } },
		{ upsert: true },
	);
	ctx.status = 200;
});

router.get("/:roomId/notes", loggedIn, async (ctx) => {
	const user = ctx.state.user!;
	const metaData = await colls.roomMetaData.findOne({ room: ctx.params.roomId, user: user._id });

	ctx.body = metaData?.notes ?? "";
});

router.get("/:roomId/chat/lastRead", loggedIn, async (ctx) => {
	const user = ctx.state.user!;
	const metaData: RoomMetaDataDoc | null = await colls.roomMetaData.findOne({
		room: ctx.params.roomId,
		user: user._id,
	});

	if (!metaData || !metaData.lastChatMessageViewed) {
		ctx.body = 0;
	} else {
		ctx.body = new Date(metaData.lastChatMessageViewed).getTime();
	}
});

router.post("/:roomId/chat/lastRead", loggedIn, async (ctx) => {
	const user = ctx.state.user!;
	const { lastRead } = z.object({ lastRead: z.union([z.string(), z.number()]) }).parse(ctx.request.body);
	await colls.roomMetaData.updateOne(
		{ room: ctx.params.roomId, user: user._id },
		{ $set: { lastChatMessageViewed: new Date(lastRead) } },
		{ upsert: true },
	);
	ctx.status = 200;
});

router.delete("/:gameId", isAdmin, async (ctx) => {
	await colls.games.deleteOne({ _id: ctx.state.game!._id });
	ctx.status = 200;
});

export default router;
