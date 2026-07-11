import type { GameInfoFront } from "@bgs/models";
import { sortBy, uniqBy } from "lodash";
import { get as getStore, writable } from "svelte/store";
import type { SetOptional } from "type-fest";
import { get } from "./api";

export const gameInfos = writable<Record<string, SetOptional<GameInfoFront, "viewer">>>({});

let promise: Promise<void> | null = null;
let lastLoad = 0;

export function gameInfoKey(name: string, version: number | "latest"): string {
  return `${name}/${version}`;
}

export function gameInfo(name: string, version: number | "latest" = "latest") {
  return getStore(gameInfos)[gameInfoKey(name, version)];
}

export function latestGameInfos(): SetOptional<GameInfoFront, "viewer">[] {
  return Object.keys(getStore(gameInfos))
    .filter((key) => key.endsWith("/latest"))
    .map((key) => getStore(gameInfos)[key]);
}

export async function loadGameInfos(): Promise<void> {
  if (promise) {
    return promise;
  }

  // Do not refresh if was loaded less than 1 hour ago
  if (lastLoad + 3_600_000 > Date.now()) {
    return;
  }

  return (promise = get<Array<Omit<GameInfoFront, "viewer">>>("/boardgame/info").then(
    (games) => {
      promise = null;
      lastLoad = Date.now();

      const latestGames = new Set(uniqBy(sortBy(games, "_id.version").reverse(), "_id.game"));

      for (const game of games) {
        const id = gameInfoKey(game._id.game, game._id.version);

        getStore(gameInfos)[id] = { viewer: getStore(gameInfos)[id]?.viewer, ...game };
        if (latestGames.has(game)) {
          getStore(gameInfos)[gameInfoKey(game._id.game, "latest")] = {
            viewer: getStore(gameInfos)[id]?.viewer,
            ...game,
          };
        }
      }

      gameInfos.update((val) => ({ ...val }));
    },
    (err) => {
      promise = null;
      return Promise.reject(err);
    }
  ));
}

const loading = new Map<string, Promise<void>>();
export async function loadGameInfo(game: string, version: number | "latest" = "latest"): Promise<void> {
  const id = gameInfoKey(game, version);
  if (loading.has(id)) {
    return loading.get(id);
  }
  if (getStore(gameInfos)[id]?.viewer) {
    return;
  }

  loading.set(
    id,
    get<GameInfoFront>(`/boardgame/${game}/info/${version}`).then(
      (info) => {
        loading.delete(id);

        if (!info?._id) {
          return;
        }

        getStore(gameInfos)[id] = getStore(gameInfos)[gameInfoKey(info._id.game, info._id.version)] = info;
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
