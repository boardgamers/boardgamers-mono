import makeSchema from "@shared/models/gameinfo";
import type { GameInfo as IGameInfo } from "@shared/types/gameinfo";
import mongoose from "mongoose";

interface GameInfoDocument extends mongoose.Document, IGameInfo {
  _id: {
    game: string;
    version: number;
  };
}

const GameInfo = mongoose.model<GameInfoDocument>("GameInfo", makeSchema<GameInfoDocument>());

export default GameInfo;
