// The game page's load probes the `<game>:rules` CMS page so the sidebar can show a
// "Rules" link when it exists. The probe must be non-fatal: a 404 (no rules page) or a
// pages-api failure means "no link", never a broken game page.
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/api", () => ({ get: vi.fn() }));

import { get } from "@/lib/api";
import { load } from "./+page";
import type { PageLoad } from "./$types";

const getMock = vi.mocked(get);

const GAME = {
	_id: "g1",
	status: "active",
	players: [],
	game: { name: "powergrid", version: 1, options: {} },
	options: { setup: { nbPlayers: 2 }, timing: { timer: { start: 0, end: 0 } } },
};

function mockApi({ rules = null as null | { title: string }, rulesError = null as null | Error } = {}) {
	getMock.mockImplementation((url: string) => {
		if (url === "/page/powergrid:rules") {
			if (rulesError) {
				return Promise.reject(rulesError) as never;
			}
			return rules ? (Promise.resolve(rules) as never) : (Promise.reject(new Error("Not Found")) as never);
		}
		if (url === "/gameplay/g1") {
			return Promise.resolve(GAME) as never;
		}
		if (url === "/game/g1/players") {
			return Promise.resolve([]) as never;
		}
		if (url.startsWith("/boardgame/")) {
			return Promise.resolve({ _id: { game: "powergrid", version: 1 }, label: "Power Grid" }) as never;
		}
		if (url.startsWith("/account/")) {
			return Promise.reject(Object.assign(new Error("Unauthorized"), { status: 401 })) as never;
		}
		return Promise.reject(new Error(`unexpected url ${url}`)) as never;
	});
}

async function runLoad() {
	const data = await load({
		params: { gameId: "g1" },
		parent: () => Promise.resolve({ user: null }),
	} as unknown as Parameters<PageLoad>[0]);
	// The mocked parent can't reproduce SvelteKit's real LayoutData intersection, which
	// collapses the return type away from the load's actual data shape.
	return data as Awaited<ReturnType<typeof load>> & {
		game: unknown;
		rulesPage: { title: string } | null;
	};
}

describe("game page load — rules page probe", () => {
	beforeEach(() => {
		getMock.mockReset();
	});

	it("returns the rules page title when the <game>:rules CMS page exists", async () => {
		mockApi({ rules: { title: "Power Grid rules" } });

		const data = await runLoad();

		expect(getMock).toHaveBeenCalledWith("/page/powergrid:rules");
		expect(data.rulesPage).toEqual({ title: "Power Grid rules" });
	});

	it("returns null when the rules page does not exist (404)", async () => {
		mockApi();

		const data = await runLoad();

		expect(data.rulesPage).toBeNull();
	});

	it("returns null when the pages api fails, without breaking the game page", async () => {
		mockApi({ rulesError: new Error("connection reset") });

		const data = await runLoad();

		expect(data.rulesPage).toBeNull();
		expect(data.game).toMatchObject({ _id: "g1" });
	});
});
