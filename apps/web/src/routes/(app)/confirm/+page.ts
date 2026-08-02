import { redirect } from "@sveltejs/kit";
import type { PageLoad } from "./$types";
import { post } from "@/lib/api";
import { setAuthData, type AuthData } from "@/lib/account.svelte";

// Client-only: confirming sets auth (account store + session cookie) via setAuthData,
// which is browser-only. Not a data-display page — nothing meaningful to SSR.
export const ssr = false;

export const load: PageLoad = async ({ url }) => {
	await post<AuthData>("/account/confirm", {
		key: url.searchParams.get("key"),
		email: url.searchParams.get("email"),
	}).then(setAuthData);

	throw redirect(302, "/account");
};
