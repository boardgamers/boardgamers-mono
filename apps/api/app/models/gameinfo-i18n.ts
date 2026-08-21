// Per-language overlay for game metadata text (#306). Language negotiation
// itself is shared with the other #306 slices: `negotiateContentLanguage` in
// app/services/language.ts (lang cookie → first Accept-Language base subtag →
// "en") — this module only applies the resolved language to a merged game-info.
import type { GameMetadataDoc } from "@bgs/models";
import type { Context } from "koa";
import { negotiateContentLanguage } from "../services/language.ts";

/** The request's preferred base language subtag (see services/language.ts). */
export function requestLanguage(ctx: Context): string {
	return negotiateContentLanguage(ctx);
}

type Translations = GameMetadataDoc["translations"];

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
