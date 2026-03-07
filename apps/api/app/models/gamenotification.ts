import locks from "../config/locks.ts";
import { colls } from "../config/db.ts";
import { processEloForGame } from "../services/elo.ts";
import { maxKarma } from "./user.ts";

export async function processCurrentMove() {
  const col = colls.gameNotifications;
  const notifications = await col.find({ kind: "currentMove", processed: false }).toArray();

  const userCol = colls.users;
  const userDocs = await userCol.find({ _id: { $in: notifications.map((n) => n.user) } }).toArray();

  for (const user of userDocs) {
    if (!user.settings?.mailing?.game?.activated) {
      continue;
    }
    const date = new Date(Date.now() + (user.settings.mailing.game.delay || 30 * 60) * 1000);
    if (!user.meta?.nextGameNotification || user.meta.nextGameNotification > date) {
      await userCol.updateOne({ _id: user._id }, { $set: { "meta.nextGameNotification": date } });
    }
  }

  await col.updateMany({ _id: { $in: notifications.map((x) => x._id) } }, { $set: { processed: true } });
}

export async function processGameEnded() {
  await using _lock = await locks.lock("game-notification", "gameEnded");
  const col = colls.gameNotifications;
  const notifications = await col.find({ kind: "gameEnded", processed: false }).toArray();

  for (const notification of notifications) {
    const game = await colls.games.findOne(
      { _id: notification.game },
      { projection: { players: 1, "game.name": 1, cancelled: 1 } },
    );

    if (!game) {
      await col.updateOne({ _id: notification._id }, { $set: { processed: true } });
      continue;
    }

    if (!game.cancelled) {
      await colls.users.updateMany({ _id: { $in: game.players.filter((pl) => !pl.dropped).map((pl) => pl._id) } }, [
        { $set: { "account.karma": { $min: [{ $add: ["$account.karma", 1] }, maxKarma] } } },
      ]);
    }

    await processEloForGame(game);

    await Promise.all([
      col.updateOne({ _id: notification._id }, { $set: { processed: true } }),
      colls.logs.insertOne({
        kind: "processGameEnded",
        data: { game: notification.game },
        createdAt: new Date(),
      }),
    ]);
  }
}

export async function processPlayerDrop() {
  await using _lock = await locks.lock("game-notification", "playerDrop");
  const col = colls.gameNotifications;
  const notifications = await col.find({ kind: "playerDrop", processed: false }).toArray();

  const dropCounts = new Map<string, { id: (typeof notifications)[0]["user"]; count: number }>();
  for (const n of notifications) {
    const key = n.user.toString();
    const entry = dropCounts.get(key);
    if (entry) {
      entry.count++;
    } else {
      dropCounts.set(key, { id: n.user, count: 1 });
    }
  }

  for (const { id, count } of dropCounts.values()) {
    await colls.users.updateOne({ _id: id }, { $inc: { "account.karma": -10 * count } });
  }

  await Promise.all([
    colls.logs.insertMany(
      notifications.map((n) => ({
        kind: "processPlayerDrop",
        data: { game: n.game, player: n.user },
        createdAt: new Date(),
      })),
    ),
    col.updateMany({ _id: { $in: notifications.map((x) => x._id) } }, { $set: { processed: true } }),
  ]);
}
