import assert from "node:assert/strict";
import { describe, it } from "node:test";

/**
 * Re-implements webHost()'s resolution logic against an explicit hostname, so the
 * hostname → public-host mapping is covered by node --test (utils.ts itself reads
 * `location` / `import.meta.env`, which only exist inside vite; the regexes below
 * are copied verbatim from webHost()).
 */
function resolveWebHost(hostname: string, viteWebHost?: string): string {
	if (viteWebHost) {
		return `http://${viteWebHost}`;
	}
	if (hostname === "localhost" || /^\d{1,3}(\.\d{1,3}){3}$/.test(hostname)) {
		return "http://localhost:8612";
	}
	return `//${hostname.replace(/^admin\./, "")}`;
}

describe("webHost", () => {
	it("strips the admin. subdomain on prod", () => {
		assert.equal(resolveWebHost("admin.boardgamers.space"), "//boardgamers.space");
	});

	it("leaves preview hosts (no admin. prefix) untouched", () => {
		assert.equal(resolveWebHost("pr-123.boardgamers.space"), "//pr-123.boardgamers.space");
	});

	it("resolves localhost to the local web dev server", () => {
		assert.equal(resolveWebHost("localhost"), "http://localhost:8612");
	});

	it("resolves raw IPs (devcontainer instance IPs) to the local web dev server", () => {
		assert.equal(resolveWebHost("127.0.0.5"), "http://localhost:8612");
	});

	it("honours the VITE_web_host override in dev", () => {
		assert.equal(resolveWebHost("localhost", "127.0.0.1:8612"), "http://127.0.0.1:8612");
	});
});
