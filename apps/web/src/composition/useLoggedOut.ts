import { goto } from "$app/navigation";
import { getStores } from "$app/stores";
import { skipOnce } from "@/utils";
import { redirectLoggedOut } from "@/utils/redirect";
import { onMount } from "svelte";
import { get as $ } from "svelte/store";
import { useAccount } from "./useAccount";

export function useLoggedOut(): void {
  const { page } = getStores();
  const { account } = useAccount();

  onMount(() => account.subscribe(skipOnce((val) => val && goto(redirectLoggedOut($(page))))));
}
