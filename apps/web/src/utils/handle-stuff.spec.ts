import { describe, expect, it } from "vitest";
import { humanizeIsoTimestamps } from "./handle-stuff";

describe("humanizeIsoTimestamps", () => {
	it("replaces an embedded ISO timestamp with a localized date", () => {
		const out = humanizeIsoTimestamps("You are muted from chat by a moderator until 2026-09-06T21:26:23.386Z.");
		expect(out).not.toContain("2026-09-06T21:26:23");
		expect(out).toContain("2026");
		expect(out).toMatch(/^You are muted from chat by a moderator until .+\.$/);
	});

	it("leaves messages without timestamps (and non-dates that merely look ISO-ish) alone", () => {
		expect(humanizeIsoTimestamps("Chat is temporarily disabled site-wide.")).toBe(
			"Chat is temporarily disabled site-wide.",
		);
		// Bare dates without a time part are not touched (could be ids/versions).
		expect(humanizeIsoTimestamps("version 2026-09-06 of the doc")).toBe("version 2026-09-06 of the doc");
	});
});
