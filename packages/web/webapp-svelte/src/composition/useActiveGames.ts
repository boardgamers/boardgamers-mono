import { get as $, writable, Writable } from "svelte/store";
import { useCached } from "./useCached";

type UseActiveGames = {
  activeGames: Writable<string[]>;
  addActiveGame: (gameId: string) => void;
  removeActiveGame: (gameId: string) => void;
};

export function useActiveGames(): UseActiveGames {
  const { cached, set } = useCached<"activeGames", UseActiveGames>("activeGames");

  if (cached) {
    return cached;
  }

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

  return set({
    activeGames,
    addActiveGame,
    removeActiveGame,
  });
}
