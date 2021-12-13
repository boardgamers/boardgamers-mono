import { get as $, writable } from "svelte/store";
import { defineStore } from "./defineStore";
import { useRest } from "./useRest";

export const useActiveGames = defineStore(() => {
  const { get } = useRest();
  const activeGames = writable<string[]>([]);

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
    activeGames.set(await get("/account/active-games"));
  }

  return {
    activeGames,
    addActiveGame,
    removeActiveGame,
    loadActiveGames,
  };
});
