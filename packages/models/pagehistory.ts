import { z } from "zod";
import type { Jsonify } from "type-fest";
import type { IndexDescription } from "mongodb";
import { zObjectId, zDate } from "./helpers.ts";

// One doc per archived version of a content page (PAGES_COLLECTION): the
// page's full state right before an edit or delete, so a bad change can be
// restored. Append-only; the api caps each page at MAX_PAGE_HISTORY_VERSIONS.
export const pageHistorySchema = z.object({
	_id: zObjectId().optional(),
	page: z.object({
		name: z.string(),
		lang: z.string(),
	}),
	title: z.string(),
	content: z.string(),
	editedBy: zObjectId(),
	createdAt: zDate().optional(),
	updatedAt: zDate().optional(),
});

export type PageHistoryDoc = z.output<typeof pageHistorySchema>;
export type PageHistoryFront = Jsonify<PageHistoryDoc>;

export const PAGE_HISTORIES_COLLECTION = "pagehistories";

export const MAX_PAGE_HISTORY_VERSIONS = 50;

export const pageHistoryIndexes: IndexDescription[] = [
	// "Past versions of this page, newest first" (admin history view + retention trim)
	{ key: { page: 1, createdAt: -1 } },
];
