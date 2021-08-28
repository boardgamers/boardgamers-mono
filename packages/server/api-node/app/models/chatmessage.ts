import makeSchema from "@shared/models/chatmessage";
import { ChatMessage } from "@shared/types/chatmessage";
import mongoose, { Types } from "mongoose";

export interface ChatMessageDocument extends mongoose.Document, ChatMessage<Types.ObjectId> {
  _id: Types.ObjectId;
}

const ChatMessage = mongoose.model("ChatMessage", makeSchema<ChatMessageDocument>());

export { ChatMessage };
