import type { PageLoad } from "./$types";
import { loadGameInfos } from "@/lib/game-info.svelte";
import { loadAllGamePreferences } from "@/lib/game-preferences.svelte";
import { setApiContext } from "@/lib/api";

export const load: PageLoad = async ({ fetch }) => {
  setApiContext((prev) => ({ ...prev, fetch }));
  await Promise.all([loadGameInfos(), loadAllGamePreferences()]);
  return {};
};
