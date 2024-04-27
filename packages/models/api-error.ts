import type { ApiError } from "@bgs/types";
import type { Db, ObjectId, Collection } from "mongodb";

export async function createApiErrorCollection(db: Db): Promise<Collection<ApiError<ObjectId>>> {
  const collection = await db.createCollection<ApiError<ObjectId>>("apierrors", {
    capped: true,
    size: 10 * 1024 * 1024,
    max: 10 * 1000,
  });

  collection.createIndex({ user: 1, createdAt: -1 });

  return collection;
}
