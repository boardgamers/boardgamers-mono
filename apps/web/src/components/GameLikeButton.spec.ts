import { flushSync, mount, unmount } from "svelte";
import { beforeEach, describe, expect, it, vi } from "vitest";

// Force the browser branch (as stores.spec.ts does): the account store is
// clientWritable and throws when mutated with `browser: false`.
vi.mock("$app/environment", () => ({ browser: true, dev: false, building: false, version: "test" }));
vi.mock("@/lib/api", () => ({ post: vi.fn(), del: vi.fn() }));
vi.mock("@/components/icons/IconHeart.svelte", async () => ({
	default: (await import("@/lib/__mocks__/IconStub.svelte")).default,
}));
vi.mock("@/components/icons/IconHeartFill.svelte", async () => ({
	default: (await import("@/lib/__mocks__/IconStub.svelte")).default,
}));

import { del, post } from "@/lib/api";
import { account } from "@/lib/stores.svelte";
import GameLikeButton from "./GameLikeButton.svelte";

const postMock = vi.mocked(post);
const delMock = vi.mocked(del);

function mountButton(props: { liked?: boolean; likeCount?: number } = {}) {
	const target = document.createElement("div");
	document.body.appendChild(target);
	const instance = mount(GameLikeButton as never, {
		target,
		props: { gameId: "testgame", liked: false, likeCount: 0, ...props },
	}) as Record<string, unknown>;
	flushSync();
	return { target, instance };
}

describe("GameLikeButton", () => {
	beforeEach(() => {
		postMock.mockReset();
		delMock.mockReset();
		account.set(null);
		document.body.innerHTML = "";
	});

	it("renders no control for anonymous users with zero likes", () => {
		const { target, instance } = mountButton({ likeCount: 0 });
		expect(target.querySelector("button")).toBeNull();
		expect(target.textContent?.trim()).toBe("");
		unmount(instance as never);
	});

	it("renders a read-only count for anonymous users", () => {
		const { target, instance } = mountButton({ likeCount: 7 });
		expect(target.querySelector("button")).toBeNull();
		expect(target.textContent).toContain("7");
		unmount(instance as never);
	});

	it("likes via POST and reflects the returned state", async () => {
		account.set({ _id: "u1" } as never);
		postMock.mockResolvedValue({ liked: true, likeCount: 5 } as never);
		const { target, instance } = mountButton({ liked: false, likeCount: 4 });

		target.querySelector("button")!.click();
		await vi.waitFor(() => expect(target.textContent).toContain("5"));

		expect(postMock).toHaveBeenCalledWith("/boardgame/testgame/like");
		expect(delMock).not.toHaveBeenCalled();
		expect(target.querySelector("button")!.getAttribute("aria-pressed")).toBe("true");
		unmount(instance as never);
	});

	it("unlikes via DELETE and reflects the returned state", async () => {
		account.set({ _id: "u1" } as never);
		delMock.mockResolvedValue({ liked: false, likeCount: 3 } as never);
		const { target, instance } = mountButton({ liked: true, likeCount: 4 });

		target.querySelector("button")!.click();
		await vi.waitFor(() => expect(target.textContent).toContain("3"));

		expect(delMock).toHaveBeenCalledWith("/boardgame/testgame/like");
		expect(postMock).not.toHaveBeenCalled();
		expect(target.querySelector("button")!.getAttribute("aria-pressed")).toBe("false");
		unmount(instance as never);
	});
});
