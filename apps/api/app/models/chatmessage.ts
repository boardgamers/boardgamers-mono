import makeSchema from "@bgs/models/chatmessage";
import type { ChatMessage as IChatMessage } from "@bgs/types";
import type { Types } from "mongoose";
import mongoose from "mongoose";

export interface ChatMessageDocument extends mongoose.Document, IChatMessage<Types.ObjectId> {
  _id: Types.ObjectId;
}

export const ChatMessage = mongoose.model("ChatMessage", makeSchema<ChatMessageDocument>());
