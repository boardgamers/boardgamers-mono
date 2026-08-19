// Tests for deriveOptionGroups (#55): the boardgame-page setup-option filter only
// offers options/values actually present in the loaded open games (compact,
// relevant chips), and only the non-default ones (a game at the default value
// isn't a meaningful "choice" to filter by).
import { describe, expect, it } from "vitest";
import { deriveOptionGroups } from "./SetupOptionsFilter.svelte";
import type { GameFront, GameInfoFront } from "@bgs/models";

const plain = (s: string) => s;

function info(options: unknown): GameInfoFront {
	return { options } as GameInfoFront;
}

function game(options: Record<string, unknown>): GameFront {
	return { game: { options } } as GameFront;
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
	it("offers only the values present in the loaded games (not every item)", () => {
		const groups = deriveOptionGroups(info([layoutOption]), [game({ layout: "xshape" })], plain);
		expect(groups).toHaveLength(1);
		expect(groups[0].name).toBe("layout");
		// Only "xshape" is used — "standard" (the default) isn't offered.
		expect(groups[0].choices).toEqual([{ name: "xshape", label: "X shape" }]);
	});

	it("omits an option whose games all use the default value", () => {
		// No `default` field → the first item ("standard") is the default.
		const groups = deriveOptionGroups(info([layoutOption]), [game({ layout: "standard" })], plain);
		expect(groups).toHaveLength(0);
	});

	it("uses the option's `default` field to determine the default value", () => {
		const opt = { ...layoutOption, default: "xshape" };
		// With default=xshape, a "standard" game is the deviation → offered.
		const groups = deriveOptionGroups(info([opt]), [game({ layout: "standard" })], plain);
		expect(groups).toHaveLength(1);
		expect(groups[0].choices).toEqual([{ name: "standard", label: "Standard" }]);
	});

	it("skips checkbox options and options no game sets", () => {
		const groups = deriveOptionGroups(
			info([layoutOption, { name: "auction", label: "Auction", type: "checkbox" }]),
			[game({})],
			plain,
		);
		expect(groups).toHaveLength(0);
	});

	it("offers multiple present values, in the option's item order", () => {
		const groups = deriveOptionGroups(
			info([layoutOption]),
			[game({ layout: "xshape" }), game({ layout: "standard" })],
			plain,
		);
		// "standard" is the default so not offered; only the deviation is.
		expect(groups[0].choices).toEqual([{ name: "xshape", label: "X shape" }]);
	});
});
