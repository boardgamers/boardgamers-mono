import { JSDOM } from "jsdom";
import { vi } from "vitest";

// `$app/environment` is a SvelteKit virtual module that doesn't resolve under plain
// vitest — mock it globally. `SANITIZE_TEST_BROWSER=1 pnpm test` flips the suite to
// the browser branch (see sanitize.spec.ts).
vi.mock("$app/environment", () => ({
	browser: process.env.SANITIZE_TEST_BROWSER === "1",
	dev: false,
	building: false,
	version: "test",
}));

// Component tests (e.g. GameLog.spec.ts) mount Svelte components and import modules
// that touch `document`/`localStorage` at module scope. Give every test file a jsdom
// DOM up front so those imports resolve; per-test files can still re-stub via
// vi.stubGlobal if they need a fresh window.
const dom = new JSDOM("<!doctype html><html><body></body></html>", { url: "http://localhost/" });
vi.stubGlobal("window", dom.window);
vi.stubGlobal("document", dom.window.document);
vi.stubGlobal("localStorage", dom.window.localStorage);
vi.stubGlobal("navigator", dom.window.navigator);
