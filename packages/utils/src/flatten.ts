import type { Get, Paths } from "type-fest";
import { isObject } from "./is-object";

export function flatten<T>(
  obj: T,
  alreadyChecked = new Set<unknown>()
): { [key in Paths<T>]: key extends string ? Get<T, key> : never } {
  if (isObject(obj) && !alreadyChecked.has(obj)) {
    alreadyChecked.add(obj);
    return Object.fromEntries(
      Object.entries(obj).flatMap(([key, val]) => {
        const flatVal = flatten(val, alreadyChecked);

        if (isObject(flatVal)) {
          return Object.entries(flatVal).map(([k2, v2]) => [`${key}.${k2}`, v2]);
        }

        return [[key, val]];
      })
    ) as { [key in Paths<T>]: key extends string ? Get<T, key> : never };
  }

  return obj as { [key in Paths<T>]: key extends string ? Get<T, key> : never };
}
