import { describe, expect, it } from "vitest";
import { gameEmoji, gameLabel } from "./game-label";

describe("gameEmoji", () => {
	it("extracts the leading emoji from a label", () => {
		expect(gameEmoji("🌏 Gaia Project")).toBe("🌏");
	});

	it("extracts emoji with variation selectors", () => {
		expect(gameEmoji("⚡️ Powergrid")).toBe("⚡️");
	});

	it("returns an empty string when the label has no emoji", () => {
		expect(gameEmoji("Container")).toBe("");
		expect(gameEmoji(" Container")).toBe("");
		// gameLabel quirk: a one-word label is ALL "emoji slot" (gameLabel returns "") —
		// still a plain word, so no emoji.
		expect(gameEmoji("6nimmt")).toBe("");
	});

	it("is the inverse of gameLabel", () => {
		for (const label of ["🌏 Gaia Project", "⚡️ Powergrid", " Container"]) {
			const emoji = gameEmoji(label);
			expect(emoji ? `${emoji} ${gameLabel(label)}` : gameLabel(label)).toBe(label.trim());
		}
	});
});

describe("gameLabel", () => {
	it("strips the leading emoji", () => {
		expect(gameLabel("🌏 Gaia Project")).toBe("Gaia Project");
	});
});
