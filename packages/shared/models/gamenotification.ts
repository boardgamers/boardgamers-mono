import { GameNotification } from "@bgs/types/gamenotification";
import { Document, Model, Schema, Types } from "mongoose";

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
    enum: ["currentMove", "gameEnded", "gameStarted", "playerDrop", "playerQuit", "dropPlayer"] as const,
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
  const schema = new Schema<T, U>(repr as any, { timestamps: true });

  schema.index({ processed: 1, kind: 1 });
  schema.index({ updatedAt: 1 }, { expireAfterSeconds: 3600 * 24 * 30 });

  return schema;
}
