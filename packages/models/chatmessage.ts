import type { ChatMessage } from "@bgs/types";
import { Model, Schema, Types } from "mongoose";

const repr = {
  room: {
    type: String,
    required: true,
  },
  author: {
    type: Schema.Types.ObjectId,
    ref: "User",
  },
  data: {
    text: {
      type: String,
      minlength: [1, "You can't send empty messages"],
      maxlength: [300, "You can't send messages too long"],
    },
  },
  type: {
    type: String,
    required: true,
    default: "text",
    enum: ["text", "emoji", "system"] as const,
  },
};

export default function makeSchema<T extends ChatMessage<Types.ObjectId>, U extends Model<T> = Model<T>>() {
  const schema = new Schema<T, U>(repr as any, {
    // We only keep 100MB of chat logs
    capped: 100 * 1024 * 1024,
  });

  schema.index({ room: 1, _id: -1 });

  return schema;
}
