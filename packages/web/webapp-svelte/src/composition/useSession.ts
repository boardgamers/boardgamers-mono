import { getStores } from "$app/stores";
import type { Session } from "@/hooks";
import { get as $ } from "svelte/store";

export function useSession(): Session {
  return $(getStores().session) as Session;
}
