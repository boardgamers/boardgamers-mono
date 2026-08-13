import { describe, expect, it } from "vitest";
import type { GameInfoFront } from "@bgs/models";

import { boardgameSeo } from "./boardgame-seo";

// Same description as the seed fixture (apps/api/scripts/fixtures/GameInfo.json).
const gameInfo = {
	label: "🚀 Gaia Project",
	description: "Terra Mystica's successor, Gaia Project is a game with perfect information.",
} as GameInfoFront;

describe("boardgameSeo", () => {
	it('title is "Play <name> online" (plain display name, no emoji)', () => {
		const seo = boardgameSeo("gaia-project", gameInfo);
		expect(seo.title).toBe("Play Gaia Project online");
	});

	it("description leads with the play-online hook, then the game blurb", () => {
		const seo = boardgameSeo("gaia-project", gameInfo);
		expect(seo.description).toBe(
			"Play Gaia Project online with other people. " +
				"Terra Mystica's successor, Gaia Project is a game with perfect information.",
		);
	});

	it("long blurbs are truncated to SERP length and keep the lead intact", () => {
		const seo = boardgameSeo("gaia-project", {
			...gameInfo,
			description: `${"Lorem ipsum dolor sit amet, consectetur adipiscing elit. ".repeat(10)}fin.`,
		} as GameInfoFront);
		const description = seo.description ?? "";
		expect(description.length).toBeLessThanOrEqual(160);
		expect(description.startsWith("Play Gaia Project online with other people.")).toBe(true);
		expect(description.endsWith("…")).toBe(true);
	});

	it("no description: the lead alone is the description", () => {
		const seo = boardgameSeo("gaia-project", { label: "🚀 Gaia Project" } as GameInfoFront);
		expect(seo.description).toBe("Play Gaia Project online with other people.");
	});

	it("falls back to the boardgame id when the game info is missing", () => {
		const seo = boardgameSeo("gaia-project", undefined);
		expect(seo.title).toBe("Play gaia-project online");
		expect(seo.description).toBe("Play gaia-project online with other people.");
	});

	it("uses the alias as the public name when the game has one (issue #106)", () => {
		const aliased = { label: "💎 Splendor", alias: "Gem Trader" } as GameInfoFront;
		expect(boardgameSeo("splendor", aliased).title).toBe("Play Gem Trader online");
	});

	it("keeps the boardgame share image", () => {
		expect(boardgameSeo("gaia-project", gameInfo).image).toBe("/share.webp/boardgame/gaia-project");
	});
});
