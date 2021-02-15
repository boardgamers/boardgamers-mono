import locks from "mongo-locks";
import ChatMessage from "../models/chatmessage";
import Game, { GameDocument } from "../models/game";
import GameNotification from "../models/gamenotification";

export default class GameService {
  static async notifyGameStart(game: GameDocument) {
    await ChatMessage.create({ room: game._id, type: "system", data: { text: "Game started" } });
    await GameNotification.create({ game: game._id, kind: "gameStarted", processed: false });
  }

  static async processSchedulesGames() {
    const free = await locks.lock("game", "scheduled-games");

    try {
      for await (const game of Game.find({
        status: "open",
        "options.timing.scheduledStart": { $lt: new Date() },
      }).cursor()) {
        const g: GameDocument = game;

        if (g.options.setup.nbPlayers > g.players.length) {
          await ChatMessage.create({
            room: game._id,
            type: "system",
            data: { text: "Game cancelled because of lack of players" },
          });
          g.cancelled = true;
          g.status = "ended";
          await g.save();
        } else {
          // Do this to avoid being caught in a loop again, before game server starts the game
          g.options.timing.scheduledStart = undefined;
          await g.save();
          await this.notifyGameStart(g);
        }
      }
    } finally {
      free();
    }
  }
}
