import type { GameFront, PlayerInfoFront, GameInfoFront } from "@bgs/models";
import type EventEmitter from "eventemitter3";

export type GameContext = {
  game: GameFront | null;
  players: PlayerInfoFront[];
  gameInfo: GameInfoFront | null;
  replayData: { start: number; end: number; current: number } | null;
  emitter: EventEmitter;
  log: string[];
};
