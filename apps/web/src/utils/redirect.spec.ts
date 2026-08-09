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

	it("collapses a redirect back to the login page (avoids an infinite redirect loop)", () => {
		// A logged-in user hitting /login?redirect=/login would otherwise bounce to /login
		// and loop; the login guard sends it to the default route instead.
		expect(redirectLoggedOut(url("http://localhost/login?redirect=%2Flogin"), null)).toBe("/");
		expect(redirectLoggedOut(url("http://localhost/login"), "/login")).toBe("/");
		expect(redirectLoggedOut(url("http://localhost/login"), "/login?error=x")).toBe("/");
	});
});
