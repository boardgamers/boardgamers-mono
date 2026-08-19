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

// Blended "freshest first" fixtures. Sort keys = max(lastPlayedAt, likedAt):
//   take6     liked 01-04 12:00, never played          → 01-04 12:00 (like only)
//   gaia      played 01-03,      never liked           → 01-03 00:00 (play only)
//   splendor  played 01-01,      liked 01-02 12:00     → 01-02 12:00 (like wins)
//   container played 01-02,      never liked           → 01-02 00:00 (play only)
// Expected My games order: take6, gaia, splendor, container.
const myBoardgamesRows = [
	{ boardgame: "gaia", lastPlayedAt: "2024-01-03T00:00:00.000Z", liked: false },
	{ boardgame: "container", lastPlayedAt: "2024-01-02T00:00:00.000Z", liked: false },
	{
		boardgame: "splendor",
		lastPlayedAt: "2024-01-01T00:00:00.000Z",
		liked: true,
		likedAt: "2024-01-02T12:00:00.000Z",
	},
	{
		boardgame: "take6",
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

describe("GameListSidebar SSR — My games freshest-first ordering", () => {
	beforeEach(() => {
		seedPageData({ myBoardgames: myBoardgamesRows, user: null });
	});

	it("orders My games freshest-first by max(lastPlayedAt, likedAt)", () => {
		const { body } = renderSidebar(gameInfos);

		// take6 (liked 01-04) > gaia (played 01-03) > splendor (liked 01-02 12:00) >
		// container (played 01-02). Note splendor's LIKE (01-02 12:00) outranks
		// container's PLAY (01-02 00:00) even though container was played more recently
		// than splendor was — the fresher signal wins per game. "other" is in All games.
		expect(renderedGames(body)).toEqual(["take6", "gaia", "splendor", "container", "other"]);
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

		expect(renderedGames(body)).toEqual(["take6", "gaia", "splendor", "container", "other"]);
	});
});
