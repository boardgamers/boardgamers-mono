import makeSchema from "@bgs/models/gamenotification";
import type { GameNotification as IGameNotification } from "@bgs/types";
import type { Types } from "mongoose";
import mongoose from "mongoose";

export interface GameNotificationDocument extends mongoose.Document, IGameNotification<Types.ObjectId> {}

const GameNotification = mongoose.model("GameNotification", makeSchema<GameNotificationDocument>());

export default GameNotification;
