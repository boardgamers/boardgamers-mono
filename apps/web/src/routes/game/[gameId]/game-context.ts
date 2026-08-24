import type { GameFront, PlayerInfoFront, GameInfoFront } from "@bgs/models";
import type EventEmitter from "eventemitter3";

export type GameContext = {
	game: GameFront | null;
	players: PlayerInfoFront[];
	gameInfo: GameInfoFront | null;
	/** Current player's per-game settings (null when logged out / not a player / none). */
	settings: Record<string, unknown> | null;
	/**
	 * Id of the SSR request's user (the viewer), from the game page's load. The `account`
	 * store is null during SSR, so components that gate on the viewer ("Your turn!",
	 * "Vote to cancel", per-player settings) resolve their userId via
	 * `live($account?._id ?? null, viewerUserId)` — SSR snapshot server-side, live store after.
	 */
	viewerUserId: string | null;
	/** The game's `<game>:rules` CMS page (title only), when it exists — drives the sidebar's Rules link. */
	rulesPage: { title: string } | null;
	replayData: { start: number; end: number; current: number } | null;
	emitter: EventEmitter;
	log: string[];
};
