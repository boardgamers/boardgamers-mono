// Regression test for the each_key_duplicate crash (#150 keyed the game log by
// line content: `{#each log as item (item)}`). Game logs legitimately contain
// duplicate lines (two players making the same move, repeated "passed", ...), so
// Svelte 5 threw `each_key_duplicate` and the component crashed. The block is now
// keyed by index, which is always unique for this append-only list.
//
// Mounts the real GameLog (jsdom env, svelte client build — see vitest.config.ts)
// with a fake "game" context holding a log full of duplicate lines, and asserts it
// renders every line without throwing.
import { flushSync, mount, unmount } from "svelte";
import { describe, expect, it } from "vitest";

import type { GameContext } from "@/routes/game/[gameId]/game-context";
import GameLog from "./GameLog.svelte";

const DUP_LOG = [
	"player1 moves from A1 to B2",
	"player2 moves from A1 to B2", // different player, identical line
	"player1 passed",
	"player2 passed",
	"player1 passed", // exact repeat
	"player2 moves from A1 to B2", // exact repeat
];

function makeContext(log: string[]): GameContext {
	return {
		game: null,
		players: [],
		gameInfo: null,
		replayData: null,
		// GameLog never subscribes to the emitter; a stub satisfies the type.
		emitter: { on() {}, off() {}, emit() {} } as unknown as GameContext["emitter"],
		log,
	};
}

describe("GameLog each-block keys", () => {
	it("renders a log with duplicate lines without each_key_duplicate", () => {
		const target = document.createElement("div");
		document.body.appendChild(target);

		let instance: Record<string, unknown> | undefined;
		expect(() => {
			instance = mount(GameLog as never, {
				target,
				props: {},
				context: new Map([["game", makeContext(DUP_LOG)]]),
			}) as Record<string, unknown>;
			flushSync();
		}).not.toThrow();

		// Reveal the log (collapsed by default unless localStorage "show-log" is set).
		target.querySelector("button")?.dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
		flushSync();

		const lines = [...target.querySelectorAll(".log > div")].map((d) => d.textContent ?? "");
		expect(lines).toHaveLength(DUP_LOG.length);

		if (instance) {
			unmount(instance as never);
		}
	});
});
