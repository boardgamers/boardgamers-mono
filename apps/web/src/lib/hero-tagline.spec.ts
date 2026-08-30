import { describe, expect, it } from "vitest";
import { FALLBACK_HERO_GAMES, heroGames, heroListParts, taglineParts, type HeroGameInfo } from "./hero-tagline";

function info(game: string, overrides: Partial<HeroGameInfo> = {}): HeroGameInfo {
	return { _id: { game }, label: game, public: true, ...overrides };
}

describe("heroGames", () => {
	it("cites the most-liked public games, likes descending, capped at 4", () => {
		const games = heroGames([
			info("a", { label: "Alpha", likeCount: 3 }),
			info("b", { label: "Beta", likeCount: 10 }),
			info("c", { label: "Gamma", likeCount: 7 }),
			info("d", { label: "Delta", likeCount: 5 }),
			info("e", { label: "Epsilon", likeCount: 4 }),
		]);
		expect(games.map((g) => g.id)).toEqual(["b", "c", "d", "e"]);
	});

	it("excludes non-public games even when they are the most liked", () => {
		const games = heroGames([
			info("beta-hit", { label: "Beta Hit", likeCount: 100, public: false }),
			info("released", { label: "Released", likeCount: 1 }),
		]);
		expect(games.map((g) => g.id)).toEqual(["released"]);
	});

	it("falls back to the historical four when no public game has likes", () => {
		expect(heroGames([])).toEqual(FALLBACK_HERO_GAMES);
		expect(heroGames([info("a", { likeCount: 0 }), info("b")])).toEqual(FALLBACK_HERO_GAMES);
		// Likes on a non-public game don't count either.
		expect(heroGames([info("beta", { likeCount: 5, public: false }), info("a")])).toEqual(FALLBACK_HERO_GAMES);
	});

	it("fills remaining slots with unliked public games (name order) after the liked ones", () => {
		const games = heroGames([
			info("zeta", { label: "Zeta" }),
			info("liked", { label: "Liked", likeCount: 2 }),
			info("alpha", { label: "Alpha" }),
		]);
		expect(games.map((g) => g.id)).toEqual(["liked", "alpha", "zeta"]);
	});

	it("breaks like-count ties deterministically by display name", () => {
		const games = heroGames([
			info("z", { label: "Zulu", likeCount: 2 }),
			info("a", { label: "Alpha", likeCount: 2 }),
			info("m", { label: "Mike", likeCount: 2 }),
		]);
		expect(games.map((g) => g.id)).toEqual(["a", "m", "z"]);
	});

	it("shows the alias when one is set (#106) and strips the label emoji", () => {
		const games = heroGames([
			info("gem-trader", { label: "💎 Splendor", alias: "Gem Trader", likeCount: 3 }),
			info("powergrid", { label: "⚡ Powergrid", likeCount: 2 }),
		]);
		expect(games.map((g) => g.name)).toEqual(["Gem Trader", "Powergrid"]);
	});
});

describe("taglineParts", () => {
	it("splits the text around the {games} placeholder", () => {
		expect(taglineParts(({ games }) => `Play ${games} online`)).toEqual({ before: "Play ", after: " online" });
	});

	it("supports a leading placeholder (games-first languages)", () => {
		expect(taglineParts(({ games }) => `${games} को ऑनलाइन खेलें`)).toEqual({ before: "", after: " को ऑनलाइन खेलें" });
	});

	it("degrades to the whole text + appended list when a catalog lost the placeholder", () => {
		expect(taglineParts(() => "Play online")).toEqual({ before: "Play online", after: "" });
	});
});

describe("heroListParts", () => {
	const games = [
		{ id: "a", name: "Alpha" },
		{ id: "b", name: "Beta" },
		{ id: "c", name: "Gamma" },
	];

	it("maps element parts to their games, in order, around localized separators", () => {
		const parts = heroListParts(games, "en");
		expect(parts.map((p) => p.text).join("")).toBe("Alpha, Beta, and Gamma");
		expect(parts.filter((p) => p.game).map((p) => p.game!.id)).toEqual(["a", "b", "c"]);
		// Separators carry no game (rendered as plain text, not links).
		expect(parts.filter((p) => !p.game).every((p) => /^[,\s]|and/.test(p.text))).toBe(true);
	});

	it("localizes the separators (zero catalog cost)", () => {
		expect(
			heroListParts(games, "fr")
				.map((p) => p.text)
				.join(""),
		).toBe("Alpha, Beta et Gamma");
		expect(
			heroListParts(games, "de")
				.map((p) => p.text)
				.join(""),
		).toBe("Alpha, Beta und Gamma");
	});
});
