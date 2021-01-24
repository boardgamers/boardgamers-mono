import mongoose, { Types } from "mongoose";
import locks from "mongo-locks";
import makeSchema from "@lib/schemas/gamenotification";
import { GameNotification } from "@lib/gamenotification";
import User, { maxKarma } from "./user";
import Game from "./game";
import Log, { LogItem } from "./log";
import EloService from "../services/elo";

const schema = makeSchema<GameNotificationDocument, GameNotificationModel>();
interface GameNotificationDocument extends mongoose.Document, GameNotification<Types.ObjectId> {}

interface GameNotificationModel extends mongoose.Model<GameNotificationDocument> {
  processCurrentMove(): Promise<void>;
  processGameEnded(): Promise<void>;
  processPlayerDrop(): Promise<void>;
}

schema.static("processCurrentMove", async function (this: GameNotificationModel) {
  const notifications = await this.find({ kind: "currentMove", processed: false }, null, { lean: true });

  const users = await User.find({ _id: { $in: notifications.map((notification) => notification.user) } });

  for (const user of users) {
    await user.updateGameNotification();
  }

  await this.updateMany({ _id: { $in: notifications.map((x) => x._id) } }, { $set: { processed: true } });
});

schema.static("processGameEnded", async function (this: GameNotificationModel) {
  const free = await locks.lock("game-notification", "gameEnded");

  try {
    const notifications = await this.find({ kind: "gameEnded", processed: false }, null, { lean: true });

    for (const notification of notifications) {
      const game = await Game.findOne({ _id: notification.game }, "players game.name cancelled", { lean: true });

      if (!game) {
        await this.updateOne({ _id: notification._id }, { $set: { processed: true } });
        continue;
      }

      // KARMA
      if (!game.cancelled) {
        await User.updateMany({ _id: { $in: game.players.filter((pl) => !pl.dropped).map((pl) => pl._id) } }, [
          {
            $set: {
              "account.karma": {
                $min: [{ $add: ["$account.karma", 1] }, maxKarma],
              },
            },
          },
        ]);
      }

      // ELO
      await EloService.processGame(game);

      await Promise.all([
        this.updateOne({ _id: notification._id }, { $set: { processed: true } }),
        await Log.create({ kind: "processGameEnded", data: { game: notification.game } }),
      ]);
    }
  } finally {
    free();
  }
});

schema.static("processPlayerDrop", async function (this: GameNotificationModel) {
  const free = await locks.lock("game-notification", "playerDrop");

  try {
    const notifications = await this.find({ kind: "playerDrop", processed: false }, null, { lean: true });

    let userIds = notifications.map((not) => not.user);

    // The loop is in case a player drops one or more players at a time
    do {
      const set = new Set(userIds.map((id) => id.toString()));

      await User.updateMany({ _id: { $in: userIds } }, { $inc: { "account.karma": -10 } });

      userIds = userIds.filter((id) => !set.delete(id.toString()));
    } while (userIds.length > 0);

    await Promise.all([
      Log.insertMany(
        notifications.map(
          (notification) =>
            ({ kind: "processPlayerDrop", data: { game: notification.game, player: notification.user } } as LogItem)
        )
      ),
      this.updateMany({ _id: { $in: notifications.map((x) => x._id) } }, { $set: { processed: true } }),
    ]);
  } finally {
    free();
  }
});

const GameNotification = mongoose.model("GameNotification", schema);

export default GameNotification;
