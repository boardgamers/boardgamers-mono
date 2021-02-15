import type { GameInfo as IGameInfo } from "@lib/gameinfo";
import makeSchema from "@lib/schemas/gameinfo";
import mongoose from "mongoose";

interface GameInfoDocument extends mongoose.Document, IGameInfo {
  _id: {
    game: string;
    version: number;
  };
}

const GameInfo = mongoose.model<GameInfoDocument>("GameInfo", makeSchema<GameInfoDocument>());

export default GameInfo;
