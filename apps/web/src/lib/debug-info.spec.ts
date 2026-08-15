import { describe, expect, it } from "vitest";

import type { GameContext } from "@/routes/game/[gameId]/game-context";
import { gatherDebugInfo } from "./debug-info";

function makeContext(overrides: Partial<GameContext> = {}): GameContext {
	return {
		game: {
			_id: "game-1",
			game: { name: "gaia-project", version: 3 },
			status: "active",
			players: [],
			data: { round: 2, map: { hexes: [1, 2, 3] } },
		},
		players: [],
		gameInfo: null,
		settings: null,
		viewerUserId: null,
		replayData: { start: 0, end: 10, current: 4 },
		emitter: { on() {}, off() {}, emit() {} } as unknown as GameContext["emitter"],
		log: ["p1 builds a mine", "p2 passes"],
		...overrides,
	} as GameContext;
}

describe("gatherDebugInfo", () => {
	it("assembles the expected shape", () => {
		const info = gatherDebugInfo(makeContext(), {
			playerIndex: 1,
			preferences: { alternateUI: true },
			viewerUrl: "/resources/game/gaia-project/3/iframe?alternate=1&customViewerUrl=",
		});

		expect(info).toEqual({
			gameId: "game-1",
			gameName: "gaia-project",
			gameVersion: 3,
			gameStatus: "active",
			playerIndex: 1,
			preferences: { alternateUI: true },
			state: { round: 2, map: { hexes: [1, 2, 3] } },
			log: ["p1 builds a mine", "p2 passes"],
			replayData: { start: 0, end: 10, current: 4 },
			viewerUrl: "/resources/game/gaia-project/3/iframe?alternate=1&customViewerUrl=",
			release: "test", // __APP_RELEASE__ define in vitest.config.ts
			capturedAt: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/),
		});
	});

	it("tolerates a missing game and empty extras", () => {
		const info = gatherDebugInfo(makeContext({ game: null, replayData: null, log: [] }));

		expect(info.gameId).toBeUndefined();
		expect(info.gameName).toBeUndefined();
		expect(info.gameVersion).toBeUndefined();
		expect(info.gameStatus).toBeUndefined();
		expect(info.playerIndex).toBeUndefined();
		expect(info.preferences).toBeUndefined();
		expect(info.state).toBeUndefined();
		expect(info.replayData).toBeUndefined();
		expect(info.viewerUrl).toBeUndefined();
		expect(info.log).toEqual([]);
	});

	it("deep-clones the state so the snapshot is detached and JSON-serializable", () => {
		const context = makeContext();
		const info = gatherDebugInfo(context);

		(context.game!.data as { round: number }).round = 99;
		expect((info.state as { round: number }).round).toBe(2);
		expect(() => JSON.stringify(info)).not.toThrow();
	});
});
