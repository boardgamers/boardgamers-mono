import { flushSync, mount, unmount } from "svelte";
import { beforeEach, describe, expect, it, vi } from "vitest";

// Browser branch: the picker's recently-used list is localStorage-backed and only
// active with `browser: true`.
vi.mock("$app/environment", () => ({ browser: true, dev: false, building: false, version: "test" }));
// Leaf/container components with a `$props()` rest-spread crash in the jsdom/svelte
// vitest env (see the stubs in src/lib/__mocks__).
vi.mock("@/modules/cdk", async () => ({
	InputGroup: (await import("@/lib/__mocks__/PassthroughStub.svelte")).default,
	Button: (await import("@/lib/__mocks__/ButtonStub.svelte")).default,
	Input: (await import("@/lib/__mocks__/InputStub.svelte")).default,
}));

import ChatInput from "./ChatInput.svelte";

function mountInput(onsend = vi.fn()) {
	const target = document.createElement("div");
	document.body.appendChild(target);
	const instance = mount(ChatInput as never, { target, props: { onsend } });
	flushSync();
	return { target, instance, onsend };
}

function emojiToggle(target: HTMLElement): HTMLButtonElement {
	const button = [...target.querySelectorAll("button")].find((b) => b.textContent?.includes("🙂"));
	expect(button, "emoji toggle button").toBeTruthy();
	return button!;
}

function picker(target: HTMLElement): HTMLElement | null {
	return target.querySelector('[data-testid="emoji-picker"]');
}

// The picker component is lazy-loaded ({#await import(…)}), so opening it needs a
// few microtask turns before the grid is in the DOM.
async function openPicker(target: HTMLElement): Promise<HTMLElement> {
	emojiToggle(target).click();
	flushSync();
	await vi.waitFor(() => expect(picker(target)).toBeTruthy());
	flushSync();
	return picker(target)!;
}

function chatInput(target: HTMLElement): HTMLInputElement {
	return target.querySelector('input[type="text"]')!;
}

function setInputValue(target: HTMLElement, value: string) {
	const input = chatInput(target);
	input.value = value;
	input.dispatchEvent(new window.Event("input", { bubbles: true }));
	flushSync();
	return input;
}

describe("ChatInput emoji picker", () => {
	beforeEach(() => {
		document.body.innerHTML = "";
		localStorage.clear();
	});

	it("opens the lazy-loaded picker from the 🙂 button and closes it on a second click", async () => {
		const { target, instance } = mountInput();
		expect(picker(target)).toBeNull();

		await openPicker(target);
		expect(picker(target)!.querySelectorAll("button").length).toBeGreaterThan(20);

		emojiToggle(target).click();
		flushSync();
		expect(picker(target)).toBeNull();
		unmount(instance);
	});

	it("inserts the picked emoji at the caret without replacing the text", async () => {
		const { target, instance } = mountInput();
		const input = setInputValue(target, "helloworld");

		const pickerEl = await openPicker(target);
		input.setSelectionRange(5, 5);
		const emojiButton = [...pickerEl.querySelectorAll<HTMLButtonElement>('[role="option"]')].find(
			(b) => b.textContent?.trim() === "😀",
		)!;
		emojiButton.click();
		flushSync();
		await vi.waitFor(() => expect(input.value).toBe("hello😀world"));
		// Caret lands right after the inserted emoji, ready for more typing.
		expect(input.selectionStart).toBe(5 + "😀".length);
		// Picker stays open for multi-emoji picks; the pick lands in "recently used".
		expect(picker(target)).toBeTruthy();
		expect(JSON.parse(localStorage.getItem("chat-emoji-recent")!)).toContain("😀");
		unmount(instance);
	});

	it("replaces a selection range with the picked emoji", async () => {
		const { target, instance } = mountInput();
		const input = setInputValue(target, "goodbye");

		const pickerEl = await openPicker(target);
		input.setSelectionRange(0, 4);
		pickerEl.querySelector<HTMLButtonElement>('[role="option"]')!.click();
		await vi.waitFor(() => expect(input.value.endsWith("bye")).toBe(true));
		expect(input.value).not.toContain("good");
		unmount(instance);
	});

	it("sends the message (picker closed) on submit", async () => {
		const { target, instance, onsend } = mountInput();
		const input = setInputValue(target, "hi there");
		await openPicker(target);

		input.form!.dispatchEvent(new window.Event("submit", { bubbles: true, cancelable: true }));
		flushSync();
		expect(onsend).toHaveBeenCalledWith("hi there");
		expect(input.value).toBe("");
		expect(picker(target)).toBeNull();
		unmount(instance);
	});

	it("closes on Escape from the input field without bubbling to the chat modal", async () => {
		const { target, instance } = mountInput();
		await openPicker(target);

		const documentEsc = vi.fn();
		document.addEventListener("keydown", documentEsc);
		chatInput(target).dispatchEvent(new window.KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
		flushSync();
		document.removeEventListener("keydown", documentEsc);
		expect(picker(target)).toBeNull();
		// The chat Modal closes on document-level Escape — the picker's Escape must not reach it.
		expect(documentEsc).not.toHaveBeenCalled();
		unmount(instance);
	});

	it("closes on Escape from inside the picker", async () => {
		const { target, instance } = mountInput();
		const pickerEl = await openPicker(target);

		pickerEl
			.querySelector("button")!
			.dispatchEvent(new window.KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
		flushSync();
		expect(picker(target)).toBeNull();
		unmount(instance);
	});

	it("closes on a pointer press outside the input row", async () => {
		const { target, instance } = mountInput();
		await openPicker(target);

		document.body.dispatchEvent(new window.MouseEvent("pointerdown", { bubbles: true }));
		flushSync();
		expect(picker(target)).toBeNull();
		unmount(instance);
	});

	it("keeps the picker open on a pointer press inside the input row", async () => {
		const { target, instance } = mountInput();
		await openPicker(target);

		chatInput(target).dispatchEvent(new window.MouseEvent("pointerdown", { bubbles: true }));
		flushSync();
		expect(picker(target)).toBeTruthy();
		unmount(instance);
	});

	it("renders all category sections in one scrollable list and jumps from the header row", async () => {
		const { target, instance } = mountInput();
		const pickerEl = await openPicker(target);

		// All sections flow continuously (no recents: localStorage is clean).
		const sections = [...pickerEl.querySelectorAll<HTMLElement>("[data-section]")];
		expect(sections.map((s) => s.dataset.section)).toEqual([
			"smileys",
			"people",
			"nature",
			"food",
			"activities",
			"objects",
			"symbols",
		]);

		const tabs = [...pickerEl.querySelectorAll<HTMLButtonElement>('[role="tab"]')];
		expect(tabs.length).toBe(7);
		expect(tabs[0].getAttribute("aria-selected")).toBe("true");
		tabs.at(-1)!.click();
		flushSync();
		// The jump highlights the target section (scroll spy takes over on scroll).
		expect(tabs.at(-1)!.getAttribute("aria-selected")).toBe("true");
		expect(tabs[0].getAttribute("aria-selected")).toBe("false");
		unmount(instance);
	});

	it("filters emoji as you type in the search input", async () => {
		const { target, instance } = mountInput();
		const pickerEl = await openPicker(target);

		const search = pickerEl.querySelector<HTMLInputElement>('input[type="search"]')!;
		search.value = "pizza";
		search.dispatchEvent(new window.Event("input", { bubbles: true }));
		flushSync();

		const options = [...pickerEl.querySelectorAll<HTMLButtonElement>('[role="option"]')];
		expect(options.map((o) => o.textContent?.trim())).toEqual(["🍕"]);
		// The category sections are replaced by a single results section while searching.
		const sections = [...pickerEl.querySelectorAll<HTMLElement>("[data-section]")];
		expect(sections.map((s) => s.dataset.section)).toEqual(["search"]);

		// Clearing the query brings the sections back.
		search.value = "";
		search.dispatchEvent(new window.Event("input", { bubbles: true }));
		flushSync();
		expect(pickerEl.querySelectorAll("[data-section]").length).toBe(7);
		unmount(instance);
	});

	it("shows an empty state when the search matches nothing", async () => {
		const { target, instance } = mountInput();
		const pickerEl = await openPicker(target);

		const search = pickerEl.querySelector<HTMLInputElement>('input[type="search"]')!;
		search.value = "zzzzzz";
		search.dispatchEvent(new window.Event("input", { bubbles: true }));
		flushSync();
		expect(pickerEl.querySelectorAll('[role="option"]').length).toBe(0);
		expect(pickerEl.textContent).toContain("No emoji found");
		unmount(instance);
	});

	it("picks the first search result on Enter without submitting the chat form", async () => {
		const { target, instance, onsend } = mountInput();
		const pickerEl = await openPicker(target);

		const search = pickerEl.querySelector<HTMLInputElement>('input[type="search"]')!;
		search.value = "trophy";
		search.dispatchEvent(new window.Event("input", { bubbles: true }));
		flushSync();
		search.dispatchEvent(new window.KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }));
		flushSync();

		await vi.waitFor(() => expect(chatInput(target).value).toBe("🏆"));
		expect(onsend).not.toHaveBeenCalled();
		expect(JSON.parse(localStorage.getItem("chat-emoji-recent")!)).toContain("🏆");
		unmount(instance);
	});

	it("shows a recently-used section first, seeded from localStorage", async () => {
		localStorage.setItem("chat-emoji-recent", JSON.stringify(["🎲", "🏆"]));
		const { target, instance } = mountInput();
		const pickerEl = await openPicker(target);

		const sections = [...pickerEl.querySelectorAll<HTMLElement>("[data-section]")];
		expect(sections[0].dataset.section).toBe("recent");
		const recentOptions = [...sections[0].querySelectorAll<HTMLButtonElement>('[role="option"]')];
		expect(recentOptions.map((o) => o.textContent?.trim())).toEqual(["🎲", "🏆"]);
		unmount(instance);
	});
});
