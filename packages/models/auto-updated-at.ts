// oxlint-disable typescript/no-unsafe-type-assertion -- generic passthrough over the driver's overloaded method signatures
import type { Collection, Document } from "mongodb";

/**
 * Wrap a collection so every update/replace bumps `updatedAt`, restoring the
 * Mongoose `timestamps` behaviour the raw driver doesn't have. Regressions here
 * are silent and nasty (e.g. the api's websocket layer polls `games.updatedAt`
 * to push viewer refreshes), so instead of relying on every call site to
 * remember, the collections whose schema carries `updatedAt` are wrapped once
 * at init.
 *
 * - `updateOne` / `updateMany` / `findOneAndUpdate`: merges `updatedAt` into
 *   `$set`, unless the update already touches `updatedAt` (via `$set`, `$unset`
 *   or `$currentDate`). Aggregation-pipeline updates get an appended
 *   `{ $set: { updatedAt: "$$NOW" } }` stage.
 * - `replaceOne` / `findOneAndReplace`: always stamps the replacement — a
 *   fetched doc carries its *old* `updatedAt`, which is indistinguishable from
 *   an intentional one.
 * - Inserts and `bulkWrite` are untouched: insert sites set their own
 *   timestamps explicitly (some schemas require `createdAt` too).
 */
export function withAutoUpdatedAt<T extends Document & { updatedAt?: Date }>(coll: Collection<T>): Collection<T> {
  // oxlint-disable-next-line typescript/no-explicit-any -- generic passthrough of the driver's overloads
  type AnyFn = (...args: any[]) => any;

  const touchesUpdatedAt = (update: Document): boolean =>
    ["$set", "$unset", "$currentDate"].some((op) => update[op] && "updatedAt" in (update[op] as Document));

  const withTimestamp = (update: Document | Document[]): Document | Document[] => {
    if (Array.isArray(update)) {
      return [...update, { $set: { updatedAt: "$$NOW" } }];
    }
    if (touchesUpdatedAt(update)) {
      return update;
    }
    return { ...update, $set: { ...(update.$set as Document), updatedAt: new Date() } };
  };

  return new Proxy(coll, {
    get(target, prop, receiver) {
      switch (prop) {
        case "updateOne":
        case "updateMany":
        case "findOneAndUpdate":
          return ((filter, update, ...rest) =>
            (target[prop] as AnyFn)(filter, withTimestamp(update as Document | Document[]), ...rest)) as AnyFn;
        case "replaceOne":
        case "findOneAndReplace":
          return ((filter, replacement, ...rest) =>
            (target[prop] as AnyFn)(filter, { ...replacement, updatedAt: new Date() }, ...rest)) as AnyFn;
        default: {
          const value = Reflect.get(target, prop, receiver) as unknown;
          return typeof value === "function" ? (value as AnyFn).bind(target) : value;
        }
      }
    },
  });
}
