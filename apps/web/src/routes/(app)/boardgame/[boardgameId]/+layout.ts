import type { LayoutLoad } from "./$types";
import { loadGameInfos, loadGameInfo } from "@/lib/game-info.svelte";
import { loadGamePreferences } from "@/lib/game-preferences.svelte";
import { setApiContext } from "@/lib/api";

export const load: LayoutLoad = async ({ params, fetch, parent }) => {
  setApiContext((prev) => ({ ...prev, fetch }));
  await parent();
  await loadGameInfos();
  await loadGameInfo(params.boardgameId, "latest");
  await loadGamePreferences(params.boardgameId);
  return {};
};
