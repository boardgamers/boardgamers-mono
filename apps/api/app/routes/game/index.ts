import { omit } from "@bgs/utils/object";
import { timerDuration } from "@bgs/utils/time";
import assert from "assert";
import { addDays } from "date-fns";
import createError from "http-errors";
import type { Context } from "koa";
import Router from "koa-router";
import { z } from "zod";
import type { GameDoc, RoomMetaDataDoc } from "@bgs/models";
import { colls } from "../../config/db.ts";
import locks from "../../config/locks.ts";
import { zObjectId } from "../../utils/zod.ts";
import { notifyGameStart } from "../../services/game.ts";
import { isAdmin, isConfirmed, loggedIn } from "../utils.ts";
import listings from "./listings.ts";

function withoutData(game: any) {
  return omit(game, "data");
}

const gameIdPattern = /^[A-Za-z0-9-]+$/;

const newGameSchema = z.object({
  game: z.object({
    game: z.string(),
    version: z.number().int(),
  }),
  gameId: z.string().regex(gameIdPattern, "Wrong format for game id"),
  players: z.number().int().positive(),
  expansions: z.array(z.string()).optional(),
  timePerGame: z.number().positive("Wrong amount of time per game"),
  timePerMove: z.number().positive("Wrong amount of time per move"),
  timerStart: z.number().optional(),
  timerEnd: z.number().optional(),
  minimumKarma: z.number().int().nonnegative().optional().nullable(),
  scheduledStart: z.number().optional(),
  seed: z.string().regex(gameIdPattern).optional(),
  options: z.record(z.union([z.string(), z.boolean()])).optional(),
});

const router = new Router<Application.DefaultState, Context>();

router.use("/status", listings.routes(), listings.allowedMethods());

router.post("/new-game", loggedIn, isConfirmed, async (ctx) => {
  const body = newGameSchema.parse(ctx.request.body);
  const {
    game: gameInfoId,
    gameId,
    players,
    expansions,
    timePerGame,
    timePerMove,
    timerStart,
    timerEnd,
    minimumKarma,
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
      user: ctx.state.user._id,
      "access.maxVersion": { $gte: gameInfoId.version },
    }))
  ) {
    ctx.status = 403;
    return;
  }

  if (gameInfo.meta.needOwnership) {
    assert(
      await colls.gamePreferences.findOne({ game: gameInfoId.game, user: ctx.state.user._id, "access.ownership": true }),
      "You need to own the game in order to host a new game. Check your account settings."
    );
  }

  const seed = body.seed || gameId;

  assert(timePerMove && !isNaN(timePerMove), "Wrong amount of time per move");
  assert(timePerGame && !isNaN(timePerGame), "Wrong amount of time per game");

  if (!/^[A-z0-9-]+$/.test(gameId)) {
    throw createError(400, "Wrong format for game id");
  }

  if (!/^[A-z0-9-]+$/.test(seed)) {
    throw createError(400, "Wrong format for game seed");
  }

  if (!gameInfo.players.includes(players)) {
    throw createError(400, "Wrong number of players");
  }

  if (await colls.games.findOne({ _id: gameId })) {
    throw createError(400, `A game with the id '${gameId}' already exists`);
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
      // Mongoose will throw if playerOrder is invalid
    } else {
      const item = gameInfo.options.find((opt) => opt.name === key);
      if (!item) {
        continue;
      }

      if (item.type === "checkbox") {
        assert(typeof val === "boolean", "Invalid value for option: " + key);
      } else if (item.type === "select") {
        assert(
          typeof val === "string" && item.items?.some((it) => it.name === val),
          "Invalid value for option: " + key
        );
      } else {
        continue;
      }
    }

    options[key] = val;
  }

  const now = new Date();
  const timing: GameDoc["options"]["timing"] = {
    timePerMove,
    timePerGame,
    timer: { start: 0, end: 24 * 3600 - 1 },
    scheduledStart: undefined as any,
  };

  if (scheduledStart) {
    assert(scheduledStart > Date.now(), "The scheduled start must not be in the past");
    assert(
      scheduledStart < Date.now() + 10 * 24 * 3600 * 1000,
      "The scheduled start must not be more than 10 days in the future"
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
      "You need at least have a 3 hour window of play time"
    );
    timing.timer = { start: timerStart, end: timerEnd };
  }

  const meta: GameDoc["options"]["meta"] = {
    unlisted: (options.unlisted as boolean) ?? false,
    minimumKarma: undefined as any,
  };
  if (minimumKarma !== undefined && minimumKarma !== null) {
    assert(+minimumKarma === minimumKarma && Math.floor(minimumKarma) === minimumKarma && minimumKarma >= 0);
    assert(
      minimumKarma + 5 <= ctx.state.user.account.karma,
      "You can't create a game with that high of a karma restriction"
    );
    meta.minimumKarma = minimumKarma;
  }

  const game: GameDoc = {
    _id: gameId,
    creator: ctx.state.user._id,
    players:
      options.join === true
        ? [
            {
              _id: ctx.state.user._id,
              remainingTime: timePerGame,
              dropped: false,
              score: 0,
              name: ctx.state.user.account.username,
              quit: false,
            },
          ]
        : [],
    currentPlayers: [],
    data: {} as any,
    context: { round: 0 },
    options: {
      setup: {
        seed,
        nbPlayers: players,
        playerOrder: (options.playerOrder ?? "random") as "random" | "host" | "join",
      },
      timing,
      meta,
    },
    game: {
      name: gameInfo._id.game,
      version: gameInfo._id.version,
      expansions: (expansions ?? []).filter((exp: string) => gameInfo.expansions.some((exp2) => exp2.name === exp)),
      options: omit(options, "join", "playerOrder", "unlisted"),
    },
    status: "open",
    ready: false,
    cancelled: false,
    createdAt: now,
    updatedAt: now,
    lastMove: now,
  };

  await colls.games.insertOne(game);

  ctx.status = 200;
});

router.param("gameId", async (gameId, ctx, next) => {
  ctx.state.game = await colls.games.findOne({ _id: gameId });

  if (!ctx.state.game) {
    throw createError(404, "Game not found: " + gameId);
  }

  await next();
});

// Metadata about the game
router.get("/:gameId", (ctx) => {
  ctx.body = withoutData(ctx.state.game);
});

router.get("/:gameId/players", async (ctx) => {
  const ret = [];
  const ids = [...ctx.state.game.players.map((pl) => pl._id), ctx.state.game.creator];
  const userDocs = await colls.users
    .find({ _id: { $in: ids } }, { projection: { "account.username": 1 } })
    .toArray();
  const gamePrefs = await colls.gamePreferences
    .find({
      game: ctx.state.game.game.name,
      user: { $in: userDocs.map((user) => user._id) },
    })
    .toArray();
  for (const user of userDocs) {
    const gamePref = gamePrefs.find((pref) => pref.user.equals(user._id));
    // @fixme: Remove 'id' when fully moved to svelte frontend
    ret.push({ id: user._id, _id: user._id, name: user.account.username, elo: gamePref?.elo?.value ?? 0 });
  }
  ctx.body = ret;
});

router.post("/:gameId/chat", loggedIn, isConfirmed, async (ctx) => {
  assert(
    ctx.state.user?.authority === "admin" ||
      (ctx.state.user && ctx.state.game.players.some((pl) => pl._id.equals(ctx.state.user._id))),
    "You must be a player of the game to chat!"
  );
  const body = z.object({
    type: z.enum(["text", "emoji"]),
    data: z.object({ text: z.string().min(1, "Empty chat message") }),
  }).parse(ctx.request.body);

  await colls.chatMessages.insertOne({
    room: ctx.state.game._id,
    author: {
      _id: ctx.state.user._id,
      name: ctx.state.user.account.username,
    },
    data: {
      text: body.data.text,
    },
    type: body.type,
  } as any);
  ctx.status = 200;
});

router.post("/:gameId/invite", loggedIn, async (ctx) => {
  assert(
    ctx.state.user._id.equals(ctx.state.game.creator),
    "You must be the creator of the game to invite other players"
  );
  const { userId } = z.object({ userId: zObjectId() }).parse(ctx.request.body);

  {
    await using _lock = await locks.lock("game", ctx.params.gameId);
    const game = await colls.games.findOne({
      _id: ctx.params.gameId,
      status: "open",
    });

    assert(game.players.length < game.options.setup.nbPlayers, "Too many people have joined the game");
    assert(!game.players.some((pl) => pl._id.equals(userId)), "That user is already in the player list");

    const userDoc = await colls.users.findOne({ _id: userId }, { projection: { "account.username": 1 } });
    const userName = userDoc!.account.username;

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

  ctx.body = withoutData(ctx.state.game);
});

router.post("/:gameId/join", loggedIn, isConfirmed, async (ctx) => {
  // Do basic checks before creating the lock
  assert(ctx.state.game.status === "open");
  const karma = ctx.state.user.account.karma;

  if (ctx.state.game.players.some((pl) => pl._id.equals(ctx.state.user._id) && pl.pending)) {
    // The player is pending, so was invited by the host, he can bypass restrictions
  } else {
    assert(
      ctx.state.game.options.meta.minimumKarma === undefined || karma >= ctx.state.game.options.meta.minimumKarma,
      "You do not have enough karma to join this game"
    );

    if (karma < 50) {
      const activeGames = await colls.games
        .find({ "players._id": ctx.state.user._id, status: { $ne: "ended" } })
        .limit(2)
        .toArray();
      assert(activeGames.length < 2, "You can't join more than two games at the same time when your karma is less than 50");
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

    const existingPlayer = game.players.find((pl) => pl._id.equals(ctx.state.user._id));
    if (existingPlayer?.pending) {
      existingPlayer.pending = false;
      game.currentPlayers = (game.currentPlayers ?? []).filter((pl) => !pl._id.equals(existingPlayer._id));
    } else {
      assert(!existingPlayer, "You already joined the game");
      assert(game.players.length < game.options.setup.nbPlayers, "Too many people have joined the game");

      game.players.push({
        _id: ctx.state.user._id,
        remainingTime: game.options.timing.timePerGame,
        quit: false,
        dropped: false,
        score: 0,
        name: ctx.state.user.account.username,
      });
    }

    if (game.players.length === game.options.setup.nbPlayers && !game.players.some((pl) => pl.pending)) {
      if (game.options.setup.playerOrder === "host") {
        game.currentPlayers = [{ _id: game.creator, timerStart: new Date(), deadline: addDays(new Date(), 1) }];
      } else {
        game.ready = true;
      }
    }

    await colls.games.replaceOne({ _id: game._id }, game);

    ctx.state.game = game;

    if (game.ready && !game.options.timing.scheduledStart) {
      await notifyGameStart(game);
    }
  }
  ctx.body = withoutData(ctx.state.game);
});

router.post("/:gameId/unjoin", loggedIn, async (ctx) => {
  {
    await using _lock = await locks.lock("game", ctx.params.gameId);
    const game = await colls.games.findOne({ _id: ctx.params.gameId, status: "open" });

    if (!game) {
      ctx.status = 404;
      return;
    }

    const index = game.players.findIndex((pl) => pl._id.equals(ctx.state.user._id));
    assert(index >= 0, "You're not part of that game");
    assert(!game.ready, "You can't unjoin a game that's ready to start");

    game.players = game.players.filter((pl) => !pl._id.equals(ctx.state.user._id));
    // In case host needed to choose options after all players joined, and player unjoined before
    // he could chose the options, he now has to wait again
    game.currentPlayers = (game.currentPlayers ?? []).filter(
      (pl) => !pl._id.equals(ctx.state.user._id) && !pl._id.equals(game.creator)
    );

    if (/* ctx.state.user._id.equals(game.creator) && */ game.players.length === 0) {
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
  {
    await using _lock = await locks.lock("game", ctx.params.gameId);
    const game = await colls.games.findOne({
      _id: ctx.params.gameId,
      status: "open",
      ready: false,
      creator: ctx.state.user._id,
    });

    if (!game) {
      ctx.status = 404;
      return;
    }

    assert(
      game.players.length === game.options.setup.nbPlayers,
      "You can only start the game when all players have joined"
    );

    const { playerOrder } = z.object({ playerOrder: z.array(z.string()).optional() }).parse(ctx.request.body);

    if (playerOrder) {
      game.players = [...game.players].sort(
        (p1, p2) => playerOrder.indexOf(p1._id.toString()) - playerOrder.indexOf(p2._id.toString())
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
  assert(
    ctx.state.user && ctx.state.game.players.some((pl) => pl._id.equals(ctx.state.user._id)),
    "You must be a player of the game to vote!"
  );

  {
    await using _lock = await locks.lock("game-cancel", ctx.params.gameId);
    const game = await colls.games.findOne({ _id: ctx.params.gameId });

    assert(game, createError(404));
    assert(game.status === "active", "The game is not ongoing");

    const player = game.players.find((pl) => pl._id.equals(ctx.state.user._id));

    assert(!player.voteCancel, "You already voted to cancel the game");

    player.voteCancel = true;
    await colls.chatMessages.insertOne({
      room: game._id,
      type: "system",
      data: { text: `${player.name} voted to cancel this game` },
    } as any);

    if (game.players.every((pl) => pl.voteCancel || pl.dropped)) {
      await colls.chatMessages.insertOne({ room: game._id, type: "system", data: { text: `Game cancelled` } } as any);
      game.status = "ended";
      game.cancelled = true;
      game.currentPlayers = null;
    }

    await colls.games.replaceOne({ _id: game._id }, game);

    if (game.status === "ended") {
      // Possible concurrency issue if game is cancelled at the exact same time as being finished
      await colls.gameNotifications.insertOne({ kind: "gameEnded", game: game._id, processed: false });
    }
  }

  ctx.status = 200;
});

router.post("/:gameId/quit", loggedIn, async (ctx) => {
  assert(
    ctx.state.user && ctx.state.game.players.some((pl) => pl._id.equals(ctx.state.user._id)),
    "You must be a player of the game to quit!"
  );

  {
    await using _lock = await locks.lock("game-cancel", ctx.params.gameId);
    const game = await colls.games.findOne(
      { _id: ctx.params.gameId },
      { projection: { players: 1, status: 1 } }
    );

    assert(game.status === "active", "The game is not ongoing");

    const player = game.players.find((pl) => pl._id.equals(ctx.state.user._id));

    assert(!player.quit && !player.dropped, "You already quit the game");

    await colls.gameNotifications.insertOne({ kind: "playerQuit", user: ctx.state.user._id, game: game._id, processed: false });
  }

  ctx.status = 200;
});

router.post("/:gameId/drop/:userId", loggedIn, async (ctx) => {
  assert(
    ctx.state.user && ctx.state.game.players.some((pl) => pl._id.equals(ctx.state.user._id)),
    "You must be a player of the game!"
  );
  const targetId = ctx.params.userId;
  assert(
    targetId && ctx.state.game.players.some((pl) => pl._id.equals(targetId)),
    "The target must be a player of the game!"
  );

  {
    await using _lock = await locks.lock("game-cancel", ctx.params.gameId);
    const game = await colls.games.findOne(
      { _id: ctx.params.gameId },
      { projection: { currentPlayers: 1, players: 1, status: 1 } }
    );

    assert(game.status === "active", "The game is not ongoing");

    const player = game.players.find((pl) => pl._id.equals(targetId));

    assert(!player.quit && !player.dropped, "That player already quit the game");

    const currentPlayer = (game.currentPlayers ?? []).find((pl) => pl._id.equals(targetId));

    assert(currentPlayer, "It's not that player's turn to play");
    assert(currentPlayer.deadline < new Date(), "The player's time is not elapsed");

    await colls.gameNotifications.insertOne({
      kind: "dropPlayer",
      user: player._id,
      game: game._id,
      processed: false,
      meta: {
        dropper: ctx.state.user._id,
        deadline: currentPlayer.deadline,
        timerStart: currentPlayer.timerStart,
        remainingTime: player.remainingTime,
      },
    });
  }

  ctx.status = 200;
});

router.post("/:roomId/notes", loggedIn, async (ctx) => {
  const { notes } = z.object({ notes: z.string() }).parse(ctx.request.body);
  await colls.roomMetaData.updateOne(
    {
      room: ctx.params.roomId,
      user: ctx.state.user._id,
    },
    { $set: { notes } },
    { upsert: true }
  );
  ctx.status = 200;
});

router.get("/:roomId/notes", loggedIn, async (ctx) => {
  const metaData = await colls.roomMetaData.findOne({ room: ctx.params.roomId, user: ctx.state.user._id });

  ctx.body = metaData?.notes ?? "";
});

router.get("/:roomId/chat/lastRead", loggedIn, async (ctx) => {
  const metaData: RoomMetaDataDoc | null = await colls.roomMetaData.findOne({
    room: ctx.params.roomId,
    user: ctx.state.user._id,
  });

  if (!metaData || !metaData.lastChatMessageViewed) {
    ctx.body = 0;
  } else {
    ctx.body = new Date(metaData.lastChatMessageViewed).getTime();
  }
});

router.post("/:roomId/chat/lastRead", loggedIn, async (ctx) => {
  const { lastRead } = z.object({ lastRead: z.union([z.string(), z.number()]) }).parse(ctx.request.body);
  await colls.roomMetaData.updateOne(
    { room: ctx.params.roomId, user: ctx.state.user._id },
    { $set: { lastChatMessageViewed: new Date(lastRead) } },
    { upsert: true }
  );
  ctx.status = 200;
});

router.delete("/:gameId", isAdmin, async (ctx) => {
  await colls.games.deleteOne({ _id: ctx.state.game._id });
  ctx.status = 200;
});

export default router;
