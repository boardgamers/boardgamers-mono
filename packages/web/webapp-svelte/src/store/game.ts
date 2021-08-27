import { get as $, writable } from "svelte/store";

export const activeGames = writable<string[]>([]);
export const currentGameId = writable<string | null>(null);
export const lastGameUpdate = writable<Date>(new Date(0));
export const playerStatus = writable<Array<{ _id: string; status: "online" | "offline" | "away" }>>([]);

export function addActiveGame(gameId: string) {
  if (!$(activeGames).includes(gameId)) {
    activeGames.update((games) => [...games, gameId]);
  }
}

export function removeActiveGame(gameId: string) {
  if ($(activeGames).includes(gameId)) {
    activeGames.update((games) => games.filter((g) => g !== gameId));
  }
}
