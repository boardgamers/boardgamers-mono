// Tests for the user profile load's api-error mapping: `get()` throws an ApiError on
// any api status >= 400, and SvelteKit would turn a bare ApiError into a 500 — the
// load must convert it so an unknown user renders a 404 (and other statuses pass through).
import { isHttpError } from "@sveltejs/kit";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/api", async (importOriginal) => {
	const original = await importOriginal<typeof import("@/lib/api")>();
	return { ...original, get: vi.fn() };
});

import { ApiError, get } from "@/lib/api";
import { clearGamesCache } from "@/lib/games.svelte";
import { load } from "./+page";
import type { PageLoad } from "./$types";

const getMock = vi.mocked(get);

const fakeUser = {
	// Valid ObjectId shape — the load derives the join date from its timestamp bytes.
	_id: "507f1f77bcf86cd799439011",
	account: { username: "alice", bio: "", karma: 7 },
};

function runLoad(username = "alice") {
	return load({
		params: { username },
		parent: () => Promise.resolve({ user: null }),
	} as unknown as Parameters<PageLoad>[0]) as Promise<{ user: unknown; isOwnProfile: boolean }>;
}

async function catchHttpError(promise: Promise<unknown>): Promise<{ status: number; message: string }> {
	try {
		await promise;
	} catch (err) {
		if (isHttpError(err)) {
			return { status: err.status, message: err.body.message };
		}
		throw err;
	}
	throw new Error("load should have thrown");
}

describe("user page load — api error mapping", () => {
	beforeEach(() => {
		clearGamesCache();
		getMock.mockReset();
	});

	it("returns the profile when the api finds the user", async () => {
		getMock.mockImplementation((url: string) => {
			if (url.startsWith("/user/infoByName/")) {
				return Promise.resolve(fakeUser) as never;
			}
			// Game lists + elo — not under test.
			return Promise.resolve([]) as never;
		});

		const data = await runLoad();

		expect(data.user).toEqual(fakeUser);
		expect(data.isOwnProfile).toBe(false);
	});

	it("renders a 404 when the api 404s (unknown user)", async () => {
		getMock.mockRejectedValue(new ApiError("User not found", 404));

		const thrown = await catchHttpError(runLoad("tjhonson"));

		expect(thrown).toEqual({ status: 404, message: "User not found" });
	});

	it.each([403, 500])("passes through an api %i instead of masking it as a 404", async (status) => {
		getMock.mockRejectedValue(new ApiError("api failure", status));

		const thrown = await catchHttpError(runLoad());

		expect(thrown.status).toBe(status);
	});
});
