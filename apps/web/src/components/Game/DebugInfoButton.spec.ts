// Tests for the "copy debug info" FAB. The button is a pure relay: it emits
// `requestDebugInfo` on the game-context emitter (StartedGame forwards it to the
// game iframe), waits for the viewer's `debugInfo` answer — the payload shape is
// entirely the viewer's choice — and copies it to the clipboard. A viewer that
// doesn't implement the protocol never answers, and the FAB degrades to a
// "not supported" toast after a timeout.
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
import { DEBUG_INFO_MESSAGE, DEBUG_INFO_REQUEST } from "@/lib/debug-info";
import { toasts } from "@/lib/notifications.svelte";
import { developerSettings } from "@/lib/stores.svelte";
import type { GameContext } from "@/routes/game/[gameId]/game-context";
import DebugInfoButton from "./DebugInfoButton.svelte";

// Whatever the game's viewer decides to send — the parent relays it verbatim.
const VIEWER_DEBUG_INFO = {
	game: "gaia-project",
	round: 2,
	players: [{ faction: "terrans" }, { faction: "xenos" }],
	custom: { anything: ["goes", 1] },
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
		// The FAB is gated on developer settings — off by default.
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

	it("requests debug info and copies the viewer's answer to the clipboard", async () => {
		developerSettings.set(true);
		flushSync();

		const requested = new Promise<void>((resolve) => {
			emitter.on(DEBUG_INFO_REQUEST, () => {
				resolve();
				// The viewer answers with its own payload.
				emitter.emit(DEBUG_INFO_MESSAGE, VIEWER_DEBUG_INFO);
			});
		});

		click();
		await requested;
		await vi.waitFor(() => expect(writeText).toHaveBeenCalledTimes(1));

		const written = writeText.mock.calls[0][0];
		expect(JSON.parse(written)).toEqual(VIEWER_DEBUG_INFO);
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
		emitter.on(DEBUG_INFO_REQUEST, () => emitter.emit(DEBUG_INFO_MESSAGE, VIEWER_DEBUG_INFO));

		click();
		if (browser) {
			await vi.waitFor(() => expect(get(toasts).some((t) => t.kind === "alert")).toBe(true));
		} else {
			// Default run: the failure path must at least settle (and never write).
			await vi.waitFor(() => expect(writeText).toHaveBeenCalledTimes(1));
		}
	});

	it("tells the user when the viewer doesn't support debug info (timeout)", async () => {
		developerSettings.set(true);
		flushSync();
		vi.useFakeTimers();
		click();
		await vi.advanceTimersByTimeAsync(4000);
		if (browser) {
			expect(get(toasts).some((t) => t.kind === "info" && t.text.includes("doesn't support"))).toBe(true);
		}
		expect(writeText).not.toHaveBeenCalled();
	});
});
