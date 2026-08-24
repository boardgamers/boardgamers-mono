// Test stub for SvelteKit's virtual `$app/paths` module (aliased in vitest.config.ts).
// `resolve` maps the app's route IDs to their pathnames (no base path in tests) and
// substitutes `[param]` segments. Only the IDs actually exercised by specs are mapped.
const routes: Record<string, string> = {
	"/(app)": "/",
	"/(app)/games": "/games",
	"/(app)/login": "/login",
	// `[...part2]` is spelled `[part2]` here so the substitution below (which only
	// matches word characters) fills the rest segment too.
	"/(app)/page/[part1]/[...part2]": "/page/[part1]/[part2]",
};

// Matches the real resolve() shape; unlike the real one it leaves an unmatched
// `[param]` in place instead of throwing.
export function resolve(id: string, params?: Record<string, string>): string {
	return (routes[id] ?? id).replace(/\[(\w+)\]/g, (match, key) => params?.[key] ?? match);
}
export const base = "";
export const assets = "";
