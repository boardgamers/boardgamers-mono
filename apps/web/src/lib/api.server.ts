import { getRequestEvent } from "$app/server";

/**
 * Server-only (this module is stripped from the client bundle by SvelteKit's `.server`
 * convention). Returns the current request's `event.fetch`, or null when there is no
 * request context (prerender, websocket, etc.) — `getRequestEvent()` throws in that case.
 */
export function currentEventFetch(): typeof fetch | null {
	try {
		return getRequestEvent().fetch;
	} catch {
		return null;
	}
}
