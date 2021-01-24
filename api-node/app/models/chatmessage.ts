import mongoose from "mongoose";
import { ObjectId } from "bson";
import schema from "@gaia-project/site-lib/dist/chatmessage";
import { ChatMessage } from "@gaia-project/site-lib/chatmessage";

interface ChatMessageDocument extends mongoose.Document, ChatMessage<ObjectId> {}

const ChatMessage = mongoose.model<ChatMessageDocument>("ChatMessage", schema);

export default ChatMessage;
