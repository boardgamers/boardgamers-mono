// @vitest-environment node
import { render } from "svelte/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/components/icons/IconMeeple.svelte", async () => ({
	default: (await import("@/lib/__mocks__/IconStub.svelte")).default,
}));
vi.mock("@/components/icons/IconMeepleFill.svelte", async () => ({
	default: (await import("@/lib/__mocks__/IconStub.svelte")).default,
}));
vi.mock("@/components/icons/IconGithub.svelte", async () => ({
	default: (await import("@/lib/__mocks__/IconStub.svelte")).default,
}));
vi.mock("@/components/icons/IconBoxArrowUpRight.svelte", async () => ({
	default: (await import("@/lib/__mocks__/IconStub.svelte")).default,
}));

import BoardgameRequests from "./BoardgameRequests.svelte";

const requests = [
	{
		_id: "req1",
		kind: "game",
		game: "testgame",
		title: "New map",
		likeCount: 4,
		status: "planned",
		liked: true,
		requestedBy: "alice",
		forumTid: 123,
		createdAt: "2025-01-01T00:00:00.000Z",
		updatedAt: "2025-01-01T00:00:00.000Z",
	},
] as never[];

// The section must be fully server-rendered — request cards, the viewer's liked
// state and the login prompt, not pop in after hydration (the viewer comes from
// the `user` prop, the page's SSR snapshot).
describe("BoardgameRequests SSR", () => {
	it("renders the requests server-side, with the liked state for a logged-in user", () => {
		const { body } = render(BoardgameRequests, {
			props: { boardgameId: "testgame", requests, user: { _id: "u1" } as never },
		});
		expect(body).toContain("Requests &amp; feedback");
		expect(body).toContain("New map");
		expect(body).toContain("Planned");
		expect(body).toContain("alice");
		expect(body).toContain('aria-pressed="true"');
		expect(body).toContain("https://forum.boardgamers.space/topic/123");
		// The form stays collapsed server-side even for a logged-in user: only the
		// disclosure trigger is rendered, the panel mounts on click after hydration.
		expect(body).not.toContain("<form");
		expect(body).toContain('aria-expanded="false"');
		expect(body).toContain('aria-controls="game-feedback-form"');
		expect(body).not.toContain('id="game-feedback-form"');
		expect(body).toContain("Request an expansion or feature");
	});

	it("renders the collapsed trigger (no form, no login prompt) server-side for anonymous users", () => {
		const { body } = render(BoardgameRequests, { props: { boardgameId: "testgame", requests, user: null } });
		expect(body).toContain("New map");
		expect(body).not.toContain("<form");
		expect(body).not.toContain("Log in");
		expect(body).toContain('aria-expanded="false"');
		expect(body).toContain("Request an expansion or feature");
	});

	it("renders the empty state server-side when the game has no requests", () => {
		const { body } = render(BoardgameRequests, { props: { boardgameId: "testgame", requests: [], user: null } });
		expect(body).toContain("No requests for this game yet — be the first!");
	});

	it("renders the source link server-side only when sourceUrl is set", () => {
		const withSource = render(BoardgameRequests, {
			props: { boardgameId: "testgame", requests: [], user: null, sourceUrl: "https://github.com/bgs/testgame" },
		});
		expect(withSource.body).toContain("https://github.com/bgs/testgame");
		const without = render(BoardgameRequests, { props: { boardgameId: "testgame", requests: [], user: null } });
		expect(without.body).not.toContain("Game source on GitHub");
	});
});
