import type { ChatMessage } from "@shared/types/chatmessage";
import { writable } from "svelte/store";

export const currentRoom = writable<string | null>(null);
export const chatMessages = writable<ChatMessage[]>([]);
