import { get } from "svelte/store";
import { beforeEach, describe, expect, it, vi } from "vitest";

// The seed helpers are browser-only (`if (!browser) return`). vitest.setup.ts mocks
// `$app/environment` with `browser: false` in the default run, so force the browser
// branch for this file — the seed-once behavior is precisely the client-side path.
vi.mock("$app/environment", () => ({ browser: true, dev: false, building: false, version: "test" }));

import { account, activeGames, seedAccountFromSSR, seedActiveGamesFromSSR } from "./stores.svelte";

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
});
