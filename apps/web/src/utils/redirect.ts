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
 * redirect. Rejects: protocol-relative //host, backslashes (user agents treat `\`
 * as a path separator when parsing redirects, so `/\evil.com` is an open redirect),
 * and ASCII control chars (\r, \n, …) which would make an invalid/injectable Location.
 */
export function safeRedirectTarget(target: string | null | undefined): string | null {
	if (!target || !target.startsWith("/") || target.startsWith("//") || target.includes("\\")) {
		return null;
	}
	return /[\x00-\x1f\x7f]/.test(target) ? null : target;
}

export function redirectLoggedOut(url: URL, formRedirect?: string | null): string {
	// Form actions honour this for no-JS logins: the appbar posts a hidden `redirect`
	// field, the login page's own flow uses the ?redirect= query string.
	const target = safeRedirectTarget(formRedirect) ?? safeRedirectTarget(url.searchParams.get("redirect"));
	// Collapse a redirect back to the login page itself to the default — otherwise the
	// logged-in login guard bounces to /login, which bounces to /login, looping forever.
	if (target && new URL(target, url).pathname === resolve("/(app)/login")) {
		return resolve("/(app)");
	}
	return target ?? resolve("/(app)");
}
