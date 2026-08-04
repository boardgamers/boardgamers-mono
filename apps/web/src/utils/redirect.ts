import { resolve } from "$app/paths";

/**
 * Query string carrying the post-login redirect target. Kept separate from the
 * login path so callers can resolve() the path and append this verbatim —
 * resolve() only accepts plain pathnames, not query strings or full URLs.
 */
export function loginRedirectQuery(url: URL): string {
	return "?redirect=" + encodeURIComponent(url.href);
}

export function redirectLoggedIn(url: URL): string {
	return resolve("/(app)/login?redirect=") + url.href;
}

export function redirectLoggedOut(url: URL): string {
	return url.searchParams.get("redirect") ?? resolve("/(app)");
}
