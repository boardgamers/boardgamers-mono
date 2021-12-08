import { getStores } from "$app/stores";
import { get as $ } from "svelte/store";

export function defineStore<T>(fn: () => T): () => T {
  return () => {
    const session = $(getStores().session) as { stores: Map<unknown, unknown> };

    if (!session.stores) {
      session.stores = new Map();
    }

    if (!session.stores.has(fn)) {
      session.stores.set(fn, fn());
    }

    return session.stores.get(fn) as T;
  };
}
