import type { Writable } from "svelte/store";
import type { GameFront, PlayerInfoFront, GameInfoFront } from "@bgs/models";
import type EventEmitter from "eventemitter3";

export type GameContext = {
  game: Writable<GameFront>;
  players: Writable<PlayerInfoFront[]>;
  gameInfo: Writable<GameInfoFront>;
  replayData: Writable<{ start: number; end: number; current: number } | null>;
  emitter: EventEmitter;
  log: Writable<string[]>;
};
