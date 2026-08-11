import { z } from "zod";
import type { IndexDescription } from "mongodb";
import type { Jsonify } from "type-fest";
import { zObjectId, zDate } from "./helpers.ts";

export const changelogSchema = z.object({
	_id: zObjectId().optional(),
	// The entry: a short one-liner (emoji + description), rendered with `marked`
	// on the homepage announcement box and the /changelog page.
	content: z.string(),
	// Longer markdown shown under the one-liner on /changelog only.
	details: z.string().optional(),
	// Link to the matching PR / commit, shown on /changelog only. http(s)-only:
	// it's bound to a raw <a href>, so javascript:/data: schemes must never validate.
	github: z.httpUrl().optional(),
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
