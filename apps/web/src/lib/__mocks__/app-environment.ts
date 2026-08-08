// Test stub for SvelteKit's virtual `$app/environment` module, used when mounting
// components under vitest (vitest.setup.ts's vi.mock covers .ts imports, but the
// svelte plugin compiles .svelte imports through vite's resolver, which needs a real
// aliased file).
export const browser = true;
export const dev = false;
export const building = false;
export const version = "test";
