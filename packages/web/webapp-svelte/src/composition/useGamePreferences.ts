import { browser } from "$app/env";
import type { GameInfo, GamePreferences } from "@bgs/types";
import { set } from "lodash";
import { get as $, writable } from "svelte/store";
import type { Primitive } from "type-fest";
import { defineStore } from "./defineStore";
import { useAccount } from "./useAccount";
import { useRest } from "./useRest";

export const useGamePreferences = defineStore(() => {
  const gamePreferences = writable<Record<string, GamePreferences>>({});
  const { account } = useAccount();
  const { post } = useRest();

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
    gameSettings.update((gameSettings) => {
      set(gameSettings, `${gameName}.preferences.${key}`, value);
      return { ...gameSettings };
    });

    if ($(account)) {
      await post(`/account/games/${gameName}/preferences/${version}`, $(gameSettings)[gameName].preferences);
    }
  }

  if (browser) {
    let $accountId = $(account)?._id;
    account.subscribe(($account) => {
      if ($accountId === $account?._id) {
        return;
      }

      $accountId = $account?._id;
      gamePreferences.set({});
    });
  }

  return {
    gamePreferences,
    addDefaults,
    updatePreference,
  };
});
