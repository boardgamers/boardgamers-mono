import { subHours, subWeeks } from "date-fns";
import { shuffle } from "lodash";
import type { GameDocument } from "../models";
import { Game, GameNotification } from "../models";
import { collections, locks } from "../config/db";
import { ObjectId } from "mongodb";

export async function notifyGameStart(game: GameDocument): Promise<void> {
  if (game.options.setup.playerOrder === "random") {
    // Mongoose (5.10.0) will bug if I directly set to the shuffled value (because array item's .get are not set)
    const shuffled = shuffle(game.players);
    game.players = [];
    game.players.push(...shuffled);
    await game.save();
  }

  await collections.chatMessages.insertOne({
    _id: new ObjectId(),
    room: game._id,
    type: "system",
    data: { text: "Game started" },
  });

  await GameNotification.create({ game: game._id, kind: "gameStarted", processed: false });
}

export async function cancelOldOpenGames() {
  // Remove live games an hour old
  await Game.remove({
    status: "open",
    "options.timing.scheduledStart": { $exists: false },
    "options.timing.timePerGame": { $lte: 600 },
    createdAt: { $lt: subHours(Date.now(), 1) },
  });

  // Remove fast games three hours old
  await Game.remove({
    status: "open",
    "options.timing.scheduledStart": { $exists: false },
    "options.timing.timePerGame": { $lte: 3600 },
    createdAt: { $lt: subHours(Date.now(), 3) },
  });

  // Remove games a week old
  await Game.remove({
    status: "open",
    "options.timing.scheduledStart": { $exists: false },
    createdAt: { $lt: subWeeks(Date.now(), 1) },
  });
}

export async function processSchedulesGames(): Promise<void> {
  await using lock = await locks.lock(["game", "scheduled-games"]);

  if (!lock) {
    return;
  }

  for await (const game of Game.find({
    status: "open",
    "options.timing.scheduledStart": { $lt: new Date() },
  }).cursor()) {
    const g: GameDocument = game;

    if (!g.ready) {
      await collections.chatMessages.insertOne({
        _id: new ObjectId(),
        room: g._id,
        type: "system",
        data: { text: "Game cancelled because host didn't set the final options in time" },
      });
      g.cancelled = true;
      g.status = "ended";
      await g.save();
      continue;
    }
    // Do this to avoid being caught in a loop again, before game server starts the game
    g.options.timing.scheduledStart = undefined;
    await g.save();
    await notifyGameStart(g);
  }
}

export async function processUnreadyGames(): Promise<void> {
  const games = await Game.find(
    {
      ready: false,
      status: "open",
      "currentPlayers.0.deadline": { $lt: Date.now() },
    },
    { _id: 1 }
  ).lean(true);

  for (const toFetch of games) {
    try {
      await using lock = await locks.lock(["game", toFetch._id]);

      if (!lock) {
        continue;
      }

      const game = await Game.findById(toFetch._id, { status: 1 });

      if (game.status === "open") {
        await collections.chatMessages.insertOne({
          _id: new ObjectId(),
          room: game._id,
          type: "system",
          data: { text: "Game cancelled because host didn't set the final options in time" },
        });
        game.cancelled = true;
        game.status = "ended";
        await game.save();
      }
    } catch (err) {
      console.error(err);
    }
  }
}
