// Test stub for SvelteKit's virtual `$app/state` module (aliased in vitest.config.ts).
// Only the `page` state is stubbed, with a mutable url so specs can set the route.
// `url` is typed as a plain URL (not SvelteKit's pathname-templated URL) so specs can
// assign arbitrary routes without fighting the route-id union type.
export const page = {
	url: new URL("http://localhost/") as URL,
};
export const navigating = null;
export const updated = { current: false };
