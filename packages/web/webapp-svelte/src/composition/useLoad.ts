import type { LoadInput } from "@sveltejs/kit";
import { loadSession, patchSession } from "./useSession";

type ReturnTypes<T> = T extends [...infer U, infer A]
  ? A extends (...args: unknown[]) => unknown
    ? ReturnType<A> & ReturnTypes<U>
    : void
  : void;

export function useLoad<T extends (...args: unknown[]) => unknown>(input: LoadInput, fn: T): ReturnType<T>;
export function useLoad<T1 extends (...args: unknown[]) => unknown, T2 extends (...args: unknown[]) => unknown>(
  input: LoadInput,
  fn1: T1,
  fn2: T2
): ReturnType<T1> & ReturnType<T2>;
export function useLoad<T extends Array<(...args: unknown[]) => unknown>>(input: LoadInput, ...fns: T): ReturnTypes<T> {
  input.session.fetch = input.fetch;

  patchSession(input.session);

  loadSession.set(input.session);

  try {
    return Object.assign({}, ...fns.map((fn) => fn()));
  } finally {
    loadSession.set(null);
  }
}
