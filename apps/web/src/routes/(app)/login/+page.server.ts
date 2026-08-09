import { redirect } from "@sveltejs/kit";
import type { Actions, PageServerLoad } from "./$types";
import { apiFetch } from "@/lib/api";
import { forwardSessionCookies } from "@/lib/auth.server";
import { redirectLoggedOut } from "@/utils/redirect";

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
		// error feedback), so branch on the status.
		const response = await apiFetch("/account/login", {
			method: "POST",
			body: JSON.stringify({ email, password }),
			headers: { "Content-Type": "application/json" },
		});

		if (!response.ok) {
			// No-JS path: bounce back to the login page with the error in the query string,
			// which the page's error banner already renders. (With JS, use:enhance
			// intercepts the submit and shows fetch errors via handleError instead.)
			const message = await response
				.json()
				.then((body) => body?.message)
				.catch(() => null);
			redirect(303, `${event.url.pathname}?error=${encodeURIComponent(message ?? "Login failed")}`);
		}

		forwardSessionCookies(event, response);

		// The appbar's no-JS login form carries the return page as a hidden `redirect`
		// field (the login page's own flow uses the ?redirect= query string); both go
		// through redirectLoggedOut's same-origin check.
		const formRedirect = form.get("redirect");
		redirect(303, redirectLoggedOut(event.url, typeof formRedirect === "string" ? formRedirect : null));
	},
};
