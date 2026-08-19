import { flushSync, mount, unmount } from "svelte";
import { beforeEach, describe, expect, it, vi } from "vitest";

// Force the browser branch (as GameLikeButton.spec.ts does): the account store is
// clientWritable and throws when mutated with `browser: false`.
vi.mock("$app/environment", () => ({ browser: true, dev: false, building: false, version: "test" }));
vi.mock("@/lib/api", () => ({ post: vi.fn(), put: vi.fn(), del: vi.fn() }));
vi.mock("@/components/icons/IconMeeple.svelte", async () => ({
	default: (await import("@/lib/__mocks__/IconStub.svelte")).default,
}));
vi.mock("@/components/icons/IconMeepleFill.svelte", async () => ({
	default: (await import("@/lib/__mocks__/IconStub.svelte")).default,
}));

import { goto } from "$app/navigation";
import { page } from "$app/state";
import { del, post, put } from "@/lib/api";
import { account } from "@/lib/stores.svelte";
import FeedbackLikeButton from "./FeedbackLikeButton.svelte";

const postMock = vi.mocked(post);
const putMock = vi.mocked(put);
const delMock = vi.mocked(del);
const gotoMock = vi.mocked(goto);

function mountButton(props = {}) {
	const target = document.createElement("div");
	document.body.appendChild(target);
	const instance = mount(FeedbackLikeButton as never, {
		target,
		props: { target: { kind: "feedback", requestId: "req1" }, liked: false, likeCount: 0, ...props },
	}) as Record<string, unknown>;
	flushSync();
	return { target, instance };
}

describe("FeedbackLikeButton", () => {
	beforeEach(() => {
		postMock.mockReset();
		putMock.mockReset();
		delMock.mockReset();
		gotoMock.mockClear();
		account.set(null);
		page.url = new URL("http://localhost/feedback") as never;
		document.body.innerHTML = "";
	});

	it("redirects a logged-out click to login (and back to the current page)", () => {
		const { target, instance } = mountButton({ likeCount: 2 });
		target.querySelector("button")!.click();
		expect(gotoMock).toHaveBeenCalledWith("/login?redirect=%2Ffeedback");
		expect(postMock).not.toHaveBeenCalled();
		expect(putMock).not.toHaveBeenCalled();
		unmount(instance as never);
	});

	it("votes on a feedback request via PUT and reports the state through onlike", async () => {
		account.set({ _id: "u1" } as never);
		putMock.mockResolvedValue({ liked: true, likeCount: 5 } as never);
		const onlike = vi.fn();
		const { target, instance } = mountButton({ liked: false, likeCount: 4, onlike });
		target.querySelector("button")!.click();
		await vi.waitFor(() => expect(onlike).toHaveBeenCalledWith({ liked: true, likeCount: 5 }));
		expect(putMock).toHaveBeenCalledWith("/feedback/req1/like");
		unmount(instance as never);
	});

	it("unvotes on a feedback request via DELETE", async () => {
		account.set({ _id: "u1" } as never);
		delMock.mockResolvedValue({ liked: false, likeCount: 3 } as never);
		const onlike = vi.fn();
		const { target, instance } = mountButton({ liked: true, likeCount: 4, onlike });
		target.querySelector("button")!.click();
		await vi.waitFor(() => expect(onlike).toHaveBeenCalledWith({ liked: false, likeCount: 3 }));
		expect(delMock).toHaveBeenCalledWith("/feedback/req1/like");
		unmount(instance as never);
	});

	it("votes on a game request via the boardgame like endpoints", async () => {
		account.set({ _id: "u1" } as never);
		postMock.mockResolvedValue({ liked: true, likeCount: 8 } as never);
		const onlike = vi.fn();
		const { target, instance } = mountButton({
			target: { kind: "game", gameId: "through-the-ages" },
			liked: false,
			likeCount: 7,
			onlike,
		});
		target.querySelector("button")!.click();
		await vi.waitFor(() => expect(onlike).toHaveBeenCalledWith({ liked: true, likeCount: 8 }));
		expect(postMock).toHaveBeenCalledWith("/boardgame/through-the-ages/like");
		expect(putMock).not.toHaveBeenCalled();
		unmount(instance as never);
	});

	it("keeps the current state and reports the error when the vote fails", async () => {
		account.set({ _id: "u1" } as never);
		putMock.mockRejectedValue(new Error("rate limited"));
		const onlike = vi.fn();
		const { target, instance } = mountButton({ liked: false, likeCount: 4, onlike });
		target.querySelector("button")!.click();
		await vi.waitFor(() => expect(putMock).toHaveBeenCalled());
		// No optimistic mutation: the count is unchanged and onlike never fires.
		expect(onlike).not.toHaveBeenCalled();
		expect(target.querySelector("button")!.textContent).toContain("4");
		unmount(instance as never);
	});
});
