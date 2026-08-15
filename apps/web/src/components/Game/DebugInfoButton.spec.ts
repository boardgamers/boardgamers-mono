// Tests for the "copy debug info" FAB. The button itself only brokers the request:
// it emits `requestDebugInfo` on the game-context emitter (StartedGame answers with
// the assembled snapshot, since it owns the player index / preferences / viewer URL),
// then copies the result to the clipboard.
import { flushSync, mount, unmount } from "svelte";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// The real icon crashes when mounted with empty props in this jsdom env (see the
// stub's comment); it isn't what this spec exercises.
vi.mock("@/components/icons/IconBug.svelte", async () => ({
	default: (await import("@/lib/__mocks__/IconStub.svelte")).default,
}));
// The CDK Button crashes on mount in this jsdom env too; stub it with a plain button.
vi.mock("@/modules/cdk", async () => ({
	Button: (await import("@/lib/__mocks__/ButtonStub.svelte")).default,
}));

import EventEmitter from "eventemitter3";
import { get } from "svelte/store";
import { browser } from "$app/environment";
import { DEBUG_INFO_MESSAGE, DEBUG_INFO_REQUEST, type GameDebugInfo } from "@/lib/debug-info";
import { toasts } from "@/lib/notifications.svelte";
import { developerSettings } from "@/lib/stores.svelte";
import type { GameContext } from "@/routes/game/[gameId]/game-context";
import DebugInfoButton from "./DebugInfoButton.svelte";

const DEBUG_INFO: GameDebugInfo = {
	gameId: "game-1",
	gameName: "gaia-project",
	gameVersion: 3,
	gameStatus: "active",
	playerIndex: 0,
	preferences: { alternateUI: false },
	state: { round: 1 },
	log: ["p1 builds a mine"],
	replayData: undefined,
	viewerUrl: "/resources/game/gaia-project/3/iframe",
	release: "test",
	capturedAt: "2026-01-01T00:00:00.000Z",
};

function makeContext(emitter: EventEmitter): GameContext {
	return {
		game: null,
		players: [],
		gameInfo: null,
		settings: null,
		viewerUserId: null,
		replayData: null,
		emitter,
		log: [],
	};
}

describe("DebugInfoButton", () => {
	let emitter: EventEmitter;
	let target: HTMLDivElement;
	let instance: Record<string, unknown> | undefined;
	const writeText = vi.fn<(text: string) => Promise<void>>();

	beforeEach(() => {
		vi.useRealTimers();
		emitter = new EventEmitter();
		toasts.set([]);
		// The FAB is gated on developer settings (the snapshot embeds the full game
		// state, a cheat vector in hidden-information games) — off by default.
		developerSettings.set(false);
		writeText.mockReset().mockResolvedValue(undefined);
		vi.stubGlobal("navigator", { clipboard: { writeText } });
		target = document.createElement("div");
		document.body.appendChild(target);
		instance = mount(DebugInfoButton as never, {
			target,
			props: {},
			context: new Map([["game", makeContext(emitter)]]),
		}) as Record<string, unknown>;
		flushSync();
	});

	afterEach(() => {
		if (instance) {
			unmount(instance as never);
			instance = undefined;
		}
		target.remove();
		vi.unstubAllGlobals();
		vi.useRealTimers();
	});

	function click() {
		target.querySelector("button")!.dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
		flushSync();
	}

	it("only renders when developer settings are enabled", () => {
		expect(target.querySelector("button")).toBeNull();

		developerSettings.set(true);
		flushSync();
		expect(target.querySelector("button")).not.toBeNull();

		developerSettings.set(false);
		flushSync();
		expect(target.querySelector("button")).toBeNull();
	});

	it("requests debug info over the emitter and copies the answer to the clipboard", async () => {
		developerSettings.set(true);
		flushSync();

		const requested = new Promise<void>((resolve) => {
			emitter.on(DEBUG_INFO_REQUEST, () => {
				resolve();
				// StartedGame answers with the assembled snapshot.
				emitter.emit(DEBUG_INFO_MESSAGE, DEBUG_INFO);
			});
		});

		click();
		await requested;
		await vi.waitFor(() => expect(writeText).toHaveBeenCalledTimes(1));

		const written = writeText.mock.calls[0][0];
		expect(JSON.parse(written)).toEqual(JSON.parse(JSON.stringify(DEBUG_INFO)));
		expect(written).toContain("\n"); // pretty-printed
		// The success toast only fires in the browser-flavored run (notifier no-ops when
		// `$app/environment`.browser is false — the default run).
		if (browser) {
			await vi.waitFor(() => expect(get(toasts).some((t) => t.kind === "success")).toBe(true));
		}
	});

	it("shows an error toast when the clipboard write is rejected", async () => {
		developerSettings.set(true);
		flushSync();
		writeText.mockRejectedValue(new Error("clipboard permission denied"));
		emitter.on(DEBUG_INFO_REQUEST, () => emitter.emit(DEBUG_INFO_MESSAGE, DEBUG_INFO));

		click();
		if (browser) {
			await vi.waitFor(() => expect(get(toasts).some((t) => t.kind === "alert")).toBe(true));
		} else {
			// Default run: the failure path must at least settle (and never write).
			await vi.waitFor(() => expect(writeText).toHaveBeenCalledTimes(1));
		}
	});

	it("shows an error toast when no debug info answer comes back", async () => {
		developerSettings.set(true);
		flushSync();
		vi.useFakeTimers();
		click();
		await vi.advanceTimersByTimeAsync(5000);
		if (browser) {
			expect(get(toasts).some((t) => t.kind === "alert")).toBe(true);
		}
		expect(writeText).not.toHaveBeenCalled();
	});
});
