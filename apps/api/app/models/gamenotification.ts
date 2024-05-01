import type { Game, GameNotification } from "@bgs/types";
import EloService from "../services/elo";
import type { LogItem } from "./log";
import { Log } from "./log";
import type { ObjectId } from "mongodb";
import { MAX_KARMA, User } from "./user";
import { collections, locks } from "../config/db";
import type { PickDeep } from "type-fest";

export namespace GameNotificationUtils {
  export async function processCurrentMove(): Promise<void> {
    const notifications = await collections.gameNotifications
      .find({ kind: "currentMove", processed: false })
      .project<Pick<GameNotification<ObjectId>, "user" | "_id">>({
        user: 1,
        _id: 1,
      })
      .toArray();

    const users = await User.find({ _id: { $in: notifications.map((notification) => notification.user) } });

    for (const user of users) {
      await user.updateGameNotification();
    }

    await collections.gameNotifications.updateMany(
      { _id: { $in: notifications.map((x) => x._id) } },
      { $set: { processed: true } }
    );
  }

  export async function processGameEnded(): Promise<void> {
    await using lock = await locks.lock(["game-notification", "gameEnded"]);

    if (!lock) {
      return;
    }

    const notifications = await collections.gameNotifications
      .find({ kind: "gameEnded", processed: false })
      .project<Pick<GameNotification<ObjectId>, "game" | "_id">>({
        game: 1,
        _id: 1,
      })
      .toArray();

    for (const notification of notifications) {
      const game = await collections.games.findOne<
        PickDeep<Game<ObjectId>, "players" | "game.name" | "cancelled" | "_id">
      >({ _id: notification.game }, { projection: { players: 1, "game.name": 1, cancelled: 1 } });

      if (!game) {
        await collections.gameNotifications.updateOne(
          { _id: notification._id },
          { $set: { processed: true, updatedAt: new Date() } }
        );
        continue;
      }

      // KARMA
      if (!game.cancelled) {
        await User.updateMany({ _id: { $in: game.players.filter((pl) => !pl.dropped).map((pl) => pl._id) } }, [
          {
            $set: {
              "account.karma": {
                $min: [{ $add: ["$account.karma", 1] }, MAX_KARMA],
              },
            },
          },
        ]);
      }

      // ELO
      await EloService.processGame(game);

      await Promise.all([
        collections.gameNotifications.updateOne(
          { _id: notification._id },
          { $set: { processed: true, updatedAt: new Date() } }
        ),
        Log.create({ kind: "processGameEnded", data: { game: notification.game } }),
      ]);
    }
  }

  export async function processPlayerDrop(): Promise<void> {
    await using lock = await locks.lock(["game-notification", "playerDrop"]);

    if (!lock) {
      return;
    }

    const notifications = await collections.gameNotifications
      .find({ kind: "playerDrop", processed: false })
      .project<Pick<GameNotification<ObjectId>, "user" | "_id" | "game">>({
        user: 1,
        _id: 1,
        game: 1,
      })
      .toArray();

    let userIds = notifications.map((not) => not.user).filter((x) => x !== undefined);

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
            ({ kind: "processPlayerDrop", data: { game: notification.game, player: notification.user } }) as LogItem
        )
      ),
      collections.gameNotifications.updateMany(
        { _id: { $in: notifications.map((x) => x._id) } },
        { $set: { processed: true, updatedAt: new Date() } }
      ),
    ]);
  }
}
