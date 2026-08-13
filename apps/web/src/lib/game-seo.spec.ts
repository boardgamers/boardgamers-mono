import { describe, expect, it } from "vitest";
import type { GameFront, GameInfoFront } from "@bgs/models";

import { gameSeo } from "./game-seo";

const gameInfo = { label: "🚀 Gaia Project" } as GameInfoFront;

const baseGame = {
	_id: "game-1",
	players: [
		{ _id: "p1", name: "Alice", score: 42, ranking: 1 },
		{ _id: "p2", name: "Bob", score: 30, ranking: 2 },
	],
	options: {
		setup: { seed: "seed", nbPlayers: 2, playerOrder: "random" },
		timing: { timePerGame: 3600, timePerMove: 60 },
	},
	game: { name: "gaia-project", version: 1, expansions: [] },
	status: "ended",
} as unknown as GameFront;

describe("gameSeo", () => {
	it("finished game: title names the winner and description ranks the players", () => {
		const seo = gameSeo({ ...baseGame }, gameInfo);
		expect(seo.title).toBe("Alice's victory! - Gaia Project game");
		expect(seo.description).toBe("1° Alice (42pts)\n2° Bob (30pts)");
		expect(seo.noindex).toBe(true);
	});

	it("finished game with empty players does not throw and has no victor (regression: /game/<id> 500)", () => {
		// Prod bug: `minBy([], "ranking")!.name` threw `Cannot read properties of undefined`,
		// 500ing every finished game with an empty players array (e.g. Vai-di-Vairus).
		const seo = gameSeo({ ...baseGame, players: [] }, gameInfo);
		expect(seo.title).toBe("Gaia Project game");
		expect(seo.description).toBe("");
		expect(seo.noindex).toBe(true);
	});

	it("finished game with missing players field does not throw", () => {
		const corrupt = { ...baseGame, players: undefined } as unknown as GameFront;
		const seo = gameSeo(corrupt, gameInfo);
		expect(seo.title).toBe("Gaia Project game");
		expect(seo.description).toBe("");
	});

	it("active game with empty players does not throw", () => {
		const seo = gameSeo({ ...baseGame, players: [], status: "active" }, gameInfo);
		expect(seo.title).toBe("Gaia Project game game-1");
		expect(seo.description).toContain("Round 0");
	});

	it("cancelled game with empty players does not throw and omits the ranking", () => {
		const seo = gameSeo({ ...baseGame, players: [], cancelled: true }, gameInfo);
		expect(seo.title).toBe("Cancelled - Gaia Project game");
		expect(seo.description).toBeUndefined();
	});

	it("null game does not throw", () => {
		const seo = gameSeo(null, gameInfo);
		expect(seo.title).toBe("Gaia Project game ");
	});

	it("open game renders player count and timer", () => {
		const seo = gameSeo({ ...baseGame, players: [baseGame.players[0]], status: "open" }, gameInfo);
		expect(seo.title).toBe("Gaia Project game game-1");
		expect(seo.description).toContain("1 / 2 players");
	});

	it("uses the alias as the public name when the game has one (issue #106)", () => {
		const aliased = { label: "💎 Splendor", alias: "Gem Trader" } as GameInfoFront;
		const seo = gameSeo({ ...baseGame, status: "open" }, aliased);
		expect(seo.title).toBe("Gem Trader game game-1");
	});

	it("open game with missing options/timing does not throw", () => {
		const corrupt = {
			...baseGame,
			players: [],
			status: "open",
			options: undefined,
		} as unknown as GameFront;
		const seo = gameSeo(corrupt, gameInfo);
		expect(seo.title).toBe("Gaia Project game game-1");
		expect(seo.description).toContain("0 / ? players");
	});
});
