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

import { goto } from "$app/navigation";
import { page } from "$app/state";
import { del, post } from "@/lib/api";
import { account } from "@/lib/stores.svelte";
import GameLikeButton from "./GameLikeButton.svelte";

const postMock = vi.mocked(post);
const delMock = vi.mocked(del);
const gotoMock = vi.mocked(goto);

function mountButton(
	props: { liked?: boolean; likeCount?: number; onlike?: (like: { liked: boolean; likeCount: number }) => void } = {},
) {
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
		gotoMock.mockClear();
		account.set(null);
		// The vitest `$app/state` stub types `url` as a plain URL; svelte-check sees the real
		// route-templated URL type, so cast to assign an arbitrary route.
		page.url = new URL("http://localhost/boardgame/testgame") as never;
		document.body.innerHTML = "";
	});

	it("always renders the button, even for anonymous users with zero likes", () => {
		const { target, instance } = mountButton({ likeCount: 0 });
		expect(target.querySelector("button")).not.toBeNull();
		expect(target.textContent).toContain("0");
		unmount(instance as never);
	});

	it("redirects a logged-out click to login (and back to the current page)", () => {
		const { target, instance } = mountButton({ likeCount: 2 });
		target.querySelector("button")!.click();
		expect(gotoMock).toHaveBeenCalledWith("/login?redirect=%2Fboardgame%2Ftestgame");
		expect(postMock).not.toHaveBeenCalled();
		expect(delMock).not.toHaveBeenCalled();
		unmount(instance as never);
	});

	it("likes via POST and reports the returned state through onlike", async () => {
		account.set({ _id: "u1" } as never);
		postMock.mockResolvedValue({ liked: true, likeCount: 5 } as never);
		const onlike = vi.fn();
		const { target, instance } = mountButton({ liked: false, likeCount: 4, onlike });

		target.querySelector("button")!.click();
		await vi.waitFor(() => expect(onlike).toHaveBeenCalledWith({ liked: true, likeCount: 5 }));

		expect(postMock).toHaveBeenCalledWith("/boardgame/testgame/like");
		expect(delMock).not.toHaveBeenCalled();
		unmount(instance as never);
	});

	it("unlikes via DELETE and reports the returned state through onlike", async () => {
		account.set({ _id: "u1" } as never);
		delMock.mockResolvedValue({ liked: false, likeCount: 3 } as never);
		const onlike = vi.fn();
		const { target, instance } = mountButton({ liked: true, likeCount: 4, onlike });

		target.querySelector("button")!.click();
		await vi.waitFor(() => expect(onlike).toHaveBeenCalledWith({ liked: false, likeCount: 3 }));

		expect(delMock).toHaveBeenCalledWith("/boardgame/testgame/like");
		expect(postMock).not.toHaveBeenCalled();
		unmount(instance as never);
	});
});
