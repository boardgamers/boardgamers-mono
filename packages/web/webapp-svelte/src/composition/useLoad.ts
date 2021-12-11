import type { LoadInput } from "@sveltejs/kit";
import { loadSession, sessionData } from "./useSession";

type ReturnTypes<T> = T extends [...infer U, infer A]
  ? A extends (...args: unknown[]) => unknown
    ? ReturnType<A> & ReturnTypes<U>
    : void
  : void;

export function useLoad<T extends Array<(...args: unknown[]) => unknown>>(input: LoadInput, ...fns: T): ReturnTypes<T> {
  if (!sessionData.has(input.session)) {
    sessionData.set(input.session, { stores: new Map(), fetch: input.fetch });
  }
  loadSession.set(input.session);

  try {
    return Object.assign({}, ...fns.map((fn) => fn()));
  } finally {
    loadSession.set(null);
  }
}
