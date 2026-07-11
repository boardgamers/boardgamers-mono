import type { Writable } from "svelte/store";
import type { IGame, PlayerInfoFront, GameInfo } from "@bgs/models";
import type EventEmitter from "eventemitter3";

export type GameContext = {
  game: Writable<IGame>;
  players: Writable<PlayerInfoFront[]>;
  gameInfo: Writable<GameInfo>;
  replayData: Writable<{ start: number; end: number; current: number } | null>;
  emitter: EventEmitter;
  log: Writable<string[]>;
};
