import { ChatMessage } from "@lib/chatmessage";
import makeSchema from "@lib/schemas/chatmessage";
import mongoose, { Types } from "mongoose";

interface ChatMessageDocument extends mongoose.Document, ChatMessage<Types.ObjectId> {}

const ChatMessage = mongoose.model("ChatMessage", makeSchema<ChatMessageDocument>());

export default ChatMessage;
