import { getStores } from "$app/stores";
import type { Session } from "@/hooks";
import { get as $ } from "svelte/store";

export function useCached<K extends string, T>(key: K): { set: (val: T) => T; cached?: T } {
  const session = $(getStores().session) as Session;

  return {
    cached: session.composition[key],
    set: (val) => (session.composition[key] = val),
  };
}
