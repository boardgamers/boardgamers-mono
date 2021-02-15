import { GameNotification as IGameNotification } from "@lib/gamenotification";
import assert from "assert";
import type { ObjectID } from "bson";
import crypto from "crypto";
import locks from "mongo-locks";
import env from "../config/env";
import ChatMessage from "../models/chatmessage";
import Game, { GameDocument } from "../models/game";
import GameNotification from "../models/gamenotification";
import type { Engine, GameData } from "../types/engine";
import { deadline, elapsedSeconds } from "../utils/time";
import { getEngine } from "./engines";

export async function handleMessages(engine: Engine, gameId: string, gameData: GameData): Promise<GameData> {
  if (engine.messages) {
    const ret = engine.messages(gameData);

    for (const message of ret.messages) {
      await ChatMessage.create({ room: gameId, type: "system", data: { text: message } });
    }

    return ret.data;
  }

  return gameData;
}

export async function addMessage(gameId: string, message: string) {
  await ChatMessage.create({ room: gameId, type: "system", data: { text: message } });
}

export async function startNextGame(): Promise<boolean> {
  let free = locks.noop;
  try {
    const notification = await GameNotification.findOne({ kind: "gameStarted", processed: false });

    if (!notification) {
      return false;
    }

    free = await locks.lock("game", notification.game);

    const game = await Game.findById(notification.game);

    if (!game || game.status !== "open" || game.players.length < game.options.setup.nbPlayers) {
      // Something happened, not ready to start
      await notification.update({ processed: true });
      return true;
    }

    const engine = await getEngine(game.game.name, game.game.version);

    let seed = game.options.setup.seed;

    if (engine.stripSecret) {
      // encrypt seed if there are secrets
      seed = crypto.createHash("sha256").update(seed).update(env.seedEncryptionKey).digest().toString("base64");
    }

    let gameData = await engine.init(game.options.setup.nbPlayers, game.game.expansions, game.game.options || {}, seed);

    if (engine.setPlayerMetaData) {
      for (let i = 0; i < game.options.setup.nbPlayers; i++) {
        gameData = engine.setPlayerMetaData(gameData, i, { name: game.players[i].name });
      }
    }

    game.data = gameData;
    game.status = "active";

    const currentPlayers: number[] = (() => {
      const current = engine.currentPlayer(gameData) ?? [];

      return Array.isArray(current) ? current : [current];
    })();

    game.currentPlayers = currentPlayers.map((playerNumber) => ({
      _id: game.players[playerNumber]._id,
      timerStart: new Date(),
      deadline: deadline(
        game.players[playerNumber].remainingTime ?? game.options.timing.timePerGame,
        game.options.timing.timer
      ),
    }));

    game.lastMove = new Date();

    if (engine.round) {
      game.context.round = engine.round(gameData);
    }

    await game.save();
    const promises = (game.currentPlayers ?? []).map((pl) =>
      GameNotification.create({ user: pl._id, createdAt: new Date(), game: game._id, kind: "currentMove" })
    );
    await Promise.all([...promises, notification.update({ processed: true })]);

    return true;
  } catch (err) {
    console.error(err);
    return false;
  } finally {
    free();
  }
}

export async function processNextQuit() {
  let free = locks.noop;
  try {
    const notification = await GameNotification.findOne({ kind: "playerQuit", processed: false });

    if (!notification) {
      return false;
    }

    free = await locks.lock("game", notification.game);

    const game = await Game.findById(notification.game);

    if (!game || game.status !== "active") {
      // Something happened, not ready to start
      await notification.update({ processed: true });
      return true;
    }

    const player = game.players.find((pl) => pl._id.equals(notification.user));

    if (!player || player.dropped || player.quit) {
      await notification.update({ processed: true });
      return true;
    }

    const engine = await getEngine(game.game.name, game.game.version);

    let gameData = game.data;

    gameData = await engine.dropPlayer(
      gameData,
      game.players.findIndex((pl) => pl._id.equals(player._id))
    );
    player.quit = true;

    ChatMessage.create({ room: game._id, type: "system", data: { text: `${player.name} quit the game` } }).catch(
      console.error
    );

    if (engine.toSave) {
      gameData = engine.toSave(gameData);
    }

    if (gameData) {
      await afterMove(engine, game, gameData);
    }
    await notification.update({ processed: true });

    return true;
  } catch (err) {
    console.error(err);
    return false;
  } finally {
    free();
  }
}

export async function afterMove(engine: Engine, game: GameDocument, gameData: GameData, alreadyEnded = false) {
  const oldPlayers = game.currentPlayers;

  gameData = await handleMessages(engine, game._id, gameData);

  if (engine.round) {
    game.context.round = engine.round(gameData);
  }

  if (
    (engine.cancelled && engine.cancelled(gameData)) ||
    game.players.every((pl) => pl.dropped || pl.quit || pl.voteCancel)
  ) {
    game.currentPlayers = null;
    game.status = "ended";
    game.cancelled = true;
    await addMessage(game._id, "Game cancelled");
  } else if (engine.ended(gameData)) {
    game.currentPlayers = null;
    game.status = "ended";
    await addMessage(game._id, "Game ended");
  } else {
    const currentPlayers: number[] = (() => {
      const current = engine.currentPlayer(gameData) ?? [];

      return Array.isArray(current) ? current : [current];
    })();
    game.currentPlayers = currentPlayers.map((playerNumber) => {
      const oldPlayer = oldPlayers?.find((player) => player._id.equals(game.players[playerNumber]._id));
      const player = game.players[playerNumber];
      return {
        _id: player._id,
        timerStart: oldPlayer?.timerStart ?? new Date(),
        deadline:
          oldPlayer?.deadline ??
          deadline(player.remainingTime ?? game.options.timing.timePerGame, game.options.timing.timer),
      };
    });
  }
  const scores = engine.scores(gameData);
  const factions = engine.factions?.(gameData);

  if (scores) {
    assert(scores.length === game.players.length);
    scores.forEach((score, i) => (game.players[i].score = score));
  }

  if (game.status === "ended") {
    let rankings = engine.rankings?.(gameData);

    if (!rankings) {
      const sortedScores = [...scores].sort((a, b) => b - a);
      rankings = scores.map((x) => sortedScores.indexOf(x) + 1);
    }

    rankings.forEach((ranking, i) => (game.players[i].ranking = ranking));
  }

  if (factions) {
    assert(factions.length === game.players.length);
    factions.forEach((faction, i) => (game.players[i].faction = faction));
  }

  if (!engine.ended(gameData)) {
    for (const oldPlayer of oldPlayers.filter((pl) => !game.currentPlayers?.some((pl2) => pl2._id.equals(pl._id)))) {
      const player = game.players.find((pl) => pl._id.equals(oldPlayer._id))!;
      player.remainingTime = Math.min(
        game.options.timing.timePerGame,
        (player.remainingTime ?? game.options.timing.timePerGame) -
          elapsedSeconds(oldPlayer.timerStart, game.options.timing.timer) +
          game.options.timing.timePerMove
      );
    }

    game.markModified("players");
  }

  game.lastMove = new Date();
  game.data = gameData;

  game.markModified("data");

  await game.save();
  for (const player of game.currentPlayers ?? []) {
    await GameNotification.create({ user: player, createdAt: new Date(), game: game._id, kind: "currentMove" });
  }
  if (game.status === "ended" && !alreadyEnded) {
    await GameNotification.create({ game: game._id, kind: "gameEnded" });
  }
}

export async function checkMoveDeadline(gameId: string) {
  // Prevent multiple moves being executed at the same time
  const free = await locks.lock("game", gameId);

  try {
    // Once inside the lock, refresh the game
    const game = await Game.findById(gameId);

    if (game.status !== "active" || !game.currentPlayers?.some((player) => player.deadline < new Date())) {
      return;
    }

    console.log("move deadline expired for game", game._id);

    const engine = await getEngine(game.game.name, game.game.version);

    if (!engine) {
      console.log("no engine for game", gameId);
      return;
    }

    const playerIds = game.currentPlayers.filter((player) => player.deadline < new Date());
    const players = game.players.filter((player) => playerIds.some((id) => player._id.equals(id._id)));

    let gameData = game.data;

    for (const player of players) {
      gameData = await engine.dropPlayer(
        gameData,
        game.players.findIndex((pl) => pl._id.equals(player._id))
      );
      player.dropped = true;

      ChatMessage.create({
        room: game._id,
        type: "system",
        data: { text: `${player.name} dropped for inactivity` },
      }).catch(console.error);
      GameNotification.create({
        user: player._id,
        game: game._id,
        kind: "playerDrop",
      } as IGameNotification<ObjectID>).catch(console.error);
    }

    if (engine.toSave) {
      gameData = engine.toSave(gameData);
    }

    if (gameData) {
      await afterMove(engine, game, gameData);
    }
  } finally {
    free();
  }
}

export async function checkMoveDeadlines() {
  for (const game of await Game.find({
    status: "active",
    "currentPlayers.deadline": { $lt: new Date() },
  })
    .select("_id")
    .lean(true)) {
    try {
      await checkMoveDeadline(game._id);
    } catch (err) {
      console.error(err);
    }
  }
}
