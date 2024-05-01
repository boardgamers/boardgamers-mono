import { subHours, subWeeks } from "date-fns";
import { shuffle } from "lodash";
import { GameNotification } from "../models";
import { collections, locks } from "../config/db";
import { ObjectId } from "mongodb";
import type { Game } from "@bgs/types";

export async function notifyGameStart(game: Pick<Game<ObjectId>, "_id" | "options" | "players">): Promise<void> {
  if (game.options.setup.playerOrder === "random") {
    game.players = shuffle(game.players);
    await collections.games.updateOne({ _id: game._id }, { $set: { players: game.players, updatedAt: new Date() } });
  }

  await collections.chatMessages.insertOne({
    _id: new ObjectId(),
    room: game._id,
    type: "system",
    data: { text: "Game started" },
  });

  await GameNotification.create({ game: game._id, kind: "gameStarted", processed: false });
}

export async function cancelOldOpenGames(): Promise<void> {
  // Remove live games an hour old
  await collections.games.deleteMany({
    status: "open",
    "options.timing.scheduledStart": { $exists: false },
    "options.timing.timePerGame": { $lte: 600 },
    createdAt: { $lt: subHours(Date.now(), 1) },
  });

  // Remove fast games three hours old
  await collections.games.deleteMany({
    status: "open",
    "options.timing.scheduledStart": { $exists: false },
    "options.timing.timePerGame": { $lte: 3600 },
    createdAt: { $lt: subHours(Date.now(), 3) },
  });

  // Remove games a week old
  await collections.games.deleteMany({
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

  for await (const game of collections.games
    .find({
      status: "open",
      "options.timing.scheduledStart": { $lt: new Date() },
    })
    .project<Pick<Game<ObjectId>, "ready" | "_id" | "options" | "players">>({ ready: 1 })) {
    if (!game.ready) {
      await collections.chatMessages.insertOne({
        _id: new ObjectId(),
        room: game._id,
        type: "system",
        data: { text: "Game cancelled because host didn't set the final options in time" },
      });
      await collections.games.updateOne(
        { _id: game._id },
        { $set: { cancelled: true, status: "ended", updatedAt: new Date() } }
      );
      continue;
    }
    await collections.games.updateOne(
      { _id: game._id },
      {
        // Do this to avoid being caught in a loop again, before game server starts the game
        $unset: { "options.timing.scheduledStart": "" },
      }
    );
    await notifyGameStart(game);
  }
}

export async function processUnreadyGames(): Promise<void> {
  const games = await collections.games
    .find({
      ready: false,
      status: "open",
      "currentPlayers.0.deadline": { $lt: Date.now() },
    })
    .project<Pick<Game<ObjectId>, "_id">>({
      _id: 1,
    })
    .toArray();

  for (const toFetch of games) {
    try {
      await using lock = await locks.lock(["game", toFetch._id]);

      if (!lock) {
        continue;
      }

      const game = await collections.games.findOne<Pick<Game<ObjectId>, "status" | "_id">>(
        { _id: toFetch._id },
        { projection: { status: 1, _id: 1 } }
      );

      if (!game) {
        continue;
      }

      if (game.status === "open") {
        await collections.chatMessages.insertOne({
          _id: new ObjectId(),
          room: game._id,
          type: "system",
          data: { text: "Game cancelled because host didn't set the final options in time" },
        });
        await collections.games.updateOne(
          { _id: game._id },
          { $set: { cancelled: true, status: "ended", updatedAt: new Date() } }
        );
      }
    } catch (err) {
      console.error(err);
    }
  }
}
