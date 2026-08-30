// Provider-avatar options in the account avatar picker (Codeberg #34): only
// connected providers with a captured avatarUrl are offered; selecting one posts
// to the copy endpoint and stores the updated account.
import { flushSync, mount, unmount } from "svelte";
import { get } from "svelte/store";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/api", () => ({ post: vi.fn() }));
vi.mock("@/utils", async () => {
	const actual = await vi.importActual<typeof import("@/utils")>("@/utils");
	return { ...actual, handleError: vi.fn() };
});
vi.mock("@/lib/account.svelte", async () => {
	const { writable } = await import("svelte/store");
	return { account: writable(null) };
});

import { post } from "@/lib/api";
import { account } from "@/lib/account.svelte";
import SocialAvatars from "./SocialAvatars.svelte";

const postMock = vi.mocked(post);

function makeUser({
	social = {},
	socialMeta = {},
}: {
	social?: Record<string, string>;
	socialMeta?: Record<string, { username: string; url?: string; avatarUrl?: string }>;
}) {
	return { account: { username: "tester", social, socialMeta } } as never;
}

async function flushMicrotasks() {
	for (let i = 0; i < 10; i++) {
		await Promise.resolve();
	}
	flushSync();
}

describe("SocialAvatars (Codeberg #34)", () => {
	let target: HTMLDivElement;

	beforeEach(() => {
		postMock.mockReset();
		account.set(null);
		document.body.innerHTML = "";
		target = document.createElement("div");
		document.body.appendChild(target);
	});

	it("offers one option per connected provider with a captured avatarUrl", () => {
		const user = makeUser({
			social: { discord: "d-1", github: "gh-1", google: "g-1" },
			socialMeta: {
				discord: {
					username: "gamer#42",
					url: "https://discord.com/users/d-1",
					avatarUrl: "https://cdn.discordapp.com/avatars/d-1/abc.png?size=256",
				},
				// Connected but no avatar captured → no option.
				github: { username: "octocat", url: "https://github.com/octocat" },
			},
		});
		const component = mount(SocialAvatars, { target, props: { user } });
		flushSync();

		const options = [...target.querySelectorAll("button")];
		expect(options).toHaveLength(1);
		expect(options[0].title).toBe("Use my Discord avatar");
		expect(options[0].querySelector("img")?.src).toBe("https://cdn.discordapp.com/avatars/d-1/abc.png?size=256");

		unmount(component);
	});

	it("ignores a stale avatarUrl when the provider is no longer connected", () => {
		const user = makeUser({
			social: {},
			socialMeta: { discord: { username: "gamer#42", avatarUrl: "https://cdn.discordapp.com/avatars/d-1/abc.png" } },
		});
		const component = mount(SocialAvatars, { target, props: { user } });
		flushSync();

		expect(target.querySelectorAll("img")).toHaveLength(0);

		unmount(component);
	});

	it("renders nothing when no provider carries an avatar", () => {
		const component = mount(SocialAvatars, { target, props: { user: makeUser({}) } });
		flushSync();

		expect(target.querySelectorAll("img")).toHaveLength(0);

		unmount(component);
	});

	it("posts the provider to the copy endpoint, stores the account and notifies", async () => {
		const updated = makeUser({});
		postMock.mockResolvedValue(updated);
		const onselected = vi.fn();
		const user = makeUser({
			social: { discord: "d-1" },
			socialMeta: { discord: { username: "gamer#42", avatarUrl: "https://cdn.discordapp.com/avatars/d-1/abc.png" } },
		});
		const component = mount(SocialAvatars, { target, props: { user, onselected } });
		flushSync();

		target.querySelector("button")!.click();
		await flushMicrotasks();

		expect(postMock).toHaveBeenCalledWith("/account/avatar/social", { provider: "discord" });
		expect(get(account)).toBe(updated);
		expect(onselected).toHaveBeenCalledOnce();

		unmount(component);
	});

	it("does not notify when the copy fails", async () => {
		postMock.mockRejectedValue(new Error("boom"));
		const onselected = vi.fn();
		const user = makeUser({
			social: { discord: "d-1" },
			socialMeta: { discord: { username: "gamer#42", avatarUrl: "https://cdn.discordapp.com/avatars/d-1/abc.png" } },
		});
		const component = mount(SocialAvatars, { target, props: { user, onselected } });
		flushSync();

		target.querySelector("button")!.click();
		await flushMicrotasks();

		expect(onselected).not.toHaveBeenCalled();
		expect(get(account)).toBe(null);

		unmount(component);
	});
});
