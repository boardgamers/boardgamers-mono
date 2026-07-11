import type { LayoutLoad } from "./$types";
import { loadGameInfos } from "@/lib/game-info.svelte";

export const load: LayoutLoad = async () => {
  await loadGameInfos();
  return {};
};
