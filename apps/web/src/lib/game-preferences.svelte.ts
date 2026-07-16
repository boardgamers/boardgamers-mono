import { browser } from "$app/environment";
import type { GameInfoFront, GamePreferencesFront } from "@bgs/models";
import { isEmpty, set } from "lodash";
import { get as getStore, writable } from "svelte/store";
import type { Primitive } from "type-fest";
import { account } from "./stores.svelte";
import { get, post } from "./api";

export const gamePreferences = writable<Record<string, GamePreferencesFront>>({});

export function addDefaults(prefs: GamePreferencesFront, gameinfo: GameInfoFront) {
  if (!gameinfo?.preferences || !prefs?.preferences) {
    return prefs;
  }

  return {
    ...prefs,
    preferences: {
      ...Object.fromEntries(
        gameinfo.preferences.filter((item) => item.default != null).map((item) => [item.name, item.default])
      ),
      ...prefs.preferences,
    },
  };
}

export async function updatePreference(gameName: string, version: number, key: string, value: Primitive) {
  gamePreferences.update((gamePreferences) => {
    set(gamePreferences, `${gameName}.preferences.${key}`, value);
    return { ...gamePreferences };
  });

  if (getStore(account)) {
    await post(`/account/games/${gameName}/preferences/${version}`, getStore(gamePreferences)[gameName].preferences);
  }
}

const augment = (data: GamePreferencesFront) => {
  if (!data.access) {
    data.access = { ownership: false };
  }
  if (!data.preferences) {
    data.preferences = {};
  }

  return data;
};

const loading = new Map<string, Promise<void>>();
export async function loadGamePreferences(game: string): Promise<void> {
  if (loading.has(game)) {
    return loading.get(game);
  }
  if (game in getStore(gamePreferences)) {
    return;
  }

  loading.set(
    game,
    Promise.resolve()
      .then(async () => {
        const data = getStore(account)
          ? await get<GamePreferencesFront>(`/account/games/${game}/settings`)
          : ({ game } as GamePreferencesFront);

        gamePreferences.set({ ...getStore(gamePreferences), [game]: augment(data) });
        loading.delete(game);
      })
      .catch((err) => {
        loading.delete(game);
        return Promise.reject(err);
      })
  );

  return loading.get(game);
}

let lastUpdate = 0;
let allPromise: Promise<void> | undefined;
export async function loadAllGamePreferences(force = false): Promise<void> {
  if (!getStore(account)) {
    return;
  }
  if (allPromise) {
    return allPromise;
  }

  if (!isEmpty(gamePreferences) && !force && Date.now() - lastUpdate < 3600 * 1000) {
    return;
  }

  return (allPromise = get<GamePreferencesFront[]>("/account/games/settings").then(
    (prefs) => {
      lastUpdate = Date.now();

      const data: Record<string, GamePreferencesFront> = {};

      for (const pref of prefs) {
        data[pref.game] = augment(pref);
      }

      gamePreferences.set(data);
    },
    (err) => {
      allPromise = undefined;
      return Promise.reject(err);
    }
  ));
}

if (browser) {
  let prevAccountId = getStore(account)?._id;
  account.subscribe((accountVal) => {
    if (prevAccountId === accountVal?._id) {
      return;
    }

    prevAccountId = accountVal?._id;
    lastUpdate = 0;
    gamePreferences.set({});
  });
}
