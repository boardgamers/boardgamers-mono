import makeSchema from "@bgs/models/gameinfo";
import type { GameInfo as IGameInfo } from "@bgs/types";
import mongoose from "mongoose";

const schema = makeSchema<GameInfoModel>();

export interface GameInfoDocument extends IGameInfo, mongoose.Document {
  _id: IGameInfo["_id"];
}

export interface GameInfoModel extends mongoose.Model<GameInfoDocument> {
  findWithVersion(game: string, version: number | "latest"): mongoose.Query<GameInfoDocument, GameInfoDocument>;
}

schema.static("findWithVersion", function (this: GameInfoModel, game: string, version: number | "latest") {
  if (version === "latest") {
    return this.findOne({ "_id.game": game }).sort("-_id.version");
  }
  return this.findById({ game, version });
});

export const GameInfo = mongoose.model("GameInfo", schema);
