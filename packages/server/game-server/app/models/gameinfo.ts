import makeSchema from "@shared/models/gameinfo";
import { GameInfo } from "@shared/types/gameinfo";
import mongoose from "mongoose";

const GameInfo = mongoose.model<GameInfo>("GameInfo", makeSchema());

export default GameInfo;
