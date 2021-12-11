import { useSession } from "./useSession";

export function defineStore<T>(fn: () => T): () => T {
  return () => {
    const { data } = useSession();

    if (!data.stores!.has(fn)) {
      data.stores!.set(fn, fn());
    }

    return data.stores!.get(fn) as T;
  };
}
