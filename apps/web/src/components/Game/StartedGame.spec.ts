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

import { browser } from "$app/environment";
import EventEmitter from "eventemitter3";
import { updatePreference } from "@/lib/game-preferences.svelte";
import { developerSettings } from "@/lib/stores.svelte";
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

// The device-local developer-settings flag rides along on the preferences message as a
// transient `devMode: true` — never persisted, and absent (not false) when settings are off.
describe("StartedGame preferences posting", () => {
	let emitter: EventEmitter;
	let target: HTMLDivElement;
	let instance: Record<string, unknown> | undefined;
	let postMessage: ReturnType<typeof vi.fn>;

	function lastPreferences(): Record<string, unknown> {
		const calls = postMessage.mock.calls.filter(([msg]) => msg?.type === "preferences");
		expect(calls.length).toBeGreaterThan(0);
		return calls.at(-1)![0].preferences;
	}

	beforeEach(() => {
		developerSettings.set(false);
		emitter = new EventEmitter();
		target = document.createElement("div");
		document.body.appendChild(target);
		instance = mount(StartedGame as never, {
			target,
			props: {},
			context: new Map<string, unknown>([
				["game", makeContext(emitter)],
				// postPreferences is a no-op without prefs for the game; seed via the SSR context
				// fallback (the gamePreferences store is client-only and guarded in the SSR run).
				["gamePreferences", { "gaia-project": { preferences: { sound: true } } }],
			]),
		}) as Record<string, unknown>;
		flushSync();
		postMessage = vi.fn();
		const iframe = target.querySelector("iframe")!;
		Object.defineProperty(iframe, "contentWindow", { value: { postMessage }, configurable: true });
	});

	afterEach(() => {
		developerSettings.set(false);
		if (instance) {
			unmount(instance as never);
			instance = undefined;
		}
		target.remove();
	});

	it("omits devMode entirely when developer settings are off", () => {
		window.dispatchEvent(new window.MessageEvent("message", { data: { type: "gameReady" } }));
		expect("devMode" in lastPreferences()).toBe(false);
	});

	it("adds devMode: true when developer settings are on, and re-posts on toggle", () => {
		window.dispatchEvent(new window.MessageEvent("message", { data: { type: "gameReady" } }));
		expect("devMode" in lastPreferences()).toBe(false);

		developerSettings.set(true);
		flushSync();
		expect(lastPreferences().devMode).toBe(true);
	});

	// browser flavor only: updatePreference mutates gamePreferences, a client-only store whose
	// SSR guard throws in the default (browser: false) run.
	it.runIf(browser)("re-posts preferences into the running iframe when a sidebar preference changes", async () => {
		window.dispatchEvent(new window.MessageEvent("message", { data: { type: "gameReady" } }));
		expect("flatBuildings" in lastPreferences()).toBe(false);

		// The regression this guards: updatePreference used to mutate the per-game object in
		// place, so the component's derived chain never saw a new reference and the running
		// game only picked the change up after a full page refresh.
		await updatePreference("gaia-project", 1, "flatBuildings", true);
		flushSync();
		expect(lastPreferences().flatBuildings).toBe(true);

		await updatePreference("gaia-project", 1, "flatBuildings", false);
		flushSync();
		expect(lastPreferences().flatBuildings).toBe(false);
	});
});
