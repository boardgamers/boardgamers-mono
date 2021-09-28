import makeSchema from "@bgs/models/gamenotification";
import { GameNotification } from "@bgs/types";
import mongoose, { Types } from "mongoose";

interface GameNotificationDocument extends mongoose.Document, GameNotification<Types.ObjectId> {}

const GameNotification = mongoose.model("GameNotification", makeSchema<GameNotificationDocument>());

export default GameNotification;
