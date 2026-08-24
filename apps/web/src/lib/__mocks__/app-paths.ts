// Test stub for SvelteKit's virtual `$app/paths` module (aliased in vitest.config.ts).
// `resolve` maps the app's route IDs to their pathnames (no base path in tests) and
// substitutes `[param]` segments. Only the IDs actually exercised by specs are mapped.
const routes: Record<string, string> = {
	"/(app)": "/",
	"/(app)/games": "/games",
	"/(app)/login": "/login",
};

// Matches the real resolve() shape; unlike the real one it leaves an unmatched
// `[param]` in place instead of throwing.
export function resolve(id: string, params?: Record<string, string>): string {
	return (routes[id] ?? id).replace(/\[(\w+)\]/g, (match, key) => params?.[key] ?? match);
}
export const base = "";
export const assets = "";
