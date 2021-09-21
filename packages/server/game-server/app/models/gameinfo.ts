import makeSchema from "@bgs/models/gameinfo";
import { GameInfo } from "@bgs/types/gameinfo";
import mongoose from "mongoose";

const GameInfo = mongoose.model<GameInfo>("GameInfo", makeSchema());

export default GameInfo;
