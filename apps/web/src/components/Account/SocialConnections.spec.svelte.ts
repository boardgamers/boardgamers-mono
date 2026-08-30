// Connected vs not-connected states, the last-login-method guard, and the unlink
// flow (#427). Real SocialConnections, jsdom env, ButtonStub for the CDK Button.
import { flushSync, mount, unmount } from "svelte";
import { get } from "svelte/store";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/api", () => ({ del: vi.fn() }));
vi.mock("@/utils", async () => {
	const actual = await vi.importActual<typeof import("@/utils")>("@/utils");
	return { ...actual, confirm: vi.fn(() => Promise.resolve(true)) };
});
vi.mock("@/lib/account.svelte", async () => {
	const { writable } = await import("svelte/store");
	return { account: writable(null) };
});
// The real Button and brand icons crash when mounted in this jsdom env (leaf
// `$props()` rest-spread issue — see the stubs' comments); they aren't what
// this spec exercises.
vi.mock("@/components/icons/IconGoogle.svelte", async () => ({
	default: (await import("@/lib/__mocks__/IconStub.svelte")).default,
}));
vi.mock("@/components/icons/IconDiscord.svelte", async () => ({
	default: (await import("@/lib/__mocks__/IconStub.svelte")).default,
}));
vi.mock("@/components/icons/IconFacebook.svelte", async () => ({
	default: (await import("@/lib/__mocks__/IconStub.svelte")).default,
}));
vi.mock("@/components/icons/IconGithub.svelte", async () => ({
	default: (await import("@/lib/__mocks__/IconStub.svelte")).default,
}));
vi.mock("@/components/icons/IconHuggingFace.svelte", async () => ({
	default: (await import("@/lib/__mocks__/IconStub.svelte")).default,
}));
vi.mock("@/modules/cdk", async () => {
	const actual = await vi.importActual<typeof import("@/modules/cdk")>("@/modules/cdk");
	return { ...actual, Button: (await import("@/lib/__mocks__/ButtonStub.svelte")).default };
});

import { del } from "@/lib/api";
import { account } from "@/lib/account.svelte";
import { confirm } from "@/utils";
import SocialConnections from "./SocialConnections.svelte";

const delMock = vi.mocked(del);
const confirmMock = vi.mocked(confirm);

function makeUser({
	social = {},
	socialMeta = {},
	hasPassword = false,
}: {
	social?: Record<string, string>;
	socialMeta?: Record<string, { username: string; url: string }>;
	hasPassword?: boolean;
}) {
	return { account: { username: "tester", social, socialMeta, ...(hasPassword ? { hasPassword } : {}) } } as never;
}

async function flushMicrotasks() {
	for (let i = 0; i < 10; i++) {
		await Promise.resolve();
	}
	flushSync();
}

const buttonByText = (target: HTMLElement, text: string) =>
	[...target.querySelectorAll("button")].filter((button) => button.textContent?.trim() === text);

describe("SocialConnections (#427)", () => {
	let target: HTMLDivElement;

	beforeEach(() => {
		delMock.mockReset();
		confirmMock.mockReset();
		confirmMock.mockResolvedValue(true);
		account.set(null);
		document.body.innerHTML = "";
		target = document.createElement("div");
		document.body.appendChild(target);
	});

	it("shows the connected state with the linked profile, Disconnect for connected and Connect for the rest", () => {
		const user = makeUser({
			social: { discord: "d-1" },
			socialMeta: { discord: { username: "gamer#42", url: "https://discord.com/users/d-1" } },
			hasPassword: true,
		});
		const component = mount(SocialConnections, { target, props: { user } });
		flushSync();

		expect(target.textContent).toContain("Connected");
		const profileLink = target.querySelector<HTMLAnchorElement>('a[href="https://discord.com/users/d-1"]');
		expect(profileLink?.textContent).toBe("gamer#42");

		expect(buttonByText(target, "Disconnect")).toHaveLength(1);
		// Google, GitHub and Hugging Face offer Connect; facebook is phased out (#99).
		expect(buttonByText(target, "Connect")).toHaveLength(3);
		expect(target.textContent).not.toContain("only way to log in");

		unmount(component);
	});

	it("offers no facebook Connect while it's being phased out (codeberg #99), only the notice", () => {
		const component = mount(SocialConnections, { target, props: { user: makeUser({ hasPassword: true }) } });
		flushSync();

		expect(buttonByText(target, "Connect")).toHaveLength(4);
		expect(target.textContent).toContain("Being phased out");
		expect(target.querySelector('[title*="phased out"]')).not.toBeNull();

		unmount(component);
	});

	it("keeps Disconnect for an already-linked facebook account (existing links still work)", () => {
		const user = makeUser({ social: { facebook: "f-1" }, hasPassword: true });
		const component = mount(SocialConnections, { target, props: { user } });
		flushSync();

		expect(buttonByText(target, "Disconnect")).toHaveLength(1);
		expect(target.textContent).not.toContain("Being phased out");

		unmount(component);
	});

	it("disables Disconnect and explains when it's the user's only login method", () => {
		const user = makeUser({ social: { discord: "d-1" } });
		const component = mount(SocialConnections, { target, props: { user } });
		flushSync();

		const [disconnect] = buttonByText(target, "Disconnect");
		expect(disconnect.disabled).toBe(true);
		expect(target.textContent).toContain("only way to log in");

		unmount(component);
	});

	it("keeps Disconnect enabled when another social connection remains", () => {
		const user = makeUser({ social: { discord: "d-1", github: "g-1" } });
		const component = mount(SocialConnections, { target, props: { user } });
		flushSync();

		for (const button of buttonByText(target, "Disconnect")) {
			expect(button.disabled).toBe(false);
		}

		unmount(component);
	});

	it("unlinks after confirmation and stores the updated account", async () => {
		const updated = makeUser({ hasPassword: true });
		delMock.mockResolvedValue(updated);
		const user = makeUser({ social: { discord: "d-1" }, hasPassword: true });
		const component = mount(SocialConnections, { target, props: { user } });
		flushSync();

		buttonByText(target, "Disconnect")[0].click();
		await flushMicrotasks();

		expect(confirmMock).toHaveBeenCalledOnce();
		expect(delMock).toHaveBeenCalledWith("/account/social/discord");
		expect(get(account)).toBe(updated);

		unmount(component);
	});

	it("does nothing when the confirmation is cancelled", async () => {
		confirmMock.mockResolvedValue(false);
		const user = makeUser({ social: { discord: "d-1" }, hasPassword: true });
		const component = mount(SocialConnections, { target, props: { user } });
		flushSync();

		buttonByText(target, "Disconnect")[0].click();
		await flushMicrotasks();

		expect(delMock).not.toHaveBeenCalled();
		expect(get(account)).toBe(null);

		unmount(component);
	});
});
