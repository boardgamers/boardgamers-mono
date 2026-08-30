// The new-game load reads the "remember my last setup" cookies server-side so the
// form can render remembered values during SSR: the per-boardgame setup cookie,
// plus the cross-boardgame `new-game-timing` cookie (#377) that recalls the last
// timing used on ANY boardgame.
import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/game-info.svelte", () => ({ getGameInfo: vi.fn().mockResolvedValue(null) }));

import { load } from "./+page.server";
import type { PageServerLoad } from "./$types";

async function runLoad(cookie: string) {
	const data = await load({
		params: { boardgameId: "gaia-project" },
		request: new Request("http://localhost/", cookie ? { headers: { cookie } } : {}),
	} as unknown as Parameters<PageServerLoad>[0]);
	if (!data) throw new Error("load returned no data");
	return data;
}

const encode = (value: unknown) => encodeURIComponent(JSON.stringify(value));

describe("new-game +page.server load — remembered setup cookies", () => {
	it("returns nulls without cookies", async () => {
		const data = await runLoad("");
		expect(data.lastSetup).toBeNull();
		expect(data.lastTiming).toBeNull();
	});

	it("parses this boardgame's setup cookie, ignoring other boardgames'", async () => {
		const data = await runLoad(
			`new-game-setup:take6=${encode({ numPlayers: 6 })}; new-game-setup:gaia-project=${encode({ numPlayers: 3, timePerGame: 600 })}`,
		);
		expect(data.lastSetup).toEqual({ numPlayers: 3, timePerGame: 600 });
	});

	it("parses the cross-boardgame timing cookie (#377)", async () => {
		const data = await runLoad(`new-game-timing=${encode({ timePerGame: 600, timePerMove: 30 })}`);
		expect(data.lastSetup).toBeNull();
		expect(data.lastTiming).toEqual({ timePerGame: 600, timePerMove: 30 });
	});

	it("returns null for a malformed cookie value", async () => {
		const data = await runLoad("new-game-timing=not-json");
		expect(data.lastTiming).toBeNull();
	});
});
