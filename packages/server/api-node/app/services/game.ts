import locks from "mongo-locks";
import { ChatMessage, Game, GameDocument, GameNotification } from "../models";

export async function notifyGameStart(game: GameDocument) {
  await ChatMessage.create({ room: game._id, type: "system", data: { text: "Game started" } });
  await GameNotification.create({ game: game._id, kind: "gameStarted", processed: false });
}

export async function processSchedulesGames() {
  const free = await locks.lock("game", "scheduled-games");

  try {
    for await (const game of Game.find({
      status: "open",
      "options.timing.scheduledStart": { $lt: new Date() },
    }).cursor()) {
      const g: GameDocument = game;

      if (!g.ready) {
        await ChatMessage.create({
          room: game._id,
          type: "system",
          data: { text: "Game cancelled because it's not fully ready at scheduled start date" },
        });
        g.cancelled = true;
        g.status = "ended";
        await g.save();
        continue;
      }
      // Do this to avoid being caught in a loop again, before game server starts the game
      g.options.timing.scheduledStart = undefined;
      await g.save();
      await this.notifyGameStart(g);
    }
  } finally {
    free().catch(console.error);
  }
}

export async function processUnreadyGames() {
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
      const free = await locks.lock("game", toFetch._id);
      try {
        const game = await Game.findById(toFetch._id, { status: 1 });

        if (game.status === "open") {
          await ChatMessage.create({
            room: game._id,
            type: "system",
            data: { text: "Game cancelled because host didn't set the final options in time" },
          });
          game.cancelled = true;
          game.status = "ended";
          await game.save();
        }
      } finally {
        free();
      }
    } catch (err) {
      console.error(err);
    }
  }
}
