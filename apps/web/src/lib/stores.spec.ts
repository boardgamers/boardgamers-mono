import { get } from "svelte/store";
import { beforeEach, describe, expect, it, vi } from "vitest";

// The seed helpers are browser-only (`if (!browser) return`). vitest.setup.ts mocks
// `$app/environment` with `browser: false` in the default run, so force the browser
// branch for this file — the seed-once behavior is precisely the client-side path.
vi.mock("$app/environment", () => ({ browser: true, dev: false, building: false, version: "test" }));

import {
	account,
	activeGames,
	applyLikedBoardgame,
	likedBoardgames,
	seedAccountFromSSR,
	seedActiveGamesFromSSR,
	seedLikedBoardgamesFromSSR,
	setAccount,
} from "./stores.svelte";

const userA = { _id: "user-a" } as never;
const userB = { _id: "user-b" } as never;

describe("SSR-seeded client stores (seed once per identity)", () => {
	beforeEach(() => {
		account.set(null);
		activeGames.set([]);
		// Reset the module-private seed guards by re-seeding to a known identity.
		seedAccountFromSSR(null);
		seedActiveGamesFromSSR([], null);
	});

	describe("seedAccountFromSSR", () => {
		it("seeds from the first snapshot", () => {
			seedAccountFromSSR(userA);
			expect(get(account)).toBe(userA);
		});

		it("does not clobber locally-mutated state on a same-identity revalidation", () => {
			seedAccountFromSSR(userA);
			const updated = { _id: "user-a", settings: { home: { forgottenGames: ["x"] } } } as never;
			account.set(updated); // live client update (e.g. a settings write)
			seedAccountFromSSR(userA); // invalidateAll() re-run with a fresh snapshot
			expect(get(account)).toBe(updated); // untouched — the store is authoritative
		});

		it("re-seeds on identity change (logout)", () => {
			seedAccountFromSSR(userA);
			seedAccountFromSSR(null);
			expect(get(account)).toBe(null);
		});

		it("re-seeds on identity change (login as another user)", () => {
			seedAccountFromSSR(userA);
			seedAccountFromSSR(userB);
			expect(get(account)).toBe(userB);
		});

		it("a stale snapshot resolving after a direct write does not clobber it (email-confirm race)", () => {
			// The confirm flow: setAuthData's invalidateAll() and the goto("/account")
			// navigation race two root-layout loads. The navigation's load can capture a
			// pre-confirm snapshot (confirmed=false) yet resolve last; without the guard
			// stamp in setAccount it would re-seed the store over the confirmed user.
			const unconfirmed = { _id: "user-a", security: { confirmed: false } } as never;
			const confirmed = { _id: "user-a", security: { confirmed: true } } as never;
			setAccount(confirmed); // direct write from the confirm response
			seedAccountFromSSR(unconfirmed); // late-arriving stale snapshot, same identity
			expect(get(account)).toBe(confirmed);
		});

		it("a fresh same-identity snapshot still re-seeds after a direct write", () => {
			const confirmed = { _id: "user-a", security: { confirmed: true } } as never;
			setAccount(confirmed);
			seedAccountFromSSR(confirmed); // invalidateAll()'s own fresh snapshot
			expect(get(account)).toBe(confirmed);
		});
	});

	describe("seedActiveGamesFromSSR", () => {
		it("seeds from the first snapshot", () => {
			seedActiveGamesFromSSR(["g1", "g2"], "user-a");
			expect(get(activeGames)).toEqual(["g1", "g2"]);
		});

		it("applies an empty snapshot (empty is a real state, not 'not yet loaded')", () => {
			seedActiveGamesFromSSR(["g1"], "user-a");
			seedActiveGamesFromSSR([], "user-a"); // store untouched since → still seedable
			expect(get(activeGames)).toEqual([]);
		});

		it("does not clobber a websocket push on a same-identity revalidation (#167)", () => {
			seedActiveGamesFromSSR(["g1", "g2"], "user-a");
			activeGames.set([]); // live ws push: no games waiting
			seedActiveGamesFromSSR(["g1", "g2"], "user-a"); // stale revalidation snapshot
			expect(get(activeGames)).toEqual([]); // the live empty state wins
		});

		it("re-seeds on identity change even after a websocket push (logout resets)", () => {
			seedActiveGamesFromSSR(["g1", "g2"], "user-a");
			activeGames.set(["g1"]); // ws push
			seedActiveGamesFromSSR([], null); // logout → anonymous snapshot
			expect(get(activeGames)).toEqual([]);
		});

		it("seeds again after applying a same-identity snapshot (store was untouched)", () => {
			seedActiveGamesFromSSR(["g1"], "user-a");
			seedActiveGamesFromSSR(["g1", "g3"], "user-a");
			expect(get(activeGames)).toEqual(["g1", "g3"]);
		});
	});

	describe("likedBoardgames", () => {
		beforeEach(() => {
			// Reset the module-private seed guard by re-seeding to a known identity.
			seedLikedBoardgamesFromSSR({}, null);
			likedBoardgames.set({});
		});

		it("seeds from the SSR snapshot", () => {
			seedLikedBoardgamesFromSSR({ gaia: 1000, take6: 2000 }, "user-a");
			expect(get(likedBoardgames)).toEqual({ gaia: 1000, take6: 2000 });
		});

		it("does not clobber a live toggle on a same-identity revalidation", () => {
			seedLikedBoardgamesFromSSR({ gaia: 1000 }, "user-a");
			applyLikedBoardgame("take6", true); // live like toggle
			seedLikedBoardgamesFromSSR({ gaia: 1000 }, "user-a"); // stale revalidation snapshot
			expect(get(likedBoardgames)).toMatchObject({ gaia: 1000 });
			expect(get(likedBoardgames).take6).toBeTypeOf("number"); // the live stamp wins
		});

		it("re-seeds on identity change (logout clears, login swaps)", () => {
			seedLikedBoardgamesFromSSR({ gaia: 1000 }, "user-a");
			seedLikedBoardgamesFromSSR({}, null);
			expect(get(likedBoardgames)).toEqual({});
			seedLikedBoardgamesFromSSR({ take6: 500 }, "user-b");
			expect(get(likedBoardgames)).toEqual({ take6: 500 });
		});

		it("applyLikedBoardgame stamps now on like and deletes on unlike", () => {
			seedLikedBoardgamesFromSSR({ gaia: 1000 }, "user-a");
			const before = Date.now();
			applyLikedBoardgame("take6", true);
			expect(get(likedBoardgames).take6).toBeGreaterThanOrEqual(before);
			applyLikedBoardgame("gaia", false);
			expect(get(likedBoardgames)).not.toHaveProperty("gaia");
		});
	});
});
