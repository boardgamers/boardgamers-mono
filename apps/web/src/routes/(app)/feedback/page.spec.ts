import { flushSync, mount, unmount } from "svelte";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { PageLoad } from "./$types";
import type { RequestedGame } from "./+page";

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

import { goto } from "$app/navigation";
import { page } from "$app/state";
import { ApiError, get, post, put } from "@/lib/api";
import { account } from "@/lib/stores.svelte";
import { load } from "./+page";
import FeedbackPage from "./+page.svelte";

const getMock = vi.mocked(get);
const postMock = vi.mocked(post);
const putMock = vi.mocked(put);
const gotoMock = vi.mocked(goto);

const gameRequests: RequestedGame[] = [
	{
		_id: "through-the-ages",
		label: "Through the Ages",
		description: "A civilization game",
		likeCount: 5,
		liked: false,
		requestedBy: "alice",
		createdAt: "2025-01-01T00:00:00.000Z",
	},
	{ _id: "brass", label: "Brass: Birmingham", likeCount: 3, liked: true, createdAt: "2025-01-02T00:00:00.000Z" },
	{
		_id: "outpost",
		label: "Outpost",
		status: "beta",
		likeCount: 4,
		liked: false,
		requestedBy: "alice",
		createdAt: "2025-01-03T00:00:00.000Z",
	},
	{
		_id: "gem-trader",
		label: "💎 Splendor",
		alias: "Gem Trader",
		status: "beta",
		likeCount: 2,
		liked: false,
		createdAt: "2025-01-04T00:00:00.000Z",
	},
];

const siteRequests = [
	{
		_id: "req1",
		kind: "site",
		title: "Tournament mode",
		body: "Bracketed tournaments",
		likeCount: 7,
		status: "planned",
		liked: false,
		requestedBy: "bob",
		createdAt: "2025-01-01T00:00:00.000Z",
		updatedAt: "2025-01-01T00:00:00.000Z",
	},
	{
		_id: "req2",
		kind: "site",
		title: "Dark mode tweaks",
		likeCount: 2,
		status: "done",
		liked: false,
		createdAt: "2025-01-02T00:00:00.000Z",
		updatedAt: "2025-01-02T00:00:00.000Z",
	},
] as never[];

function mountPage(data: Record<string, unknown> = {}) {
	const target = document.createElement("div");
	document.body.appendChild(target);
	const instance = mount(FeedbackPage as never, {
		target,
		props: { data: { gameRequests, siteRequests, ...data } },
	}) as Record<string, unknown>;
	flushSync();
	return { target, instance };
}

describe("/feedback load", () => {
	beforeEach(() => {
		getMock.mockReset();
	});

	it("prefetches game requests and site feedback (SSR)", async () => {
		getMock.mockImplementation((url: string) => {
			if (url === "/boardgame/requests") {
				return Promise.resolve(gameRequests) as never;
			}
			if (url === "/feedback") {
				return Promise.resolve(siteRequests) as never;
			}
			throw new Error(`unexpected get ${url}`);
		});
		const data = (await load({} as unknown as Parameters<PageLoad>[0])) as Exclude<Awaited<ReturnType<PageLoad>>, void>;
		expect(getMock).toHaveBeenCalledWith("/boardgame/requests");
		expect(getMock).toHaveBeenCalledWith("/feedback", { kind: "site" });
		expect(data.gameRequests).toEqual(gameRequests);
		expect(data.siteRequests).toEqual(siteRequests);
		expect(data.seo?.title).toContain("Feedback");
	});
});

describe("/feedback page", () => {
	beforeEach(() => {
		postMock.mockReset();
		putMock.mockReset();
		gotoMock.mockClear();
		account.set(null);
		page.url = new URL("http://localhost/feedback") as never;
		page.data = { user: null } as never;
		document.body.innerHTML = "";
		sessionStorage.clear();
	});

	it("renders both lists with labels, statuses, requesters and vote counts", () => {
		const { target, instance } = mountPage();
		const text = target.textContent!;
		expect(text).toContain("Through the Ages");
		expect(text).toContain("A civilization game");
		expect(text).toContain("Brass: Birmingham");
		expect(text).toContain("Tournament mode");
		expect(text).toContain("Planned");
		expect(text).toContain("Done");
		expect(text).toContain("alice");
		expect(text).toContain("bob");
		// Vote counts
		expect(text).toContain("5");
		expect(text).toContain("7");
		// Anonymous: forms replaced by a login prompt
		expect(target.querySelectorAll("form")).toHaveLength(0);
		expect(text).toContain("Log in");
		unmount(instance as never);
	});

	it("shows the empty states when there are no requests", () => {
		const { target, instance } = mountPage({ gameRequests: [], siteRequests: [] });
		const text = target.textContent!;
		expect(text).toContain("No game requests yet — be the first!");
		expect(text).toContain("No feature requests yet — suggest the first one!");
		unmount(instance as never);
	});

	it("flags beta games with a badge and a play-testing note", () => {
		const { target, instance } = mountPage();
		const text = target.textContent!;
		expect(text).toContain("Outpost");
		expect(text).toContain("In beta");
		expect(text).toContain("Being play-tested");
		// A plain request carries neither the badge nor the note.
		const ttaCard = [...target.querySelectorAll("li")].find((li) => li.textContent!.includes("Through the Ages"))!;
		expect(ttaCard.textContent).not.toContain("In beta");
		unmount(instance as never);
	});

	it("displays an aliased beta game under its alias, noting the canonical rules (#106)", () => {
		const { target, instance } = mountPage();
		const card = [...target.querySelectorAll("li")].find((li) => li.textContent!.includes("Gem Trader"))!;
		expect(card.querySelector("h3")!.textContent).toBe("💎 Gem Trader");
		expect(card.textContent).toContain("Splendor rules");
		expect(card.textContent).toContain("In beta");
		unmount(instance as never);
	});

	it("links to the adding-a-game guide and the site's Codeberg source", () => {
		const { target, instance } = mountPage();
		const docsLink = target.querySelector<HTMLAnchorElement>(
			'a[href="https://docs.boardgamers.space/guide/adding-a-game"]',
		);
		expect(docsLink?.textContent).toContain("How games get added");
		const codebergLink = target.querySelector<HTMLAnchorElement>(
			'a[href="https://codeberg.org/boardgamers/boardgamers"]',
		);
		expect(codebergLink?.textContent).toContain("Site source on Codeberg");
		unmount(instance as never);
	});

	it("redirects an anonymous vote click to login", () => {
		const { target, instance } = mountPage();
		target.querySelector<HTMLButtonElement>("button[aria-pressed]")!.click();
		expect(gotoMock).toHaveBeenCalledWith("/login?redirect=%2Ffeedback");
		expect(putMock).not.toHaveBeenCalled();
		unmount(instance as never);
	});

	it("votes on a site request and updates the count", async () => {
		account.set({ _id: "u1" } as never);
		putMock.mockResolvedValue({ liked: true, likeCount: 8 } as never);
		const { target, instance } = mountPage();
		const tournamentCard = [...target.querySelectorAll("li")].find((li) =>
			li.textContent!.includes("Tournament mode"),
		)!;
		const button = tournamentCard.querySelector<HTMLButtonElement>("button[aria-pressed]")!;
		expect(button.getAttribute("aria-pressed")).toBe("false");
		button.click();
		await vi.waitFor(() => expect(button.getAttribute("aria-pressed")).toBe("true"));
		expect(putMock).toHaveBeenCalledWith("/feedback/req1/like");
		expect(button.textContent).toContain("8");
		unmount(instance as never);
	});

	it("creates a game request and lists it, with the requester's username", async () => {
		account.set({ _id: "u1", account: { username: "alice" } } as never);
		const created = {
			_id: "terraforming-mars",
			label: "Terraforming Mars",
			likeCount: 1,
			liked: true,
			// The API's create response carries the requester's ObjectId, not a username.
			requestedBy: "6a85d5a593ba8918f017020d",
			createdAt: "2025-01-03T00:00:00.000Z",
		};
		postMock.mockResolvedValue(created as never);
		const { target, instance } = mountPage();

		const labelInput = target.querySelector<HTMLInputElement>("#game-request-label")!;
		labelInput.value = "Terraforming Mars";
		labelInput.dispatchEvent(new Event("input", { bubbles: true }));
		flushSync();
		target.querySelector<HTMLFormElement>("#game-request-label")!.closest("form")!.requestSubmit();

		await vi.waitFor(() => expect(target.textContent).toContain("Terraforming Mars"));
		expect(postMock).toHaveBeenCalledWith("/boardgame/request", { label: "Terraforming Mars" });
		// The raw ObjectId is substituted with the current user's username
		expect(target.textContent).toContain("Requested by alice");
		expect(target.textContent).not.toContain("6a85d5a593ba8918f017020d");
		unmount(instance as never);
	});

	it("creates a site suggestion and lists it", async () => {
		account.set({ _id: "u1", account: { username: "alice" } } as never);
		const created = {
			_id: "req3",
			kind: "site",
			title: "Mobile app",
			likeCount: 0,
			status: "open",
			liked: false,
			createdAt: "2025-01-03T00:00:00.000Z",
			updatedAt: "2025-01-03T00:00:00.000Z",
		};
		postMock.mockResolvedValue(created as never);
		const { target, instance } = mountPage();

		const titleInput = target.querySelector<HTMLInputElement>("#feedback-request-site-title")!;
		titleInput.value = "Mobile app";
		titleInput.dispatchEvent(new Event("input", { bubbles: true }));
		flushSync();
		titleInput.closest("form")!.requestSubmit();

		await vi.waitFor(() => expect(target.textContent).toContain("Mobile app"));
		expect(postMock).toHaveBeenCalledWith("/feedback", { kind: "site", title: "Mobile app" });
		// New requests show the default "Open" status badge
		expect(target.textContent).toContain("Open");
		unmount(instance as never);
	});

	it("prompts to link a forum account when the API requires one", async () => {
		account.set({ _id: "u1", account: { username: "alice" } } as never);
		postMock.mockRejectedValue(
			new ApiError("Link your forum account to submit feedback", 403, "forum_account_required"),
		);
		const { target, instance } = mountPage();

		const titleInput = target.querySelector<HTMLInputElement>("#feedback-request-site-title")!;
		titleInput.value = "Mobile app";
		titleInput.dispatchEvent(new Event("input", { bubbles: true }));
		flushSync();
		titleInput.closest("form")!.requestSubmit();

		await vi.waitFor(() => {
			const alert = target.querySelector('[role="alert"]');
			expect(alert?.textContent).toContain("posted on our forum");
		});
		expect(target.textContent).toContain("Link forum account");
		// The failed request is not added to the list
		expect(target.textContent).not.toContain("Mobile app</h3>");
		unmount(instance as never);
	});

	it("prompts to link a forum account for a game request, stashing the draft", async () => {
		account.set({ _id: "u1", account: { username: "alice" } } as never);
		postMock.mockRejectedValue(
			new ApiError("Link your forum account to request a game", 403, "forum_account_required"),
		);
		const { target, instance } = mountPage();

		const labelInput = target.querySelector<HTMLInputElement>("#game-request-label")!;
		labelInput.value = "Terraforming Mars";
		labelInput.dispatchEvent(new Event("input", { bubbles: true }));
		flushSync();
		labelInput.closest("form")!.requestSubmit();

		await vi.waitFor(() => {
			const alert = target.querySelector('[role="alert"]');
			expect(alert?.textContent).toContain("posted on our forum");
		});
		expect(target.textContent).toContain("Link forum account");
		// The failed request is not added to the list
		expect(target.textContent).not.toContain("Terraforming Mars</h3>");

		// Clicking the link button stashes the draft under its own key (distinct from
		// the site form's "feedback-draft-site") and starts the forum SSO.
		const linkButton = [...target.querySelectorAll<HTMLButtonElement>("button")].find((b) =>
			b.textContent!.includes("Link forum account"),
		)!;
		linkButton.click();
		expect(sessionStorage.getItem("feedback-draft-game-request")).toBe(
			JSON.stringify({ label: "Terraforming Mars", description: "" }),
		);
		expect(sessionStorage.getItem("feedback-draft-site")).toBeNull();
		unmount(instance as never);
	});

	it("restores a stashed game-request draft on return from the forum linking flow", () => {
		account.set({ _id: "u1", account: { username: "alice" } } as never);
		sessionStorage.setItem(
			"feedback-draft-game-request",
			JSON.stringify({ label: "Terraforming Mars", description: "Card drafting in space" }),
		);
		const { target, instance } = mountPage();

		expect(target.querySelector<HTMLInputElement>("#game-request-label")!.value).toBe("Terraforming Mars");
		expect(target.querySelector<HTMLTextAreaElement>("#game-request-description")!.value).toBe(
			"Card drafting in space",
		);
		// The draft is consumed (a later plain visit doesn't resurrect it).
		expect(sessionStorage.getItem("feedback-draft-game-request")).toBeNull();
		unmount(instance as never);
	});

	it("surfaces API errors (409/429) inline in the form", async () => {
		account.set({ _id: "u1" } as never);
		postMock.mockRejectedValue(new Error('"Terraforming Mars" is already requested — vote for it instead'));
		const { target, instance } = mountPage();

		const labelInput = target.querySelector<HTMLInputElement>("#game-request-label")!;
		labelInput.value = "Terraforming Mars";
		labelInput.dispatchEvent(new Event("input", { bubbles: true }));
		flushSync();
		labelInput.closest("form")!.requestSubmit();

		await vi.waitFor(() => {
			const alert = target.querySelector('[role="alert"]');
			expect(alert?.textContent).toContain("already requested");
		});
		// The failed request is not added to the list
		expect(target.textContent).not.toContain("Terraforming Mars</h3>");
		unmount(instance as never);
	});
});
