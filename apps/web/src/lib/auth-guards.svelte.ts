import { goto } from "$app/navigation";
import { resolve } from "$app/paths";
import { page } from "$app/state";
import { skipOnce } from "@/utils";
import { loginRedirectQuery, redirectLoggedOut } from "@/utils/redirect";
import { onMount } from "svelte";
import { account } from "./stores.svelte";

export function useLoggedIn(): void {
	onMount(() =>
		account.subscribe(
			skipOnce((val) => {
				if (val) return;
				const loginTarget = resolve("/(app)/login") + loginRedirectQuery(page.url);
				// eslint-disable-next-line svelte/no-navigation-without-resolve -- path is resolve()d above; the rule can't trace resolve() + query-string concatenation
				goto(loginTarget);
			}),
		),
	);
}

export function useLoggedOut(): void {
	onMount(() =>
		account.subscribe(
			skipOnce((val) => {
				if (!val) return;
				// redirectLoggedOut returns a same-origin path (possibly with a query string)
				// that's already been through the safe-target check — navigate directly; it is
				// NOT a route ID, so resolve() would mangle any '?query' into the pathname.
				// eslint-disable-next-line svelte/no-navigation-without-resolve -- safe same-origin path from redirectLoggedOut, not a route ID
				goto(redirectLoggedOut(page.url));
			}),
		),
	);
}
