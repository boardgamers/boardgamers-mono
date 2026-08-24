// The sidebar links to the game's `<game>:rules` CMS page (/page/<game>/rules) when the
// game page's load found one (context.rulesPage), and shows nothing otherwise. Mounts
// the real GameSidebar in jsdom with a fake game context (same harness as
// GameSidebar/GameLog.spec.ts).
import { flushSync, mount, unmount } from "svelte";
import { describe, expect, it } from "vitest";

import type { GameContext } from "@/routes/game/[gameId]/game-context";
import GameSidebar from "./GameSidebar.svelte";

function makeGame() {
	return {
		_id: "g1",
		status: "active",
		players: [{ _id: "p1", name: "player1", remainingTime: 3600 }],
		currentPlayers: [],
		game: { name: "powergrid", version: 1, options: {} },
		options: {
			setup: { nbPlayers: 2 },
			timing: { timer: { start: 0, end: 0 }, timePerGame: 86400, timePerMove: 3600 },
		},
	} as never;
}

function makeContext(rulesPage: GameContext["rulesPage"]): GameContext {
	return {
		game: makeGame(),
		players: [],
		gameInfo: { _id: { game: "powergrid", version: 1 }, label: "Power Grid" } as never,
		settings: null,
		viewerUserId: null,
		rulesPage,
		replayData: null,
		emitter: { on() {}, off() {}, emit() {} } as unknown as GameContext["emitter"],
		log: [],
	};
}

function mountSidebar(rulesPage: GameContext["rulesPage"]) {
	const target = document.createElement("div");
	document.body.appendChild(target);
	const instance = mount(GameSidebar as never, {
		target,
		props: {},
		context: new Map([["game", makeContext(rulesPage)]]),
	}) as Record<string, unknown>;
	flushSync();
	return { target, instance };
}

describe("GameSidebar rules link", () => {
	it("links to /page/<game>/rules when the rules CMS page exists", () => {
		const { target, instance } = mountSidebar({ title: "Power Grid rules" });

		const link = target.querySelector<HTMLAnchorElement>('a[href="/page/powergrid/rules"]');
		expect(link).not.toBeNull();
		expect(link?.textContent).toContain("Rules");

		unmount(instance as never);
	});

	it("renders no rules link when the probe found no page", () => {
		const { target, instance } = mountSidebar(null);

		expect(target.querySelector('a[href="/page/powergrid/rules"]')).toBeNull();

		unmount(instance as never);
	});
});
