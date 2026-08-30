import { flushSync, mount, unmount } from "svelte";
import { beforeEach, describe, expect, it, vi } from "vitest";

// Force the browser branch (as FeedbackLikeButton.spec.ts does): the stores are
// clientWritable and throw when mutated with `browser: false`.
vi.mock("$app/environment", () => ({ browser: true, dev: false, building: false, version: "test" }));
vi.mock("@/lib/api", () => ({ get: vi.fn(), post: vi.fn(), put: vi.fn(), del: vi.fn() }));

import { del, put } from "@/lib/api";
import { account, chatReactions } from "@/lib/stores.svelte";
import { CHAT_REACTION_QUICK } from "@bgs/models/chatreaction-emoji";
import ReactionBar from "./ReactionBar.svelte";

const putMock = vi.mocked(put);
const delMock = vi.mocked(del);

const thumbsUpUrl = `/game/r1/chat/m1/reaction/${encodeURIComponent("👍")}`;

function mountBar(props = {}) {
	const target = document.createElement("div");
	document.body.appendChild(target);
	const instance = mount(ReactionBar as never, {
		target,
		props: { messageId: "m1", room: "r1", ...props },
	});
	flushSync();
	return { target, instance };
}

// The chips row is the only element anchored below the bubble (the picker opens above, bottom-full).
function chipsRow(target: HTMLElement): HTMLDivElement | null {
	return target.querySelector<HTMLDivElement>("div.top-full");
}

function chips(target: HTMLElement): HTMLButtonElement[] {
	return [...(chipsRow(target)?.querySelectorAll<HTMLButtonElement>(":scope > button") ?? [])];
}

describe("ReactionBar", () => {
	beforeEach(() => {
		putMock.mockReset();
		delMock.mockReset();
		account.set(null);
		chatReactions.set({});
		document.body.innerHTML = "";
	});

	it("renders one chip per emoji with count and reactor names in the tooltip", () => {
		chatReactions.set({
			m1: [
				{
					emoji: "👍",
					users: [
						{ _id: "u1", name: "alice" },
						{ _id: "u2", name: "bob" },
					],
				},
				{ emoji: "🎉", users: [{ _id: "u2", name: "bob" }] },
			],
		});
		const { target, instance } = mountBar();
		const rendered = chips(target);
		expect(rendered).toHaveLength(2);
		expect(rendered[0].textContent).toContain("👍");
		expect(rendered[0].textContent).toContain("2");
		expect(rendered[0].title).toContain("alice, bob");
		expect(rendered[1].textContent).toContain("🎉");
		expect(rendered[1].textContent).toContain("1");
		unmount(instance);
	});

	// Layout itself is browser-verified (jsdom has no layout) — assert the classes
	// that implement the overlay: absolutely positioned (zero impact on flow),
	// overlapping the bubble's bottom edge by the -mt-2 look, painted above
	// neighbours, left-inset for received messages and mirrored for own ones.
	it("overlays the bubble edge out of flow, mirrored for own messages", () => {
		chatReactions.set({ m1: [{ emoji: "👍", users: [{ _id: "u1", name: "alice" }] }] });
		const { target, instance } = mountBar();
		const row = chipsRow(target)!;
		expect(row.className).toContain("absolute");
		expect(row.className).toContain("top-full");
		expect(row.className).toContain("-mt-2");
		expect(row.className).toContain("z-[1]");
		expect(row.className).toContain("left-1.5");
		expect(row.className).not.toContain("right-1.5");
		unmount(instance);

		const { target: mineTarget, instance: mineInstance } = mountBar({ mine: true });
		const mineRow = chipsRow(mineTarget)!;
		expect(mineRow.className).toContain("right-1.5");
		expect(mineRow.className).not.toContain("left-1.5");
		unmount(mineInstance);
	});

	// The overlay must stay a single line: past the cap the remaining groups fold
	// into a non-interactive "+N" chip whose tooltip lists them.
	it("caps visible chips and folds the rest into a +N chip", () => {
		const emojis = ["👍", "🎉", "😂", "❤️", "😮", "😢", "🔥"];
		chatReactions.set({
			m1: emojis.map((emoji) => ({ emoji, users: [{ _id: "u1", name: "alice" }] })),
		});
		const { target, instance } = mountBar();
		const rendered = chips(target);
		expect(rendered).toHaveLength(4);
		const overflow = chipsRow(target)!.querySelector("span[title]")!;
		expect(overflow.textContent).toContain("+3");
		expect(overflow.getAttribute("title")).toContain("😢");
		expect(overflow.getAttribute("title")).toContain("🔥");
		unmount(instance);
	});

	it("shows no add-reaction affordance and disabled chips when logged out", () => {
		chatReactions.set({ m1: [{ emoji: "👍", users: [{ _id: "u1", name: "alice" }] }] });
		const { target, instance } = mountBar();
		expect(target.querySelector("[aria-expanded]")).toBeNull();
		expect(chips(target)[0].disabled).toBe(true);
		chips(target)[0].click();
		expect(putMock).not.toHaveBeenCalled();
		expect(delMock).not.toHaveBeenCalled();
		unmount(instance);
	});

	it("PUTs when clicking a chip the user hasn't reacted with, and applies the response", async () => {
		account.set({ _id: "me" } as never);
		chatReactions.set({ m1: [{ emoji: "👍", users: [{ _id: "u1", name: "alice" }] }] });
		putMock.mockResolvedValue({
			message: "m1",
			reactions: [
				{
					emoji: "👍",
					users: [
						{ _id: "u1", name: "alice" },
						{ _id: "me", name: "myself" },
					],
				},
			],
		} as never);

		const { target, instance } = mountBar();
		expect(chips(target)[0].className).not.toContain("border-blue-400");
		chips(target)[0].click();
		await vi.waitFor(() => expect(putMock).toHaveBeenCalledWith(thumbsUpUrl));
		// Own reaction now highlighted, count updated from the response.
		await vi.waitFor(() => {
			flushSync();
			expect(chips(target)[0].textContent).toContain("2");
			expect(chips(target)[0].className).toContain("border-blue-400");
		});
		unmount(instance);
	});

	it("DELETEs when clicking an own reaction, clearing the last chip", async () => {
		account.set({ _id: "me" } as never);
		chatReactions.set({ m1: [{ emoji: "👍", users: [{ _id: "me", name: "myself" }] }] });
		delMock.mockResolvedValue({ message: "m1", reactions: [] } as never);

		const { target, instance } = mountBar();
		expect(chips(target)[0].className).toContain("border-blue-400");
		chips(target)[0].click();
		await vi.waitFor(() => expect(delMock).toHaveBeenCalledWith(thumbsUpUrl));
		await vi.waitFor(() => {
			flushSync();
			expect(chips(target)).toHaveLength(0);
		});
		unmount(instance);
	});

	it("opens the quick picker, expands to the full set, and reacts from it", async () => {
		account.set({ _id: "me" } as never);
		putMock.mockResolvedValue({
			message: "m1",
			reactions: [{ emoji: "👍", users: [{ _id: "me", name: "myself" }] }],
		} as never);

		const { target, instance } = mountBar();
		const addButton = target.querySelector<HTMLButtonElement>("[aria-expanded]")!;
		expect(addButton).not.toBeNull();
		addButton.click();
		flushSync();

		const picker = target.querySelector<HTMLElement>("[role=menu]")!;
		// Quick set plus the "more" expander.
		expect(picker.querySelectorAll("button")).toHaveLength(CHAT_REACTION_QUICK.length + 1);

		const more = [...picker.querySelectorAll("button")].at(-1)!;
		more.click();
		flushSync();
		expect(target.querySelector<HTMLElement>("[role=menu]")!.querySelectorAll("button").length).toBeGreaterThan(
			CHAT_REACTION_QUICK.length + 1,
		);

		target.querySelector<HTMLElement>("[role=menu]")!.querySelector("button")!.click();
		await vi.waitFor(() => expect(putMock).toHaveBeenCalledWith(thumbsUpUrl));
		// Picker closes after reacting; chip appears from the applied response.
		await vi.waitFor(() => {
			flushSync();
			expect(target.querySelector("[role=menu]")).toBeNull();
			expect(chips(target)[0].textContent).toContain("👍");
		});
		unmount(instance);
	});
});
