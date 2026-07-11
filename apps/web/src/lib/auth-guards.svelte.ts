import { goto } from "$app/navigation";
import { page } from "$app/stores";
import { skipOnce } from "@/utils";
import { redirectLoggedIn, redirectLoggedOut } from "@/utils/redirect";
import { onMount } from "svelte";
import { get as $ } from "svelte/store";
import { account } from "./stores.svelte";

export function useLoggedIn(): void {
  onMount(() => account.subscribe(skipOnce((val) => !val && goto(redirectLoggedIn($(page).url)))));
}

export function useLoggedOut(): void {
  onMount(() => account.subscribe(skipOnce((val) => val && goto(redirectLoggedOut($(page).url)))));
}
