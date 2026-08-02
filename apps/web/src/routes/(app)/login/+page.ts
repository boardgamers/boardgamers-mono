import { redirect } from "@sveltejs/kit";
import type { PageLoad } from "./$types";
import { account, loadAccount } from "@/lib/account.svelte";
import { redirectLoggedOut } from "@/utils/redirect";
import { get as $ } from "svelte/store";

export const ssr = false;

export const load: PageLoad = async ({ url }) => {
	// After an auth redirect (e.g. social login), the API has set the session cookie —
	// just load the account (cookie-auth) and bounce away if already logged in.
	if (url.searchParams.has("refreshToken") || url.searchParams.has("auth")) {
		await loadAccount();
	}

	if ($(account)) {
		throw redirect(302, redirectLoggedOut(url));
	}

	return {};
};
