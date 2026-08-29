// The game page's load makes ONE existence probe (`/page/_exists?names=…`) covering the
// `<game>:rules` / `:settings` / `:preferences` CMS pages, so the sidebar shows the
// "Rules" link and the Settings/Preferences "i" links only when the target page exists
// (#429). The probe must be non-fatal: a pages-api failure means "no links", never a
// broken game page.
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

const EXISTS_URL = "/page/_exists?names=powergrid:rules,powergrid:settings,powergrid:preferences";

function mockApi({ exists = [] as string[], existsError = null as null | Error } = {}) {
	getMock.mockImplementation((url: string) => {
		if (url === EXISTS_URL) {
			if (existsError) {
				return Promise.reject(existsError) as never;
			}
			return Promise.resolve({ exists }) as never;
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
		rulesPage: boolean;
		settingsPage: boolean;
		preferencesPage: boolean;
	};
}

describe("game page load — sidebar CMS page existence probe (#429)", () => {
	beforeEach(() => {
		getMock.mockReset();
	});

	it("probes all three sidebar pages in a single _exists call", async () => {
		mockApi({ exists: ["powergrid:rules", "powergrid:settings", "powergrid:preferences"] });

		const data = await runLoad();

		expect(getMock).toHaveBeenCalledWith(EXISTS_URL);
		expect(data.rulesPage).toBe(true);
		expect(data.settingsPage).toBe(true);
		expect(data.preferencesPage).toBe(true);
	});

	it("flags only the pages that exist", async () => {
		mockApi({ exists: ["powergrid:settings"] });

		const data = await runLoad();

		expect(data.rulesPage).toBe(false);
		expect(data.settingsPage).toBe(true);
		expect(data.preferencesPage).toBe(false);
	});

	it("returns false for all three when none of the pages exist", async () => {
		mockApi({ exists: [] });

		const data = await runLoad();

		expect(data.rulesPage).toBe(false);
		expect(data.settingsPage).toBe(false);
		expect(data.preferencesPage).toBe(false);
	});

	it("hides all links when the pages api fails, without breaking the game page", async () => {
		mockApi({ existsError: new Error("connection reset") });

		const data = await runLoad();

		expect(data.rulesPage).toBe(false);
		expect(data.settingsPage).toBe(false);
		expect(data.preferencesPage).toBe(false);
		expect(data.game).toMatchObject({ _id: "g1" });
	});
});
