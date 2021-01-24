import { Schema } from "mongoose";

const schema = new Schema(
  {
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
      enum: ["text", "emoji", "system"],
    },
  },
  {
    // We only keep 100MB of chat logs
    capped: 100 * 1024 * 1024,
  }
);

export default schema;
