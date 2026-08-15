// Protocol test for the viewer↔game debug-info relay: an emitter `requestDebugInfo`
// (from the DebugInfoButton FAB) must be forwarded to the game iframe, and a
// `debugInfo` window message from the viewer must be routed back onto the
// game-context emitter for the waiting FAB. The parent never assembles a payload
// itself — the viewer owns it.
import { flushSync, mount, unmount } from "svelte";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// `$app/state` / `$app/navigation` resolve to the stubs in src/lib/__mocks__ via the
// vitest.config.ts aliases (vi.mock can't intercept imports inside .svelte files).
vi.mock("@/lib/api", () => ({ get: vi.fn(), post: vi.fn() }));
// Loading's Spinner crashes on mount in this jsdom env (same class of issue as the
// icon stub); it isn't what this spec exercises.
vi.mock("@/modules/cdk", async () => ({
	Loading: (await import("@/lib/__mocks__/LoadingStub.svelte")).default,
}));

// jsdom has no matchMedia, which @/lib/theme reads at module scope in the
// browser-flavored (SANITIZE_TEST_BROWSER=1) run. Hoisted so the stub is installed
// before the spec's imports (and their transitive theme import) evaluate.
vi.hoisted(() => {
	const matchMedia = (query: string) => ({
		matches: false,
		media: query,
		addEventListener() {},
		removeEventListener() {},
		addListener() {},
		removeListener() {},
	});
	(globalThis as any).matchMedia = matchMedia;
	if (typeof window !== "undefined") {
		(window as any).matchMedia = matchMedia;
	}
});

import EventEmitter from "eventemitter3";
import { DEBUG_INFO_MESSAGE, DEBUG_INFO_REQUEST } from "@/lib/debug-info";
import type { GameContext } from "@/routes/game/[gameId]/game-context";
import StartedGame from "./StartedGame.svelte";

const GAME_ID = "game-1";

function makeContext(emitter: EventEmitter): GameContext {
	return {
		game: {
			_id: GAME_ID,
			game: { name: "gaia-project", version: 3 },
			status: "active",
			players: [],
			data: { round: 2 },
		},
		players: [],
		gameInfo: {
			_id: { game: "gaia-project", version: 3 },
			preferences: [],
		},
		settings: null,
		viewerUserId: null,
		replayData: null,
		emitter,
		log: ["p1 builds a mine"],
	} as unknown as GameContext;
}

describe("StartedGame debug-info relay", () => {
	let emitter: EventEmitter;
	let target: HTMLDivElement;
	let instance: Record<string, unknown> | undefined;
	let postMessage: ReturnType<typeof vi.fn>;

	beforeEach(() => {
		emitter = new EventEmitter();
		target = document.createElement("div");
		document.body.appendChild(target);
		instance = mount(StartedGame as never, {
			target,
			props: {},
			context: new Map([["game", makeContext(emitter)]]),
		}) as Record<string, unknown>;
		flushSync();
		postMessage = vi.fn();
		const iframe = target.querySelector("iframe")!;
		Object.defineProperty(iframe, "contentWindow", { value: { postMessage }, configurable: true });
	});

	afterEach(() => {
		if (instance) {
			unmount(instance as never);
			instance = undefined;
		}
		target.remove();
	});

	it("forwards an emitter `requestDebugInfo` (FAB click) to the game iframe", () => {
		emitter.emit(DEBUG_INFO_REQUEST);
		expect(postMessage).toHaveBeenCalledWith({ type: DEBUG_INFO_REQUEST }, "*");
	});

	it("routes a viewer `debugInfo` window message to the emitter, payload untouched", async () => {
		const received = new Promise<unknown>((resolve) => emitter.once(DEBUG_INFO_MESSAGE, resolve));
		const payload = { whatever: "the viewer wants", nested: { list: [1, 2] } };

		window.dispatchEvent(new window.MessageEvent("message", { data: { type: DEBUG_INFO_MESSAGE, data: payload } }));

		await expect(received).resolves.toEqual(payload);
		// The parent must not post any payload of its own back to the viewer.
		expect(postMessage.mock.calls.filter(([msg]) => msg?.type === DEBUG_INFO_MESSAGE)).toHaveLength(0);
	});
});
