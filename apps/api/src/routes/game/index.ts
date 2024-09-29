import { timerDuration } from "@bgs/utils/time";
import assert from "assert";
import { addDays } from "date-fns";
import createError from "http-errors";
import type { Context } from "koa";
import Router from "koa-router";
import { omit } from "lodash";
import type { RoomMetaDataDocument } from "../../models";
import { GameInfo, GameNotification, GamePreferences, RoomMetaData, User } from "../../models";
import { notifyGameStart } from "../../services/game";
import { isAdmin, isConfirmed, loggedIn } from "../utils";
import listings from "./listings";
import { ObjectId } from "mongodb";
import { z } from "zod";
import { collections, locks } from "../../config/db";

const router = new Router<Application.DefaultState, Context>();

router.use("/status", listings.routes(), listings.allowedMethods());

router.post("/new-game", loggedIn, isConfirmed, async (ctx) => {
  const body = ctx.request.body;
  const user = ctx.state.user;
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
    seed,
    join,
    unlisted,
    playerOrder,
  } = z
    .object({
      game: z.object({
        game: z
          .string()
          .regex(/^[A-z0-9-]+$/)
          .min(1)
          .max(25),
        version: z.number().int().min(0),
      }),
      gameId: z
        .string()
        .regex(/^[A-z0-9-]+$/)
        .min(1)
        .max(25),
      seed: z
        .string()
        .regex(/^[A-z0-9-]+$/)
        .min(1)
        .max(25)
        .optional(),
      players: z.number().int().min(1),
      expansions: z.array(z.string()).optional(),
      timePerGame: z
        .number()
        .int()
        .min(60)
        .max(15 * 24 * 3600)
        .default(15 * 24 * 3600),
      timePerMove: z
        .number()
        .int()
        .min(0)
        .max(24 * 3600)
        .default(15 * 60),
      timerStart: z
        .number()
        .int()
        .min(0)
        .max(24 * 3600 - 1)
        .optional(),
      timerEnd: z
        .number()
        .int()
        .min(0)
        .max(24 * 3600 - 1)
        .optional(),
      minimumKarma: z
        .number()
        .int()
        .min(0)
        .max(Math.max(user.karma - 5, 0))
        .optional(),
      scheduledStart: z.date({ coerce: true }).min(new Date()).max(addDays(new Date(), 10)).optional(),
      // Todo: add default values: join: true, unlisted: false, playerOrder: "random"
      join: z.boolean(),
      unlisted: z.boolean(),
      playerOrder: z.enum(["random", "host", "join"]),
    })
    .parse(body);

  const options: Record<string, string | boolean> = {};

  const gameInfo = await GameInfo.findOne({ _id: gameInfoId });

  if (!gameInfo) {
    ctx.status = 404;
    return;
  }

  if (
    !gameInfo.meta.public &&
    !(await GamePreferences.findOne({
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
      await GamePreferences.findOne({ game: gameInfoId.game, user: user._id, "access.ownership": true }),
      "You need to own the game in order to host a new game. Check your account settings."
    );
  }

  if (!gameInfo.players.includes(players)) {
    throw createError(400, "Wrong number of players");
  }

  if (await Game.findById(gameId)) {
    throw createError(400, `A game with the id '${gameId}' already exists`);
  }

  for (const [key, val] of Object.entries(body.options ?? {})) {
    if (typeof val !== "string" && typeof val !== "boolean") {
      continue;
    }

    if (val === "$none") {
      continue;
    }

    const item = gameInfo.options.find((opt) => opt.name === key);
    if (!item) {
      continue;
    }

    if (item.type === "checkbox") {
      assert(typeof val === "boolean", "Invalid value for option: " + key);
    } else if (item.type === "select") {
      assert(typeof val === "string" && item.items?.some((it) => it.name === val), "Invalid value for option: " + key);
    } else {
      continue;
    }

    options[key] = val;
  }

  if (timerStart !== timerEnd && typeof timerStart === "number" && typeof timerEnd === "number") {
    assert(
      timerDuration({ start: timerStart, end: timerEnd }) >= 3 * 3600,
      "You need at least have a 3 hour window of play time"
    );
  }

  await collections.games.insertOne({
    _id: gameId,
    creator: user._id,
    game: {
      name: gameInfo._id.game,
      version: gameInfo._id.version,
      expansions: (expansions ?? []).filter((exp: string) => gameInfo.expansions.some((exp2) => exp2.name === exp)),
      options,
    },
    options: {
      setup: {
        seed: seed ?? gameId,
        nbPlayers: players,
        playerOrder,
      },
      timing: {
        timePerGame,
        timePerMove,
        timer:
          timerStart !== undefined && timerEnd !== undefined
            ? {
                start: timerStart,
                end: timerEnd,
              }
            : undefined,
        scheduledStart,
      },
      meta: {
        unlisted,
        minimumKarma,
      },
    },
    players: join
      ? [
          {
            _id: user._id,
            remainingTime: timePerGame,
            dropped: false,
            score: 0,
            quit: false,
            name: user.account.username,
          },
        ]
      : [],
    createdAt: new Date(),
    updatedAt: new Date(),
    status: "open",
    data: {},
    cancelled: false,
    ready: false,
    currentPlayers: [],
    context: {
      round: 0,
    },
  });

  ctx.status = 200;
});

router.param("gameId", async (gameId, ctx, next) => {
  ctx.state.game = await collections.games.findOne({ _id: gameId });

  if (!ctx.state.game) {
    throw createError(404, "Game not found: " + gameId);
  }

  await next();
});

// Metadata about the game
router.get("/:gameId", (ctx) => {
  ctx.body = omit(ctx.state.game, "data");
});

router.get("/:gameId/players", async (ctx) => {
  const ret = [];
  const ids = [...ctx.state.game.players.map((pl) => pl._id), ctx.state.game.creator];
  const users = await User.find({ _id: { $in: ids } })
    .select("account.username")
    .lean(true);
  const gamePrefs = await GamePreferences.find({
    game: ctx.state.game.game.name,
    user: { $in: users.map((user) => user._id) },
  }).lean(true);
  for (const user of users) {
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

  const parsed = z
    .object({
      type: z.enum(["text", "emoji"]),
      data: z.object({
        text: z.string().min(1).max(300).trim(),
      }),
    })
    .parse(ctx.request.body);

  await collections.chatMessages.insertOne({
    _id: new ObjectId(),
    room: ctx.state.game._id,
    author: {
      _id: ctx.state.user._id,
      name: ctx.state.user.account.username,
    },
    data: {
      text: parsed.data.text,
    },
    type: parsed.type,
  });

  ctx.status = 200;
});

router.post("/:gameId/invite", loggedIn, async (ctx) => {
  assert(
    ctx.state.user._id.equals(ctx.state.game.creator),
    "You must be the creator of the game to invite other players"
  );
  // assert(ctx.state.game.options.timing.scheduledStart, "The game must have a scheduled start");

  const { userId } = ctx.request.body;

  const free = await locks.lock("game", ctx.params.gameId);
  try {
    const game = await Game.findOne({
      _id: ctx.params.gameId,
      status: "open",
    });

    assert(game.players.length < game.options.setup.nbPlayers, "Too many people have joined the game");
    assert(!game.players.some((pl) => pl._id.equals(userId)), "That user is already in the player list");

    const userName = (await User.findById(userId).select("account.username")).account.username;

    game.players.push({
      _id: userId,
      remainingTime: game.options.timing.timePerGame,
      quit: false,
      dropped: false,
      score: 0,
      name: userName,
      pending: true,
    });

    game.currentPlayers.push({ _id: userId, timerStart: new Date(), deadline: game.options.timing.scheduledStart });

    await game.save();
  } finally {
    free().catch(console.error);
  }

  ctx.body = omit(ctx.state.game, "data");
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
      const games = await Game.findWithPlayer(ctx.state.user._id).where("status").ne("ended").limit(2).count();
      assert(games < 2, "You can't join more than two games at the same time when your karma is less than 50");
    }
  }

  const free = await locks.lock("game", ctx.params.gameId);
  try {
    const game = await Game.findOne({
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
      game.currentPlayers = game.currentPlayers.filter((pl) => !pl._id.equals(existingPlayer._id));
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

    await game.save();

    ctx.state.game = game;

    if (game.ready && !game.options.timing.scheduledStart) {
      await notifyGameStart(game);
    }
  } finally {
    free().catch(console.error);
  }
  ctx.body = omit(ctx.state.game, "data");
});

router.post("/:gameId/unjoin", loggedIn, async (ctx) => {
  const free = await locks.lock("game", ctx.params.gameId);
  try {
    const game = await Game.findOne({ _id: ctx.params.gameId, status: "open" });

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
    game.currentPlayers = game.currentPlayers.filter(
      (pl) => !pl._id.equals(ctx.state.user._id) && !pl._id.equals(game.creator)
    );

    if (/* ctx.state.user._id.equals(game.creator) && */ game.players.length === 0) {
      // Remove game if its own creator leaves, and there's no one else
      await game.remove();
    } else {
      await game.save();
    }

    ctx.state.game = game;
  } finally {
    free().catch(console.error);
  }
  ctx.body = omit(ctx.state.game, "data");
});

router.post("/:gameId/start", loggedIn, async (ctx) => {
  const free = await locks.lock("game", ctx.params.gameId);
  try {
    const game = await Game.findOne({
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

    const { playerOrder } = ctx.request.body;

    if (playerOrder) {
      game.players = [...game.players].sort(
        (p1, p2) => playerOrder.indexOf(p1._id.toString()) - playerOrder.indexOf(p2._id.toString())
      );
    }
    game.ready = true;

    await game.save();

    if (!game.options.timing.scheduledStart) {
      await notifyGameStart(game);
    }

    ctx.state.game = game;
  } finally {
    free().catch(console.error);
  }
  ctx.body = omit(ctx.state.game, "data");
});

router.post("/:gameId/cancel", loggedIn, async (ctx) => {
  assert(
    ctx.state.user && ctx.state.game.players.some((pl) => pl._id.equals(ctx.state.user._id)),
    "You must be a player of the game to vote!"
  );

  await using lock = await locks.lock(["game-cancel", ctx.params.gameId]);

  if (!lock) {
    throw createError(409, "The game is already being cancelled");
  }

  const game = await Game.findOne({ _id: ctx.params.gameId });

  assert(game, createError(404));
  assert(game.status === "active", "The game is not ongoing");

  const player = game.players.find((pl) => pl._id.equals(ctx.state.user._id));

  assert(!player.voteCancel, "You already voted to cancel the game");

  player.voteCancel = true;

  await collections.chatMessages.insertOne({
    _id: new ObjectId(),
    room: game._id,
    type: "system",
    data: { text: `${ctx.state.user.account.username} voted to cancel this game` },
  });

  if (game.players.every((pl) => pl.voteCancel || pl.dropped)) {
    await collections.chatMessages.insertOne({
      _id: new ObjectId(),
      room: game._id,
      type: "system",
      data: { text: `Game cancelled` },
    });
    game.status = "ended";
    game.cancelled = true;
    game.currentPlayers = null;
  }

  await game.save();

  if (game.status === "ended") {
    // Possible concurrency issue if game is cancelled at the exact same time as being finished
    await GameNotification.create({ kind: "gameEnded", game: game._id });
  }

  ctx.status = 200;
});

router.post("/:gameId/quit", loggedIn, async (ctx) => {
  assert(
    ctx.state.user && ctx.state.game.players.some((pl) => pl._id.equals(ctx.state.user._id)),
    "You must be a player of the game to quit!"
  );

  await using lock = await locks.lock(["game-cancel", ctx.params.gameId]);

  if (!lock) {
    throw createError(409, "The game is already being cancelled");
  }

  const game = await Game.findOne({ _id: ctx.params.gameId }).select("players status").lean(true);

  assert(game.status === "active", "The game is not ongoing");

  const player = game.players.find((pl) => pl._id.equals(ctx.state.user._id));

  assert(!player.quit && !player.dropped, "You already quit the game");

  await GameNotification.create({ kind: "playerQuit", user: ctx.state.user._id, game: game._id });

  ctx.status = 200;
});

router.post("/:gameId/drop/:userId", loggedIn, async (ctx) => {
  assert(
    ctx.state.user && ctx.state.game.players.some((pl) => pl._id.equals(ctx.state.user._id)),
    "You must be a player of the game!"
  );
  const targetId = ctx.params.userId;
  assert(
    targetId && ctx.state.game.players.some((pl) => pl._id.equals(targetId), "The target must be a player of the game!")
  );

  const free = await locks.lock("game-cancel", ctx.params.gameId);

  try {
    const game = await Game.findOne({ _id: ctx.params.gameId }).select("currentPlayers players status").lean(true);

    assert(game.status === "active", "The game is not ongoing");

    const player = game.players.find((pl) => pl._id.equals(targetId));

    assert(!player.quit && !player.dropped, "That player already quit the game");

    const currentPlayer = game.currentPlayers.find((pl) => pl._id.equals(targetId));

    assert(currentPlayer, "It's not that player's turn to play");
    assert(currentPlayer.deadline < new Date(), "The player's time is not elapsed");

    await GameNotification.create({
      kind: "dropPlayer",
      user: targetId,
      game: game,
      meta: {
        dropper: ctx.state.user._id,
        deadline: currentPlayer.deadline,
        timerStart: currentPlayer.timerStart,
        remainingTime: player.remainingTime,
      },
    });
  } finally {
    free().catch(console.error);
  }

  ctx.status = 200;
});

router.post("/:roomId/notes", loggedIn, async (ctx) => {
  await RoomMetaData.findOneAndUpdate(
    {
      room: ctx.params.roomId,
      user: ctx.state.user._id,
    },
    {
      notes: ctx.request.body.notes,
    },
    {
      runValidators: true,
      upsert: true,
    }
  );
  ctx.status = 200;
});

router.get("/:roomId/notes", loggedIn, async (ctx) => {
  const metaData = await RoomMetaData.findOne({ room: ctx.params.roomId, user: ctx.state.user._id }).lean(true);

  ctx.body = metaData?.notes ?? "";
});

router.get("/:roomId/chat/lastRead", loggedIn, async (ctx) => {
  const metaData: RoomMetaDataDocument = await RoomMetaData.findOne({
    room: ctx.params.roomId,
    user: ctx.state.user._id,
  }).lean(true);

  if (!metaData || !metaData.lastChatMessageViewed) {
    ctx.body = 0;
  } else {
    ctx.body = new Date(metaData.lastChatMessageViewed).getTime();
  }
});

router.post("/:roomId/chat/lastRead", loggedIn, async (ctx) => {
  await RoomMetaData.findOneAndUpdate(
    { room: ctx.params.roomId, user: ctx.state.user._id },
    { lastChatMessageViewed: new Date(ctx.request.body.lastRead) },
    { upsert: true }
  );
  ctx.status = 200;
});

router.delete("/:gameId", isAdmin, async (ctx) => {
  await ctx.state.game.remove();
  ctx.status = 200;
});

export default router;
