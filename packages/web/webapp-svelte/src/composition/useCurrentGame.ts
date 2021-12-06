import { browser } from "$app/env";
import { Writable, writable } from "svelte/store";
import { useCached } from "./useCached";

type UseCurrentGame = {
  currentGameId: Writable<string | null>;
  lastGameUpdate: Writable<Date>;
  playerStatus: Writable<Array<{ _id: string; status: "online" | "offline" | "away" }>>;
};

export function useCurrentGame(): UseCurrentGame {
  const { set, cached } = useCached<"currentGame", UseCurrentGame>("currentGame");

  if (cached) {
    return cached;
  }

  const currentGameId = writable<string | null>(null);
  const lastGameUpdate = writable<Date>(new Date(0));
  const playerStatus = writable<Array<{ _id: string; status: "online" | "offline" | "away" }>>([]);

  if (browser) {
    currentGameId.subscribe(() => {
      lastGameUpdate.set(new Date(0));
      playerStatus.set([]);
    });
  }

  return set({ currentGameId, lastGameUpdate, playerStatus });
}
