// The homepage hero tagline: translated sentence ("Play {games} online") around the
// most-liked public games, each silently linking to its boardgame page. Rendering is
// covered here (the pure selection/formatting logic is in lib/hero-tagline.spec.ts):
// SSR'd game data comes from the game-info context the root layout provides.
import { flushSync, mount, unmount } from "svelte";
import { afterEach, describe, expect, it } from "vitest";
import type { GameInfoFront } from "@bgs/models";
import type { SetOptional } from "type-fest";
import { switchLanguage } from "@/lib/i18n/messages";
import HeroTagline from "./HeroTagline.svelte";

type ListedGameInfo = SetOptional<GameInfoFront, "viewer">;

function info(game: string, overrides: Partial<GameInfoFront> & { version?: number } = {}): ListedGameInfo {
	const { version = 1, ...rest } = overrides;
	return { _id: { game, version }, label: game, public: true, ...rest } as ListedGameInfo;
}

// The context map the root layout provides, mirroring buildGameInfoMap: every version
// keyed `<game>/<version>` plus `<game>/latest` for each game's highest version. The hero
// reads ALL entries — "public" is a per-game any-version property.
function contextOf(infos: ListedGameInfo[]): Map<string, Record<string, ListedGameInfo>> {
	const map: Record<string, ListedGameInfo> = {};
	for (const i of infos) {
		map[`${i._id.game}/${i._id.version}`] = i;
		const latest = map[`${i._id.game}/latest`];
		if (!latest || latest._id.version < i._id.version) {
			map[`${i._id.game}/latest`] = i;
		}
	}
	return new Map([["gameInfos", map]]);
}

function mountHero(infos: ListedGameInfo[]) {
	const target = document.createElement("div");
	document.body.appendChild(target);
	const instance = mount(HeroTagline, { target, context: contextOf(infos) });
	flushSync();
	return { target, instance };
}

let cleanup: (() => void) | undefined;
afterEach(async () => {
	cleanup?.();
	cleanup = undefined;
	await switchLanguage("en");
});

function links(target: HTMLElement): Array<{ text: string; href: string }> {
	return [...target.querySelectorAll("a")].map((a) => ({ text: a.textContent ?? "", href: a.getAttribute("href")! }));
}

describe("HeroTagline", () => {
	it("cites the top-liked public games, linking each to its boardgame page", () => {
		const { target, instance } = mountHero([
			info("splendor", { label: "💎 Splendor", likeCount: 9 }),
			info("outpost", { label: "Outpost", likeCount: 3 }),
			info("take6", { label: "6nimmt", likeCount: 7 }),
			info("secret-beta", { label: "Secret Beta", likeCount: 50, public: false }),
		]);
		cleanup = () => unmount(instance);

		expect(target.textContent!.trim()).toBe("Play Splendor, 6nimmt, and Outpost online");
		expect(links(target)).toEqual([
			{ text: "Splendor", href: "/boardgame/splendor" },
			{ text: "6nimmt", href: "/boardgame/take6" },
			{ text: "Outpost", href: "/boardgame/outpost" },
		]);
	});

	it("falls back to the historical four when no game has likes", () => {
		const { target, instance } = mountHero([info("something", { label: "Something" })]);
		cleanup = () => unmount(instance);

		expect(target.textContent!.trim()).toBe("Play Gaia Project, Powergrid, 6nimmt, and Container online");
		expect(links(target).map((l) => l.href)).toEqual([
			"/boardgame/gaia-project",
			"/boardgame/powergrid",
			"/boardgame/take6",
			"/boardgame/container",
		]);
	});

	it("cites a game whose latest version is a private beta when an older version is public", () => {
		// A beta grantee's list carries the game's private-beta latest on top of the public
		// version — the hero must show them the same list as everyone else.
		const { target, instance } = mountHero([
			info("gaia-project", { label: "🌌 Gaia Project", likeCount: 9, version: 2, public: false }),
			info("gaia-project", { label: "🌌 Gaia Project", likeCount: 9, version: 1 }),
			info("container", { label: "Container", likeCount: 1 }),
		]);
		cleanup = () => unmount(instance);

		expect(target.textContent!.trim()).toBe("Play Gaia Project and Container online");
		expect(links(target)[0]).toEqual({ text: "Gaia Project", href: "/boardgame/gaia-project" });
	});

	it("does not cite an aliased game (trademark discretion), even when it is the most liked", () => {
		const { target, instance } = mountHero([
			info("gem-trader", { label: "💎 Splendor", alias: "Gem Trader", likeCount: 2 }),
			info("container", { label: "Container", likeCount: 1 }),
		]);
		cleanup = () => unmount(instance);

		expect(target.textContent!.trim()).toBe("Play Container online");
		expect(links(target)).toEqual([{ text: "Container", href: "/boardgame/container" }]);
	});

	it("renders the translated sentence and localized separators on language switch", async () => {
		const { target, instance } = mountHero([
			info("gaia-project", { label: "🌌 Gaia Project", likeCount: 3 }),
			info("powergrid", { label: "⚡ Powergrid", likeCount: 2 }),
			info("container", { label: "Container", likeCount: 1 }),
		]);
		cleanup = () => unmount(instance);

		await switchLanguage("fr");
		flushSync();

		expect(target.textContent!.trim()).toBe("Jouez à Gaia Project, Powergrid et Container en ligne");
		// The game names stay proper nouns — still linked to the same pages.
		expect(links(target).map((l) => l.href)).toEqual([
			"/boardgame/gaia-project",
			"/boardgame/powergrid",
			"/boardgame/container",
		]);
	});
});
