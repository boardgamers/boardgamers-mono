// Tests for deriveOptionGroups (#55): the boardgame-page setup-option filter only
// offers an option when it could actually narrow the lobby — the visible games
// use ≥2 distinct values for it (counting the default). A single-value option
// (every game X-shape, or every game at the default) is hidden as noise.
import { describe, expect, it } from "vitest";
import { deriveOptionGroups, hasPaceChoice } from "./SetupOptionsFilter.svelte";
import type { GameFront, GameInfoFront } from "@bgs/models";

const plain = (s: string) => s;

function info(options: unknown): GameInfoFront {
	return { options } as GameInfoFront;
}

function game(options: Record<string, unknown>): GameFront {
	return { game: { options } } as GameFront;
}

function pacedGame(timePerGame: number): GameFront {
	return { game: { options: {} }, options: { timing: { timePerGame } } } as GameFront;
}

const layoutOption = {
	name: "layout",
	label: "Map layout",
	type: "select",
	items: [
		{ name: "standard", label: "Standard" },
		{ name: "xshape", label: "X shape" },
	],
};

describe("deriveOptionGroups (#55)", () => {
	it("offers an option when the games use ≥2 distinct values (default counts)", () => {
		// standard (the default) + xshape → two values → filterable, both offered.
		const groups = deriveOptionGroups(
			info([layoutOption]),
			[game({ layout: "xshape" }), game({ layout: "standard" })],
			plain,
		);
		expect(groups).toHaveLength(1);
		expect(groups[0].name).toBe("layout");
		expect(groups[0].choices).toEqual([
			{ name: "standard", label: "Standard" },
			{ name: "xshape", label: "X shape" },
		]);
	});

	it("hides an option when every game shares one non-default value", () => {
		// All X-shape — nothing to narrow, so no "Map layout" group.
		const groups = deriveOptionGroups(
			info([layoutOption]),
			[game({ layout: "xshape" }), game({ layout: "xshape" })],
			plain,
		);
		expect(groups).toHaveLength(0);
	});

	it("hides an option when every game is at the default value", () => {
		const groups = deriveOptionGroups(info([layoutOption]), [game({ layout: "standard" }), game({})], plain);
		expect(groups).toHaveLength(0);
	});

	it("uses the option's `default` field to determine the default value", () => {
		const opt = { ...layoutOption, default: "xshape" };
		// default=xshape: a standard game + an xshape game are two distinct values.
		const groups = deriveOptionGroups(info([opt]), [game({ layout: "standard" }), game({ layout: "xshape" })], plain);
		expect(groups).toHaveLength(1);
		expect(groups[0].choices).toEqual([
			{ name: "standard", label: "Standard" },
			{ name: "xshape", label: "X shape" },
		]);
	});

	it("skips checkbox options", () => {
		const groups = deriveOptionGroups(
			info([{ name: "auction", label: "Auction", type: "checkbox" }]),
			[game({ auction: true }), game({})],
			plain,
		);
		expect(groups).toHaveLength(0);
	});

	it("only offers the values present (not every item in the definition)", () => {
		const threeItem = {
			...layoutOption,
			items: [
				{ name: "standard", label: "Standard" },
				{ name: "xshape", label: "X shape" },
				{ name: "balanced", label: "Balanced" },
			],
		};
		const groups = deriveOptionGroups(
			info([threeItem]),
			[game({ layout: "xshape" }), game({ layout: "standard" })],
			plain,
		);
		// "balanced" isn't used by any game → not offered.
		expect(groups[0].choices).toEqual([
			{ name: "standard", label: "Standard" },
			{ name: "xshape", label: "X shape" },
		]);
	});
});

// The pace filter hides when every visible game is the same pace (nothing to
// narrow) — applies to both the home and boardgame lobbies.
describe("hasPaceChoice (#55)", () => {
	it("shows the pace filter when games are mixed live + async", () => {
		expect(hasPaceChoice([pacedGame(3600), pacedGame(172800)])).toBe(true);
	});

	it("hides the pace filter when every game is the same pace", () => {
		expect(hasPaceChoice([pacedGame(172800), pacedGame(259200)])).toBe(false); // all async
		expect(hasPaceChoice([pacedGame(3600), pacedGame(7200)])).toBe(false); // all live
	});

	it("shows the pace filter while games load (empty list)", () => {
		expect(hasPaceChoice([])).toBe(true);
	});
});
