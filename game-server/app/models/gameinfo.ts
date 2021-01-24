import schema from "@lib/schemas/gameinfo";
import type { GameInfo as IGameInfo } from "@lib/gameinfo";
import mongoose from "mongoose";

interface GameInfoDocument extends mongoose.Document, IGameInfo {
  _id: {
    game: string;
    version: number;
  };
}

const GameInfo = mongoose.model<GameInfoDocument>("GameInfo", schema);

export default GameInfo;
