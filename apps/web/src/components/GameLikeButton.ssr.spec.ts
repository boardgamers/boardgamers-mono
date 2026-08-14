// @vitest-environment node
import { render } from "svelte/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/components/icons/IconHeart.svelte", async () => ({
	default: (await import("@/lib/__mocks__/IconStub.svelte")).default,
}));
vi.mock("@/components/icons/IconHeartFill.svelte", async () => ({
	default: (await import("@/lib/__mocks__/IconStub.svelte")).default,
}));

import GameLikeButton from "./GameLikeButton.svelte";

// Regression for the "likeCount isn't SSR'd" bug: the count is public data and must be
// present in the server-rendered HTML, not pop in after a client refetch.
describe("GameLikeButton SSR", () => {
	it("renders the like count server-side for anonymous users", () => {
		const { body } = render(GameLikeButton, { props: { gameId: "gaia-project", liked: false, likeCount: 3 } });
		expect(body).toContain(">3</span>");
		expect(body).toContain("3 likes");
	});

	// The interactive button needs the account store (clientWritable — browser-only), so
	// SSR renders the anonymous read-only badge even for logged-in users; the count (the
	// public data this regression covers) is present either way. The button swaps in at
	// hydration once the seeded account store is readable.
	it("renders the read-only badge server-side (button hydrates client-side)", () => {
		const { body } = render(GameLikeButton, { props: { gameId: "gaia-project", liked: true, likeCount: 1 } });
		expect(body).not.toContain("<button");
		expect(body).toContain(">1</span>");
	});

	it("renders nothing server-side when the count is zero", () => {
		const { body } = render(GameLikeButton, { props: { gameId: "gaia-project", liked: false, likeCount: 0 } });
		expect(body.replace(/<!--.*?-->/gs, "").trim()).toBe("");
	});
});
