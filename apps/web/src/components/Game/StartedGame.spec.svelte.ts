// Live-update invariants (see #290/#292): refetch exactly when a push is strictly
// newer than our copy, adopt then ping the viewer, and only post `state` on request.
// Mounts the real StartedGame in jsdom with a fake game context.
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

import { goto } from "$app/navigation";
import { get, post } from "@/lib/api";
import { lastGameUpdate } from "@/lib/stores.svelte";
import type { GameContext } from "@/routes/game/[gameId]/game-context";
import StartedGame from "./StartedGame.svelte";

const postMock = vi.mocked(post);
const getMock = vi.mocked(get);
const gotoMock = vi.mocked(goto);
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

	it("ignores a push that only echoes what we already hold (own move, page-load echo)", async () => {
		const t0 = new Date("2026-08-14T00:00:00Z");
		const t1 = new Date("2026-08-14T00:01:00Z");
		const { context, instance } = mountGame(makeGame(t0));

		await receiveFromViewer("gameReady");
		expect(posted.some((m) => m.type === "state")).toBe(true);
		posted = [];

		// The ws layer re-sends the current updatedAt on subscribe: equal ⇒ no-op.
		lastGameUpdateStore.set(t0);
		await flushMicrotasks();
		expect(posted).toEqual([]);
		expect(getMock).not.toHaveBeenCalled();

		// The viewer plays a move: the response carries the *stored* updatedAt (and no
		// `data` — the route omits it), so the ws echo of the move compares equal.
		postMock.mockResolvedValue({ game: makeGame(t1, { data: undefined }), log: { start: 0, data: [] } } as never);
		await receiveFromViewer("gameMove", { move: "move pass" });
		expect(posted.some((m) => m.type === "gameLog")).toBe(true);
		expect(new Date((context.game as { updatedAt: string }).updatedAt).getTime()).toBe(t1.getTime());
		await flushMicrotasks();
		posted = [];
		getMock.mockClear();

		lastGameUpdateStore.set(t1);
		await flushMicrotasks();
		// No ping, no refetch, no `state` post: the iframe made the move and has the state.
		expect(posted).toEqual([]);
		expect(getMock).not.toHaveBeenCalled();

		unmount(instance as never);
	});

	it("refetches once on a strictly-newer push, adopts the fresh game, then pings the viewer", async () => {
		const t0 = new Date("2026-08-14T00:00:00Z");
		const t1 = new Date("2026-08-14T00:05:00Z");
		const { context, instance } = mountGame(makeGame(t0));

		await receiveFromViewer("gameReady");
		await flushMicrotasks();
		posted = [];
		getMock.mockClear();

		// Another player's move lands.
		getMock.mockResolvedValue(makeGame(t1, { data: { round: 2 } }) as never);
		lastGameUpdateStore.set(t1);
		await flushMicrotasks();

		// Exactly one refetch (adopting the fresh doc must not re-trigger the watcher),
		// the app-level game advances, and the viewer only gets the cheap ping — never
		// an unprompted `state` post. (Adoption may also re-post player/avatar info.)
		expect(getMock).toHaveBeenCalledTimes(1);
		expect(getMock).toHaveBeenCalledWith(`/gameplay/g1`);
		expect(new Date((context.game as { updatedAt: string }).updatedAt).getTime()).toBe(t1.getTime());
		expect(posted.filter((m) => m.type === "state:updated")).toHaveLength(1);
		expect(posted.some((m) => m.type === "state")).toBe(false);

		// The viewer answers the ping with fetchState: served from the already-fresh
		// context.game, without another round-trip.
		getMock.mockClear();
		await receiveFromViewer("fetchState");
		expect(getMock).not.toHaveBeenCalled();
		const statePost = posted.find((m) => m.type === "state");
		expect(statePost?.state).toEqual({ round: 2 });

		unmount(instance as never);
	});

	it("propagates a cancel/end to the app-level game live (sidebar, og:title)", async () => {
		const t0 = new Date("2026-08-14T00:00:00Z");
		const t1 = new Date("2026-08-14T00:06:00Z");
		const { context, instance } = mountGame(makeGame(t0));

		await receiveFromViewer("gameReady");
		await flushMicrotasks();
		posted = [];
		getMock.mockClear();

		// All cancel votes landed: the push carries the cancel's updatedAt.
		getMock.mockResolvedValue(makeGame(t1, { cancelled: true, status: "ended" }) as never);
		lastGameUpdateStore.set(t1);
		await flushMicrotasks();

		expect((context.game as { cancelled?: boolean }).cancelled).toBe(true);
		expect(posted.some((m) => m.type === "state:updated")).toBe(true);
		expect(posted.some((m) => m.type === "state")).toBe(false);

		unmount(instance as never);
	});

	it("refetches before serving fetchState when our copy has no data (own move stripped it)", async () => {
		const t0 = new Date("2026-08-14T00:00:00Z");
		const t1 = new Date("2026-08-14T00:02:00Z");
		const { instance } = mountGame(makeGame(t0));

		await receiveFromViewer("gameReady");
		postMock.mockResolvedValue({ game: makeGame(t1, { data: undefined }), log: { start: 0, data: [] } } as never);
		await receiveFromViewer("gameMove", { move: "move pass" });
		await flushMicrotasks();
		posted = [];
		getMock.mockClear();

		// e.g. a replay:end resync right after our own move.
		getMock.mockResolvedValue(makeGame(t1, { data: { round: 3 } }) as never);
		await receiveFromViewer("fetchState");
		expect(getMock).toHaveBeenCalledWith(`/gameplay/g1`);
		const statePost = posted.find((m) => m.type === "state");
		expect(statePost?.state).toEqual({ round: 3 });

		unmount(instance as never);
	});

	it("keeps the app-level game fresh during a replay without posting state to the iframe", async () => {
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

		// The refetch only touches context.game — nothing is posted that could clobber
		// the replay (the viewer ignores `state:updated` pings while replaying).
		expect((context.game as { cancelled?: boolean }).cancelled).toBe(true);
		expect(posted.some((m) => m.type === "state")).toBe(false);

		unmount(instance as never);
	});
});

// The viewer uplink contract (viewer-api.md "player:clicked") is { index: number },
// relayed verbatim by the iframe shim as event.data.player; legacy viewers sent
// { name }. Reading .name off a conforming payload used to hand `undefined` to
// resolve(), which throws "Missing parameter 'username'".
describe("StartedGame playerClick", () => {
	beforeEach(() => {
		postMock.mockReset();
		getMock.mockReset();
		getMock.mockResolvedValue(makeGame(new Date(0)) as never);
		gotoMock.mockClear();
		posted = [];
		document.body.innerHTML = "";
	});

	it("navigates to the seat's profile from a conforming { index } payload", async () => {
		const { instance } = mountGame(makeGame(new Date(0)));

		await receiveFromViewer("playerClick", { player: { index: 1 } });
		expect(gotoMock).toHaveBeenCalledWith("/(app)/user/opponent");

		unmount(instance as never);
	});

	it("still honors a legacy { name } payload", async () => {
		const { instance } = mountGame(makeGame(new Date(0)));

		await receiveFromViewer("playerClick", { player: { name: "someone" } });
		expect(gotoMock).toHaveBeenCalledWith("/(app)/user/someone");

		unmount(instance as never);
	});

	it("does nothing when no username can be resolved", async () => {
		const { instance } = mountGame(makeGame(new Date(0)));

		await receiveFromViewer("playerClick", { player: { index: 99 } });
		await receiveFromViewer("playerClick", {});
		expect(gotoMock).not.toHaveBeenCalled();

		unmount(instance as never);
	});
});
