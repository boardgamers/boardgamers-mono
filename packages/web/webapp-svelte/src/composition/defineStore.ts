import { patchSession, useSession } from "./useSession";

export function defineStore<T>(fn: () => T): () => T {
  return () => {
    const session = useSession();

    if (!session.stores) {
      session.stores = new Map();

      patchSession(session);
    }

    if (!session.stores.has(fn)) {
      session.stores.set(fn, fn());
    }

    return session.stores.get(fn) as T;
  };
}
