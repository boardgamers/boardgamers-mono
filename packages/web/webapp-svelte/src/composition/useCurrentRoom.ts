import { browser } from "$app/env";
import type { ChatMessage } from "@bgs/types";
import { writable } from "svelte/store";
import { defineStore } from "./defineStore";
import { useCurrentGame } from "./useCurrentGame";

export const useCurrentRoom = defineStore(() => {
  const room = writable<string | null>(null);
  const chatMessages = writable<ChatMessage[]>([]);

  if (browser) {
    const { currentGameId } = useCurrentGame();

    currentGameId.subscribe((val) => room.set(val));
    room.subscribe(() => chatMessages.set([]));
  }

  return { room, chatMessages };
});
