import { z } from "zod";
import type { IndexDescription } from "mongodb";
import type { Jsonify } from "type-fest";
import { zObjectId, zDate } from "./helpers.ts";

// Per-language translations of a changelog entry's text, keyed by base
// language subtag ("de", "fr", …) — the #306 pattern, mirroring
// `gameMetadataTranslationsSchema`. Base subtags only (unlike CMS pages):
// changelog entries are short-lived, regional variants are overkill. The
// top-level content/details stay the English (source) text and the per-field
// fallback; the api serves the winning string in the regular fields at read
// time, so public clients stay unchanged. Not part of `changelogInputSchema`:
// the admin form round-trips only the whitelisted fields, so a regular edit
// can never clobber translations stored on the doc.
export const changelogTranslationsSchema = z.record(
	z.string().regex(/^[a-z]{2,3}$/, "language keys must be base subtags (2–3 lowercase letters)"),
	z.object({
		content: z.string().optional(),
		details: z.string().optional(),
		// Content hash of the source {content, details} the overlay was
		// translated from (the api's `changelogSourceHash`) — same
		// outdated-tracking scheme as game metadata: the overlay is OUTDATED
		// when the current source text hashes differently. A hash, not a
		// timestamp, so unrelated doc writes can't self-invalidate it.
		translatedFrom: z
			.object({
				hash: z.string(),
			})
			.optional(),
	}),
);

export type ChangelogTranslations = z.output<typeof changelogTranslationsSchema>;

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
	// See changelogTranslationsSchema above. Stripped from the public payloads.
	translations: changelogTranslationsSchema.optional(),
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
