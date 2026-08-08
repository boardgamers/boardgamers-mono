import type { GameFront, PlayerInfoFront, GameInfoFront } from "@bgs/models";
import type EventEmitter from "eventemitter3";

export type GameContext = {
	game: GameFront | null;
	players: PlayerInfoFront[];
	gameInfo: GameInfoFront | null;
	/** Current player's per-game settings (null when logged out / not a player / none). */
	settings: Record<string, unknown> | null;
	/** Id of the user `settings` was fetched for — used to resolve `playerUser` during SSR. */
	settingsUserId: string | null;
	replayData: { start: number; end: number; current: number } | null;
	emitter: EventEmitter;
	log: string[];
};
