import { describe, expect, it } from "vitest";
import type { GameInfoFront } from "@bgs/models";
import { applyGameLike, byGamePopularity, byMyGamesOrder, reseedGameInfoLikes } from "./game-info.svelte";

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

// Login/logout must clear/update the per-user `liked` state. The layout re-seeds the
// game-info map from the fresh per-user /boardgame/info list on an identity change.
describe("reseedGameInfoLikes", () => {
	const entry = (game: string, likeCount?: number, liked?: boolean) =>
		({ _id: { game, version: 1 }, likeCount, liked }) as unknown as GameInfoFront;

	it("applies the fresh per-user liked state onto existing entries (login)", () => {
		// Logged-out snapshot: nothing liked.
		const map = {
			"gaia-project/latest": entry("gaia-project", 5, false),
			"take6/latest": entry("take6", 2, false),
		};
		// Fresh list after logging in as a user who likes gaia-project.
		const fresh = {
			"gaia-project/latest": entry("gaia-project", 5, true),
			"take6/latest": entry("take6", 2, false),
		};

		const next = reseedGameInfoLikes(map, fresh);

		expect(next["gaia-project/latest"]).toMatchObject({ liked: true, likeCount: 5 });
		expect(next["take6/latest"]).toMatchObject({ liked: false, likeCount: 2 });
	});

	it("clears liked state on logout", () => {
		const map = { "gaia-project/latest": entry("gaia-project", 5, true) };
		const fresh = { "gaia-project/latest": entry("gaia-project", 5, false) };

		expect(reseedGameInfoLikes(map, fresh)["gaia-project/latest"]).toMatchObject({ liked: false });
	});

	it("preserves an already-loaded viewer and adds new keys", () => {
		const withViewer = { ...entry("gaia-project", 5, false), viewer: { url: "//v1" } } as unknown as GameInfoFront;
		const map = { "gaia-project/latest": withViewer };
		const fresh = {
			"gaia-project/latest": entry("gaia-project", 6, true),
			"container/latest": entry("container", 1, true),
		};

		const next = reseedGameInfoLikes(map, fresh);

		expect(next["gaia-project/latest"]).toMatchObject({ liked: true, likeCount: 6, viewer: { url: "//v1" } });
		expect(next["container/latest"]).toMatchObject({ liked: true, likeCount: 1 });
		// Pure: the input map is untouched.
		expect(map["gaia-project/latest"]).toBe(withViewer);
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

// The sidebar's "My games" ordering, "freshest first": each game's sort key is the
// MOST RECENT of its last-played and like times, descending.
describe("byMyGamesOrder", () => {
	const entry = (game: string, label = game) => ({ _id: { game, version: 1 }, label }) as unknown as GameInfoFront;
	const names = (list: GameInfoFront[]) => list.map((g) => g._id.game);

	it("sorts by the most recent of last-played and like time, descending", () => {
		// gaia: played at 3000, liked at 1000 → key 3000 (play recency wins).
		// take6: never played, liked at 2500 → key 2500 (like only).
		// container: played at 500, liked at 2000 → key 2000 (like wins).
		// splendor: played at 100, never liked → key 100 (play only).
		const lastPlayedAt = { gaia: 3000, container: 500, splendor: 100 };
		const likedAt = { gaia: 1000, take6: 2500, container: 2000 };
		const list = [entry("splendor"), entry("container"), entry("take6"), entry("gaia")];

		expect(names(list.slice().sort(byMyGamesOrder(lastPlayedAt, likedAt)))).toEqual([
			"gaia",
			"take6",
			"container",
			"splendor",
		]);
	});

	it("lets play recency win when more recent than the like (a)", () => {
		// Played today (key ~now), liked a year ago → sorts ABOVE a game liked
		// yesterday but never played.
		const now = 1_000_000;
		const lastPlayedAt = { "played-today": now };
		const likedAt = { "played-today": now - 31_536_000, "liked-yesterday": now - 86_400 };
		const list = [entry("liked-yesterday"), entry("played-today")];

		expect(names(list.slice().sort(byMyGamesOrder(lastPlayedAt, likedAt)))).toEqual([
			"played-today",
			"liked-yesterday",
		]);
	});

	it("lets the like win when more recent than the last play (b)", () => {
		// Liked an hour ago, last played a month ago → sorts by the like, ABOVE a game
		// played yesterday (never liked).
		const now = 1_000_000;
		const lastPlayedAt = { "liked-recently": now - 2_592_000, "played-yesterday": now - 86_400 };
		const likedAt = { "liked-recently": now - 3_600 };
		const list = [entry("played-yesterday"), entry("liked-recently")];

		expect(names(list.slice().sort(byMyGamesOrder(lastPlayedAt, likedAt)))).toEqual([
			"liked-recently",
			"played-yesterday",
		]);
	});

	it("orders liked-never-played games by likedAt among themselves (c)", () => {
		const lastPlayedAt = { played: 5000 };
		const likedAt = { "never-played-b": 500, "never-played-a": 1500 };
		const list = [entry("played"), entry("never-played-b"), entry("never-played-a")];

		// played (5000) is freshest; the two never-played follow in likedAt order.
		expect(names(list.slice().sort(byMyGamesOrder(lastPlayedAt, likedAt)))).toEqual([
			"played",
			"never-played-a",
			"never-played-b",
		]);
	});

	it("sinks a game with neither signal to the bottom, A-Z among themselves", () => {
		const lastPlayedAt = { played: 1000 };
		const list = [entry("b-game", "Banana"), entry("played"), entry("a-game", "Apple")];
		expect(names(list.slice().sort(byMyGamesOrder(lastPlayedAt, {})))).toEqual(["played", "a-game", "b-game"]);
	});
});
