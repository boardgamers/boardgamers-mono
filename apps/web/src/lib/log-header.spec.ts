import { describe, expect, it } from "vitest";
import { logHeader } from "./log-header";

describe("logHeader", () => {
	it("returns null for a missing/empty header", () => {
		expect(logHeader(null)).toBeNull();
		expect(logHeader(undefined)).toBeNull();
		expect(logHeader("")).toBeNull();
		expect(logHeader("   ")).toBeNull();
	});

	it("trims the value", () => {
		expect(logHeader("  Mozilla/5.0  ")).toBe("Mozilla/5.0");
	});

	it("truncates to 200 chars", () => {
		const long = `Mozilla/5.0 ${"x".repeat(500)}`;
		const result = logHeader(long);
		expect(result).toHaveLength(200);
		expect(result).toBe(long.slice(0, 200));
	});

	it("strips control chars so a crafted header can't forge log lines", () => {
		expect(logHeader("bot\r\ninjected\tfield")).toBe("bot  injected field");
	});
});
