import { error } from "@sveltejs/kit";
import type { PageLoad } from "./$types";
import { loadGame, loadGamePlayers } from "@/lib/game.svelte";
import { gameInfo, loadGameInfo } from "@/lib/game-info.svelte";
import { loadGamePreferences } from "@/lib/game-preferences.svelte";

export const load: PageLoad = async ({ params }) => {
  const gameId = params.gameId;

  let game, players;
  try {
    [game, players] = await Promise.all([loadGame(gameId), loadGamePlayers(gameId)]);
  } catch {
    // loadGame rejects with Error("Not Found") (status 404) when the gameplay API returns 404.
    throw error(404, "Game not found");
  }

  // game.game can be absent on legacy/corrupt docs — Mongo validation is "warn"/"moderate",
  // so the schema is not enforced on existing data. Guard before dereferencing.
  if (!game?.game) {
    throw error(404, "Game data is incomplete");
  }

  await Promise.all([loadGameInfo(game.game.name, game.game.version), loadGamePreferences(game.game.name)]);

  return {
    game,
    players,
    gameInfo: gameInfo(game.game.name, game.game.version),
  };
};
