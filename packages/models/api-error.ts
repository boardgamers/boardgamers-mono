import { z } from "zod";
import type { Jsonify } from "type-fest";
import type { IndexDescription } from "mongodb";
import { zObjectId, zDate } from "./helpers.ts";

export const apiErrorSchema = z.object({
  _id: zObjectId().optional(),
  error: z.object({
    name: z.string(),
    message: z.string(),
    stack: z.array(z.string()),
  }),
  request: z.object({
    url: z.string(),
    method: z.string(),
    body: z.string(),
    status: z.number().optional(),
    id: z.string().optional(),
  }),
  meta: z.unknown(),
  user: zObjectId().optional(),
  createdAt: zDate().optional(),
  updatedAt: zDate().optional(),
});

export type ApiErrorDoc = z.output<typeof apiErrorSchema>;
export type ApiErrorFront = Jsonify<ApiErrorDoc>;

export const API_ERRORS_COLLECTION = "apierrors";

export const apiErrorsCollectionOptions = { size: 10 * 1000 * 1000, max: 10000 };

export const apiErrorIndexes: IndexDescription[] = [
  // api + game-server: admin error listing per user
  { key: { user: 1, createdAt: -1 } },
];
