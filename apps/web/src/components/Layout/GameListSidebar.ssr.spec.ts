// @vitest-environment node
import { render } from "svelte/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { GameInfoFront } from "@bgs/models";

vi.mock("@/components/icons/IconMeeple.svelte", async () => ({
	default: (await import("@/lib/__mocks__/IconStub.svelte")).default,
}));
vi.mock("@/components/icons/IconMeepleFill.svelte", async () => ({
	default: (await import("@/lib/__mocks__/IconStub.svelte")).default,
}));

import { page } from "$app/state";
import GameListSidebar from "./GameListSidebar.svelte";

// The mock `page` is loosely typed; helper so specs can seed layout data freely.
function seedPageData(data: Record<string, unknown>) {
	Object.assign(page.data, data);
}
// `render` of a component referenced via a `never` cast would type props as `never`.
function renderSidebar(gameInfos: Record<string, GameInfoFront>) {
	return render(GameListSidebar as never, { props: { gameInfos } as never });
}

const info = (game: string, extra: Partial<GameInfoFront> = {}) =>
	({
		_id: { game, version: 1 },
		label: game,
		...extra,
	}) as unknown as GameInfoFront;

// Two played (gaia most recent, then container), two liked (splendor liked long ago
// AND played long ago, take6 liked recently, never played), one unrelated.
const gameInfos = {
	"gaia/latest": info("gaia"),
	"container/latest": info("container"),
	"splendor/latest": info("splendor", { liked: true, likeCount: 2 }),
	"take6/latest": info("take6", { liked: true, likeCount: 5 }),
	"other/latest": info("other", { likeCount: 9 }),
};

const myBoardgamesRows = [
	{ boardgame: "gaia", lastActivity: "2024-01-03T00:00:00.000Z", liked: false },
	{ boardgame: "container", lastActivity: "2024-01-02T00:00:00.000Z", liked: false },
	{
		boardgame: "splendor",
		lastActivity: "2024-01-01T00:00:00.000Z",
		liked: true,
		likedAt: "2024-01-01T12:00:00.000Z",
	},
	{
		boardgame: "take6",
		lastActivity: "2024-01-04T12:00:00.000Z",
		liked: true,
		likedAt: "2024-01-04T12:00:00.000Z",
	},
];

/** Sidebar entry display names in render order (section headers excluded). */
function renderedGames(body: string): string[] {
	const names: string[] = [];
	// Each entry's display name is inside the GameName container (the flex-1 div), which
	// comes before the like-count badge and the forget/unforget button.
	for (const match of body.matchAll(/<div class="min-w-0 flex-1">(.*?)<\/div>/gs)) {
		names.push(
			match[1]
				.replace(/<[^>]+>/g, "")
				.replace(/\s+/g, " ")
				.trim(),
		);
	}
	return names;
}

describe("GameListSidebar SSR — My games liked-first ordering", () => {
	beforeEach(() => {
		seedPageData({ myBoardgames: myBoardgamesRows, user: null });
	});

	it("renders liked games at the top of My games, above played games", () => {
		const { body } = renderSidebar(gameInfos);

		// Liked first (most-recently-liked first): take6, splendor — then played by
		// recency: gaia, container. "other" is in All games below.
		expect(renderedGames(body)).toEqual(["take6", "splendor", "gaia", "container", "other"]);
		expect(body).toContain("My games");
		expect(body).toContain("All games");
	});

	it("renders no My games section when there is nothing played or liked", () => {
		seedPageData({ myBoardgames: [], user: null });
		const anonymousInfos = Object.fromEntries(
			Object.entries(gameInfos).map(([k, v]) => [k, { ...v, liked: false }]),
		) as typeof gameInfos;
		const { body } = renderSidebar(anonymousInfos);

		expect(body).not.toContain("My games");
		// All games remain, most-liked first (likeCount desc, then A-Z): other(9) >
		// take6(5) > splendor(2) > container(0) > gaia(0).
		expect(renderedGames(body)).toEqual(["other", "take6", "splendor", "container", "gaia"]);
	});

	it("keeps a forgotten played game out of My games but listed (hidden) in All games", () => {
		seedPageData({
			myBoardgames: myBoardgamesRows,
			user: { _id: "user-a", settings: { home: { forgottenGames: ["gaia"] } } },
		});
		const { body } = renderSidebar(gameInfos);

		expect(renderedGames(body)).toEqual(["take6", "splendor", "container", "other", "gaia"]);
	});

	it("keeps a forgotten but liked game in My games (the like pins it)", () => {
		seedPageData({
			myBoardgames: myBoardgamesRows,
			user: { _id: "user-a", settings: { home: { forgottenGames: ["splendor"] } } },
		});
		const { body } = renderSidebar(gameInfos);

		expect(renderedGames(body)).toEqual(["take6", "splendor", "gaia", "container", "other"]);
	});
});
