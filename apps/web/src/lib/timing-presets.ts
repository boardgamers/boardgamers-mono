// Timing presets for the new-game form (#377): named timePerGame/timePerMove
// combos so creating a live or async game doesn't require reasoning about two
// duration dropdowns. Pure client-side sugar — the API payload is unchanged.
//
// The values line up with platform behavior elsewhere:
// - live: timePerGame ≤ 600 → unfilled open games are auto-cancelled after 1h
//   (api cancelOldOpenGames), and timePerMove ≤ 15min gets the eager per-move
//   refund in the game-server ("live" short-game path).
// - rapid: timePerGame ≤ 3600 → auto-cancelled after 3h if unfilled.
// - async: the long-standing form defaults (3 days + 2h per move).
export type TimingPresetId = "async" | "rapid" | "live";

export interface TimingPreset {
	id: TimingPresetId;
	timePerGame: number;
	timePerMove: number;
}

export const timingPresets: TimingPreset[] = [
	{ id: "async", timePerGame: 3 * 24 * 3600, timePerMove: 2 * 3600 },
	{ id: "rapid", timePerGame: 3600, timePerMove: 5 * 60 },
	{ id: "live", timePerGame: 600, timePerMove: 30 },
];

export function matchTimingPreset(timePerGame: number, timePerMove: number): TimingPresetId | null {
	return (
		timingPresets.find((preset) => preset.timePerGame === timePerGame && preset.timePerMove === timePerMove)?.id ?? null
	);
}
