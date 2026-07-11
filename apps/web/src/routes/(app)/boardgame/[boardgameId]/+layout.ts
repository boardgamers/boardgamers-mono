import type { LayoutLoad } from "./$types";
import { loadGameInfos } from "@/lib/game-info.svelte";
import { loadGamePreferences } from "@/lib/game-preferences.svelte";

export const load: LayoutLoad = async ({ params }) => {
  await loadGameInfos();
  await loadGamePreferences(params.boardgameId);
  return {};
};
