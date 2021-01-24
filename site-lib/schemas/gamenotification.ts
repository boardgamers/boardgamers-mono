import { Schema } from "mongoose";

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
    enum: ["currentMove", "gameEnded", "gameStarted", "playerDrop", "playerQuit"],
    index: true,
  },
  processed: {
    type: Boolean,
    default: false,
  },
};

const schema = new Schema(repr, { timestamps: true });

schema.index({ processed: 1, kind: 1 });
schema.index({ updatedAt: 1 }, { expireAfterSeconds: 3600 * 24 * 30 });

export default schema;
