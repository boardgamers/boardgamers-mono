import { get } from "@/api";
import { boardgames } from "@/store";
import type { RemoveReadable } from "@/utils";
import type { GameInfo } from "@bgs/types";
import { sortBy, uniqBy } from "lodash";
import type { ValueOf } from "type-fest";

let lastLoad = 0;
let promise: Promise<void> | undefined;
let $boardgames: RemoveReadable<typeof boardgames>;
boardgames.subscribe((val) => ($boardgames = val));

export function boardgameKey(name: string, version: number | "latest"): string {
  return `${name}/${version}`;
}

export function boardgameInfo(name: string, version: number | "latest"): ValueOf<typeof $boardgames> {
  return $boardgames[boardgameKey(name, version)];
}

export function latestBoardgames(): ValueOf<typeof $boardgames>[] {
  return Object.keys($boardgames)
    .filter((key) => key.endsWith("/latest"))
    .map((key) => $boardgames[key]);
}

export async function loadBoardgames(): Promise<void> {
  if (promise) {
    return promise;
  }

  // Do not refresh if was loaded less than 1 hour ago
  if (lastLoad + 3600 * 1000 > Date.now()) {
    return;
  }

  return (promise = get<Array<Omit<GameInfo, "viewer">>>("/boardgame/info").then(
    (games) => {
      promise = undefined;
      lastLoad = Date.now();

      const latestGames = new Set(uniqBy(sortBy(games, "_id.version").reverse(), "_id.game"));

      for (const game of games) {
        const id = boardgameKey(game._id.game, game._id.version);

        $boardgames[id] = { viewer: $boardgames[id]?.viewer, ...game };
        if (latestGames.has(game)) {
          $boardgames[boardgameKey(game._id.game, "latest")] = { viewer: $boardgames[id]?.viewer, ...game };
        }
      }

      boardgames.set({ ...$boardgames });
    },
    (err) => {
      // do not keep throwing past the first call of this function
      promise = undefined;
      return Promise.reject(err);
    }
  ));
}

const loading = new Map<string, Promise<void>>();
export async function loadBoardgame(game: string, version: number | "latest"): Promise<void> {
  const id = boardgameKey(game, version);
  if (loading.has(id)) {
    return loading.get(id);
  }
  if ($boardgames[id]?.viewer) {
    return;
  }

  loading.set(
    id,
    get<GameInfo>(`/boardgame/${game}/info/${version}`).then(
      (game) => {
        loading.delete(id);

        // Two assignments in case version === latest, the ids would be different
        $boardgames[id] = $boardgames[boardgameKey(game._id.game, game._id.version)] = game;
        boardgames.set({ ...$boardgames });
      },
      (err) => {
        loading.delete(id);
        return Promise.reject(err);
      }
    )
  );

  return loading.get(id);
}
