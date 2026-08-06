import { describe, expect, it, vi } from "vitest";

// Branch under test is selected by vitest.setup.ts: default run is the SSR
// (jsdom-backed) branch; `SANITIZE_TEST_BROWSER=1 pnpm test` re-runs the suite with
// $app/environment.browser = true (native-window branch). A fresh jsdom window is
// stubbed in per browser test because DOMPurify@2 hooks its window lazily, on first
// sanitize.
const { browser } = await import("$app/environment");

const loadSanitize = async () => {
	vi.resetModules();
	const { sanitizeHtml } = await import("./sanitize");
	return sanitizeHtml;
};

const xss = '<p>hi</p><script>alert("xss")</script><img src="x" onerror="alert(1)">';

describe(`sanitizeHtml (${browser ? "browser" : "SSR"} branch)`, () => {
	it("strips XSS", async () => {
		if (browser) {
			vi.stubGlobal("window", new (await import("jsdom")).JSDOM("").window);
		}
		const sanitizeHtml = await loadSanitize();
		expect(sanitizeHtml(xss)).toBe('<p>hi</p><img src="x">');
		vi.unstubAllGlobals();
	});

	it("keeps regular markup", async () => {
		if (browser) {
			vi.stubGlobal("window", new (await import("jsdom")).JSDOM("").window);
		}
		const sanitizeHtml = await loadSanitize();
		expect(sanitizeHtml('<strong>bold</strong> <a href="https://example.com">link</a>')).toBe(
			'<strong>bold</strong> <a href="https://example.com">link</a>',
		);
		vi.unstubAllGlobals();
	});
});
