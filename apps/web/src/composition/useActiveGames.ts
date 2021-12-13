import { get as $, writable } from "svelte/store";
import { defineStore } from "./defineStore";

export const useActiveGames = defineStore(() => {
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

  return {
    activeGames,
    addActiveGame,
    removeActiveGame,
  };
});
