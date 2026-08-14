// Regression test for the #290 recursion: the ws push following the viewer's own
// move, and the viewer's echo `fetchState`, must not make the host refetch or re-post
// `state` — while a real status transition (cancel/end) must refresh `context.game`
// live. Mounts the real StartedGame in jsdom with a fake game context.
import { flushSync, mount, unmount } from "svelte";
import type { Writable } from "svelte/store";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/api", () => ({ post: vi.fn(), get: vi.fn() }));
vi.mock("@/utils", async () => {
	const actual = await vi.importActual<typeof import("@/utils")>("@/utils");
	return { ...actual, confirm: vi.fn(() => Promise.resolve(true)) };
});
vi.mock("@/modules/cdk", async () => {
	const actual = await vi.importActual<typeof import("@/modules/cdk")>("@/modules/cdk");
	return {
		...actual,
		Loading: (await import("@/lib/__mocks__/LoadingStub.svelte")).default,
	};
});
vi.mock("@/lib/stores.svelte", async () => {
	const { writable } = await import("svelte/store");
	return {
		account: writable(null),
		playerStatus: writable([]),
		activeGames: writable([]),
		devGameSettings: writable({}),
		developerSettings: writable(false),
		currentGameId: writable(null),
		lastGameUpdate: writable(new Date(0)),
		addActiveGame: vi.fn(),
		removeActiveGame: vi.fn(),
		live: <T>(storeValue: T, ssrSnapshot: T) => storeValue ?? ssrSnapshot,
		clientWritable: <T>(_name: string, initial: T) => writable(initial),
		assertBrowserStore: () => {},
	};
});

import { get, post } from "@/lib/api";
import { lastGameUpdate } from "@/lib/stores.svelte";
import type { GameContext } from "@/routes/game/[gameId]/game-context";
import StartedGame from "./StartedGame.svelte";

const postMock = vi.mocked(post);
const getMock = vi.mocked(get);
const lastGameUpdateStore = lastGameUpdate as unknown as Writable<Date>;

let posted: { type: string; state?: unknown }[];
let iframe: HTMLIFrameElement;

function makeGame(updatedAt: Date, over: Partial<Record<string, unknown>> = {}) {
	return {
		_id: "g1",
		status: "active",
		cancelled: false,
		players: [
			{ _id: "me", name: "myself", remainingTime: 3600 },
			{ _id: "other", name: "opponent", remainingTime: 3600 },
		],
		currentPlayers: [{ _id: "other", timerStart: new Date().toISOString() }],
		createdAt: new Date(updatedAt.getTime() - 3600_000).toISOString(),
		updatedAt: updatedAt.toISOString(),
		data: { round: 1 },
		game: { name: "test", version: 1, options: {} },
		options: {
			setup: { nbPlayers: 2 },
			timing: { timer: { start: 0, end: 0 }, timePerGame: 86400, timePerMove: 3600 },
		},
		...over,
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

async function receiveFromViewer(type: string, data: Record<string, unknown> = {}) {
	window.dispatchEvent(new window.MessageEvent("message", { data: { type, ...data } }));
	await flushMicrotasks();
}

describe("StartedGame live updates", () => {
	beforeEach(() => {
		postMock.mockReset();
		getMock.mockReset();
		// Always resolve (even without a per-test mockResolvedValue): the watcher can
		// fire one last time after unmount, when the shared lastGameUpdate store resets.
		getMock.mockResolvedValue(makeGame(new Date(0)) as never);
		posted = [];
		document.body.innerHTML = "";
	});

	function mountGame(game: unknown) {
		const context = $state(makeContext(game));
		const target = document.createElement("div");
		document.body.appendChild(target);

		const instance = mount(StartedGame as never, {
			target,
			props: {},
			context: new Map([["game", context]]),
		}) as Record<string, unknown>;
		flushSync();

		// jsdom gives iframes a real contentWindow, but it can't run the viewer; stub
		// postMessage to record everything the host posts to the iframe.
		iframe = target.querySelector("iframe")!;
		Object.defineProperty(iframe, "contentWindow", {
			configurable: true,
			value: { postMessage: vi.fn((msg) => posted.push(msg)) },
		});

		return { context, target, instance };
	}

	it("does not loop when the ws push follows the viewer's own move", async () => {
		const t0 = new Date("2026-08-14T00:00:00Z");
		const t1 = new Date("2026-08-14T00:01:00Z");
		const { context, instance } = mountGame(makeGame(t0));

		// Viewer is up and has the initial state.
		await receiveFromViewer("gameReady");
		expect(posted.some((m) => m.type === "state")).toBe(true);

		// The viewer plays a move: the host posts it and stores the fresh state locally.
		postMock.mockResolvedValue({ game: makeGame(t1), log: { start: 0, data: [] } } as never);
		await receiveFromViewer("gameMove", { move: "move pass" });
		expect(posted.some((m) => m.type === "gameLog")).toBe(true);
		expect(new Date((context.game as { updatedAt: string }).updatedAt).getTime()).toBe(t1.getTime());

		// Let effects triggered by the `context.game` assignment settle before the reset.
		await flushMicrotasks();
		posted = [];
		getMock.mockClear();

		lastGameUpdateStore.set(t1);
		await flushMicrotasks();
		expect(posted.some((m) => m.type === "state:updated")).toBe(true);
		// …but the host must NOT refetch nor re-post `state`: the push carries exactly
		// the timestamp we already hold (the iframe made the move and has the state).
		expect(posted.some((m) => m.type === "state")).toBe(false);
		expect(getMock).not.toHaveBeenCalled();

		// The refetch (if any) settled without touching context.game…
		expect(new Date((context.game as { updatedAt: string }).updatedAt).getTime()).toBe(t1.getTime());

		// Cycle breaker: the viewer asks for the state it already owns (it made the
		// move); re-serving it fed the recursion.
		getMock.mockClear();
		await receiveFromViewer("fetchState");
		expect(getMock).not.toHaveBeenCalled();
		expect(posted.some((m) => m.type === "state")).toBe(false);

		unmount(instance as never);
	});

	it("propagates a cancel/end to the app-level game live (sidebar, og:title)", async () => {
		const t0 = new Date("2026-08-14T00:00:00Z");
		const t1 = new Date("2026-08-14T00:05:00Z");
		const t2 = new Date("2026-08-14T00:06:00Z");
		const { context, instance } = mountGame(makeGame(t0));

		await receiveFromViewer("gameReady");
		await flushMicrotasks();
		posted = [];
		getMock.mockClear();

		// Another player's move lands: the push is strictly newer than our state, so the
		// host refetches — no status change, so context.game stays put (no clobber).
		getMock.mockResolvedValue(makeGame(t1) as never);
		lastGameUpdateStore.set(t1);
		await flushMicrotasks();
		expect(getMock).toHaveBeenCalledWith(`/gameplay/g1`);
		expect(new Date((context.game as { updatedAt: string }).updatedAt).getTime()).toBe(t0.getTime());

		// The game then gets cancelled (all votes landed): the next push carries its
		// updatedAt, and the refetch sees the status/cancelled transition.
		getMock.mockClear();
		getMock.mockResolvedValue(makeGame(t2, { cancelled: true }) as never);
		lastGameUpdateStore.set(t2);
		await flushMicrotasks();

		expect(getMock).toHaveBeenCalledWith(`/gameplay/g1`);
		expect((context.game as { cancelled?: boolean }).cancelled).toBe(true);
		// The iframe only gets the cheap `state:updated` ping — never a `state` post,
		// so there is nothing for the viewer to answer with `fetchState`.
		expect(posted.some((m) => m.type === "state:updated")).toBe(true);
		expect(posted.some((m) => m.type === "state")).toBe(false);

		unmount(instance as never);
	});

	it("keeps serving fetchState for genuinely external updates", async () => {
		const t0 = new Date("2026-08-14T00:00:00Z");
		const t1 = new Date("2026-08-14T00:02:00Z");
		const { instance } = mountGame(makeGame(t0));

		await receiveFromViewer("gameReady");
		posted = [];

		// No self-move happened, so a fetchState means the iframe is behind (external
		// move, remount): serve the fresh state as before.
		getMock.mockResolvedValue(makeGame(t1) as never);
		await receiveFromViewer("fetchState");
		expect(getMock).toHaveBeenCalledWith(`/gameplay/g1`);
		expect(posted.some((m) => m.type === "state")).toBe(true);

		unmount(instance as never);
	});

	it("does not refetch or clobber the iframe state during a live replay", async () => {
		const t0 = new Date("2026-08-14T00:00:00Z");
		const t1 = new Date("2026-08-14T00:03:00Z");
		const { context, instance } = mountGame(makeGame(t0));

		await receiveFromViewer("gameReady");
		context.replayData = { start: 0, end: 10, current: 5 };
		// Let effects triggered by the replayData assignment settle before the reset.
		await flushMicrotasks();
		posted = [];
		getMock.mockReset();

		getMock.mockResolvedValue(makeGame(t1, { cancelled: true }) as never);
		lastGameUpdateStore.set(t1);
		await flushMicrotasks();

		expect(getMock).not.toHaveBeenCalled();
		expect((context.game as { cancelled?: boolean }).cancelled).toBe(false);

		unmount(instance as never);
	});
});
