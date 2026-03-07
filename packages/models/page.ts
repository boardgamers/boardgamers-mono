import { z } from "zod";
import type { Jsonify } from "type-fest";

export const pageSchema = z.object({
  _id: z.object({
    name: z.string(),
    lang: z.string(),
  }),
  title: z.string(),
  content: z.string(),
});

export type PageDoc = z.output<typeof pageSchema>;
export type PageFront = Jsonify<PageDoc>;

export const PAGES_COLLECTION = "pages";
