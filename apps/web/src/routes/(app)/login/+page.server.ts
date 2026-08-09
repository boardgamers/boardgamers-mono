import { redirect } from "@sveltejs/kit";
import type { Actions, PageServerLoad } from "./$types";
import { apiFetch } from "@/lib/api";
import { forwardSessionCookies } from "@/lib/auth.server";
import { redirectLoggedOut, safeRedirectTarget } from "@/utils/redirect";

/**
 * Server-side mirror of the client-side guard in +page.ts: without JS (e.g. after a
 * no-JS login redirect that bounces back here via ?redirect=/login), the fresh session
 * cookie makes parent() return the user — bounce to the target instead of looping.
 */
export const load: PageServerLoad = async ({ url, parent }) => {
	const { user } = await parent();
	if (user) {
		throw redirect(302, redirectLoggedOut(url));
	}
};

/**
 * No-JS login: a plain form POST. With JS, `use:enhance` intercepts the submit and
 * logs in client-side instead (see +page.svelte) — this action only runs without JS
 * (or when JS is disabled mid-session), then the API's session cookie is relayed to
 * the browser and a full navigation re-renders with the new identity.
 */
export const actions: Actions = {
	default: async (event) => {
		const form = await event.request.formData();
		const email = String(form.get("email") ?? "");
		const password = String(form.get("password") ?? "");

		// apiFetch returns the raw Response (no throw on 4xx — that path is the form's
		// error feedback), but a network/transport failure rejects the promise; catch it
		// and treat it like a failed login (response stays null) rather than a 500.
		const response = await apiFetch("/account/login", {
			method: "POST",
			body: JSON.stringify({ email, password }),
			headers: { "Content-Type": "application/json" },
		}).catch(() => null);

		if (!response?.ok) {
			// No-JS path: bounce back to the login page with the error in the query string,
			// which the page's error banner already renders. Preserve the existing query
			// (e.g. ?redirect=/somewhere) so a retry still returns to the original page.
			// (With JS, use:enhance intercepts the submit and shows fetch errors via handleError.)
			const message = response
				? await response
						.json()
						.then((body) => body?.message)
						.catch(() => null)
				: null;
			const target = new URL(event.url);
			target.search = "";
			target.searchParams.set("error", message ?? "Login failed");
			// Preserve the return page for a retry: from the query string (login page flow)
			// or the hidden form field (appbar login form). Apply the same strict same-origin
			// validation as the post-login redirect so an unsafe target isn't carried across retries.
			const returnTo = event.url.searchParams.get("redirect") ?? form.get("redirect");
			const safeReturnTo = typeof returnTo === "string" ? safeRedirectTarget(returnTo) : null;
			if (safeReturnTo) {
				target.searchParams.set("redirect", safeReturnTo);
			}
			throw redirect(303, target.pathname + target.search);
		}

		forwardSessionCookies(event, response);

		// The appbar's no-JS login form carries the return page as a hidden `redirect`
		// field (the login page's own flow uses the ?redirect= query string); both go
		// through redirectLoggedOut's same-origin check.
		const formRedirect = form.get("redirect");
		throw redirect(303, redirectLoggedOut(event.url, typeof formRedirect === "string" ? formRedirect : null));
	},
};
