import { goto } from "$app/navigation";
import { resolve } from "$app/paths";
import type { Pathname } from "$app/types";
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
				// Parameters<>-typed tuple pins resolve()'s single-string overload; tsgo doesn't
				// distribute a Pathname union over the tuple-union overloads (typescript-go#2125).
				goto(resolve(...([redirectLoggedOut(page.url) as Pathname] as Parameters<typeof resolve>)));
			}),
		),
	);
}
