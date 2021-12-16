import makeSchema from "@bgs/models/gameinfo";
import { GameInfo } from "@bgs/types";
import mongoose from "mongoose";

const schema = makeSchema<GameInfoModel>();

export interface GameInfoDocument extends GameInfo, mongoose.Document {
  _id: GameInfo["_id"];
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

const GameInfo = mongoose.model("GameInfo", schema);

export { GameInfo };
