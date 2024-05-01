export * from "./join-and";
export * from "./remove-falsy";
export * from "./time";

export function typedInclude<V, T extends V>(arr: readonly T[], v: V): v is T {
  return arr.includes(v as T);
}

export function isPromise(p: unknown): p is Promise<unknown> {
  return typeof p === "object" && "then" in p && typeof p.then === "function";
}
