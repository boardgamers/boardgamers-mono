import type { RemoveReadable } from "@/utils";
import type { GameInfo } from "@bgs/types";
import { sortBy, uniqBy } from "lodash";
import { get as $, writable } from "svelte/store";
import type { SetOptional, ValueOf } from "type-fest";
import { defineStore } from "./defineStore";
import { useRest } from "./useRest";

export const useGameInfo = defineStore(() => {
  const { get } = useRest();
  const gameInfos = writable<Record<string, SetOptional<GameInfo, "viewer">>>({});

  let promise: Promise<void> | null = null;
  let lastLoad = 0;

  function gameInfoKey(name: string, version: number | "latest"): string {
    return `${name}/${version}`;
  }

  function gameInfo(name: string, version: number | "latest") {
    return $(gameInfos)[gameInfoKey(name, version)];
  }

  function latestGameInfos(): ValueOf<RemoveReadable<typeof gameInfos>>[] {
    return Object.keys($(gameInfos))
      .filter((key) => key.endsWith("/latest"))
      .map((key) => $(gameInfos)[key]);
  }

  async function loadGameInfos(): Promise<void> {
    if (promise) {
      return promise;
    }

    // Do not refresh if was loaded less than 1 hour ago
    if (lastLoad + 3_600_000 > Date.now()) {
      return;
    }

    return (promise = get<Array<Omit<GameInfo, "viewer">>>("/boardgame/info").then(
      (games) => {
        promise = null;
        lastLoad = Date.now();

        const latestGames = new Set(uniqBy(sortBy(games, "_id.version").reverse(), "_id.game"));

        for (const game of games) {
          const id = gameInfoKey(game._id.game, game._id.version);

          $(gameInfos)[id] = { viewer: $(gameInfos)[id]?.viewer, ...game };
          if (latestGames.has(game)) {
            $(gameInfos)[gameInfoKey(game._id.game, "latest")] = { viewer: $(gameInfos)[id]?.viewer, ...game };
          }
        }

        gameInfos.update((val) => ({ ...val }));
      },
      (err) => {
        // do not keep throwing past the first call of this function
        promise = null;
        return Promise.reject(err);
      }
    ));
  }

  const loading = new Map<string, Promise<void>>();
  async function loadGameInfo(game: string, version: number | "latest"): Promise<void> {
    const id = gameInfoKey(game, version);
    if (loading.has(id)) {
      return loading.get(id);
    }
    if ($(gameInfos)[id]?.viewer) {
      return;
    }

    loading.set(
      id,
      get<GameInfo>(`/boardgame/${game}/info/${version}`).then(
        (game) => {
          loading.delete(id);

          // Two assignments in case version === latest, the ids would be different
          $(gameInfos)[id] = $(gameInfos)[gameInfoKey(game._id.game, game._id.version)] = game;
          gameInfos.update((val) => ({ ...val }));
        },
        (err) => {
          loading.delete(id);
          return Promise.reject(err);
        }
      )
    );

    return loading.get(id);
  }

  return {
    gameInfos,
    loadGameInfos,
    gameInfo,
    gameInfoKey,
    latestGameInfos,
    loadGameInfo,
  };
});
