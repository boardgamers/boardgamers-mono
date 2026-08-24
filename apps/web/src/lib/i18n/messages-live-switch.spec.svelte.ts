// Live language-switch invariant (#306): calling switchLanguage() re-renders
// every mounted `m.*()` string in the new language WITHOUT a remount/reload.
// Regresses against the message proxy doing its store read at property-ACCESS
// time (outside the render effect, so Svelte 5 never tracked it): the read
// must happen inside the wrapped message function, at CALL time.
import { flushSync, mount, unmount } from "svelte";
import { describe, expect, it } from "vitest";
import { switchLanguage } from "./messages";
import LanguageSwitchProbe from "./LanguageSwitchProbe.svelte";

describe("i18n live language switch (#306)", () => {
	it("re-renders m.*() strings on language switch without remount", async () => {
		const target = document.createElement("div");
		document.body.appendChild(target);
		const instance = mount(LanguageSwitchProbe, { target });
		flushSync();
		expect(target.querySelector("[data-testid=probe]")!.textContent).toBe("No games to show");

		await switchLanguage("de");
		flushSync();
		expect(target.querySelector("[data-testid=probe]")!.textContent).toBe("Keine Spiele vorhanden");

		await switchLanguage("en");
		flushSync();
		expect(target.querySelector("[data-testid=probe]")!.textContent).toBe("No games to show");

		unmount(instance);
		target.remove();
	});
});
