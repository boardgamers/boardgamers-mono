import { ChatMessage } from "@lib/chatmessage";
import makeSchema from "@lib/schemas/chatmessage";
import { ObjectId } from "bson";
import mongoose from "mongoose";

export interface ChatMessageDocument extends mongoose.Document, ChatMessage<ObjectId> {}

const ChatMessage = mongoose.model("ChatMessage", makeSchema<ChatMessageDocument>());

export { ChatMessage };
