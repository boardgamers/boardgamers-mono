import { GameNotification } from "@lib/gamenotification";
import makeSchema from "@lib/schemas/gamenotification";
import mongoose, { Types } from "mongoose";

interface GameNotificationDocument extends mongoose.Document, GameNotification<Types.ObjectId> {}

const GameNotification = mongoose.model("GameNotification", makeSchema<GameNotificationDocument>());

export default GameNotification;
