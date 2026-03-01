import type { UserDoc } from "@bgs/models";
import type { WithId } from "mongodb";
import { colls } from "../config/db.ts";

export default class GameInfoService {
  static async lastAccessibleVersion(game: string, user?: WithId<UserDoc>) {
    if (!user) {
      return colls.gameInfos.findOne(
        { "_id.game": game, "meta.public": true },
        { sort: { "_id.version": -1 } }
      );
    }

    const pref = await colls.gamePreferences.findOne(
      { user: user._id, game, "access.maxVersion": { $exists: true } },
      { projection: { "access.maxVersion": 1 } }
    );

    if (pref) {
      return colls.gameInfos.findOne(
        {
          "_id.game": game,
          $or: [{ "meta.public": true }, { "_id.version": pref.access.maxVersion }],
        },
        { sort: { "_id.version": -1 } }
      );
    } else {
      return colls.gameInfos.findOne(
        { "_id.game": game, "meta.public": true },
        { sort: { "_id.version": -1 } }
      );
    }
  }

  static async latestAccessibleGames<T>(userId?: T) {
    const ownGames = userId
      ? await colls.gamePreferences
          .find({ user: userId, "access.maxVersion": { $exists: true } })
          .project({ game: 1, "access.maxVersion": 1 })
          .toArray()
      : [];
    const publicGames = (await colls.gameInfos
      .aggregate<{ _id: string; version: number }>([
        { $match: { "meta.public": true } },
        { $sort: { "_id.game": 1, "_id.version": -1 } },
        { $project: { _id: 1 } },
        { $group: { _id: "$_id.game", version: { $first: "$_id.version" } } },
      ])
      .toArray()) as Array<{ _id: string; version: number }>;

    const map = new Map<string, number>();

    for (const game of ownGames) {
      map.set(game.game, game.access.maxVersion);
    }

    for (const game of publicGames) {
      if (!map.has(game._id) || map.get(game._id)! < game.version) {
        map.set(game._id, game.version);
      }
    }

    return map;
  }
}
