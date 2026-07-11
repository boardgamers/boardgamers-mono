import type { PageLoad } from "./$types";
import { loadGameInfos } from "@/lib/game-info.svelte";
import { loadAllGamePreferences } from "@/lib/game-preferences.svelte";

export const load: PageLoad = async () => {
  await Promise.all([loadGameInfos(), loadAllGamePreferences()]);

  return {};
};
