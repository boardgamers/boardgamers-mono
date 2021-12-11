import type { LoadInput } from "@sveltejs/kit";
import type { IterableElement } from "type-fest";
import { loadSession } from "./useSession";

export function useLoad<T extends Array<(...args: unknown[]) => unknown>>(
  input: LoadInput,
  ...fns: T
): ReturnType<IterableElement<T>> {
  input.session.fetch = input.fetch;

  input.session.toJSON = function (this) {
    const clone = { ...this };

    delete clone.toJSON;
    delete clone.fetch;
    delete clone.stores;

    return clone;
  };

  loadSession.set(input.session);

  try {
    return Object.assign({}, ...fns.map((fn) => fn()));
  } finally {
    loadSession.set(null);
  }
}
