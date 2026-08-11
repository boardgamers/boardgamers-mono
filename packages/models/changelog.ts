import { z } from "zod";
import type { IndexDescription } from "mongodb";
import type { Jsonify } from "type-fest";
import { zObjectId, zDate } from "./helpers.ts";

export const changelogSchema = z.object({
	_id: zObjectId().optional(),
	title: z.string(),
	// Markdown, rendered with `marked` on the homepage and the /changelog page.
	content: z.string(),
	// Drafts stay invisible on the public routes until published.
	published: z.boolean(),
	createdAt: zDate().optional(),
	updatedAt: zDate().optional(),
});

export type ChangelogDoc = z.output<typeof changelogSchema>;
export type ChangelogFront = Jsonify<ChangelogDoc> & { _id: string };

export const CHANGELOGS_COLLECTION = "changelogs";

export const changelogIndexes: IndexDescription[] = [
	// public + admin: newest-first listing with a createdAt cursor
	{ key: { createdAt: -1 } },
];
