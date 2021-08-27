import makeSchema from "@shared/models/chatmessage";
import { ChatMessage } from "@shared/types/chatmessage";
import { ObjectId } from "bson";
import mongoose from "mongoose";

export interface ChatMessageDocument extends mongoose.Document, ChatMessage<ObjectId> {
  _id: ObjectId;
}

const ChatMessage = mongoose.model("ChatMessage", makeSchema<ChatMessageDocument>());

export { ChatMessage };
