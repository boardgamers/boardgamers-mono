// Test stub for SvelteKit's virtual `$app/state` module (aliased in vitest.config.ts).
// The `page` object mirrors SvelteKit's full shape (params/route/error included) —
// Svelte 5 compiles `$app/state` imports through `$.get(...)` wrappers, and a partial
// stub confuses snippet arity checks in child components. `url`/`data` are mutable so
// specs can set the route and seed layout data (myBoardgames, user).
export const page = {
	url: new URL("http://localhost/") as URL,
	data: {} as Record<string, unknown>,
	params: {} as Record<string, string>,
	route: { id: "/" as string | null },
	status: 200,
	error: null as App.Error | null,
	form: undefined as unknown,
	state: {} as Record<string, unknown>,
};
export const navigating = null;
export const updated = { current: false };
