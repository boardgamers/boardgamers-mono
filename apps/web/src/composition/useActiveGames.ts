import { get as $, writable } from "svelte/store";
import { defineStore } from "./defineStore";
import { useRest } from "./useRest";

export const useActiveGames = defineStore(() => {
  const { get } = useRest();
  const activeGames = writable<string[]>([]);
  let loaded = false;

  function addActiveGame(gameId: string) {
    if (!$(activeGames).includes(gameId)) {
      activeGames.update((games) => [...games, gameId]);
    }
  }

  function removeActiveGame(gameId: string) {
    if ($(activeGames).includes(gameId)) {
      activeGames.update((games) => games.filter((g) => g !== gameId));
    }
  }

  async function loadActiveGames() {
    // We only want to load during the initial load, afterwards we have a websocket maintaining the state
    if (loaded) {
      return;
    }
    loaded = true;
    activeGames.set(await get("/account/active-games"));
  }

  return {
    activeGames,
    addActiveGame,
    removeActiveGame,
    loadActiveGames,
  };
});
