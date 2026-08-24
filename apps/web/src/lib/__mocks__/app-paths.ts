// Test stub for SvelteKit's virtual `$app/paths` module (aliased in vitest.config.ts).
// `resolve` maps the app's route IDs to their pathnames (no base path in tests, no
// route params to substitute). Only the IDs actually exercised by specs are mapped.
const routes: Record<string, string> = {
	"/(app)": "/",
	"/(app)/games": "/games",
	"/(app)/login": "/login",
	"/(app)/page/[part1]/[...part2]": "/page",
};

// Matches the real resolve() shape; route params (when mapped) are appended path-style.
export function resolve(id: string, params?: Record<string, string>): string {
	const base = routes[id] ?? id;
	const rest = params ? Object.values(params).filter(Boolean).join("/") : "";
	return rest ? `${base}/${rest}` : base;
}
export const base = "";
export const assets = "";
