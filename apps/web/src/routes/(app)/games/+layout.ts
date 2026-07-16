import type { LayoutLoad } from "./$types";
import { loadGameInfos } from "@/lib/game-info.svelte";
import { setApiContext } from "@/lib/api";

export const load: LayoutLoad = async ({ fetch }) => {
  setApiContext((prev) => ({ ...prev, fetch }));
  await loadGameInfos();
  return {};
};
