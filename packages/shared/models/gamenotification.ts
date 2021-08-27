import { Document, Model, Schema, Types } from "mongoose";
import { GameNotification } from "../gamenotification";

const repr = {
  user: {
    type: Schema.Types.ObjectId,
    ref: "User",
  },
  game: {
    type: String,
    ref: "Game",
  },
  kind: {
    type: String,
    enum: ["currentMove", "gameEnded", "gameStarted", "playerDrop", "playerQuit", "dropPlayer"],
    index: true,
  },
  processed: {
    type: Boolean,
    default: false,
  },
  meta: {},
};

export default function makeSchema<
  T extends Document & GameNotification<Types.ObjectId>,
  U extends Model<T> = Model<T>
>() {
  const schema = new Schema<T, U>(repr, { timestamps: true });

  schema.index({ processed: 1, kind: 1 });
  schema.index({ updatedAt: 1 }, { expireAfterSeconds: 3600 * 24 * 30 });

  return schema;
}
