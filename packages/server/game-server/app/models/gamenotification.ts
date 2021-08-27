import makeSchema from "@shared/models/gamenotification";
import { GameNotification } from "@shared/types/gamenotification";
import mongoose, { Types } from "mongoose";

interface GameNotificationDocument extends mongoose.Document, GameNotification<Types.ObjectId> {}

const GameNotification = mongoose.model("GameNotification", makeSchema<GameNotificationDocument>());

export default GameNotification;
