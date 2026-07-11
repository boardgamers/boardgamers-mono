import { logoClick } from "@/lib/stores.svelte";
import { writable } from "svelte/store";

// Backward compat: old code used useLogoClicks().logoClicks as a store.
export const logoClicks = writable(0);

export function useLogoClicks() {
  return {
    logoClicks,
    logoClick,
  };
}
