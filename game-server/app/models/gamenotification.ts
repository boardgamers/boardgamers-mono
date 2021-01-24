import mongoose from "mongoose";
import schema from "@lib/schemas/gamenotification";
import { GameNotification } from "@lib/gamenotification";

interface GameNotificationDocument extends mongoose.Document, GameNotification {}

const GameNotification = mongoose.model<GameNotificationDocument>("GameNotification", schema);

export default GameNotification;
