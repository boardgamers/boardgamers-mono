import { subHours, subWeeks } from "date-fns";
import { shuffle } from "@bgs/utils/array";
import { ObjectId } from "mongodb";
import locks from "../config/locks.ts";
import type { GameDoc } from "@bgs/models";
import { colls } from "../config/db.ts";

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
  await colls.gameNotifications.insertOne({ game: game._id, kind: "gameStarted", processed: false, createdAt: now, updatedAt: now });
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
