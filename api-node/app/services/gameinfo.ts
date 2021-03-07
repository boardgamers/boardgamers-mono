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
}
