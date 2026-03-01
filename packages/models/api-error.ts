import type { ApiError } from "@bgs/types";
import type { IndexDescription, ObjectId } from "mongodb";

export interface ApiErrorDoc extends Omit<ApiError<ObjectId>, "updatedAt"> {
  _id?: ObjectId;
  createdAt?: Date;
  updatedAt?: Date;
}

export const API_ERRORS_COLLECTION = "apierrors";

/** Capped collection: 10 MB, max 10k docs */
export const apiErrorsCollectionOptions = { capped: true, size: 10 * 1000 * 1000, max: 10000 } as const;

export const apiErrorIndexes: IndexDescription[] = [
  // api: admin error listing per user; game-server: same
  { key: { user: 1, createdAt: -1 } },
];
