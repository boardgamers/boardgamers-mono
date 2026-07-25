import { z } from "zod";
import type { Jsonify } from "type-fest";
import { zDate } from "./helpers.ts";

export const pageSchema = z.object({
  _id: z.object({
    name: z.string(),
    lang: z.string(),
  }),
  title: z.string(),
  content: z.string(),
  createdAt: zDate().optional(),
  updatedAt: zDate().optional(),
});

export type PageDoc = z.output<typeof pageSchema>;
export type PageFront = Jsonify<PageDoc>;

export const PAGES_COLLECTION = "pages";
