import { goto } from "$app/navigation";
import { getStores } from "$app/stores";
import { skipOnce } from "@/utils";
import { redirectLoggedIn } from "@/utils/redirect";
import { onMount } from "svelte";
import { get as $ } from "svelte/store";
import { useAccount } from "./useAccount";

export function useLoggedIn(): void {
  const { page } = getStores();
  const { account } = useAccount();

  onMount(() => account.subscribe(skipOnce((val) => !val && goto(redirectLoggedIn($(page).url)))));
}
