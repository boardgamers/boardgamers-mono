import { redirect } from "@sveltejs/kit";
import type { Actions } from "./$types";
import { resolve } from "$app/paths";
import { apiFetch } from "@/lib/api";
import { forwardSessionCookies } from "@/lib/auth.server";

/**
 * No-JS logout: a plain form POST (the appbar's Log out button) revokes the session
 * server-side and relays the API's cookie-clearing to the browser. With JS,
 * `use:enhance` intercepts the submit and logs out client-side instead (see
 * Layout/Appbar.svelte), so this action only runs without JS — after it, a full
 * navigation re-renders the page as anonymous.
 */
export const actions: Actions = {
	default: async (event) => {
		const response = await apiFetch("/account/signout", {
			method: "POST",
			// koa-bodyparser 415s a POST with no JSON content-type, even an empty one.
			body: "{}",
			headers: { "Content-Type": "application/json" },
		}).catch(() => null);
		if (response) {
			forwardSessionCookies(event, response);
		}
		throw redirect(303, resolve("/(app)"));
	},
};
