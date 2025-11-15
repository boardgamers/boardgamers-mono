import { browser } from "$app/env";
import { onDestroy } from "svelte";
import type { Readable } from "svelte/store";
import { get as $, writable } from "svelte/store";

const counter = writable(0);

export function useUniqueComponent(): { current: number; counter: Readable<number> } {
  counter.update((val) => val + 1);

  if (!browser) {
    onDestroy(() => counter.update((val) => val - 1));
  }

  // I would rather return a boolean in a store, but I don't know how to not leave dangling subscriptions
  // in SSR, as onDestroy doesn't work there
  return {
    current: $(counter),
    counter,
  };
}
