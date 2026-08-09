import { resolve } from "$app/paths";

/** The redirect target carried to /login and back: same-origin path+query (never a full URL). */
function toRedirectTarget(url: URL): string {
	// No url.hash: it never reaches the server, and SvelteKit forbids reading it there.
	return url.pathname + url.search;
}

/**
 * Query string carrying the post-login redirect target. Kept separate from the
 * login path so callers can resolve() the path and append this verbatim —
 * resolve() only accepts plain pathnames, not query strings or full URLs.
 */
export function loginRedirectQuery(url: URL): string {
	return "?redirect=" + encodeURIComponent(toRedirectTarget(url));
}

export function redirectLoggedIn(url: URL): string {
	return resolve("/(app)/login") + loginRedirectQuery(url);
}

/**
 * Same-origin absolute path check, so a caller-supplied target can't be an open
 * redirect (protocol-relative //host included). ASCII control chars (\r, \n, …) are
 * rejected too — they'd produce an invalid / injectable Location header.
 */
function safeRedirectTarget(target: string | null | undefined): string | null {
	if (!target || !target.startsWith("/") || target.startsWith("//")) {
		return null;
	}
	// eslint-disable-next-line no-control-regex -- intentionally matching control chars to reject them
	return /[\x00-\x1f\x7f]/.test(target) ? null : target;
}

export function redirectLoggedOut(url: URL, formRedirect?: string | null): string {
	// Form actions honour this for no-JS logins: the appbar posts a hidden `redirect`
	// field, the login page's own flow uses the ?redirect= query string.
	return safeRedirectTarget(formRedirect) ?? safeRedirectTarget(url.searchParams.get("redirect")) ?? resolve("/(app)");
}
