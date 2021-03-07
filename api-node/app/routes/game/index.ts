import assert from "assert";
import createError from "http-errors";
import { Context } from "koa";
import Router from "koa-router";
import { omit, shuffle } from "lodash";
import locks from "mongo-locks";
import { timerDuration } from "../../engine/time-utils";
import {
  ChatMessage,
  Game,
  GameInfo,
  GameNotification,
  GamePreferences,
  RoomMetaData,
  RoomMetaDataDocument,
  User,
} from "../../models";
import GameService from "../../services/game";
import { isAdmin, isConfirmed, loggedIn, queryCount, skipCount } from "../utils";

const router = new Router<Application.DefaultState, Context>();

router.post("/new-game", loggedIn, isConfirmed, async (ctx) => {
  const body = ctx.request.body;
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
  const options = body.options ?? {};

  const gameInfo = await GameInfo.findOne({ _id: gameInfoId });

  if (!gameInfo) {
    ctx.status = 404;
    return;
  }

  if (
    !gameInfo.meta.public &&
    !(await GamePreferences.findOne({
      game: gameInfoId.game,
      user: ctx.state.user.id,
      "access.maxVersion": { $gte: gameInfoId.version },
    }))
  ) {
    ctx.status = 403;
    return;
  }

  if (gameInfo.meta.needOwnership) {
    assert(
      await GamePreferences.findOne({ game: gameInfoId.game, user: ctx.state.user.id, "access.ownership": true }),
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

  if (await Game.findById(gameId)) {
    throw createError(400, `A game with the id '${gameId}' already exists`);
  }

  const game = new Game();

  game.creator = ctx.state.user._id;
  game.game = {
    name: gameInfo._id.game,
    version: gameInfo._id.version,
    expansions: (expansions ?? []).filter((exp: string) => gameInfo.expansions.some((exp2) => exp2.name === exp)),

    options: omit(options, "join", "randomOrder", "unlisted"),
  };
  game.options.setup.seed = seed;
  game.options.setup.nbPlayers = players;
  game.options.setup.randomPlayerOrder = options.randomOrder;
  game.options.meta.unlisted = options.unlisted;
  game.options.timing.timePerMove = timePerMove;
  game.options.timing.timePerGame = timePerGame;

  if (scheduledStart) {
    assert(scheduledStart > Date.now(), "The scheduled start must not be in the past");
    assert(
      scheduledStart < Date.now() + 10 * 24 * 3600 * 1000,
      "The scheduled start must not be more than 10 days in the future"
    );

    game.options.timing.scheduledStart = new Date(scheduledStart);
  }

  if (minimumKarma !== undefined && minimumKarma !== null) {
    assert(+minimumKarma === minimumKarma && Math.floor(minimumKarma) === minimumKarma && minimumKarma >= 0);
    assert(
      minimumKarma + 5 <= ctx.state.user.account.karma,
      "You can't create a game with that high of a karma restriction"
    );
    game.options.meta.minimumKarma = minimumKarma;
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

    game.options.timing.timer.start = timerStart;
    game.options.timing.timer.end = timerEnd;
  }

  game._id = gameId;

  if (options.join) {
    game.players.push({
      _id: ctx.state.user._id,
      remainingTime: game.options.timing.timePerGame,
      dropped: false,
      score: 0,
      name: ctx.state.user.account.username,
      quit: false,
    });
  } else {
    // assert(false, "You need special authorization to create games without joining them!");
  }

  await game.save();

  ctx.status = 200;
});

router.param("gameId", async (gameId, ctx, next) => {
  ctx.state.game = await Game.findById(gameId);

  if (!ctx.state.game) {
    throw createError(404, "Game not found");
  }

  await next();
});

router.get("/active", async (ctx) => {
  const conditions: Record<string, unknown> = { status: "active" };
  if (ctx.query.user) {
    conditions["players._id"] = ctx.query.user;
  }
  ctx.body = await Game.find(conditions)
    .sort("-lastMove")
    .skip(skipCount(ctx))
    .limit(queryCount(ctx))
    .select(Game.basics());
});

router.get("/active/count", async (ctx) => {
  const conditions: Record<string, unknown> = { status: "active" };
  if (ctx.query.user) {
    conditions["players._id"] = ctx.query.user;
  }
  ctx.body = await Game.count(conditions).exec();
});

router.get("/closed", async (ctx) => {
  const conditions: Record<string, unknown> = { status: "ended" };
  if (ctx.query.user) {
    conditions["players._id"] = ctx.query.user;
  }
  ctx.body = await Game.find(conditions)
    .sort("-lastMove")
    .skip(skipCount(ctx))
    .limit(queryCount(ctx))
    .select([...Game.basics(), "cancelled"])
    .lean(true);
});

router.get("/closed/count", async (ctx) => {
  const conditions: Record<string, unknown> = { status: "ended" };
  if (ctx.query.user) {
    conditions["players._id"] = ctx.query.user;
  }
  ctx.body = await Game.count(conditions).exec();
});

router.get("/open", async (ctx) => {
  const conditions: Record<string, unknown> = { status: "open", "options.meta.unlisted": { $ne: true } };

  if (ctx.query.maxKarma) {
    conditions.$or = [
      { "options.meta.minimumKarma": { $lte: +ctx.query.maxKarma } },
      { "options.meta.minimumKarma": { $exists: false } },
    ];
  }
  if (ctx.query.user) {
    conditions["players._id"] = ctx.query.user;
  }

  if (ctx.query.sample) {
    ctx.body = await Game.aggregate()
      .match(conditions)
      .sample(queryCount(ctx))
      .project(Game.basics().reduce((acc, item) => ({ ...acc, [item]: 1 }), {}));
  } else {
    ctx.body = await Game.find(conditions)
      .sort("-createdAt")
      .skip(skipCount(ctx))
      .limit(queryCount(ctx))
      .select(Game.basics())
      .lean(true);
  }
});

router.get("/open/count", async (ctx) => {
  const conditions: Record<string, unknown> = { status: "open", "options.meta.unlisted": { $ne: true } };

  if (ctx.query.user) {
    conditions["players._id"] = ctx.query.user;
  }

  if (ctx.query.maxKarma) {
    conditions.$or = [
      { "options.meta.minimumKarma": { $lte: +ctx.query.maxKarma } },
      { "options.meta.minimumKarma": { $exists: false } },
    ];
  }

  ctx.body = await Game.count(conditions).exec();
});

router.get("/stats", async (ctx) => {
  const [active, open, total, finished] = await Promise.all([
    Game.count({ status: "active" }).exec(),
    Game.count({ status: "open", "options.meta.unlisted": { $ne: true } }).exec(),
    Game.count({}).exec(),
    Game.count({ status: "ended" }).exec(),
  ]);

  ctx.body = {
    active,
    open,
    total,
    finished,
  };
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
    ret.push({ id: user._id, name: user.account.username, elo: gamePref?.elo?.value ?? 0 });
  }
  ctx.body = ret;
});

router.post("/:gameId/chat", loggedIn, isConfirmed, async (ctx) => {
  assert(
    ctx.state.user && ctx.state.game.players.some((pl) => pl._id.equals(ctx.state.user._id)),
    "You must be a player of the game to chat!"
  );
  assert(ctx.request.body.type === "text" || ctx.request.body.type === "emoji");

  const text = ctx.request.body?.data?.text?.trim();
  assert(text, "Empty chat message");

  const doc = new ChatMessage({
    room: ctx.state.game._id,
    author: ctx.state.user._id,
    data: {
      text: ctx.request.body.data.text,
    },
    type: ctx.request.body.type,
  });
  await doc.save();
  ctx.status = 200;
});

router.post("/:gameId/join", loggedIn, isConfirmed, async (ctx) => {
  // Do basic checks before creating the lock
  assert(ctx.state.game.status === "open");
  const karma = ctx.state.user.account.karma;
  assert(
    ctx.state.game.options.meta.minimumKarma === undefined || karma >= ctx.state.game.options.meta.minimumKarma,
    "You do not have enough karma to join this game"
  );

  if (karma < 50) {
    const games = await Game.findWithPlayer(ctx.state.user._id).where("status").ne("ended").limit(2).count();
    assert(games < 2, "You can't join more than two games at the same time when your karma is less than 50");
  }

  const free = await locks.lock("game", ctx.params.gameId);
  try {
    const game = await Game.findOne({
      _id: ctx.params.gameId,
      status: "open",
      $or: [
        {
          "options.meta.minimumKarma": { $exists: false },
        },
        {
          "options.meta.minimumKarma": { $lte: ctx.state.user.account.karma },
        },
      ],
    });

    if (!game) {
      ctx.status = 404;
      return;
    }

    // Todo: checked if allowed to join such a game

    assert(!game.players.some((pl) => pl._id.equals(ctx.state.user._id)), "You already joined the game");
    assert(game.players.length < game.options.setup.nbPlayers, "Too many people have joined the game");

    game.players.push({
      _id: ctx.state.user._id,
      remainingTime: game.options.timing.timePerGame,
      quit: false,
      dropped: false,
      score: 0,
      name: ctx.state.user.account.username,
    });

    if (game.players.length === game.options.setup.nbPlayers) {
      if (game.options.setup.randomPlayerOrder) {
        // Mongoose (5.10.0) will bug if I directly set to the shuffled value (because array item's .get are not set)
        const shuffled = shuffle(game.players);
        game.players = [];
        game.players.push(...shuffled);
      }
    }

    await game.save();

    ctx.state.game = game;

    if (game.players.length === game.options.setup.nbPlayers && !game.options.timing.scheduledStart) {
      await GameService.notifyGameStart(game);
    }
  } finally {
    free();
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
    assert(game.players.length < game.options.setup.nbPlayers, "You can't unjoin a game that's full");

    game.players = game.players.filter((pl) => !pl._id.equals(ctx.state.user._id));

    if (/* ctx.state.user._id.equals(game.creator) && */ game.players.length === 0) {
      // Remove game if its own creator leaves, and there's no one else
      await game.remove();
    } else {
      await game.save();
    }

    ctx.state.game = game;
  } finally {
    free();
  }
  ctx.body = omit(ctx.state.game, "data");
});

router.post("/:gameId/cancel", loggedIn, async (ctx) => {
  assert(
    ctx.state.user && ctx.state.game.players.some((pl) => pl._id.equals(ctx.state.user._id)),
    "You must be a player of the game to vote!"
  );

  const free = await locks.lock("game-cancel", ctx.params.gameId);

  try {
    const game = await Game.findOne({ _id: ctx.params.gameId });

    assert(game, createError(404));
    assert(game.status === "active", "The game is not ongoing");

    const player = game.players.find((pl) => pl._id.equals(ctx.state.user._id));

    assert(!player.voteCancel, "You already voted to cancel the game");

    player.voteCancel = true;
    await ChatMessage.create({
      room: game._id,
      type: "system",
      data: { text: `${player.name} voted to cancel this game` },
    });

    if (game.players.every((pl) => pl.voteCancel || pl.dropped)) {
      await ChatMessage.create({ room: game._id, type: "system", data: { text: `Game cancelled` } });
      game.status = "ended";
      game.cancelled = true;
      game.currentPlayers = null;
    }

    await game.save();

    if (game.status === "ended") {
      // Possible concurrency issue if game is cancelled at the exact same time as being finished
      await GameNotification.create({ kind: "gameEnded", game: game._id });
    }
  } finally {
    free();
  }

  ctx.status = 200;
});

router.post("/:gameId/quit", loggedIn, async (ctx) => {
  assert(
    ctx.state.user && ctx.state.game.players.some((pl) => pl._id.equals(ctx.state.user._id)),
    "You must be a player of the game to quit!"
  );

  const free = await locks.lock("game-cancel", ctx.params.gameId);

  try {
    const game = await Game.findOne({ _id: ctx.params.gameId }).select("players status").lean(true);

    assert(game.status === "active", "The game is not ongoing");

    const player = game.players.find((pl) => pl._id.equals(ctx.state.user._id));

    assert(!player.quit && !player.dropped, "You already quit the game");

    await GameNotification.create({ kind: "playerQuit", user: ctx.state.user._id, game: game._id });
  } finally {
    free();
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

    await GameNotification.create({ kind: "dropPlayer", user: targetId, game: game._id });
  } finally {
    free();
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
