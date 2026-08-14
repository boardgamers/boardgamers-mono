import { describe, expect, it } from "vitest";
import type { GameInfoFront } from "@bgs/models";
import { applyGameLike } from "./game-info.svelte";

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
