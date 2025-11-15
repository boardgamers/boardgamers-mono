import { browser } from "$app/env";
import { writable } from "svelte/store";
import { defineStore } from "./defineStore";

export const useCurrentGame = defineStore(() => {
  const currentGameId = writable<string | null>(null);
  const lastGameUpdate = writable<Date>(new Date(0));
  const playerStatus = writable<Array<{ _id: string; status: "online" | "offline" | "away" }>>([]);

  if (browser) {
    currentGameId.subscribe(() => {
      lastGameUpdate.set(new Date(0));
      playerStatus.set([]);
    });
  }

  return { currentGameId, lastGameUpdate, playerStatus };
});
