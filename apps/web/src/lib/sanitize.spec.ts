import { describe, expect, it, vi } from "vitest";

const loadSanitize = async (browser: boolean) => {
	vi.resetModules();
	vi.doMock("$app/environment", () => ({ browser }));
	const { sanitizeHtml } = await import("./sanitize");
	return sanitizeHtml;
};

const xss = '<p>hi</p><script>alert("xss")</script><img src="x" onerror="alert(1)">';

describe("sanitizeHtml", () => {
	it("strips XSS during SSR (jsdom-backed window)", async () => {
		const sanitizeHtml = await loadSanitize(false);
		expect(sanitizeHtml(xss)).toBe('<p>hi</p><img src="x">');
	});

	it("strips XSS in the browser branch (native window)", async () => {
		vi.stubGlobal("window", new (await import("jsdom")).JSDOM("").window);
		const sanitizeHtml = await loadSanitize(true);
		expect(sanitizeHtml(xss)).toBe('<p>hi</p><img src="x">');
		vi.unstubAllGlobals();
	});

	it("keeps regular markup", async () => {
		const sanitizeHtml = await loadSanitize(false);
		expect(sanitizeHtml('<strong>bold</strong> <a href="https://example.com">link</a>')).toBe(
			'<strong>bold</strong> <a href="https://example.com">link</a>',
		);
	});
});
