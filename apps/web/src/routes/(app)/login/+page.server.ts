import { redirect } from "@sveltejs/kit";
import type { Actions, PageServerLoad } from "./$types";
import { apiFetch } from "@/lib/api";
import { forwardSessionCookies } from "@/lib/auth.server";
import { redirectLoggedOut, safeRedirectTarget } from "@/utils/redirect";

/**
 * Cross-host session handoff (admin "login as" → boardgamers.space/login?refreshToken=…).
 * The session cookie is host-only (#153), so the login-as response can only set it on
 * the admin host — instead the one-time code rides the URL and is exchanged here, on
 * the player-facing host: POST /account/session revokes it and sets this host's
 * session cookie, which we relay to the browser. Server-side (not +page.ts) so the
 * exchange also works without JS, and so the code never reaches client-side storage.
 */
async function exchangeHandoffCode(event: Parameters<PageServerLoad>[0]) {
	const { url } = event;
	const raw = url.searchParams.get("refreshToken");

	// Failure path: back to the login page with an error banner, the dead code dropped
	// from the URL (it's single-use — keeping it would just re-fail on refresh).
	const fail = (error: string): never => {
		const target = new URL(url);
		target.searchParams.delete("refreshToken");
		target.searchParams.set("error", error);
		throw redirect(303, target.pathname + target.search);
	};

	// The handoff payload is the API's refresh-token JSON ({ code, expiresAt }). Parse
	// defensively: a malformed value just fails the exchange with a login error.
	let code: string | null = null;
	try {
		const parsed: unknown = JSON.parse(raw!);
		if (parsed && typeof parsed === "object" && typeof (parsed as { code?: unknown }).code === "string") {
			code = (parsed as { code: string }).code;
		}
	} catch {
		code = null;
	}
	if (!code) {
		fail("Invalid login link");
	}

	const response = await apiFetch("/account/session", {
		method: "POST",
		body: JSON.stringify({ code }),
		headers: { "Content-Type": "application/json" },
	}).catch(() => null);

	if (!response?.ok) {
		fail("This login link has expired — please try again.");
	}

	// fail() throws (never returns), so response is a non-null ok Response here.
	forwardSessionCookies(event, response as Response);
	throw redirect(303, redirectLoggedOut(url));
}

/**
 * Server-side mirror of the client-side guard in +page.ts: without JS (e.g. after a
 * no-JS login redirect that bounces back here via ?redirect=/login), the fresh session
 * cookie makes parent() return the user — bounce to the target instead of looping.
 */
export const load: PageServerLoad = async (event) => {
	if (event.url.searchParams.has("refreshToken")) {
		await exchangeHandoffCode(event);
	}
	const { user } = await event.parent();
	if (user) {
		throw redirect(302, redirectLoggedOut(event.url));
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
			// No-JS path: bounce back to the login page with an error in the query string, which
			// the page's error banner renders. Only the redirect target is carried over (other
			// query params are dropped). With JS, use:enhance intercepts and shows fetch errors.
			// The API's message is forwarded verbatim (a 404's "<email> isn't registered" is
			// intentional — emails are already enumerable at account creation, and it's more
			// helpful). A network/transport failure (no response) gets a service-error message
			// instead of a credential one.
			const message = response
				? ((await response
						.json()
						.then((body) => body?.message)
						.catch(() => null)) ?? "Login failed")
				: "Couldn't reach the server — please try again.";
			const target = new URL(event.url);
			target.search = "";
			target.searchParams.set("error", message);
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
