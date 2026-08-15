// Protocol test for the viewer↔game debug-info messages: when the viewer posts
// `requestDebugInfo` (or the game-context emitter receives it — the DebugInfoButton
// path), StartedGame must post a `debugInfo` message back to the iframe and emit the
// same snapshot on the emitter.
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
import { DEBUG_INFO_MESSAGE, DEBUG_INFO_REQUEST, type GameDebugInfo } from "@/lib/debug-info";
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

describe("StartedGame debug-info protocol", () => {
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

	function postedDebugInfos(): GameDebugInfo[] {
		return postMessage.mock.calls.filter(([msg]) => msg?.type === DEBUG_INFO_MESSAGE).map(([msg]) => msg.data);
	}

	it("answers a viewer `requestDebugInfo` window message with `debugInfo`", async () => {
		const emitted = new Promise<GameDebugInfo>((resolve) => emitter.once(DEBUG_INFO_MESSAGE, resolve));

		window.dispatchEvent(new window.MessageEvent("message", { data: { type: DEBUG_INFO_REQUEST } }));
		await vi.waitFor(() => expect(postedDebugInfos()).toHaveLength(1));

		const info = postedDebugInfos()[0];
		expect(info.gameId).toBe(GAME_ID);
		expect(info.gameName).toBe("gaia-project");
		expect(info.gameVersion).toBe(3);
		expect(info.gameStatus).toBe("active");
		expect(info.state).toEqual({ round: 2 });
		expect(info.log).toEqual(["p1 builds a mine"]);
		expect(info.release).toBe("test");
		expect(info.capturedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);

		// The same snapshot is emitted on the context emitter for the FAB.
		await expect(emitted).resolves.toEqual(info);
	});

	it("answers an emitter `requestDebugInfo` (DebugInfoButton path)", async () => {
		const emitted = new Promise<GameDebugInfo>((resolve) => emitter.once(DEBUG_INFO_MESSAGE, resolve));

		emitter.emit(DEBUG_INFO_REQUEST);
		await vi.waitFor(() => expect(postedDebugInfos()).toHaveLength(1));

		await expect(emitted).resolves.toMatchObject({ gameId: GAME_ID });
	});
});
