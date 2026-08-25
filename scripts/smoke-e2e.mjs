#!/usr/bin/env node
/**
 * CI smoke test: load the built web app's home page in headless Chromium and
 * fail on any client-side crash. This is the guard that catches the class of
 * bug where `vite build` and svelte-check pass but the bundle explodes in the
 * browser (e.g. mongodb leaking in via a runtime @bgs/models root import:
 * `class heritage t.EventEmitter is not an object or null` at hydration).
 *
 * Assumes the app is already serving (CI boots `node build` against the stub
 * api). Override the target with SMOKE_URL.
 *
 * Fails (exit 1) when:
 *   - the page throws an uncaught error / unhandled rejection (pageerror)
 *   - console.error fires (SvelteKit reports hydration failures there) — minus
 *     the documented benign filters below
 *   - the "Gaia Project" hero link is not visible (SSR markup never rendered)
 */
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

// playwright is a @bgs/web dependency, not a root one — resolve it from
// apps/web so this script can run from the repo root.
const require = createRequire(fileURLToPath(new URL("../apps/web/package.json", import.meta.url)));
const { chromium } = require("playwright");

const base = process.env.SMOKE_URL ?? "http://127.0.0.1:8612";

/**
 * Benign console.error noise, each with its reason:
 *  - /ws: the home layout opens a websocket to /ws; the stub stack has no ws
 *    server, so Chromium logs "WebSocket connection to 'ws://…' failed". The
 *    app treats this as a normal reconnect case, not an error.
 *  - stub 404s: the stub api has no route for a few fire-and-forget calls the
 *    home page makes against endpoints that exist on the real api (e.g. the
 *    error reporter POSTs /api/site/errors/report after the /ws failure). Each
 *    is a Chromium network-error log for a 404 the app already handles.
 */
const benignConsoleError = [
	/WebSocket connection to .*\/ws.* failed/i,
	/Failed to load resource: the server responded with a status of 404/,
];

const pageErrors = [];
const consoleErrors = [];

// CI sets PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH to Debian's chromium (the
// runner's podman setup intermittently fails to launch the playwright CDN
// binary); locally it falls back to the playwright-installed one.
// --no-sandbox: the job container runs as root, and Debian's chromium
// refuses to start as root without it ("Running as root without
// --no-sandbox is not supported").
const browser = await chromium.launch({
	...(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH
		? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH }
		: {}),
	args: ["--no-sandbox"],
});
try {
	const page = await browser.newPage();
	page.on("pageerror", (err) => pageErrors.push(String(err)));
	page.on("console", (msg) => {
		if (msg.type() !== "error") {
			return;
		}
		const text = msg.text();
		if (!benignConsoleError.some((pattern) => pattern.test(text))) {
			consoleErrors.push(text);
		}
	});

	try {
		await page.goto(base + "/", { waitUntil: "networkidle", timeout: 30_000 });
	} catch (err) {
		// A goto failure (connection refused, timeout, …) is a smoke failure
		// like any other — report it instead of crashing with a bare stack.
		consoleErrors.push(`page.goto failed: ${String(err).split("\n")[0]}`);
	}

	// Skip the hero assertion when goto already failed: the page is blank,
	// the check would only add a redundant error line.
	if (consoleErrors.length === 0) {
		const hero = page.getByRole("link", { name: "Gaia Project" }).first();
		if (!(await hero.isVisible().catch(() => false))) {
			consoleErrors.push('hero link "Gaia Project" not visible — SSR markup did not render');
		}
	}
} finally {
	await browser.close();
}

if (pageErrors.length > 0 || consoleErrors.length > 0) {
	for (const err of pageErrors) {
		console.error(`✖ pageerror: ${err}`);
	}
	for (const err of consoleErrors) {
		console.error(`✖ console.error: ${err}`);
	}
	console.error(
		`\nsmoke-e2e: FAILED (${pageErrors.length} pageerror(s), ${consoleErrors.length} console error(s)) at ${base}/`,
	);
	process.exit(1);
}

console.log(`smoke-e2e: OK — ${base}/ rendered, "Gaia Project" visible, no page errors, no console errors`);
