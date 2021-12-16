import { browser } from "$app/env";
import type { RemoveReadable } from "@/utils";
import type { GameInfo, GamePreferences } from "@bgs/types";
import { isEmpty, set } from "lodash";
import { get as $, writable } from "svelte/store";
import type { Primitive } from "type-fest";
import { defineStore } from "./defineStore";
import { useAccount } from "./useAccount";
import { useRest } from "./useRest";

export const useGamePreferences = defineStore(() => {
  const gamePreferences = writable<Record<string, GamePreferences>>({});
  const { account } = useAccount();
  const { post, get } = useRest();

  function addDefaults(prefs: GamePreferences, gameinfo: GameInfo) {
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

  async function updatePreference(gameName: string, version: number, key: string, value: Primitive) {
    gamePreferences.update((gamePreferences) => {
      set(gamePreferences, `${gameName}.preferences.${key}`, value);
      return { ...gamePreferences };
    });

    if ($(account)) {
      await post(`/account/games/${gameName}/preferences/${version}`, $(gamePreferences)[gameName].preferences);
    }
  }

  const augment = (data: GamePreferences) => {
    if (!data.access) {
      data.access = { ownership: false };
    }
    if (!data.preferences) {
      data.preferences = {};
    }

    return data;
  };

  const loading = new Map<string, Promise<void>>();
  async function loadGamePreferences(game: string): Promise<void> {
    if (loading.has(game)) {
      return loading.get(game);
    }
    if (game in $(gamePreferences)) {
      return;
    }

    loading.set(
      game,
      Promise.resolve()
        .then(async () => {
          const data = $(account)
            ? await get<GamePreferences>(`/account/games/${game}/settings`)
            : ({ game } as GamePreferences);

          if (!data.access) {
            data.access = { ownership: false };
          }
          if (!data.preferences) {
            data.preferences = {};
          }

          gamePreferences.set({ ...$(gamePreferences), [game]: augment(data) });
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
  let promise: Promise<void> | undefined;
  async function loadAllGamePreferences(force = false): Promise<void> {
    if (!$(account)) {
      return;
    }
    if (promise) {
      return promise;
    }

    if (!isEmpty(gamePreferences) && !force && Date.now() - lastUpdate < 3600 * 1000) {
      return;
    }

    return (promise = get<GamePreferences[]>("/account/games/settings").then(
      (prefs) => {
        lastUpdate = Date.now();

        const data: RemoveReadable<typeof gamePreferences> = {};

        for (const pref of prefs) {
          data[pref.game] = augment(pref);
        }

        gamePreferences.set(data);
      },
      (err) => {
        // do not keep throwing past the first call of this function
        promise = undefined;
        return Promise.reject(err);
      }
    ));
  }

  if (browser) {
    let $accountId = $(account)?._id;
    account.subscribe(($account) => {
      if ($accountId === $account?._id) {
        return;
      }

      $accountId = $account?._id;
      lastUpdate = 0;
      gamePreferences.set({});
    });
  }

  return {
    gamePreferences,
    addDefaults,
    updatePreference,
    loadGamePreferences,
    loadAllGamePreferences,
  };
});
