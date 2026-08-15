import type { GameContext } from "@/routes/game/[gameId]/game-context";

// The viewer↔game postMessage protocol lets a viewer ask the parent for the
// current debug snapshot; the parent answers with a `debugInfo` message.
export const DEBUG_INFO_REQUEST = "requestDebugInfo";
export const DEBUG_INFO_MESSAGE = "debugInfo";

export type GameDebugInfo = {
	gameId: string | undefined;
	gameName: string | undefined;
	gameVersion: number | undefined;
	gameStatus: string | undefined;
	playerIndex: number | undefined;
	preferences: unknown;
	state: unknown;
	log: unknown;
	replayData: unknown;
	viewerUrl: string | undefined;
	release: string;
	capturedAt: string;
};

/**
 * Assemble a JSON-serializable snapshot of the current game for bug reports.
 * Everything goes through the JSON deep-clone idiom (same as the `state`
 * postMessage) so the result is safe to both postMessage and stringify.
 */
export function gatherDebugInfo(
	context: GameContext,
	extra: { playerIndex?: number; preferences?: unknown; viewerUrl?: string } = {},
): GameDebugInfo {
	const clone = (value: unknown) => (value === undefined ? undefined : JSON.parse(JSON.stringify(value)));
	return {
		gameId: context.game?._id,
		gameName: context.game?.game?.name,
		gameVersion: context.game?.game?.version,
		gameStatus: context.game?.status,
		playerIndex: extra.playerIndex,
		preferences: clone(extra.preferences),
		state: clone(context.game?.data),
		log: clone(context.log),
		replayData: clone(context.replayData ?? undefined),
		viewerUrl: extra.viewerUrl,
		release: __APP_RELEASE__,
		capturedAt: new Date().toISOString(),
	};
}
