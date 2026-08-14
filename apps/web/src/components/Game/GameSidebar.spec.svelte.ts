// Regression test: after a successful "vote to cancel" POST, the button must
// immediately render disabled — the cancel route answers 204 (no body), so before
// the fix the local `players[me].voteCancel` was never set and the button stayed
// enabled until a websocket push happened to refresh the game (or a reload).
//
// Mounts the real GameSidebar (jsdom env, svelte client build — see vitest.config.ts)
// with a fake "game" context holding an active 2-player game, mocks `post` to succeed
// and `confirm` to auto-accept, clicks the button, and asserts the disabled state.
import { flushSync, mount, unmount } from "svelte";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/api", () => ({ post: vi.fn(), get: vi.fn() }));
vi.mock("@/utils", async () => {
	const actual = await vi.importActual<typeof import("@/utils")>("@/utils");
	return { ...actual, confirm: vi.fn(() => Promise.resolve(true)) };
});
// The real icon and Badge crash when mounted in this jsdom env (leaf `$props()`
// rest-spread issue — see the stubs' comments); they aren't what this spec exercises.
vi.mock("@/components/icons/IconClockHistory.svelte", async () => ({
	default: (await import("@/lib/__mocks__/IconStub.svelte")).default,
}));
vi.mock("@/modules/cdk", async () => {
	const actual = await vi.importActual<typeof import("@/modules/cdk")>("@/modules/cdk");
	return {
		...actual,
		Badge: (await import("@/lib/__mocks__/BadgeStub.svelte")).default,
		Button: (await import("@/lib/__mocks__/ButtonStub.svelte")).default,
	};
});
vi.mock("@/components/User/UsernameLink.svelte", async () => ({
	default: (await import("@/lib/__mocks__/UsernameLinkStub.svelte")).default,
}));
// vitest.setup.ts mocks $app/environment with browser:false, which makes the real
// clientWritable stores throw on mutation — GameSidebar's onGameChanged effect calls
// removeActiveGame. A light stand-in keeps the spec focused on the vote flow.
vi.mock("@/lib/stores.svelte", async () => {
	const { writable } = await import("svelte/store");
	return {
		account: writable(null),
		playerStatus: writable([]),
		activeGames: writable([]),
		devGameSettings: writable({}),
		// Read by reportError (via handleError) on the failed-vote path.
		currentGameId: writable(null),
		lastGameUpdate: writable(new Date(0)),
		addActiveGame: vi.fn(),
		removeActiveGame: vi.fn(),
		live: <T>(storeValue: T, ssrSnapshot: T) => storeValue ?? ssrSnapshot,
		// Other imports (game-preferences.svelte.ts) build their own stores from these.
		clientWritable: <T>(_name: string, initial: T) => writable(initial),
		assertBrowserStore: () => {},
	};
});

import { post } from "@/lib/api";
import type { GameContext } from "@/routes/game/[gameId]/game-context";
import GameSidebar from "./GameSidebar.svelte";

// The vote handler mutates `context.game.players[me].voteCancel` in place — that only
// re-renders if the game object is a `$state` proxy, as it is in the real layout
// (`+layout.svelte` wraps the context in `$state`). `.svelte.ts` so `$state` works here.
function reactiveContext(game: unknown): GameContext {
	const context = $state(makeContext(game));
	return context;
}

const postMock = vi.mocked(post);

function makeGame() {
	return {
		_id: "g1",
		status: "active",
		cancelled: false,
		players: [
			{ _id: "me", name: "myself", remainingTime: 3600 },
			{ _id: "other", name: "opponent", remainingTime: 3600 },
		],
		currentPlayers: [{ _id: "other", timerStart: new Date().toISOString() }],
		createdAt: new Date().toISOString(),
		updatedAt: new Date().toISOString(),
		game: { name: "test", version: 1, options: {} },
		options: {
			setup: { nbPlayers: 2 },
			timing: { timer: { start: 0, end: 0 }, timePerGame: 86400, timePerMove: 3600 },
		},
	} as never;
}

function makeContext(game: unknown): GameContext {
	return {
		game,
		players: [],
		gameInfo: {
			_id: { game: "test", version: 1 },
			label: "Test game",
			viewer: {},
			engines: [],
			preferences: [],
			alternateOptions: [],
			options: [],
		},
		settings: null,
		viewerUserId: "me",
		replayData: null,
		emitter: { on() {}, off() {}, emit() {} } as unknown as GameContext["emitter"],
		log: [],
	} as never;
}

async function flushMicrotasks() {
	for (let i = 0; i < 10; i++) {
		await Promise.resolve();
	}
	flushSync();
}

describe("GameSidebar vote-to-cancel", () => {
	beforeEach(() => {
		postMock.mockReset();
		postMock.mockResolvedValue(undefined as never);
		document.body.innerHTML = "";
	});

	it("disables the button right after a successful vote (no reload)", async () => {
		const game = makeGame();
		const context = reactiveContext(game);
		const target = document.createElement("div");
		document.body.appendChild(target);

		const instance = mount(GameSidebar as never, {
			target,
			props: {},
			context: new Map([["game", context]]),
		}) as Record<string, unknown>;
		flushSync();

		const button = () => [...target.querySelectorAll("button")].find((b) => b.textContent?.trim() === "Vote to cancel");
		expect(button(), "vote-to-cancel button renders").toBeTruthy();
		expect(button()!.disabled).toBe(false);

		button()!.dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
		await flushMicrotasks();

		expect(postMock).toHaveBeenCalledWith("/game/g1/cancel");
		expect((context.game as { players: { voteCancel?: boolean }[] }).players[0].voteCancel).toBe(true);
		expect(button()!.disabled, "button disabled right after the vote").toBe(true);

		unmount(instance as never);
	});

	it("keeps the button enabled when the vote POST fails", async () => {
		postMock.mockRejectedValue(new Error("boom") as never);
		const game = makeGame();
		const context = reactiveContext(game);
		const target = document.createElement("div");
		document.body.appendChild(target);

		const instance = mount(GameSidebar as never, {
			target,
			props: {},
			context: new Map([["game", context]]),
		}) as Record<string, unknown>;
		flushSync();

		const button = () => [...target.querySelectorAll("button")].find((b) => b.textContent?.trim() === "Vote to cancel");
		button()!.dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
		await flushMicrotasks();

		expect((context.game as { players: { voteCancel?: boolean }[] }).players[0].voteCancel).toBeUndefined();
		expect(button()!.disabled).toBe(false);

		unmount(instance as never);
	});
});
