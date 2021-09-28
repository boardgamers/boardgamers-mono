import type { ChatMessage } from "@bgs/types";
import { writable } from "svelte/store";

export const currentRoom = writable<string | null>(null);
export const chatMessages = writable<ChatMessage[]>([]);
