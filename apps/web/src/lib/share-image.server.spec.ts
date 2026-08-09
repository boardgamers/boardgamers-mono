import { afterEach, describe, expect, it } from "vitest";
import { renderOrigin } from "./share-image.server";

// The internal screenshot must always navigate to the app's own http loopback server,
// never the public https origin (prod node speaks plain http behind nginx — see the
// renderOrigin comment). Resolution order: OG_RENDER_ORIGIN > http://<HOST>:<PORT>
// (HOST normalized to a connectable loopback) > http://127.0.0.1:8612.
describe("renderOrigin", () => {
	afterEach(() => {
		delete process.env.OG_RENDER_ORIGIN;
		delete process.env.HOST;
		delete process.env.PORT;
	});

	it("defaults to the adapter-node default on the http loopback", () => {
		expect(renderOrigin()).toBe("http://127.0.0.1:8612");
	});

	it("uses the listen PORT", () => {
		process.env.PORT = "4123";
		expect(renderOrigin()).toBe("http://127.0.0.1:4123");
	});

	it("honors an IPv4 HOST", () => {
		process.env.HOST = "127.0.0.1";
		process.env.PORT = "8612";
		expect(renderOrigin()).toBe("http://127.0.0.1:8612");
	});

	it("brackets an IPv6 HOST", () => {
		process.env.HOST = "::1";
		expect(renderOrigin()).toBe("http://[::1]:8612");
	});

	it("accepts an already-bracketed IPv6 HOST", () => {
		process.env.HOST = "[::1]";
		expect(renderOrigin()).toBe("http://[::1]:8612");
	});

	it("maps the IPv4 wildcard to the IPv4 loopback", () => {
		process.env.HOST = "0.0.0.0";
		expect(renderOrigin()).toBe("http://127.0.0.1:8612");
	});

	it("maps the IPv6 wildcard to the IPv6 loopback", () => {
		process.env.HOST = "::";
		expect(renderOrigin()).toBe("http://[::1]:8612");
	});

	it("OG_RENDER_ORIGIN wins over HOST/PORT and is stripped of trailing slashes", () => {
		process.env.HOST = "::";
		process.env.PORT = "4123";
		process.env.OG_RENDER_ORIGIN = "http://localhost:9999/";
		expect(renderOrigin()).toBe("http://localhost:9999");
	});
});
