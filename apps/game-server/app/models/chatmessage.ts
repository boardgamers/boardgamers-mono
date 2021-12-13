import makeSchema from "@bgs/models/chatmessage";
import { ChatMessage } from "@bgs/types";
import mongoose, { Types } from "mongoose";

interface ChatMessageDocument extends mongoose.Document, ChatMessage<Types.ObjectId> {
  _id: Types.ObjectId;
}

const ChatMessage = mongoose.model("ChatMessage", makeSchema<ChatMessageDocument>());

export default ChatMessage;
