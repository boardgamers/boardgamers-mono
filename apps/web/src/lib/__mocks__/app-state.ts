// Test stub for SvelteKit's virtual `$app/state` module (aliased in vitest.config.ts).
// Only the `page` state is stubbed, with a mutable url so specs can set the route.
export const page = {
	url: new URL("http://localhost/"),
};
