import { gameSettings, user } from "@/store";
import type { RemoveReadable } from "@/utils";
import type { GamePreferences } from "@lib/gamepreferences";
import { get as storeGet } from "svelte/store";
import { get } from "./rest";

let $gameSettings: RemoveReadable<typeof gameSettings>;
gameSettings.subscribe((val) => ($gameSettings = val));

let loading = new Map<string, Promise<void>>();
export async function loadGameSettings(game: string) {
  if (loading.has(game)) {
    return loading.get(game);
  }
  if (game in $gameSettings) {
    return;
  }

  loading.set(
    game,
    Promise.resolve()
      .then(async () => {
        const data = storeGet(user)
          ? await get<GamePreferences>(`/account/games/${game}/settings`)
          : ({ game } as GamePreferences);

        if (!data.access) {
          data.access = { ownership: false };
        }
        if (!data.preferences) {
          data.preferences = {};
        }

        $gameSettings[game] = data;
        gameSettings.set({ ...$gameSettings });
        loading.delete(game);
      })
      .catch((err) => {
        loading.delete(game);
        return Promise.reject(err);
      })
  );
}
