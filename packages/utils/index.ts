export * from "./join-and";
export * from "./remove-falsy";
export * from "./time";

export function isPromise(p: any): p is Promise<any> {
  return typeof p === "object" && "then" in p && typeof p.then === "function";
}
