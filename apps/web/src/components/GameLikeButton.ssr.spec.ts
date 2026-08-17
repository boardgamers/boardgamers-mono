// @vitest-environment node
import { render } from "svelte/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/components/icons/IconMeeple.svelte", async () => ({
	default: (await import("@/lib/__mocks__/IconStub.svelte")).default,
}));
vi.mock("@/components/icons/IconMeepleFill.svelte", async () => ({
	default: (await import("@/lib/__mocks__/IconStub.svelte")).default,
}));

import GameLikeButton from "./GameLikeButton.svelte";

// The button (and the viewer's liked state) must be in the server-rendered HTML for a
// logged-in user — not pop in after hydration. The viewer comes from the `ssrUser` prop
// (the page's SSR snapshot), since the client-only `$account` store is null during SSR.
describe("GameLikeButton SSR", () => {
	it("renders the interactive button server-side for anonymous users (not liked)", () => {
		const { body } = render(GameLikeButton, { props: { gameId: "gaia-project", liked: false, likeCount: 3 } });
		expect(body).toContain("<button");
		expect(body).toContain('aria-pressed="false"');
		expect(body).toContain(">3</span>");
	});

	it("renders the button + liked state server-side for a logged-in user (ssrUser)", () => {
		const ssrUser = { _id: "u1" } as never;
		const { body } = render(GameLikeButton, {
			props: { gameId: "gaia-project", liked: true, likeCount: 1, ssrUser },
		});
		expect(body).toContain("<button");
		expect(body).toContain('aria-pressed="true"');
		expect(body).toContain(">1</span>");
	});

	it("renders the button server-side even when the count is zero", () => {
		const { body } = render(GameLikeButton, { props: { gameId: "gaia-project", liked: false, likeCount: 0 } });
		expect(body).toContain("<button");
		expect(body).toContain(">0</span>");
	});
});
