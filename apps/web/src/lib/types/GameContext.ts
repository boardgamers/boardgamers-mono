import type { GameInfo, IGame, PlayerInfo } from "@bgs/types";
import type EventEmitter from "eventemitter3";
import type { Writable } from "svelte/store";

export type GameContext = {
  game: Writable<IGame>;
  players: Writable<PlayerInfo[]>;
  gameInfo: Writable<GameInfo>;
  replayData: Writable<{ start: number; end: number; current: number } | null>;
  emitter: EventEmitter;
  log: Writable<string[]>;
};
