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
	// Set by the LLM translate endpoint (#306): which language version this
	// page was translated from, and that source's updatedAt at translation
	// time. The translation is OUTDATED when the source's current updatedAt is
	// newer. A manual edit clears the field (the translation is then manually
	// maintained, no longer tracked against a source).
	translatedFrom: z
		.object({
			lang: z.string(),
			updatedAt: zDate(),
		})
		.optional(),
	createdAt: zDate().optional(),
	updatedAt: zDate().optional(),
});

export type PageDoc = z.output<typeof pageSchema>;
export type PageFront = Jsonify<PageDoc>;

export const PAGES_COLLECTION = "pages";
