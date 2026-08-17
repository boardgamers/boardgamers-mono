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

/**
 * True when the current SSR request carries a session cookie. Used to skip
 * cookie-authed calls (e.g. /account/mint) that would otherwise 401 for every
 * anonymous page view. Returns true when there is no request context
 * (prerender, websocket, …) — the caller then falls through to the mint call,
 * which 401s → null as before.
 */
export function currentRequestHasSession(): boolean {
	try {
		return !!getRequestEvent().locals.refreshToken;
	} catch {
		return true;
	}
}
