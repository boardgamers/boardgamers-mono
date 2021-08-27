import makeSchema from "@shared/models/gameinfo";
import { GameInfo } from "@shared/types/gameinfo";
import mongoose from "mongoose";

const schema = makeSchema<GameInfoDocument, GameInfoModel>();

export interface GameInfoDocument extends GameInfo, mongoose.Document {
  _id: {
    game: string;
    version: number;
  };
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
