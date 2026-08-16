import { describe, expect, it } from "vitest";
import type { GameInfoFront } from "@bgs/models";
import { applyGameLike, byGamePopularity } from "./game-info.svelte";

// Regression for the "count resets to 0 after like + refresh" bug: the toggle response
// must be applied to every map entry of the game (all versions + `latest`) — `likeCount`
// is shared across versions, so updating only one key desyncs the list from the button.
describe("applyGameLike", () => {
	const entry = (game: string, version: number, likeCount?: number) =>
		({ _id: { game, version }, likeCount }) as unknown as GameInfoFront;

	it("patches every version entry and the latest alias", () => {
		const stale = entry("gaia-project", 1, 3);
		const map = {
			"gaia-project/1": stale,
			"gaia-project/2": entry("gaia-project", 2),
			"gaia-project/latest": entry("gaia-project", 2),
			"container/latest": entry("container", 2, 7),
		};

		const next = applyGameLike(map, "gaia-project", { liked: true, likeCount: 4 });

		expect(next["gaia-project/1"]).toMatchObject({ liked: true, likeCount: 4 });
		expect(next["gaia-project/2"]).toMatchObject({ liked: true, likeCount: 4 });
		expect(next["gaia-project/latest"]).toMatchObject({ liked: true, likeCount: 4 });
		expect(next["container/latest"]).toMatchObject({ likeCount: 7 });
		expect(next["container/latest"]).not.toHaveProperty("liked");
		// Pure: the input map is untouched.
		expect(map["gaia-project/1"]).toBe(stale);
		expect(stale.likeCount).toBe(3);
	});

	it("is a no-op for games absent from the map", () => {
		const map = { "container/latest": entry("container", 2, 7) };
		expect(applyGameLike(map, "unknown", { liked: true, likeCount: 1 })).toEqual(map);
	});
});

// The /boardgames + /new-game discovery ordering (#98).
describe("byGamePopularity", () => {
	const game = (label: string, likeCount?: number, liked?: boolean) =>
		({ label, likeCount, liked }) as unknown as GameInfoFront;

	it("puts games the user liked first, then most-liked, then A-Z", () => {
		const list = [game("🐑 Catan", 3), game("🚀 Gaia Project", 10), game("🏭 Power Grid", 1, true), game("🎲 Azul")];

		expect(
			list
				.slice()
				.sort(byGamePopularity)
				.map((g) => g.label),
		).toEqual([
			"🏭 Power Grid", // liked by me — first despite fewer likes
			"🚀 Gaia Project", // then likeCount desc
			"🐑 Catan",
			"🎲 Azul", // no likes last
		]);
	});

	it("breaks likeCount ties by display name (alias-aware)", () => {
		const list = [
			game("Zooloretto", 2),
			// The DISPLAYED name is what sorts: the alias ("Gem Trader"), not the canonical
			// label ("Splendor") — it lands before "Zooloretto" where "Splendor" would not.
			{ label: "Splendor", alias: "Gem Trader", likeCount: 2 } as unknown as GameInfoFront,
			game("Azul", 2),
		];

		expect(
			list
				.slice()
				.sort(byGamePopularity)
				.map((g) => g.alias ?? g.label),
		).toEqual(["Azul", "Gem Trader", "Zooloretto"]);
	});
});
