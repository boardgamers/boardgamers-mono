// Test stub for SvelteKit's virtual `$app/paths` module (aliased in vitest.config.ts).
// `resolve` maps the app's route IDs to their pathnames (no base path in tests, no
// route params to substitute). Only the IDs actually exercised by specs are mapped.
const routes: Record<string, string> = {
	"/(app)": "/",
	"/(app)/login": "/login",
};

export function resolve(id: string): string {
	return routes[id] ?? id;
}
export const base = "";
export const assets = "";
