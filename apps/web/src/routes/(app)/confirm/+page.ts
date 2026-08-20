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
	const result = await post<(AuthData & { alreadyConfirmed?: boolean }) | { alreadyConfirmed: true }>(
		"/account/confirm",
		{
			key: url.searchParams.get("key"),
			email: url.searchParams.get("email"),
		},
	);

	// Re-opened/prefetched link: the API issues no session here (the key can't be
	// verified against a nulled confirmKey), so there's nothing to set — send the
	// user to log in with an explanation instead of a dead end.
	if ("alreadyConfirmed" in result && result.alreadyConfirmed) {
		notifier.info("Your account was already confirmed — please log in.");
		await goto(resolve("/(app)/login"));
		return;
	}

	await setAuthData(result as AuthData);

	// goto, not throw redirect(): setAuthData's invalidateAll() cancels the in-flight
	// initial navigation (direct load from the email link), which would swallow a
	// redirect thrown here and leave a blank page.
	await goto(resolve("/(app)/account"));
};
