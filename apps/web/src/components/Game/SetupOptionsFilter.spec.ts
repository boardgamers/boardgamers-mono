// Tests for deriveOptionGroups (#55): the boardgame-page setup-option filter only
// offers an option when it could actually narrow the lobby — the visible games
// use ≥2 distinct values for it (counting the default). A single-value option
// (every game X-shape, or every game at the default) is hidden as noise.
//
// The component-level tests mount the filter and exercise the chips: no "All"
// chip (clicking the selected chip deselects), aria-pressed state, and the
// visibility regression — with an active pace filter the parent keeps passing
// the last UNFILTERED list, so the chips must survive the filtered list going
// single-pace or empty.
import { flushSync, mount, unmount } from "svelte";
import { get } from "svelte/store";
import { beforeEach, describe, expect, it } from "vitest";
import { deriveOptionGroups, hasPaceChoice } from "./SetupOptionsFilter.svelte";
import SetupOptionsFilterHarness, { harGames, harInfo, harPace } from "./SetupOptionsFilterHarness.svelte";
import type { GameFront, GameInfoFront } from "@bgs/models";

const plain = (s: string) => s;

function info(options: unknown): GameInfoFront {
	return { options } as GameInfoFront;
}

function game(options: Record<string, unknown>): GameFront {
	// `options.timing` is what hasPaceChoice reads (the pace side of the filter).
	return { game: { options }, options: { timing: {} } } as GameFront;
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

// The pace filter hides when every game in the (unfiltered) lobby is the same
// pace (nothing to narrow) — applies to both the home and boardgame lobbies.
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

function mountFilter() {
	const target = document.createElement("div");
	document.body.appendChild(target);
	const instance = mount(SetupOptionsFilterHarness as never, { target });
	flushSync();
	return { target, instance };
}

function paceChips(target: HTMLElement): HTMLButtonElement[] {
	return [...target.querySelectorAll<HTMLButtonElement>('[role="group"][aria-label="Filter games by pace"] button')];
}

describe("SetupOptionsFilter pace chips", () => {
	beforeEach(() => {
		document.body.innerHTML = "";
		harGames.set([]);
		harPace.set("");
		harInfo.set(undefined);
	});

	it("renders no 'All' chip — only Live and Async", () => {
		harGames.set([pacedGame(3600), pacedGame(172800)]);
		const { target, instance } = mountFilter();

		expect(paceChips(target).map((c) => c.textContent?.trim())).toEqual(["⚡ Live", "🐢 Async"]);
		// Settle the optionFilter bind-back's second effect pass before unmount.
		flushSync();
		unmount(instance);
	});

	it("clicking a chip selects it, clicking it again deselects (back to no filter)", () => {
		harGames.set([pacedGame(3600), pacedGame(172800)]);
		const { target, instance } = mountFilter();
		const [live] = paceChips(target);

		live.click();
		flushSync();
		expect(get(harPace)).toBe("live");
		expect(live.getAttribute("aria-pressed")).toBe("true");

		live.click();
		flushSync();
		expect(get(harPace)).toBe("");
		expect(live.getAttribute("aria-pressed")).toBe("false");
		unmount(instance);
	});

	it("switching chips moves the selection (no deselect on a different chip)", () => {
		harGames.set([pacedGame(3600), pacedGame(172800)]);
		const { target, instance } = mountFilter();
		const [live, asyncChip] = paceChips(target);

		live.click();
		flushSync();
		asyncChip.click();
		flushSync();
		expect(get(harPace)).toBe("async");
		expect(live.getAttribute("aria-pressed")).toBe("false");
		expect(asyncChip.getAttribute("aria-pressed")).toBe("true");
		unmount(instance);
	});

	// The regression: with an active pace filter the lobby's GameList binds back
	// only same-pace games — before the fix the chips derived from that filtered
	// list and vanished, stranding the user. The parent now anchors visibility to
	// the last unfiltered list, which the harness's harGames stands in for.
	it("stays visible while the pace filter is active (anchored to the unfiltered set)", () => {
		harGames.set([pacedGame(3600), pacedGame(172800)]);
		const { target, instance } = mountFilter();
		const [live] = paceChips(target);

		live.click();
		flushSync();
		expect(get(harPace)).toBe("live");
		expect(paceChips(target)).toHaveLength(2);
		unmount(instance);
	});

	it("stays visible when the unfiltered set still has both paces but the filtered list is empty", () => {
		// hasPaceChoice is derived from the games the parent passes (the unfiltered
		// set) — an empty FILTERED list never reaches the component, so a lobby
		// whose filter matches nothing keeps its chips.
		harGames.set([pacedGame(3600), pacedGame(172800)]);
		const { target, instance } = mountFilter();

		harPace.set("async");
		flushSync();
		expect(paceChips(target).map((c) => c.getAttribute("aria-pressed"))).toEqual(["false", "true"]);
		unmount(instance);
	});

	it("hides the pace chips when the unfiltered lobby is all one pace", () => {
		harGames.set([pacedGame(3600), pacedGame(7200)]);
		const { target, instance } = mountFilter();

		expect(paceChips(target)).toHaveLength(0);
		unmount(instance);
	});
});

describe("SetupOptionsFilter option-group chips", () => {
	beforeEach(() => {
		document.body.innerHTML = "";
		harGames.set([]);
		harPace.set("");
		harInfo.set(undefined);
	});

	function optionChips(target: HTMLElement): HTMLButtonElement[] {
		return [...target.querySelectorAll<HTMLButtonElement>('[role="group"][aria-label="Filter by Map layout"] button')];
	}

	it("renders no 'All' chip in an option group", () => {
		harInfo.set(info([layoutOption]));
		harGames.set([game({ layout: "xshape" }), game({ layout: "standard" })]);
		const { target, instance } = mountFilter();

		expect(optionChips(target).map((c) => c.textContent?.trim())).toEqual(["Standard", "X shape"]);
		unmount(instance);
	});

	it("clicking the selected option chip clears that group's filter", () => {
		harInfo.set(info([layoutOption]));
		harGames.set([game({ layout: "xshape" }), game({ layout: "standard" })]);
		const { target, instance } = mountFilter();
		const [standard, xshape] = optionChips(target);

		xshape.click();
		flushSync();
		expect(xshape.getAttribute("aria-pressed")).toBe("true");
		expect(standard.getAttribute("aria-pressed")).toBe("false");

		xshape.click();
		flushSync();
		expect(xshape.getAttribute("aria-pressed")).toBe("false");
		expect(standard.getAttribute("aria-pressed")).toBe("false");
		unmount(instance);
	});
});
