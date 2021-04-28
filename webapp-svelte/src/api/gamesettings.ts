import { gameSettings, user } from "@/store";
import type { RemoveReadable } from "@/utils";
import type { GamePreferences } from "@lib/gamepreferences";
import { isEmpty } from "lodash";
import { get as storeGet } from "svelte/store";
import { get } from "./rest";

let $gameSettings: RemoveReadable<typeof gameSettings>;
gameSettings.subscribe((val) => ($gameSettings = val));

const augment = (data: GamePreferences) => {
  if (!data.access) {
    data.access = { ownership: false };
  }
  if (!data.preferences) {
    data.preferences = {};
  }

  return data;
};

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

        gameSettings.set({ ...$gameSettings, [game]: augment(data) });
        loading.delete(game);
      })
      .catch((err) => {
        loading.delete(game);
        return Promise.reject(err);
      })
  );
}

let lastUpdate = 0;
let promise: Promise<void> | undefined;
export async function loadAllGameSettings() {
  if (!storeGet(user)) {
    return;
  }
  if (promise) {
    return promise;
  }

  if (!isEmpty(gameSettings) && Date.now() - lastUpdate < 3600 * 1000) {
    return;
  }

  return (promise = get<GamePreferences[]>("/account/games/settings").then(
    (prefs) => {
      const data: typeof $gameSettings = {};

      for (const pref of prefs) {
        data[pref.game] = augment(pref);
      }

      gameSettings.set(data);
    },
    (err) => {
      // do not keep throwing past the first call of this function
      promise = undefined;
      return Promise.reject(err);
    }
  ));
}
