import mongoose from "mongoose";
import { ObjectId } from "bson";
import schema from "@lib/schemas/chatmessage";

interface ChatMessageDocument extends mongoose.Document {
  room: string;
  author: ObjectId;
  text: string;
  type: string;
}

const ChatMessage = mongoose.model<ChatMessageDocument>("ChatMessage", schema);

export default ChatMessage;
