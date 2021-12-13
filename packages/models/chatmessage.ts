import type { ChatMessage } from "@bgs/types";
import { Model, Schema, Types } from "mongoose";

const repr = {
  room: {
    type: String,
    index: true,
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
  return new Schema<T, U>(repr as any, {
    // We only keep 100MB of chat logs
    capped: 100 * 1024 * 1024,
  });
}
