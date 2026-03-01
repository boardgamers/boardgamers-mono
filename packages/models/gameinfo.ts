import type { GameInfo } from "@bgs/types";

export interface GameInfoDoc extends GameInfo {
  _id: { game: string; version: number };
}

export const GAME_INFOS_COLLECTION = "gameinfos";
