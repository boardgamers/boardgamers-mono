import { invalidateAll } from "$app/navigation";

// Games/pages are now loaded by +layout.ts and passed to Sidebar as data.
// These wrappers exist for backward-compat with pages that call them after mutations
// to refresh the sidebar — they now just invalidate the layout load.
export async function loadGames() {
	await invalidateAll();
}

export async function loadPages() {
	await invalidateAll();
}
