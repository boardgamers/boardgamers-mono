import { z } from "zod";
import type { IndexDescription } from "mongodb";
import { zDate, zObjectId } from "./helpers.ts";

export const imageSchema = z.object({
  _id: zObjectId().optional(),
  formats: z.array(z.string()),
  images: z.record(
    z.string(),
    z.object({
      mime: z.string(),
      raw: z.instanceof(Buffer),
      size: z.number(),
    })
  ),
  key: z.string(),
  ref: zObjectId(),
  refType: z.literal("User"),
  createdAt: zDate().optional(),
  updatedAt: zDate().optional(),
});

export type ImageDoc = z.output<typeof imageSchema>;

export const IMAGES_COLLECTION = "images";

export const imageIndexes: IndexDescription[] = [
  // api: avatar/image lookup per user
  { key: { ref: 1, key: 1 } },
];
