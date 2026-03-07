export * from "./array.ts";
export * from "./object.ts";
export * from "./remove-falsy.ts";
export * from "./time.ts";

export function isPromise(p: unknown): p is Promise<unknown> {
  return (
    typeof p === "object" && p !== null && "then" in p && typeof (p as Record<string, unknown>).then === "function"
  );
}
