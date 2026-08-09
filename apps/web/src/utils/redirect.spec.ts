import { describe, expect, it } from "vitest";
import { redirectLoggedOut } from "./redirect";

const url = (u: string) => new URL(u, "http://localhost");

describe("redirectLoggedOut", () => {
	it("allows same-origin absolute paths, with query", () => {
		expect(redirectLoggedOut(url("http://localhost/?redirect=/account"), null)).toBe("/account");
		expect(redirectLoggedOut(url("http://localhost/"), "/path?x=1&y=2")).toBe("/path?x=1&y=2");
	});

	it("prefers the form-field redirect over the query string", () => {
		expect(redirectLoggedOut(url("http://localhost/?redirect=/account"), "/boardgames")).toBe("/boardgames");
	});

	it("falls back to / when no target", () => {
		expect(redirectLoggedOut(url("http://localhost/"), null)).toBe("/");
		expect(redirectLoggedOut(url("http://localhost/"))).toBe("/");
	});

	it.each(["//evil.com", "https://evil.com", "http://evil.com/x"])("rejects external target %s", (bad) => {
		expect(redirectLoggedOut(url("http://localhost/"), bad)).toBe("/");
		expect(redirectLoggedOut(url(`http://localhost/?redirect=${encodeURIComponent(bad)}`), null)).toBe("/");
	});

	it("rejects backslashes (open-redirect bypass)", () => {
		expect(redirectLoggedOut(url("http://localhost/"), "/\\evil.com")).toBe("/");
		expect(redirectLoggedOut(url("http://localhost/"), "/foo\\bar")).toBe("/");
	});

	it("rejects ASCII control characters (invalid/injectable Location header)", () => {
		expect(redirectLoggedOut(url("http://localhost/"), "/foo\r\nSet-Cookie: x=1")).toBe("/");
		expect(redirectLoggedOut(url("http://localhost/"), "/foo\x7Fbar")).toBe("/"); // DEL
		expect(redirectLoggedOut(url("http://localhost/"), "/foo\x00bar")).toBe("/"); // NUL
	});
});
