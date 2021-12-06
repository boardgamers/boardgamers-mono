import { browser } from "$app/env";
import type { ChatMessage } from "@bgs/types";
import { Writable, writable } from "svelte/store";
import { useCached } from "./useCached";
import { useCurrentGame } from "./useCurrentGame";

type UseCurrentRoom = {
  room: Writable<null | string>;
  chatMessages: Writable<ChatMessage[]>;
};

export function useCurrentRoom(): UseCurrentRoom {
  const { cached, set } = useCached<"currentRoom", UseCurrentRoom>("currentRoom");

  if (cached) {
    return cached;
  }

  const room = writable<string | null>(null);
  const chatMessages = writable<ChatMessage[]>([]);

  if (browser) {
    const { currentGameId } = useCurrentGame();

    currentGameId.subscribe((val) => room.set(val));
    room.subscribe(() => chatMessages.set([]));
  }

  return set({ room, chatMessages });
}
