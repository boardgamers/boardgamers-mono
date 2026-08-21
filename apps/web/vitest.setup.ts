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
// Svelte's attribute setter walks an element's prototype chain up to the global
// `Element`; jsdom nodes are created from the jsdom realm's Element, so the
// walk must compare against that one (otherwise it walks past it into null).
vi.stubGlobal("Element", dom.window.Element);

// jsdom doesn't implement matchMedia, but modules like `lib/theme.ts` call it at
// module scope when the browser branch is active (SANITIZE_TEST_BROWSER=1). Stub it
// on the jsdom window here — a stub inside a spec file would land after that spec's
// ESM imports hoist.
if (!dom.window.matchMedia) {
	dom.window.matchMedia = ((query: string) => ({
		matches: false,
		media: query,
		addEventListener() {},
		removeEventListener() {},
		addListener() {},
		removeListener() {},
		dispatchEvent: () => false,
	})) as typeof window.matchMedia;
}
