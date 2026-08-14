// Test stub for SvelteKit's virtual `$app/navigation` module, used when mounting
// components under vitest (the svelte plugin compiles imports through vite's resolver,
// which needs a real aliased file). Component specs never navigate, so these are no-ops.
export function invalidateAll(): Promise<void> {
	return Promise.resolve();
}
export function goto(): Promise<void> {
	return Promise.resolve();
}
export function afterNavigate(): void {}
export function beforeNavigate(): void {}
