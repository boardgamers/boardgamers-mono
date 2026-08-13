import { describe, expect, it } from "vitest";
import { gameBadge, gameBasedOn, gameBasedOnLabel, gameDisplayName, gameEmoji, gameLabel } from "./game-label";

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

describe("gameDisplayName", () => {
	it("returns the label as-is when there is no alias", () => {
		expect(gameDisplayName({ label: " 🌏 Gaia Project" })).toBe("🌏 Gaia Project");
		expect(gameDisplayName({ label: " 🌏 Gaia Project" }, { emoji: false })).toBe("Gaia Project");
	});

	it("returns the alias with the label's emoji when set", () => {
		expect(gameDisplayName({ label: " 💎 Splendor", alias: "Gem Trader" })).toBe("💎 Gem Trader");
		expect(gameDisplayName({ label: " 💎 Splendor", alias: "Gem Trader" }, { emoji: false })).toBe("Gem Trader");
	});

	it("keeps an emoji-less label emoji-less, aliased or not", () => {
		expect(gameDisplayName({ label: " Container" })).toBe("Container");
		expect(gameDisplayName({ label: " Container", alias: "Box Baron" })).toBe("Box Baron");
	});

	it("returns an empty string without a game", () => {
		expect(gameDisplayName(null)).toBe("");
		expect(gameDisplayName(undefined)).toBe("");
	});
});

describe("gameBadge", () => {
	it("returns the label's emoji for a non-aliased game", () => {
		expect(gameBadge({ label: "🌏 Gaia Project" })).toBe("🌏");
	});

	it("returns the canonical label's emoji for an aliased game, not the alias initial", () => {
		// Regression: GameList used the alias's first letter ("T" for "Take 6") even
		// though the canonical label carries an emoji.
		expect(gameBadge({ label: "6️⃣ 6nimmt", alias: "Take 6" })).toBe("6️⃣");
		expect(gameBadge({ label: " 💎 Splendor", alias: "Gem Trader" })).toBe("💎");
	});

	it("falls back to the alias initial when the canonical label has no emoji", () => {
		expect(gameBadge({ label: " Container", alias: "Box Baron" })).toBe("B");
	});

	it("falls back to the label initial when there is no emoji and no alias", () => {
		expect(gameBadge({ label: " Container" })).toBe("C");
	});

	it("is empty without a game", () => {
		expect(gameBadge(null)).toBe("");
		expect(gameBadge(undefined)).toBe("");
	});
});

describe("gameBasedOn / gameBasedOnLabel", () => {
	it("returns the emoji-less canonical name for an aliased game", () => {
		const info = { label: " 💎 Splendor", alias: "Gem Trader" };
		expect(gameBasedOn(info)).toBe("Splendor");
		expect(gameBasedOnLabel(info)).toBe("Splendor rules");
	});

	it("is empty when there is no alias", () => {
		expect(gameBasedOn({ label: " 🌏 Gaia Project" })).toBe("");
		expect(gameBasedOnLabel({ label: " 🌏 Gaia Project" })).toBe("");
		expect(gameBasedOn(null)).toBe("");
	});
});
