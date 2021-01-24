import mongoose from "mongoose";
import { ObjectId } from "bson";
import schema from "@lib/schemas/chatmessage";
import { ChatMessage } from "@lib/chatmessage";

interface ChatMessageDocument extends mongoose.Document, ChatMessage<ObjectId> {}

const ChatMessage = mongoose.model<ChatMessageDocument>("ChatMessage", schema);

export default ChatMessage;
