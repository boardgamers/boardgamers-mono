import type { PageLoad } from "./$types";
import { goto } from "$app/navigation";
import { resolve } from "$app/paths";
import { post } from "@/lib/api";
import { setAuthData, type AuthData } from "@/lib/account.svelte";
import { notifier } from "@/lib/notifications.svelte";

// Client-only: confirming sets auth (account store + session cookie) via setAuthData,
// which is browser-only. Not a data-display page — nothing meaningful to SSR.
export const ssr = false;

export const load: PageLoad = async ({ url }) => {
	const { alreadyConfirmed, ...authData } = await post<AuthData & { alreadyConfirmed?: boolean }>("/account/confirm", {
		key: url.searchParams.get("key"),
		email: url.searchParams.get("email"),
	});
	await setAuthData(authData);

	// Re-opened/prefetched link: the API still authenticates, so land logged in with
	// an explanation instead of a dead end.
	if (alreadyConfirmed) {
		notifier.info("Your account was already confirmed — you're logged in.");
	}

	// goto, not throw redirect(): setAuthData's invalidateAll() cancels the in-flight
	// initial navigation (direct load from the email link), which would swallow a
	// redirect thrown here and leave a blank page.
	await goto(resolve("/(app)/account"));
};
