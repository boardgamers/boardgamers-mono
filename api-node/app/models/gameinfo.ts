import mongoose from "mongoose";
import { GameInfo } from "@lib/gameinfo";
import schema from "@lib/schemas/gameinfo";

export interface GameInfoDocument extends GameInfo, mongoose.Document {
  _id: {
    game: string;
    version: number;
  };
}

export interface GameInfoModel extends mongoose.Model<GameInfoDocument> {
  findWithVersion(game: string, version: number | "latest"): mongoose.DocumentQuery<GameInfoDocument, GameInfoDocument>;
}

schema.static("findWithVersion", function (this: GameInfoModel, game: string, version: number | "latest") {
  if (version === "latest") {
    return this.findOne({ "_id.game": game }).sort("-_id.version");
  }
  return this.findById({ game, version });
});

const GameInfo = mongoose.model<GameInfoDocument, GameInfoModel>("GameInfo", schema);

export default GameInfo;
