// Test stub for SvelteKit's virtual `$app/navigation` module (aliased in
// vitest.config.ts). `goto` is a spy so specs can assert navigation (e.g. the
// logged-out like button redirecting to /login); `replaceState` applies the URL
// to the `$app/state` mock's `page.url` so URL-syncing components (lobby pace
// filter) can be asserted; the rest are no-ops.
import { vi } from "vitest";
import { page } from "./app-state";

export const goto = vi.fn((): Promise<void> => Promise.resolve());
export function replaceState(url: string | URL): void {
	page.url = new URL(url);
}
export function invalidateAll(): Promise<void> {
	return Promise.resolve();
}
export function afterNavigate(): void {}
export function beforeNavigate(): void {}
