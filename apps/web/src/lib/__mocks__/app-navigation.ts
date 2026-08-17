// Test stub for SvelteKit's virtual `$app/navigation` module (aliased in
// vitest.config.ts). `goto` is a spy so specs can assert navigation (e.g. the
// logged-out like button redirecting to /login); the rest are no-ops.
import { vi } from "vitest";

export const goto = vi.fn((): Promise<void> => Promise.resolve());
export function invalidateAll(): Promise<void> {
	return Promise.resolve();
}
export function afterNavigate(): void {}
export function beforeNavigate(): void {}
