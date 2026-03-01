import makeSchema from "@bgs/models/gameinfo";
import type { GameInfo as IGameInfo } from "@bgs/types";
import mongoose from "mongoose";

const GameInfo = mongoose.model<IGameInfo>("GameInfo", makeSchema());

export default GameInfo;
