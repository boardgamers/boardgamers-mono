// Timing presets on the new-game form (#377): named async/rapid/live combos fill
// timePerGame + timePerMove, Custom reveals the full duration dropdowns, and the
// initial values (form defaults or a remembered setup) preselect the matching
// preset — falling back to Custom when they match none.
import { flushSync, mount, unmount } from "svelte";
import { get } from "svelte/store";
import { beforeEach, describe, expect, it } from "vitest";
import { matchTimingPreset, timingPresets } from "@/lib/timing-presets";
import TimingSettingsHarness, { harTimePerGame, harTimePerMove } from "./TimingSettingsHarness.svelte";

const preset = (id: string) => timingPresets.find((p) => p.id === id)!;

function mountSettings() {
	const target = document.createElement("div");
	document.body.appendChild(target);
	const instance = mount(TimingSettingsHarness as never, { target });
	flushSync();
	return { target, instance };
}

function chips(target: HTMLElement): HTMLButtonElement[] {
	return [...target.querySelectorAll<HTMLButtonElement>('[role="radiogroup"] button')];
}

function pressed(target: HTMLElement): string | undefined {
	return chips(target)
		.find((c) => c.getAttribute("aria-pressed") === "true")
		?.textContent?.trim();
}

const selects = (target: HTMLElement) => target.querySelectorAll("select");

describe("matchTimingPreset", () => {
	it("maps each preset's values back to its id", () => {
		for (const p of timingPresets) {
			expect(matchTimingPreset(p.timePerGame, p.timePerMove)).toBe(p.id);
		}
	});

	it("returns null for values that match no preset", () => {
		expect(matchTimingPreset(600, 60)).toBeNull();
	});
});

describe("TimingSettings", () => {
	beforeEach(() => {
		document.body.innerHTML = "";
		// The long-standing form defaults — identical to the async preset.
		harTimePerGame.set(3 * 24 * 3600);
		harTimePerMove.set(2 * 3600);
	});

	it("preselects Async for the form defaults and hides the dropdowns", () => {
		const { target, instance } = mountSettings();

		expect(chips(target).map((c) => c.textContent?.trim())).toEqual(["🐢 Async", "🐇 Rapid", "⚡ Live", "Custom"]);
		expect(pressed(target)).toBe("🐢 Async");
		expect(selects(target)).toHaveLength(0);

		unmount(instance);
	});

	it("clicking a preset fills timePerGame and timePerMove", () => {
		const { target, instance } = mountSettings();

		chips(target)[2].click(); // ⚡ Live
		flushSync();
		expect(get(harTimePerGame)).toBe(preset("live").timePerGame);
		expect(get(harTimePerMove)).toBe(preset("live").timePerMove);
		expect(pressed(target)).toBe("⚡ Live");

		chips(target)[1].click(); // 🐇 Rapid
		flushSync();
		expect(get(harTimePerGame)).toBe(preset("rapid").timePerGame);
		expect(get(harTimePerMove)).toBe(preset("rapid").timePerMove);
		expect(pressed(target)).toBe("🐇 Rapid");

		unmount(instance);
	});

	it("Custom reveals the dropdowns and keeps the current values", () => {
		const { target, instance } = mountSettings();

		chips(target)[3].click();
		flushSync();
		expect(pressed(target)).toBe("Custom");
		const [game, move] = [...selects(target)];
		expect(+game.value).toBe(3 * 24 * 3600);
		expect(+move.value).toBe(2 * 3600);

		// Editing a field stays in custom mode, even when the values coincide
		// with a preset.
		game.value = String(preset("live").timePerGame);
		game.dispatchEvent(new Event("change"));
		move.value = String(preset("live").timePerMove);
		move.dispatchEvent(new Event("change"));
		flushSync();
		expect(get(harTimePerGame)).toBe(preset("live").timePerGame);
		expect(pressed(target)).toBe("Custom");
		expect(selects(target)).toHaveLength(2);

		unmount(instance);
	});

	it("switching back from Custom to a preset hides the dropdowns again", () => {
		const { target, instance } = mountSettings();

		chips(target)[3].click();
		flushSync();
		chips(target)[0].click(); // 🐢 Async
		flushSync();
		expect(pressed(target)).toBe("🐢 Async");
		expect(selects(target)).toHaveLength(0);

		unmount(instance);
	});

	it("preselects the matching preset for remembered values (recall path)", () => {
		harTimePerGame.set(preset("live").timePerGame);
		harTimePerMove.set(preset("live").timePerMove);
		const { target, instance } = mountSettings();

		expect(pressed(target)).toBe("⚡ Live");
		expect(selects(target)).toHaveLength(0);

		unmount(instance);
	});

	it("starts in Custom when remembered values match no preset", () => {
		harTimePerGame.set(24 * 3600);
		harTimePerMove.set(3600);
		const { target, instance } = mountSettings();

		expect(pressed(target)).toBe("Custom");
		const [game, move] = [...selects(target)];
		expect(+game.value).toBe(24 * 3600);
		expect(+move.value).toBe(3600);

		unmount(instance);
	});
});
