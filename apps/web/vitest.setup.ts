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
