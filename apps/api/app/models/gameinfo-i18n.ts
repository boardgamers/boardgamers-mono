// Per-language overlay for game metadata text (#306). Language negotiation
// itself is shared with the other #306 slices: `negotiateContentLanguage` in
// app/services/language.ts (lang cookie → first Accept-Language base subtag →
// "en") — this module only applies the resolved language to a merged game-info.
import { createHash } from "node:crypto";
import type { GameMetadataDoc } from "@bgs/models";
import type { Context } from "koa";
import { negotiateContentLanguage } from "../services/language.ts";

/**
 * The request's preferred base language subtag (see services/language.ts).
 * Game-metadata translation keys are base subtags (`gameMetadataTranslationsSchema`),
 * so unlike content pages the region is stripped here (pt-BR → pt).
 */
export function requestLanguage(ctx: Context): string {
	return negotiateContentLanguage(ctx).split("-")[0];
}

type Translations = GameMetadataDoc["translations"];

/**
 * The base (English) description/rules/credits that have a non-empty string —
 * the source the metadata translate endpoints work from, and the input to
 * `metadataSourceHash`. Typed so callers don't need a cast.
 */
export function metadataSourceStrings(doc: {
	description?: string;
	rules?: string;
	credits?: string;
}): Record<string, string> {
	const source: Record<string, string> = {};
	for (const field of ["description", "rules", "credits"] as const) {
		const value = doc[field];
		if (typeof value === "string" && value) {
			source[field] = value;
		}
	}
	return source;
}

/**
 * Content hash of the translation source text, stored as
 * `translations.<lang>.translatedFrom.hash` when an overlay is written. The
 * overlay is OUTDATED when the stored hash differs from the current source's.
 * A hash (not a timestamp) on purpose: the doc's `updatedAt` bumps on every
 * write — likes ($inc likeCount), status recomputes, the overlay write itself —
 * so a timestamp comparison would self-invalidate and decay to noise, while a
 * content hash only moves when the source TEXT changes (and an
 * edit-then-revert correctly reads fresh again). Key order is deterministic:
 * `metadataSourceStrings` inserts in a fixed field order.
 */
export function metadataSourceHash(source: Record<string, string>): string {
	return createHash("sha256").update(JSON.stringify(source)).digest("hex").slice(0, 16);
}

/**
 * Overlay `translations[lang]` onto a merged game-info-like doc, per field with
 * English/base fallback: description/rules/credits resolve to
 * `translations[lang]?.<field> ?? <base field>`. Returns the doc unchanged when
 * `lang` is "en" or no translation exists for `lang` (byte-identical to the
 * pre-#306 response). `doc` may be null (pass-through for merge results).
 */
export function applyGameInfoTranslation<T extends Record<string, unknown> | null>(
	doc: T,
	translations: Translations,
	lang: string,
): T {
	if (!doc || lang === "en" || !translations) {
		return doc;
	}
	const overlay = translations[lang];
	if (!overlay) {
		return doc;
	}
	for (const field of ["description", "rules", "credits"] as const) {
		const translated = overlay[field];
		if (translated !== undefined) {
			doc[field] = translated;
		}
	}
	return doc;
}
