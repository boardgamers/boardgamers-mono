import { GameInfo, GamePreferences, UserDocument } from "../models";

export default class GameInfoService {
  static async lastAccessibleVersion(game: string, user?: UserDocument) {
    if (!user) {
      return GameInfo.findOne({ "_id.game": game, "meta.public": true }).sort("-_id.version");
    }

    const pref = await GamePreferences.findOne(
      { user: user._id, game, "access.maxVersion": { $exists: true } },
      "access.maxVersion",
      { lean: true }
    );

    if (pref) {
      return GameInfo.findOne({
        "_id.game": game,
        $or: [{ "meta.public": true }, { "_id.version": pref.access.maxVersion }],
      }).sort("-_id.version");
    } else {
      return GameInfo.findOne({ "_id.game": game, "meta.public": true }).sort("-_id.version");
    }
  }

  static async latestAccessibleGames<T>(userId?: T) {
    const ownGames = userId
      ? await GamePreferences.find({ user: userId, "access.maxVersion": { $exists: true } })
          .select("game access.maxVersion -_id")
          .lean(true)
      : [];
    const publicGames: Array<{ _id: string; version: number }> = await GameInfo.aggregate()
      .match({ "meta.public": true })
      .sort("_id.game -_id.version")
      .project({ _id: 1 })
      .group({ _id: "$_id.game", version: { $first: "$_id.version" } });

    const map = new Map<string, number>();

    for (const game of ownGames) {
      map.set(game.game, game.access.maxVersion);
    }

    for (const game of publicGames) {
      if (!map.has(game._id) || map.get(game._id) < game.version) {
        map.set(game._id, game.version);
      }
    }

    return map;
  }
}
