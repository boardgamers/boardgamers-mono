import { flushSync, mount, unmount } from "svelte";
import { beforeEach, describe, expect, it, vi } from "vitest";

// Browser branch: the account store is clientWritable and throws when mutated with
// `browser: false`.
vi.mock("$app/environment", () => ({ browser: true, dev: false, building: false, version: "test" }));
vi.mock("@/lib/api", async (importOriginal) => ({
	...(await importOriginal<typeof import("@/lib/api")>()),
	get: vi.fn(),
	post: vi.fn(),
	put: vi.fn(),
	del: vi.fn(),
}));
// Leaf components with a `$props()` rest-spread crash in the jsdom/svelte vitest env
// (see the stubs in src/lib/__mocks__).
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
vi.mock("@/components/User/UsernameLink.svelte", async () => ({
	default: (await import("@/lib/__mocks__/UsernameLinkStub.svelte")).default,
}));
vi.mock("@/modules/cdk", async () => ({
	Badge: (await import("@/lib/__mocks__/BadgeStub.svelte")).default,
	Button: (await import("@/lib/__mocks__/ButtonStub.svelte")).default,
	Input: (await import("@/lib/__mocks__/InputStub.svelte")).default,
}));

import { ApiError, post, put } from "@/lib/api";
import { account } from "@/lib/stores.svelte";
import BoardgameRequests from "./BoardgameRequests.svelte";

const postMock = vi.mocked(post);
const putMock = vi.mocked(put);

// Already in API order (the server sorts most-voted first, then oldest).
const requests = [
	{
		_id: "req2",
		kind: "game",
		game: "testgame",
		title: "Solo mode",
		likeCount: 9,
		status: "open",
		liked: true,
		requestedBy: "bob",
		createdAt: "2025-01-02T00:00:00.000Z",
		updatedAt: "2025-01-02T00:00:00.000Z",
	},
	{
		_id: "req1",
		kind: "game",
		game: "testgame",
		title: "New map",
		body: "A second map with a different layout",
		likeCount: 4,
		status: "planned",
		liked: false,
		requestedBy: "alice",
		forumTid: 123,
		createdAt: "2025-01-01T00:00:00.000Z",
		updatedAt: "2025-01-01T00:00:00.000Z",
	},
] as never[];

function mountSection(props: Record<string, unknown> = {}) {
	const target = document.createElement("div");
	document.body.appendChild(target);
	const instance = mount(BoardgameRequests as never, {
		target,
		props: { boardgameId: "testgame", requests, user: null, ...props },
	}) as Record<string, unknown>;
	flushSync();
	return { target, instance };
}

describe("BoardgameRequests", () => {
	beforeEach(() => {
		postMock.mockReset();
		putMock.mockReset();
		account.set(null);
		document.body.innerHTML = "";
		sessionStorage.clear();
	});

	it("renders the requests most-voted first, with status, requester and forum link", () => {
		const { target, instance } = mountSection();
		const text = target.textContent!;
		expect(text).toContain("Requests & feedback");
		expect(text).toContain("New map");
		expect(text).toContain("A second map with a different layout");
		expect(text).toContain("Solo mode");
		expect(text).toContain("Planned");
		expect(text).toContain("alice");
		expect(text).toContain("bob");
		// Most-voted first: "Solo mode" (9) before "New map" (4)
		const titles = [...target.querySelectorAll("li h3")].map((h) => h.textContent);
		expect(titles).toEqual(["Solo mode", "New map"]);
		// forumTid → forum discussion link
		const forumLink = target.querySelector<HTMLAnchorElement>('a[href="https://forum.boardgamers.space/topic/123"]');
		expect(forumLink?.textContent).toContain("Forum discussion");
		// Anonymous: the form is replaced by a login prompt
		expect(target.querySelectorAll("form")).toHaveLength(0);
		expect(text).toContain("Log in");
		unmount(instance as never);
	});

	it("shows the empty state when the game has no requests", () => {
		const { target, instance } = mountSection({ requests: [] });
		expect(target.textContent).toContain("No requests for this game yet — be the first!");
		unmount(instance as never);
	});

	it("links to the game's source repo only when sourceUrl is set", () => {
		const { target, instance } = mountSection({ sourceUrl: "https://github.com/boardgamers/testgame" });
		const sourceLink = target.querySelector<HTMLAnchorElement>('a[href="https://github.com/boardgamers/testgame"]');
		expect(sourceLink?.textContent).toContain("Game source on GitHub");
		unmount(instance as never);

		const { target: target2, instance: instance2 } = mountSection();
		expect(target2.textContent).not.toContain("Game source on GitHub");
		unmount(instance2 as never);
	});

	it("votes on a request and updates the count", async () => {
		// FeedbackLikeButton reads the live $account store on the client — set it
		// before mounting so its first derived pass sees the logged-in user.
		account.set({ _id: "u1" } as never);
		putMock.mockResolvedValue({ liked: true, likeCount: 5 } as never);
		const { target, instance } = mountSection({ user: { _id: "u1" } });
		const newMapCard = [...target.querySelectorAll("li")].find((li) => li.textContent!.includes("New map"))!;
		const button = newMapCard.querySelector<HTMLButtonElement>("button[aria-pressed]")!;
		expect(button.getAttribute("aria-pressed")).toBe("false");
		button.click();
		await vi.waitFor(() => expect(button.getAttribute("aria-pressed")).toBe("true"));
		expect(putMock).toHaveBeenCalledWith("/feedback/req1/like");
		expect(button.textContent).toContain("5");
		unmount(instance as never);
	});

	it("creates a game request and lists it, with the requester's username", async () => {
		const created = {
			_id: "req3",
			kind: "game",
			game: "testgame",
			title: "New faction",
			likeCount: 0,
			status: "open",
			liked: false,
			// The API's create response carries the requester's ObjectId, not a username.
			requestedBy: "6a85d5a593ba8918f017020d",
			createdAt: "2025-01-03T00:00:00.000Z",
		};
		postMock.mockResolvedValue(created as never);
		const { target, instance } = mountSection({ user: { _id: "u1", account: { username: "alice" } } });

		const titleInput = target.querySelector<HTMLInputElement>("#feedback-request-game-testgame-title")!;
		titleInput.value = "New faction";
		titleInput.dispatchEvent(new Event("input", { bubbles: true }));
		flushSync();
		titleInput.closest("form")!.requestSubmit();

		await vi.waitFor(() => expect(target.textContent).toContain("New faction"));
		expect(postMock).toHaveBeenCalledWith("/feedback", { kind: "game", game: "testgame", title: "New faction" });
		// The raw ObjectId is substituted with the current user's username
		expect(target.textContent).toContain("Requested by alice");
		expect(target.textContent).not.toContain("6a85d5a593ba8918f017020d");
		unmount(instance as never);
	});

	it("prompts to link a forum account when the API requires one", async () => {
		postMock.mockRejectedValue(
			new ApiError("Link your forum account to submit feedback", 403, "forum_account_required"),
		);
		const { target, instance } = mountSection({ user: { _id: "u1", account: { username: "alice" } } });

		const titleInput = target.querySelector<HTMLInputElement>("#feedback-request-game-testgame-title")!;
		titleInput.value = "New faction";
		titleInput.dispatchEvent(new Event("input", { bubbles: true }));
		flushSync();
		titleInput.closest("form")!.requestSubmit();

		await vi.waitFor(() => {
			const alert = target.querySelector('[role="alert"]');
			expect(alert?.textContent).toContain("posted on our forum");
		});
		expect(target.textContent).toContain("Link forum account");
		// The failed request is not added to the list
		expect(target.textContent).not.toContain("New faction");

		// Clicking the link button stashes the draft under the form's own key.
		const linkButton = [...target.querySelectorAll<HTMLButtonElement>("button")].find((b) =>
			b.textContent!.includes("Link forum account"),
		)!;
		linkButton.click();
		expect(sessionStorage.getItem("feedback-draft-game-testgame")).toBe(
			JSON.stringify({ title: "New faction", body: "" }),
		);
		unmount(instance as never);
	});
});
