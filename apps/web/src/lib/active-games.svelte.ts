import { get } from "./api";
import { activeGames } from "./stores.svelte";

let loaded = false;

export async function loadActiveGames() {
  if (loaded) return;
  loaded = true;
  try {
    const games = await get<string[]>("/account/active-games");
    activeGames.set(games);
  } catch {
    loaded = false;
  }
}

export { activeGames, addActiveGame, removeActiveGame } from "./stores.svelte";
