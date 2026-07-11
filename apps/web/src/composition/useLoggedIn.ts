import { goto } from "$app/navigation";
import { page } from "$app/stores";
import { skipOnce } from "@/utils";
import { redirectLoggedIn } from "@/utils/redirect";
import { onMount } from "svelte";
import { get as $ } from "svelte/store";
import { account } from "@/lib/stores.svelte";

export function useLoggedIn(): void {
  onMount(() => account.subscribe(skipOnce((val) => !val && goto(redirectLoggedIn($(page).url)))));
}
