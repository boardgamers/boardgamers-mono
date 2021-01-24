import mongoose, { Types } from "mongoose";
import makeSchema from "@lib/schemas/gamenotification";
import { GameNotification } from "@lib/gamenotification";

interface GameNotificationDocument extends mongoose.Document, GameNotification<Types.ObjectId> {}

const GameNotification = mongoose.model("GameNotification", makeSchema<GameNotificationDocument>());

export default GameNotification;
