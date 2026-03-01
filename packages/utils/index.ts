export * from "./array.ts";
export * from "./object.ts";
export * from "./remove-falsy.ts";
export * from "./time.ts";

export function isPromise(p: any): p is Promise<any> {
  return typeof p === "object" && "then" in p && typeof p.then === "function";
}
