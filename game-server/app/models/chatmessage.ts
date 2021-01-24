import mongoose, { Types } from "mongoose";
import makeSchema from "@lib/schemas/chatmessage";
import { ChatMessage } from "@lib/chatmessage";

interface ChatMessageDocument extends mongoose.Document, ChatMessage<Types.ObjectId> {}

const ChatMessage = mongoose.model("ChatMessage", makeSchema<ChatMessageDocument>());

export default ChatMessage;
