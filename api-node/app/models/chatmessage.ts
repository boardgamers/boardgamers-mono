import mongoose from "mongoose";
import { ObjectId } from "bson";
import makeSchema from "@lib/schemas/chatmessage";
import { ChatMessage } from "@lib/chatmessage";

interface ChatMessageDocument extends mongoose.Document, ChatMessage<ObjectId> {}

const ChatMessage = mongoose.model("ChatMessage", makeSchema<ChatMessageDocument>());

export default ChatMessage;
