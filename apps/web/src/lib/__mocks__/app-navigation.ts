// Test stub for SvelteKit's virtual `$app/navigation` module (aliased in
// vitest.config.ts). Navigation is a no-op in component specs.
export function goto(): Promise<void> {
	return Promise.resolve();
}
export function invalidateAll(): Promise<void> {
	return Promise.resolve();
}
