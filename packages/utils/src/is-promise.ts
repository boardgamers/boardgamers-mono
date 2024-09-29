export function isPromise(p: unknown): p is Promise<unknown> {
  return !!p && typeof p === "object" && "then" in p && typeof p.then === "function";
}
