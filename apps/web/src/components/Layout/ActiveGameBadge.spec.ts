// Regression test for the navbar "active games" badge going stale.
//
// Bug: the badge derived `store.length > 0 ? store : page.data.activeGames`. When the
// websocket pushed an *empty* list after the user's last move (`games:currentTurn` with
// `games: []`), the `store.length > 0` guard rejected it and the badge fell back to the
// stale `page.data.activeGames` snapshot — so the count stayed at the old value until a
// full page refresh re-ran the server load.
//
// Fix: the store is the single source of truth — the layout seeds it once from SSR data
// (so SSR/first paint is correct, no flicker) and the websocket keeps it live. There is
// no `page.data` fallback that could shadow a live (empty) update.
//
// Mounts a minimal badge component (ActiveGameBadge.spec.svelte) that mirrors the Appbar
// derivation, seeds the store the way the layout does, then simulates the websocket push
// and asserts the badge clears without touching page.data.
import { flushSync, mount, unmount } from "svelte";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { activeGames } from "@/lib/stores.svelte";
import type { UserFront } from "@bgs/models";
import ActiveGameBadge from "./ActiveGameBadge.spec.svelte";

// The badge is client-only behaviour: `activeGames` is a clientWritable that throws on
// SSR mutation, and the test mutates it to simulate layout-seed + websocket pushes. So
// only run in the browser pass (`SANITIZE_TEST_BROWSER=1`, see vitest.setup.ts); the SSR
// pass has nothing to assert here.
const { browser } = await import("$app/environment");
const run = browser ? describe : describe.skip;

// Only the fields the component reads matter; the rest of UserFront is irrelevant here.
const user = { _id: "u1", account: { username: "admin" } } as unknown as UserFront;

run("ActiveGameBadge", () => {
	let target: HTMLDivElement;
	let instance: Record<string, unknown> | undefined;

	beforeEach(() => {
		target = document.createElement("div");
		document.body.appendChild(target);
	});

	afterEach(() => {
		if (instance) unmount(instance as never);
		instance = undefined;
		target.remove();
		activeGames.set([]);
	});

	function text(): string | null {
		return target.querySelector("#active-game-count")?.textContent ?? null;
	}

	it("seeds from SSR data, then clears live when the websocket pushes an empty list", () => {
		// Layout seed: SSR had 1 active game → store starts non-empty.
		activeGames.set(["game-1"]);
		instance = mount(ActiveGameBadge as never, { target, props: { user } }) as Record<string, unknown>;
		flushSync();
		expect(text()).toBe("1");

		// User makes their move → websocket pushes `games:currentTurn` with an empty list.
		// The badge must drop to 0 with no page refresh (previously stuck at "1").
		activeGames.set([]);
		flushSync();
		expect(text()).toBe("0");
	});

	it("increments live when a new game becomes the user's turn", () => {
		activeGames.set([]);
		instance = mount(ActiveGameBadge as never, { target, props: { user } }) as Record<string, unknown>;
		flushSync();
		expect(text()).toBe("0");

		activeGames.set(["game-9"]);
		flushSync();
		expect(text()).toBe("1");
	});

	it("hides the badge when logged out", () => {
		activeGames.set(["game-1"]);
		instance = mount(ActiveGameBadge as never, { target, props: { user: null } }) as Record<string, unknown>;
		flushSync();
		expect(text()).toBeNull();
	});
});
